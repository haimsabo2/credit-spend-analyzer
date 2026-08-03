"""Treat merchant-spend-group members as not needing manual review (parent is the group)."""

from __future__ import annotations

from sqlalchemy import exists, select
from sqlmodel import Session, func

from ..models import MerchantSpendGroup, MerchantSpendGroupMember, Transaction
from ..utils import normalize_merchant_pattern_key


def transaction_not_in_merchant_spend_group_clause():
    """Correlated NOT EXISTS for use in Transaction queries (matches pattern_key)."""
    return ~exists(
        select(MerchantSpendGroupMember.id).where(
            MerchantSpendGroupMember.pattern_key == func.lower(func.trim(Transaction.description))
        )
    )


def transaction_in_spend_group_clause(group_id: int):
    """Correlated EXISTS: transaction description matches a member of this spend group."""
    return exists(
        select(MerchantSpendGroupMember.id).where(
            MerchantSpendGroupMember.group_id == group_id,
            MerchantSpendGroupMember.pattern_key == func.lower(func.trim(Transaction.description)),
        )
    )


def spend_group_display_names_by_pattern_keys(
    session: Session, pattern_keys: set[str]
) -> dict[str, str]:
    """pattern_key -> group display_name for members of a merchant spend group."""
    if not pattern_keys:
        return {}
    stmt = (
        select(MerchantSpendGroupMember.pattern_key, MerchantSpendGroup.display_name)
        .select_from(MerchantSpendGroupMember)
        .join(
            MerchantSpendGroup,
            MerchantSpendGroupMember.group_id == MerchantSpendGroup.id,
        )
        .where(MerchantSpendGroupMember.pattern_key.in_(pattern_keys))
    )
    rows = session.exec(stmt).all()
    return {str(pk): name for pk, name in rows}


def transaction_pattern_in_spend_group(session: Session, description: str | None) -> bool:
    pk = normalize_merchant_pattern_key(description or "")
    if not pk:
        return False
    return (
        session.exec(
            select(MerchantSpendGroupMember.id).where(MerchantSpendGroupMember.pattern_key == pk)
        ).first()
        is not None
    )


def clear_needs_review_if_spend_group_member(session: Session, txn: Transaction) -> None:
    """If description matches a spend group, do not flag for uncategorized transaction lists."""
    if transaction_pattern_in_spend_group(session, txn.description):
        txn.needs_review = False
