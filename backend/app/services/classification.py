"""Rules engine for auto-categorizing transactions."""

from __future__ import annotations

import re
from typing import List, Optional

from sqlalchemy import func as sa_func
from sqlmodel import Session, func, select

from ..models import ClassificationRule, Subcategory, Transaction
from .merchant_subcategory import sync_approval_subcategory_after_merchant_key_propagate


def _matches(rule: ClassificationRule, txn: Transaction) -> bool:
    """Return True if *rule* matches *txn*."""
    if rule.card_label_filter and txn.card_label != rule.card_label_filter:
        return False

    desc = txn.description or ""
    pattern = rule.pattern

    if rule.match_type == "contains":
        return pattern.lower() in desc.lower()
    elif rule.match_type == "regex":
        try:
            return re.search(pattern, desc, re.IGNORECASE) is not None
        except re.error:
            return False
    elif rule.match_type == "merchant_key":
        return desc.strip().lower() == pattern.strip().lower()

    return False


def _load_active_rules(session: Session) -> List[ClassificationRule]:
    stmt = (
        select(ClassificationRule)
        .where(ClassificationRule.active == True)  # noqa: E712
        .order_by(ClassificationRule.priority.asc(), ClassificationRule.id.asc())
    )
    return list(session.exec(stmt).all())


def find_matching_rule(
    session: Session, txn: Transaction
) -> Optional[ClassificationRule]:
    """Return the first active rule that matches *txn*, or None."""
    for rule in _load_active_rules(session):
        if _matches(rule, txn):
            return rule
    return None


def apply_rules(session: Session, transactions: List[Transaction]) -> int:
    """Apply all active rules to *transactions*. Returns count of matched txns."""
    if not transactions:
        return 0

    rules = _load_active_rules(session)
    matched = 0

    for txn in transactions:
        hit = False
        for rule in rules:
            if _matches(rule, txn):
                txn.category_id = rule.category_id
                txn.confidence = 0.9
                txn.rule_id_applied = rule.id
                txn.needs_review = False
                hit = True
                break
        if not hit:
            txn.confidence = 0.3
            txn.needs_review = True
        if hit:
            matched += 1
        session.add(txn)

    session.commit()
    return matched


def apply_single_rule(session: Session, rule: ClassificationRule) -> int:
    """Apply *rule* to all uncategorized (or low-confidence) transactions.

    Returns count of updated transactions.
    """
    stmt = select(Transaction).where(
        (Transaction.category_id == None) | (Transaction.confidence < 0.9)  # noqa: E711
    )
    candidates = list(session.exec(stmt).all())

    updated = 0
    for txn in candidates:
        if _matches(rule, txn):
            txn.category_id = rule.category_id
            txn.confidence = 0.9
            txn.rule_id_applied = rule.id
            txn.needs_review = False
            session.add(txn)
            updated += 1

    if updated:
        session.commit()
    return updated


def upsert_merchant_key_rule_and_propagate(
    session: Session, pattern: str, category_id: int
) -> tuple[ClassificationRule, int]:
    """Deactivate any active merchant_key rules for this pattern, add one new rule, set category
    and confidence=1.0 on every transaction whose trimmed description matches (all months).

    Returns (new_rule, number_of_transactions_updated).
    """
    pat = pattern.strip()
    if not pat:
        raise ValueError("pattern must be non-empty")

    stmt_conflicts = select(ClassificationRule).where(
        ClassificationRule.match_type == "merchant_key",
        ClassificationRule.active == True,  # noqa: E712
        func.lower(ClassificationRule.pattern) == pat.lower(),
    )
    for r in session.exec(stmt_conflicts).all():
        r.active = False
        session.add(r)
    session.flush()

    new_rule = ClassificationRule(
        pattern=pat,
        match_type="merchant_key",
        category_id=category_id,
        priority=100,
        active=True,
    )
    session.add(new_rule)
    session.flush()
    session.refresh(new_rule)

    stmt_txn = select(Transaction).where(
        func.lower(func.trim(Transaction.description)) == pat.lower()
    )
    txns = list(session.exec(stmt_txn).all())
    for t in txns:
        t.category_id = category_id
        t.confidence = 1.0
        t.rule_id_applied = new_rule.id
        t.needs_review = False
        if t.subcategory_id:
            sub = session.get(Subcategory, t.subcategory_id)
            if not sub or sub.category_id != category_id:
                t.subcategory_id = None
        session.add(t)

    sync_approval_subcategory_after_merchant_key_propagate(
        session, pat.strip().lower(), category_id, txns
    )

    return new_rule, len(txns)


def _transaction_candidates_for_rule(session: Session, rule: ClassificationRule) -> List[Transaction]:
    """Narrow transactions that might match *rule* (SQL prefilter + optional card scope)."""
    stmt = select(Transaction)
    if rule.card_label_filter:
        stmt = stmt.where(Transaction.card_label == rule.card_label_filter)

    if rule.match_type == "merchant_key":
        pat = rule.pattern.strip().lower()
        stmt = stmt.where(func.lower(func.trim(Transaction.description)) == pat)
        return list(session.exec(stmt).all())

    if rule.match_type == "contains":
        needle = rule.pattern.lower()
        stmt = stmt.where(
            sa_func.instr(
                func.lower(func.coalesce(Transaction.description, "")),
                needle,
            )
            > 0
        )
        return list(session.exec(stmt).all())

    stmt = stmt.where(Transaction.description.isnot(None))  # noqa: E711
    return list(session.exec(stmt).all())


def reapply_active_rule_to_matching_transactions(session: Session, rule: ClassificationRule) -> int:
    """Set category from *rule* on every transaction where this rule wins (first match by priority).

    Used after Rules API create/update so past months stay aligned with the rule row.
    Returns number of transactions updated.
    """
    if not rule.active or rule.id is None:
        return 0

    candidates = _transaction_candidates_for_rule(session, rule)
    updated = 0
    for txn in candidates:
        if not _matches(rule, txn):
            continue
        winner = find_matching_rule(session, txn)
        if winner is None or winner.id != rule.id:
            continue
        txn.category_id = rule.category_id
        txn.confidence = 0.9
        txn.rule_id_applied = rule.id
        txn.needs_review = False
        if txn.subcategory_id:
            sub = session.get(Subcategory, txn.subcategory_id)
            if not sub or sub.category_id != rule.category_id:
                txn.subcategory_id = None
        session.add(txn)
        updated += 1

    if updated:
        session.flush()
    return updated
