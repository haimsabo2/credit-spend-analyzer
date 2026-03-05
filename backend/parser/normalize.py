from __future__ import annotations

import hashlib
import logging
import re
import unicodedata
from datetime import date, datetime, timedelta
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)


def _is_na(value: object) -> bool:
    try:
        return pd.isna(value)  # type: ignore[arg-type]
    except TypeError:
        return False


def parse_hebrew_report_date(value: object) -> Optional[date]:
    """Parse a date value from the legacy report.

    Supports:
    - Excel serial numbers.
    - datetime/date instances.
    - Strings in formats like DD/MM/YY or DD/MM/YYYY.
    """
    if value is None or _is_na(value):
        return None

    if isinstance(value, date) and not isinstance(value, datetime):
        return value

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # Excel serial number: days since 1899-12-30
        try:
            base = date(1899, 12, 30)
            days = int(value)
            if days <= 0:
                return None
            return base + timedelta(days=days)
        except Exception:
            logger.debug("Failed to parse Excel serial date from %r", value)
            return None

    text = str(value).strip()
    if not text:
        return None

    # Look for a date-like token inside the string.
    m = re.search(r"(\d{1,2}/\d{1,2}/\d{2,4})", text)
    if m:
        text = m.group(1)

    for fmt in ("%d/%m/%y", "%d/%m/%Y"):
        try:
            dt = datetime.strptime(text, fmt)
            return dt.date()
        except ValueError:
            continue

    logger.debug("Could not parse report date from %r", value)
    return None


def parse_amount(value: object) -> Optional[float]:
    """Parse a numeric amount from the report."""
    if value is None or _is_na(value):
        return None

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    # Remove thousands separators and normalize minus.
    text = text.replace("\u200f", "")  # RTL mark if present
    text = text.replace(",", "")
    text = text.replace("−", "-")  # minus sign variant

    try:
        return float(text)
    except ValueError:
        logger.debug("Could not parse amount from %r", value)
        return None


_SHEKEL_ALIASES = frozenset({"₪", "NIS", "ILS"})


def normalize_currency(value: object) -> Optional[str]:
    """Normalize currency codes to canonical Unicode strings.

    Treats ``"₪"``, ``"NIS"`` and ``"ILS"`` as the shekel symbol ``₪``.
    All other currencies are upper-cased (e.g. ``"usd"`` -> ``"USD"``).
    """
    if value is None or _is_na(value):
        return None

    text = str(value).strip()
    if not text:
        return None

    upper = text.upper()
    if upper in _SHEKEL_ALIASES or text == "₪":
        return "₪"
    return upper


def normalize_merchant(merchant_raw: str) -> str:
    """Normalize merchant text into a stable key."""
    if merchant_raw is None:
        return ""

    text = str(merchant_raw).strip()
    if not text:
        return ""

    # Collapse whitespace.
    text = re.sub(r"\s+", " ", text)

    # Normalize unicode (remove most diacritics but keep base chars).
    nfkd = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in nfkd if not unicodedata.combining(ch))

    # Lowercase for stability; Hebrew letters are unaffected.
    return stripped.lower()


def compute_row_signature(
    *,
    card_label: str,
    charge_cycle_date: Optional[date],
    section: Optional[str],
    purchase_date: Optional[date],
    charge_date: Optional[date],
    amount_charged: Optional[float],
    merchant_key: str,
) -> str:
    """Compute a stable SHA-256 based signature for a transaction row."""
    parts = [
        card_label or "",
        charge_cycle_date.isoformat() if charge_cycle_date else "",
        section or "",
        purchase_date.isoformat() if purchase_date else "",
        (charge_date or charge_cycle_date).isoformat()
        if (charge_date or charge_cycle_date)
        else "",
        f"{amount_charged:.2f}" if amount_charged is not None else "",
        merchant_key or "",
    ]
    canonical = "|".join(parts)
    if not canonical.strip():
        return ""

    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

