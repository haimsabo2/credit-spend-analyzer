"""Hebrew category seed and lookup helpers."""

from __future__ import annotations

from typing import Optional

from sqlmodel import Session, select

from ..models import Category

SEED_CATEGORIES_HE: tuple[str, ...] = (
    "דיור ומשכנתא",
    "חשבונות ושירותים",
    "סופר ומכולת",
    "מסעדות ובתי קפה",
    "תחבורה ודלק",
    "רכב",
    "בריאות",
    "חינוך וחוגים",
    "ביטוחים",
    "ביגוד והנעלה",
    "קניות לבית",
    "בילויים ופנאי",
    "נסיעות וחו\"ל",
    "מנויים ודיגיטל",
    "עמלות וכרטיס",
    "מיסים ואגרות",
    "תרומות ומתנות",
    "העברות ותשלומים",
    "אחר",
)


def ensure_seed_categories(session: Session) -> None:
    """Ensure all Hebrew system categories exist. Idempotent per category name."""
    for name in SEED_CATEGORIES_HE:
        exists = session.exec(
            select(Category).where(
                Category.name == name,
                Category.is_system == True,  # noqa: E712
            )
        ).first()
        if not exists:
            session.add(Category(name=name, is_system=True))
    session.commit()


def get_category_id_by_name_he(session: Session, name_he: str) -> Optional[int]:
    """Return the category id for a Hebrew name, or None if not found."""
    cat = session.exec(
        select(Category).where(Category.name == name_he)
    ).first()
    return cat.id if cat else None
