"""Rules engine for auto-categorizing transactions."""

from __future__ import annotations

import re
from typing import List, Optional

from sqlmodel import Session, select

from ..models import ClassificationRule, Transaction


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
