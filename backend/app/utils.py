from __future__ import annotations

from datetime import date, timedelta
from typing import List, Optional

_SHEKEL_ALIASES = frozenset({"₪", "NIS", "ILS"})


def normalize_currency_code(value: Optional[str]) -> Optional[str]:
    """Normalize a stored currency code for API output.

    Maps ``"₪"``, ``"NIS"`` and ``"ILS"`` to the shekel symbol ``₪``.
    Other values are upper-cased.  ``None`` passes through unchanged.
    """
    if value is None:
        return None
    upper = value.strip().upper()
    if upper in _SHEKEL_ALIASES or value.strip() == "₪":
        return "₪"
    return upper


def prior_months(month: str, count: int) -> List[str]:
    """Return *count* YYYY-MM strings preceding *month*, oldest first."""
    year, mon = int(month[:4]), int(month[5:7])
    d = date(year, mon, 1)
    result: list[str] = []
    for _ in range(count):
        d -= timedelta(days=1)
        d = d.replace(day=1)
        result.append(f"{d.year:04d}-{d.month:02d}")
    result.reverse()
    return result


def next_month(month: str) -> str:
    """Return the YYYY-MM string for the month after *month*."""
    year, mon = int(month[:4]), int(month[5:7])
    d = date(year, mon, 28) + timedelta(days=4)
    d = d.replace(day=1)
    return f"{d.year:04d}-{d.month:02d}"
