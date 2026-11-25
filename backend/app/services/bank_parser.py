"""Parser and deterministic row-signature generator for Bank Leumi checking statements (.xls)."""

from __future__ import annotations

import hashlib
import html
import io
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from html.parser import HTMLParser
from typing import Optional

import pandas as pd

_BIDI_MARKS_RE = re.compile(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]")
_DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$")
_ACCOUNT_RE = re.compile(r"מס['׳`]?\s*חשבון\s*:?\s*([\d\-/]{5,30})")


@dataclass
class ParsedBankRow:
    account_number: str
    activity_date: date
    value_date: Optional[date]
    month: str
    chronological_order: int
    description: str
    reference: str
    debit: float
    credit: float
    balance: Optional[float]
    row_signature: str


@dataclass
class BankParseResult:
    account_number: str
    rows: list[ParsedBankRow]
    date_from: Optional[date]
    date_to: Optional[date]


class _LeafTableRowParser(HTMLParser):
    """Extract leaf <tr> cells from nested Bank Leumi HTML exports without duplicating wrapper rows."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._stack: list[dict] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        t = tag.lower()
        if t == "tr":
            if self._stack:
                self._stack[-1]["has_child_tr"] = True
            self._stack.append(
                {"cells": [], "in_td": False, "buf": [], "has_child_tr": False}
            )
        elif t in ("td", "th") and self._stack:
            self._stack[-1]["in_td"] = True
            self._stack[-1]["buf"] = []

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ("td", "th") and self._stack and self._stack[-1]["in_td"]:
            cur = self._stack[-1]
            cur["in_td"] = False
            raw_cell = html.unescape("".join(cur["buf"]))
            cleaned = _clean_text(raw_cell)
            cur["cells"].append(cleaned)
        elif t == "tr" and self._stack:
            cur = self._stack.pop()
            if not cur["has_child_tr"] and cur["cells"]:
                self.rows.append(cur["cells"])

    def handle_data(self, data: str) -> None:
        if self._stack and self._stack[-1]["in_td"]:
            self._stack[-1]["buf"].append(data)


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    s = str(value)
    s = _BIDI_MARKS_RE.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _normalize_desc_key(desc: str) -> str:
    s = _clean_text(desc)
    nfkd = unicodedata.normalize("NFKD", s)
    stripped = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    return stripped.lower()


def _parse_bank_date(val: str) -> Optional[date]:
    s = _clean_text(val)
    m = _DATE_RE.match(s)
    if not m:
        return None
    d_str, m_str, y_str = m.groups()
    yr = int(y_str)
    if yr < 100:
        yr += 2000
    try:
        return date(yr, int(m_str), int(d_str))
    except ValueError:
        return None


def _parse_bank_amount(val: str) -> Optional[float]:
    s = _clean_text(val)
    if not s:
        return None
    s = s.replace(",", "").replace("₪", "").replace("−", "-").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _decode_html_bytes(content: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1255", "iso-8859-8"):
        try:
            decoded = content.decode(enc)
            if "תאריך" in decoded or "תנועות" in decoded or "<table" in decoded.lower():
                return decoded
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _extract_raw_rows_from_excel_fallback(content: bytes) -> tuple[str, list[list[str]]]:
    """Fallback for binary .xls / .xlsx bank statements."""
    df_list = []
    try:
        df_list = [pd.read_excel(io.BytesIO(content), header=None, dtype=str)]
    except Exception:
        return "", []
    if not df_list:
        return "", []
    df = df_list[0].fillna("")
    rows: list[list[str]] = []
    acct = ""
    for _, series in df.iterrows():
        cells = [_clean_text(v) for v in series.tolist()]
        joined = " ".join(c for c in cells if c)
        if not acct:
            m = _ACCOUNT_RE.search(joined)
            if m:
                acct = m.group(1)
        if any(cells):
            rows.append(cells)
    return acct, rows


def compute_bank_row_signature(
    *,
    account_number: str,
    activity_date: date,
    value_date: Optional[date],
    description: str,
    reference: str,
    debit: float,
    credit: float,
    same_day_occurrence: int,
) -> str:
    """Compute a deterministic SHA-256 signature independent of running balance.

    Including ``same_day_occurrence`` (0, 1, ...) ensures two legitimate identical transfers
    on the same date are both preserved on first upload AND both skipped on overlapping re-uploads.
    """
    canonical = "|".join(
        [
            _clean_text(account_number),
            activity_date.isoformat(),
            value_date.isoformat() if value_date else "",
            _normalize_desc_key(description),
            _clean_text(reference),
            f"{debit:.2f}",
            f"{credit:.2f}",
            f"occ={same_day_occurrence}",
        ]
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parse_bank_statement_bytes(content: bytes) -> BankParseResult:
    """Parse a Bank Leumi checking-account .xls statement (HTML table or binary Excel)."""
    if not content:
        raise ValueError("קובץ תדפיס הבנק ריק.")

    account_number = ""
    raw_rows: list[list[str]] = []

    head_lower = content[:2048].lower()
    is_html_like = (
        b"<html" in head_lower
        or b"<table" in head_lower
        or b"<!doctype" in head_lower
        or b"<meta" in head_lower
    )

    if is_html_like:
        html_text = _decode_html_bytes(content)
        clean_header_scan = _BIDI_MARKS_RE.sub("", html.unescape(html_text))
        m_acct = _ACCOUNT_RE.search(clean_header_scan)
        if m_acct:
            account_number = m_acct.group(1).strip()
        parser = _LeafTableRowParser()
        parser.feed(html_text)
        raw_rows = parser.rows
    else:
        account_number, raw_rows = _extract_raw_rows_from_excel_fallback(content)
        if not raw_rows:
            # Try HTML decode anyway in case file has leading whitespace/BOM without html tag
            html_text = _decode_html_bytes(content)
            clean_header_scan = _BIDI_MARKS_RE.sub("", html.unescape(html_text))
            m_acct = _ACCOUNT_RE.search(clean_header_scan)
            if m_acct:
                account_number = m_acct.group(1).strip()
            parser = _LeafTableRowParser()
            parser.feed(html_text)
            raw_rows = parser.rows

    extracted: list[dict] = []
    for cells in raw_rows:
        if not account_number:
            joined = " ".join(cells)
            m_acct = _ACCOUNT_RE.search(joined)
            if m_acct:
                account_number = m_acct.group(1).strip()
        if len(cells) < 6:
            continue
        act_date = _parse_bank_date(cells[0])
        if act_date is None:
            continue
        val_date = _parse_bank_date(cells[1])
        desc = _clean_text(cells[2])
        ref = _clean_text(cells[3])
        debit = _parse_bank_amount(cells[4]) or 0.0
        credit = _parse_bank_amount(cells[5]) or 0.0
        balance = _parse_bank_amount(cells[6]) if len(cells) >= 7 else None
        if debit == 0.0 and credit == 0.0 and not desc:
            continue
        extracted.append(
            {
                "activity_date": act_date,
                "value_date": val_date,
                "description": desc,
                "reference": ref,
                "debit": round(debit, 2),
                "credit": round(credit, 2),
                "balance": round(balance, 2) if balance is not None else None,
            }
        )

    if not extracted:
        raise ValueError(
            "לא זוהו שורות תנועות בחשבון בקובץ. ודא שמדובר בייצוא תנועות בחשבון (.xls) מבנק לאומי."
        )

    # Bank Leumi exports newest-first; reverse to strictly chronological oldest -> newest
    # while preserving exact intra-day chronological sequence (bottom-to-top).
    if extracted[0]["activity_date"] > extracted[-1]["activity_date"]:
        extracted.reverse()
    elif (
        len(extracted) > 2
        and extracted[0]["activity_date"] == extracted[-1]["activity_date"]
    ):
        # Single-day export: check running balance direction if available
        b0, b1 = extracted[0]["balance"], extracted[-1]["balance"]
        net_last = extracted[0]["credit"] - extracted[0]["debit"]
        if b0 is not None and b1 is not None and abs((b1 + net_last) - b0) < 1.0:
            extracted.reverse()

    acct = account_number or "checking-default"
    same_day_occurrence_counter: Counter[str] = Counter()
    same_day_chrono_counter: Counter[date] = Counter()
    parsed_rows: list[ParsedBankRow] = []

    for item in extracted:
        act_d: date = item["activity_date"]
        val_d: Optional[date] = item["value_date"]
        desc: str = item["description"]
        ref: str = item["reference"]
        deb: float = item["debit"]
        cred: float = item["credit"]
        bal: Optional[float] = item["balance"]

        base_dup_key = "|".join(
            [
                acct,
                act_d.isoformat(),
                val_d.isoformat() if val_d else "",
                _normalize_desc_key(desc),
                ref,
                f"{deb:.2f}",
                f"{cred:.2f}",
            ]
        )
        occ_idx = same_day_occurrence_counter[base_dup_key]
        same_day_occurrence_counter[base_dup_key] += 1

        chrono_idx = same_day_chrono_counter[act_d]
        same_day_chrono_counter[act_d] += 1

        sig = compute_bank_row_signature(
            account_number=acct,
            activity_date=act_d,
            value_date=val_d,
            description=desc,
            reference=ref,
            debit=deb,
            credit=cred,
            same_day_occurrence=occ_idx,
        )

        parsed_rows.append(
            ParsedBankRow(
                account_number=acct,
                activity_date=act_d,
                value_date=val_d,
                month=f"{act_d.year:04d}-{act_d.month:02d}",
                chronological_order=chrono_idx,
                description=desc,
                reference=ref,
                debit=deb,
                credit=cred,
                balance=bal,
                row_signature=sig,
            )
        )

    dates = [r.activity_date for r in parsed_rows]
    return BankParseResult(
        account_number=acct,
        rows=parsed_rows,
        date_from=min(dates) if dates else None,
        date_to=max(dates) if dates else None,
    )
