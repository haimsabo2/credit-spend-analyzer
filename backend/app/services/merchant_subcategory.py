"""Apply user subcategory preference per approved merchant pattern_key."""

from __future__ import annotations

from typing import Iterable, List, Optional

from sqlmodel import Session, func, select

from ..models import MerchantKeyUserApproval, Subcategory, Transaction
from ..utils import normalize_merchant_pattern_key


def ensure_merchant_key_user_approval(
    session: Session, raw_description_or_pattern: str
) -> MerchantKeyUserApproval | None:
    """Create a user-approval row for this merchant key if missing (idempotent).

    Used when the user explicitly categorizes a line or adds it to a spend group so
    merchant-group UIs treat the pattern as approved without a separate approve click.
    """
    pk = normalize_merchant_pattern_key(raw_description_or_pattern)
    if not pk:
        return None
    row = session.exec(
        select(MerchantKeyUserApproval).where(MerchantKeyUserApproval.pattern_key == pk)
    ).first()
    if row:
        return row
    row = MerchantKeyUserApproval(pattern_key=pk)
    session.add(row)
    session.flush()
    return row


def transactions_matching_pattern(session: Session, pattern_key: str) -> List[Transaction]:
    pk = normalize_merchant_pattern_key(pattern_key)
    stmt = select(Transaction).where(
        func.lower(func.trim(Transaction.description)) == pk
    )
    return list(session.exec(stmt).all())


def apply_merchant_subcategory_preference(
    session: Session,
    pattern_key: str,
    subcategory_id: Optional[int],
    *,
    approval: Optional[MerchantKeyUserApproval] = None,
) -> None:
    """Persist preference on the approval row for *pattern_key* and update transactions.

    When *subcategory_id* is None, clears preference and NULLs subcategory on all
    rows matching the pattern. *approval* if passed must belong to *pattern_key*.
    """
    pk = normalize_merchant_pattern_key(pattern_key)
    row = approval
    if row is None:
        row = session.exec(
            select(MerchantKeyUserApproval).where(
                MerchantKeyUserApproval.pattern_key == pk
            )
        ).first()
    if not row or row.pattern_key != pk:
        raise ValueError("merchant approval row missing for pattern_key")

    txns = transactions_matching_pattern(session, pk)

    if subcategory_id is None:
        row.subcategory_id = None
        session.add(row)
        for t in txns:
            t.subcategory_id = None
            session.add(t)
        return

    sub = session.get(Subcategory, subcategory_id)
    if not sub:
        raise ValueError("subcategory not found")

    row.subcategory_id = subcategory_id
    session.add(row)

    for t in txns:
        if t.category_id == sub.category_id:
            t.subcategory_id = subcategory_id
            session.add(t)


def apply_approved_subcategory_after_category(session: Session, txn: Transaction) -> None:
    """If this merchant is approved with a stored subcategory, set txn.subcategory_id when valid."""
    if txn.category_id is None:
        return
    pk = normalize_merchant_pattern_key(txn.description)
    approval = session.exec(
        select(MerchantKeyUserApproval).where(
            MerchantKeyUserApproval.pattern_key == pk
        )
    ).first()
    if not approval or approval.subcategory_id is None:
        return
    sub = session.get(Subcategory, approval.subcategory_id)
    if sub and sub.category_id == txn.category_id:
        txn.subcategory_id = approval.subcategory_id
        session.add(txn)


def apply_approved_subcategory_to_transactions(
    session: Session, txns: Iterable[Transaction]
) -> None:
    """Bulk: after categorization, apply stored approval subcategories."""
    rows = list(
        session.exec(
            select(MerchantKeyUserApproval).where(
                MerchantKeyUserApproval.subcategory_id != None  # noqa: E711
            )
        ).all()
    )
    if not rows:
        return
    by_pattern = {r.pattern_key: r.subcategory_id for r in rows}
    sub_ids = {sid for sid in by_pattern.values() if sid is not None}
    if not sub_ids:
        return
    subs = list(
        session.exec(select(Subcategory).where(Subcategory.id.in_(sub_ids))).all()
    )
    subs_by_id = {s.id: s for s in subs}

    for txn in txns:
        if txn.category_id is None:
            continue
        pk = normalize_merchant_pattern_key(txn.description)
        sid = by_pattern.get(pk)
        if sid is None:
            continue
        sub = subs_by_id.get(sid)
        if sub and sub.category_id == txn.category_id:
            txn.subcategory_id = sid
            session.add(txn)


def sync_approval_subcategory_after_merchant_key_propagate(
    session: Session,
    pattern_key: str,
    category_id: int,
    txns: List[Transaction],
) -> None:
    """After upsert_merchant_key_rule_and_propagate: drop stale approval sub or re-apply."""
    pk = normalize_merchant_pattern_key(pattern_key)
    approval = session.exec(
        select(MerchantKeyUserApproval).where(
            MerchantKeyUserApproval.pattern_key == pk
        )
    ).first()
    if not approval:
        return
    sid = approval.subcategory_id
    if sid is None:
        return
    sub = session.get(Subcategory, sid)
    if not sub or sub.category_id != category_id:
        approval.subcategory_id = None
        session.add(approval)
        return
    for t in txns:
        if t.category_id == category_id:
            t.subcategory_id = sid
            session.add(t)
