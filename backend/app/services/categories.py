"""Hebrew category seed and lookup helpers."""

from __future__ import annotations

from typing import Optional

from sqlmodel import Session, select

from ..models import Category, Subcategory

# "מסעדות ובתי קפה" is a subcategory under leisure, not a top-level seed category.
LEISURE_CATEGORY_NAME_HE = "בילויים ופנאי"
RESTAURANTS_SUBCATEGORY_NAME_HE = "מסעדות ובתי קפה"
# Legacy: same Hebrew label existed as its own Category row; migration moves it under leisure.
LEGACY_RESTAURANTS_TOP_CATEGORY_NAME_HE = "מסעדות ובתי קפה"

SEED_CATEGORIES_HE: tuple[str, ...] = (
    "דיור ומשכנתא",
    "חשבונות ושירותים",
    "סופר ומכולת",
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


def ensure_default_subcategories(session: Session) -> None:
    """Ensure canonical subcategories exist under selected parents (idempotent)."""
    leisure = session.exec(
        select(Category).where(Category.name == LEISURE_CATEGORY_NAME_HE)
    ).first()
    if not leisure or leisure.id is None:
        return
    exists = session.exec(
        select(Subcategory).where(
            Subcategory.category_id == leisure.id,
            Subcategory.name == RESTAURANTS_SUBCATEGORY_NAME_HE,
        )
    ).first()
    if not exists:
        session.add(
            Subcategory(
                category_id=leisure.id,
                name=RESTAURANTS_SUBCATEGORY_NAME_HE,
            )
        )
    session.commit()


def get_category_id_by_name_he(session: Session, name_he: str) -> Optional[int]:
    """Return the category id for a Hebrew name, or None if not found."""
    cat = session.exec(
        select(Category).where(Category.name == name_he)
    ).first()
    return cat.id if cat else None


def get_subcategory_id_by_parent_and_name(
    session: Session, category_id: int, sub_name_he: str
) -> Optional[int]:
    """Return subcategory id under *category_id* by exact name, or None."""
    name = (sub_name_he or "").strip()
    if not name:
        return None
    sub = session.exec(
        select(Subcategory).where(
            Subcategory.category_id == category_id,
            Subcategory.name == name,
        )
    ).first()
    return sub.id if sub else None


def resolve_llm_category_subcategory_names(
    category_name_he: str, subcategory_name_he: Optional[str]
) -> tuple[str, Optional[str]]:
    """Map legacy top-level restaurant category to leisure + restaurants sub."""
    cat = (category_name_he or "").strip()
    sub = (subcategory_name_he or "").strip() or None
    if cat == LEGACY_RESTAURANTS_TOP_CATEGORY_NAME_HE:
        return (LEISURE_CATEGORY_NAME_HE, sub or RESTAURANTS_SUBCATEGORY_NAME_HE)
    return (cat, sub)
