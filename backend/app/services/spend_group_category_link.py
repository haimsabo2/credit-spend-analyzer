"""Link merchant spend groups to categories and propagate rules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlmodel import Session, select

from ..models import (
    Category,
    MerchantSpendGroup,
    MerchantSpendGroupMember,
    Subcategory,
)
from .classification import upsert_merchant_key_rule_and_propagate
from .merchant_subcategory import (
    apply_merchant_subcategory_preference,
    ensure_merchant_key_user_approval,
)

SpendGroupLinkMode = Literal["rollup", "as_subcategory"]
SPEND_GROUP_LINK_MODES: frozenset[str] = frozenset({"rollup", "as_subcategory"})


@dataclass
class SpendGroupLinkResult:
    category_id: int
    link_mode: SpendGroupLinkMode
    subcategory_id: int | None
    members_processed: int
    rules_created: int
    transactions_updated: int


def _ensure_subcategory_for_group(
    session: Session, category_id: int, display_name: str
) -> Subcategory:
    name = display_name.strip()
    existing = session.exec(
        select(Subcategory).where(
            Subcategory.category_id == category_id,
            Subcategory.name == name,
        )
    ).first()
    if existing:
        return existing
    sub = Subcategory(category_id=category_id, name=name)
    session.add(sub)
    session.flush()
    session.refresh(sub)
    return sub


def _apply_link_to_pattern(
    session: Session,
    *,
    pattern_key: str,
    category_id: int,
    subcategory_id: int | None,
) -> int:
    ensure_merchant_key_user_approval(session, pattern_key)
    _, txn_count = upsert_merchant_key_rule_and_propagate(
        session, pattern_key, category_id
    )
    if subcategory_id is not None:
        apply_merchant_subcategory_preference(session, pattern_key, subcategory_id)
    return txn_count


def link_spend_group_to_category(
    session: Session,
    group: MerchantSpendGroup,
    category_id: int,
    link_mode: SpendGroupLinkMode,
) -> SpendGroupLinkResult:
    if link_mode not in SPEND_GROUP_LINK_MODES:
        raise ValueError("invalid link_mode")
    if not session.get(Category, category_id):
        raise ValueError("category not found")
    if group.id is None:
        raise ValueError("group must be persisted")

    subcategory_id: int | None = None
    if link_mode == "as_subcategory":
        sub = _ensure_subcategory_for_group(session, category_id, group.display_name)
        assert sub.id is not None
        subcategory_id = sub.id

    group.category_id = category_id
    group.link_mode = link_mode
    group.subcategory_id = subcategory_id
    session.add(group)
    session.flush()

    members = list(
        session.exec(
            select(MerchantSpendGroupMember).where(
                MerchantSpendGroupMember.group_id == group.id
            )
        ).all()
    )

    transactions_updated = 0
    for member in members:
        transactions_updated += _apply_link_to_pattern(
            session,
            pattern_key=member.pattern_key,
            category_id=category_id,
            subcategory_id=subcategory_id,
        )

    return SpendGroupLinkResult(
        category_id=category_id,
        link_mode=link_mode,
        subcategory_id=subcategory_id,
        members_processed=len(members),
        rules_created=len(members),
        transactions_updated=transactions_updated,
    )


def unlink_spend_group_from_category(session: Session, group: MerchantSpendGroup) -> None:
    group.category_id = None
    group.link_mode = None
    group.subcategory_id = None
    session.add(group)


def apply_linked_group_to_member(
    session: Session, group: MerchantSpendGroup, pattern_key: str
) -> int:
    """After adding a member, apply category link if the group is linked."""
    if group.category_id is None or group.link_mode is None:
        return 0
    return _apply_link_to_pattern(
        session,
        pattern_key=pattern_key,
        category_id=group.category_id,
        subcategory_id=group.subcategory_id,
    )
