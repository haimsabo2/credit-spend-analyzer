"""Keyword-based dictionary categorizer for common merchants."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..models import Transaction
from .categories import LEISURE_CATEGORY_NAME_HE, RESTAURANTS_SUBCATEGORY_NAME_HE

DICTIONARY: dict[str, list[str]] = {
    "סופר ומכולת": [
        "שופרסל", "רמי לוי", "ויקטורי", "יוחננוף", "מגה",
    ],
    "תחבורה ודלק": [
        "פז", "דלק", "דור אלון", "סונול",
    ],
    # Dining / delivery → leisure parent + restaurants subcategory
    LEISURE_CATEGORY_NAME_HE: [
        "wolt",
        "תן ביס",
        "תןביס",
        "cibus",
    ],
    "מנויים ודיגיטל": [
        "netflix", "spotify", "openai", "chatgpt", "apple.com/bill", "google*",
    ],
    "בריאות": [
        "כללית", "מכבי", "מאוחדת", "לאומית", "בית חולים", "מרפאה", "רוקח",
    ],
    "מיסים ואגרות": [
        "ארנונה", "עירייה", "מס הכנסה", "ביטוח לאומי", "רשות המיסים",
    ],
    "ביטוחים": [
        "הראל", "מגדל", "כלל ביטוח", "מנורה", "ביטוח",
    ],
    "עמלות וכרטיס": [
        "עמלת", "דמי כרטיס", "עמלות",
    ],
    "חינוך וחוגים": [
        "חוג", "גן", "בית ספר", "שיעור", "קורס",
    ],
}


@dataclass
class DictMatch:
    category_name_he: str
    confidence: float
    reason_he: str
    subcategory_name_he: Optional[str] = None


def dictionary_categorize(tx: Transaction) -> Optional[DictMatch]:
    """Try to categorize *tx* using keyword dictionary. Returns None if no match."""
    text = (tx.description or "").lower()
    if not text:
        return None

    for category, keywords in DICTIONARY.items():
        for kw in keywords:
            if kw.lower() in text:
                sub: Optional[str] = (
                    RESTAURANTS_SUBCATEGORY_NAME_HE
                    if category == LEISURE_CATEGORY_NAME_HE
                    else None
                )
                return DictMatch(
                    category_name_he=category,
                    confidence=0.8,
                    reason_he=f'מילון: "{kw}"',
                    subcategory_name_he=sub,
                )
    return None
