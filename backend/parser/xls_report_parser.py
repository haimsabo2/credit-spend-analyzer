from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import List, Optional, Sequence

import pandas as pd
from pydantic import BaseModel

from .normalize import (
    compute_row_signature,
    normalize_currency,
    normalize_merchant,
    parse_amount,
    parse_hebrew_report_date,
)

logger = logging.getLogger(__name__)


class TransactionNormalized(BaseModel):
    """Normalized transaction extracted from a legacy XLS report."""

    upload_id: Optional[int] = None
    card_label: Optional[str]
    charge_cycle_date: Optional[date]
    section: Optional[str]
    purchase_date: Optional[date]
    charge_date: Optional[date] = None
    merchant_raw: str
    merchant_key: str
    amount_original: Optional[float]
    currency_original: Optional[str]
    amount_charged: float
    currency_charged: Optional[str]
    voucher_number: Optional[str] = None
    details: Optional[str] = None
    row_signature: str


@dataclass
class _ParserState:
    current_card_label: Optional[str] = None
    pending_card_label: Optional[str] = None
    charge_cycle_date: Optional[date] = None
    section: Optional[str] = None  # "IL" or "FOREIGN"
    in_il_table: bool = False
    in_foreign_table: bool = False


class XlsReportParser:
    """State-machine-based parser for legacy credit-card XLS reports."""

    def __init__(self, df: pd.DataFrame, upload_id: Optional[int] = None) -> None:
        # Keep only the first 8 columns as per requirements.
        if df.shape[1] > 8:
            df = df.iloc[:, :8]
        self.df = df
        self.upload_id = upload_id
        self.state = _ParserState()
        self.noise_rows_skipped: int = 0

    @classmethod
    def from_xls_path(
        cls,
        path: Path | str,
        upload_id: Optional[int] = None,
    ) -> "XlsReportParser":
        path = Path(path)
        df = pd.read_excel(
            path,
            header=None,
            usecols=range(8),
            engine="xlrd",
        )
        return cls(df, upload_id=upload_id)

    def parse(self) -> List[TransactionNormalized]:
        """Parse the XLS report into normalized transactions."""
        transactions: List[TransactionNormalized] = []

        for idx in range(len(self.df)):
            row = self.df.iloc[idx]
            cells = list(row.values.tolist())
            str_cells = self._cells_to_strings(cells)
            line_text = " ".join(c for c in str_cells if c).strip()

            if not line_text:
                # Blank rows end any active table.
                if self.state.in_il_table or self.state.in_foreign_table:
                    self.state.in_il_table = False
                    self.state.in_foreign_table = False
                continue

            # Detect card label and charge cycle context.
            self._update_card_context(str_cells, line_text)

            # Detect section markers.
            self._update_section(line_text)

            # Detect headers for IL / FOREIGN tables.
            if self._is_il_header(line_text):
                logger.debug("Detected IL header at row %s", idx)
                self.state.in_il_table = True
                self.state.in_foreign_table = False
                continue

            if self._is_foreign_header(line_text):
                logger.debug("Detected FOREIGN header at row %s", idx)
                self.state.in_foreign_table = True
                self.state.in_il_table = False
                continue

            # Skip obvious noise / subtotal lines.
            if self._is_noise_row(line_text):
                logger.debug("Skipping noise row %s: %r", idx, line_text)
                self.noise_rows_skipped += 1
                continue

            tx: Optional[TransactionNormalized] = None
            if self.state.in_il_table and self.state.section == "IL":
                tx = self._parse_il_row(cells)
            elif self.state.in_foreign_table and self.state.section == "FOREIGN":
                tx = self._parse_foreign_row(cells)

            if tx is not None:
                transactions.append(tx)

        return transactions

    # --------------------------------------------------------------------- #
    # Context / detection helpers
    # --------------------------------------------------------------------- #

    @staticmethod
    def _cells_to_strings(cells: Sequence[object]) -> List[str]:
        values: List[str] = []
        for value in cells:
            if value is None or pd.isna(value):
                values.append("")
            else:
                values.append(str(value).strip())
        return values

    def _update_card_context(self, str_cells: List[str], line_text: str) -> None:
        # Detect candidate card label lines that look like: "... - 8838"
        for cell in str_cells:
            if not cell:
                continue
            if "-" in cell and re.search(r"\d{4}\b", cell):
                self.state.pending_card_label = cell.strip()

        if "מועד חיוב" in line_text:
            # Find a date value in the row.
            charge_date: Optional[date] = None
            for cell in str_cells:
                candidate = parse_hebrew_report_date(cell)
                if candidate:
                    charge_date = candidate
                    break

            if charge_date:
                self.state.charge_cycle_date = charge_date
                if self.state.pending_card_label:
                    self.state.current_card_label = self.state.pending_card_label
                logger.debug(
                    "Updated card context: label=%r, charge_cycle_date=%s",
                    self.state.current_card_label,
                    self.state.charge_cycle_date,
                )

    def _update_section(self, line_text: str) -> None:
        normalized = line_text.replace('"', "").replace("˝", "")
        if "עסקאות בארץ" in normalized:
            self.state.section = "IL"
            logger.debug("Switched section to IL")
        elif "עסקאות בחו" in normalized:
            self.state.section = "FOREIGN"
            logger.debug("Switched section to FOREIGN")

    @staticmethod
    def _is_il_header(line_text: str) -> bool:
        required_keywords = [
            "תאריך רכישה",
            "שם בית עסק",
            "סכום עסקה",
            "מטבע מקור",
            "סכום חיוב",
            "מטבע לחיוב",
        ]
        return all(kw in line_text for kw in required_keywords)

    @staticmethod
    def _is_foreign_header(line_text: str) -> bool:
        required_keywords = [
            "תאריך רכישה",
            "תאריך חיוב",
            "שם בית עסק",
            "סכום מקורי",
            "מטבע מקור",
            "סכום חיוב",
            "מטבע לחיוב",
        ]
        return all(kw in line_text for kw in required_keywords)

    @staticmethod
    def _is_noise_row(line_text: str) -> bool:
        if not line_text:
            return True
        noise_markers = [
            "סך חיוב",
            "TOTAL FOR DATE",
            "סה\"כ",
        ]
        return any(marker in line_text for marker in noise_markers)

    # --------------------------------------------------------------------- #
    # Row parsing
    # --------------------------------------------------------------------- #

    def _build_signature(
        self,
        *,
        purchase_date: Optional[date],
        charge_date: Optional[date],
        amount_charged: Optional[float],
        merchant_key: str,
    ) -> str:
        return compute_row_signature(
            card_label=self.state.current_card_label or "",
            charge_cycle_date=self.state.charge_cycle_date,
            section=self.state.section,
            purchase_date=purchase_date,
            charge_date=charge_date,
            amount_charged=amount_charged,
            merchant_key=merchant_key,
        )

    def _parse_il_row(self, cells: Sequence[object]) -> Optional[TransactionNormalized]:
        if len(cells) < 6:
            return None

        purchase_date = parse_hebrew_report_date(cells[0])
        merchant_raw = "" if cells[1] is None or pd.isna(cells[1]) else str(cells[1]).strip()
        amount_original = parse_amount(cells[2]) if len(cells) > 2 else None
        currency_original = normalize_currency(cells[3]) if len(cells) > 3 else None
        amount_charged = parse_amount(cells[4]) if len(cells) > 4 else None
        currency_charged = normalize_currency(cells[5]) if len(cells) > 5 else None
        voucher_number = None
        details = None
        if len(cells) > 6 and cells[6] is not None and not pd.isna(cells[6]):
            voucher_number = str(cells[6]).strip() or None
        if len(cells) > 7 and cells[7] is not None and not pd.isna(cells[7]):
            details = str(cells[7]).strip() or None

        if not merchant_raw or purchase_date is None or amount_charged is None:
            return None

        merchant_key = normalize_merchant(merchant_raw)
        charge_date = self.state.charge_cycle_date
        signature = self._build_signature(
            purchase_date=purchase_date,
            charge_date=charge_date,
            amount_charged=amount_charged,
            merchant_key=merchant_key,
        )
        if not signature:
            return None

        return TransactionNormalized(
            upload_id=self.upload_id,
            card_label=self.state.current_card_label,
            charge_cycle_date=self.state.charge_cycle_date,
            section=self.state.section,
            purchase_date=purchase_date,
            charge_date=charge_date,
            merchant_raw=merchant_raw,
            merchant_key=merchant_key,
            amount_original=amount_original,
            currency_original=currency_original,
            amount_charged=amount_charged,
            currency_charged=currency_charged,
            voucher_number=voucher_number,
            details=details,
            row_signature=signature,
        )

    def _parse_foreign_row(
        self,
        cells: Sequence[object],
    ) -> Optional[TransactionNormalized]:
        if len(cells) < 7:
            return None

        purchase_date = parse_hebrew_report_date(cells[0])
        charge_date = parse_hebrew_report_date(cells[1]) or self.state.charge_cycle_date
        merchant_raw = "" if cells[2] is None or pd.isna(cells[2]) else str(cells[2]).strip()
        amount_original = parse_amount(cells[3]) if len(cells) > 3 else None
        currency_original = normalize_currency(cells[4]) if len(cells) > 4 else None
        amount_charged = parse_amount(cells[5]) if len(cells) > 5 else None
        currency_charged = normalize_currency(cells[6]) if len(cells) > 6 else None

        if not merchant_raw or purchase_date is None or amount_charged is None:
            return None

        merchant_key = normalize_merchant(merchant_raw)
        signature = self._build_signature(
            purchase_date=purchase_date,
            charge_date=charge_date,
            amount_charged=amount_charged,
            merchant_key=merchant_key,
        )
        if not signature:
            return None

        return TransactionNormalized(
            upload_id=self.upload_id,
            card_label=self.state.current_card_label,
            charge_cycle_date=self.state.charge_cycle_date,
            section=self.state.section,
            purchase_date=purchase_date,
            charge_date=charge_date,
            merchant_raw=merchant_raw,
            merchant_key=merchant_key,
            amount_original=amount_original,
            currency_original=currency_original,
            amount_charged=amount_charged,
            currency_charged=currency_charged,
            voucher_number=None,
            details=None,
            row_signature=signature,
        )


def parse_xls_report(
    path: Path | str,
    upload_id: Optional[int] = None,
) -> List[TransactionNormalized]:
    """Convenience function to parse an XLS report from a file path."""
    parser = XlsReportParser.from_xls_path(path, upload_id=upload_id)
    return parser.parse()

