"""Keyword-based dictionary categorizer for common merchants."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..models import Transaction

DICTIONARY: dict[str, list[str]] = {
    "סופר ומכולת": [
        "שופרסל", "רמי לוי", "ויקטורי", "יוחננוף", "מגה",
    ],
    "תחבורה ודלק": [
        "פז", "דלק", "דור אלון", "סונול",
    ],
    "מסעדות ובתי קפה": [
        "wolt", "תן ביס", "תןביס", "cibus",
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


def dictionary_categorize(tx: Transaction) -> Optional[DictMatch]:
    """Try to categorize *tx* using keyword dictionary. Returns None if no match."""
    text = (tx.description or "").lower()
    if not text:
        return None

    for category, keywords in DICTIONARY.items():
        for kw in keywords:
            if kw.lower() in text:
                return DictMatch(
                    category_name_he=category,
                    confidence=0.8,
                    reason_he=f'מילון: "{kw}"',
                )
    return None
