"""Detect merchants (normalized description) whose transactions disagree on category_id."""

from __future__ import annotations

from sqlalchemy import text
from sqlmodel import Session


def merchant_category_conflict_pattern_keys(session: Session) -> frozenset[str]:
    """Return pattern keys where more than one distinct category bucket appears.

    Buckets use COALESCE(cast(category_id AS TEXT), '') so uncategorized rows
    (NULL) are distinct from any numeric category.
    """
    stmt = text(
        """
        SELECT lower(trim(description)) AS pk
        FROM "transaction"
        WHERE trim(description) != ''
        GROUP BY pk
        HAVING COUNT(DISTINCT COALESCE(CAST(category_id AS TEXT), '')) > 1
        """
    )
    rows = session.execute(stmt).all()
    return frozenset(r[0] for r in rows if r[0])
