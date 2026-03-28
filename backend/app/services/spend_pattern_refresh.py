"""Recompute auto spend_pattern from history (distinct statement months + merchant recurrence)."""

from __future__ import annotations

from collections import defaultdict

from sqlmodel import Session, select

from ..models import Transaction, Upload

MIN_DISTINCT_MONTHS_FOR_SPEND_PATTERN = 3


def count_distinct_statement_months(session: Session) -> int:
    stmt = (
        select(Upload.month)
        .select_from(Transaction)
        .join(Upload, Transaction.upload_id == Upload.id)
        .distinct()
    )
    return len(session.exec(stmt).all())


def refresh_auto_spend_patterns(session: Session) -> None:
    """Set spend_pattern on rows without user override.

    Fewer than 3 distinct statement months with data: force ``unknown``.
    Otherwise: same normalized description in 2+ distinct months -> ``recurring``;
    otherwise ``one_time``.
    """
    txns = list(session.exec(select(Transaction)).all())
    if not txns:
        return

    n_months = count_distinct_statement_months(session)
    upload_cache: dict[int, Upload | None] = {}

    def upload_for(t: Transaction) -> Upload | None:
        uid = t.upload_id
        if uid not in upload_cache:
            upload_cache[uid] = session.get(Upload, uid)
        return upload_cache[uid]

    if n_months < MIN_DISTINCT_MONTHS_FOR_SPEND_PATTERN:
        for t in txns:
            if t.spend_pattern_user_set:
                continue
            t.spend_pattern = "unknown"
            session.add(t)
        session.commit()
        return

    merchant_months: dict[str, set[str]] = defaultdict(set)
    for t in txns:
        u = upload_for(t)
        if u is None:
            continue
        key = (t.description or "").strip().lower() or "__empty__"
        merchant_months[key].add(u.month)

    for t in txns:
        if t.spend_pattern_user_set:
            continue
        key = (t.description or "").strip().lower() or "__empty__"
        if len(merchant_months[key]) >= 2:
            t.spend_pattern = "recurring"
        else:
            t.spend_pattern = "one_time"
        session.add(t)
    session.commit()
