from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import and_, or_
from sqlmodel import Session, func, select

from ..dependencies import SessionDep
from ..models import ClassificationRule, Transaction, Upload
from ..schemas import (
    AutoCategorizeChunkResponse,
    AutoCategorizeSummary,
    CategorizeQueueResponse,
    CategorizeRequest,
    CategorizeResponse,
    LlmPendingCountResponse,
    SpendPatternUpdate,
    TransactionRead,
)
from ..services.batch_categorize import (
    REASON_PENDING_MANUAL_OR_AI,
    batch_categorize_transactions,
    llm_categorize_transactions,
)
from ..services.spend_pattern import ALLOWED_SPEND_PATTERNS
from ..services.classification import apply_single_rule

logger = logging.getLogger(__name__)

router = APIRouter()


def _validate_month_ym(month: str) -> None:
    if not month or len(month) != 7 or month[4] != "-":
        raise HTTPException(422, detail="month must be YYYY-MM")
    try:
        y, m = int(month[:4]), int(month[5:7])
        if not (1 <= m <= 12):
            raise ValueError
    except ValueError:
        raise HTTPException(422, detail="month must be YYYY-MM")


def _pending_auto_categorize_clause():
    """Rows rules/dictionary can still change (excludes stuck uncategorized awaiting user/AI)."""
    uncat_not_stuck = and_(
        Transaction.category_id == None,  # noqa: E711
        or_(
            Transaction.reason_he.is_(None),
            Transaction.reason_he != REASON_PENDING_MANUAL_OR_AI,
        ),
    )
    low_conf = and_(
        Transaction.category_id != None,  # noqa: E711
        Transaction.confidence < 0.6,
    )
    return or_(uncat_not_stuck, low_conf)


def pending_categorization_count(session: Session, month: str) -> int:
    stmt = (
        select(func.count())
        .select_from(Transaction)
        .join(Upload, Transaction.upload_id == Upload.id)
        .where(Upload.month == month, _pending_auto_categorize_clause())
    )
    return int(session.exec(stmt).one())


def llm_pending_uncategorized_count(session: Session, month: str) -> int:
    stmt = (
        select(func.count())
        .select_from(Transaction)
        .join(Upload, Transaction.upload_id == Upload.id)
        .where(
            Upload.month == month,
            Transaction.category_id == None,  # noqa: E711
        )
    )
    return int(session.exec(stmt).one())


@router.get("", response_model=list[TransactionRead])
def get_transactions(
    session: SessionDep,
    month: str | None = Query(None, description="Filter by upload month YYYY-MM"),
    card_label: str | None = Query(None, description="Filter by card label"),
    section: str | None = Query(None, description="Filter by section e.g. IL, FOREIGN"),
    needs_review: bool | None = Query(
        None,
        description="true = uncategorized (category_id IS NULL), false = categorized",
    ),
    category_id: int | None = Query(None, description="Filter by category id"),
    q: str | None = Query(None, description="Search merchant/details text"),
    amount_min: float | None = Query(None, description="Minimum amount inclusive"),
    amount_max: float | None = Query(None, description="Maximum amount inclusive"),
    spend_pattern: str | None = Query(
        None,
        description="Filter by spend pattern: unknown, recurring, one_time",
    ),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List transactions with optional filters, text search, and pagination."""
    if spend_pattern is not None and spend_pattern not in ALLOWED_SPEND_PATTERNS:
        raise HTTPException(422, detail="spend_pattern must be unknown, recurring, or one_time")
    stmt = select(Transaction).join(Upload)

    if month is not None:
        stmt = stmt.where(Upload.month == month)
    if card_label is not None:
        stmt = stmt.where(Transaction.card_label == card_label)
    if section is not None:
        stmt = stmt.where(Transaction.section == section)
    if needs_review is True:
        stmt = stmt.where(Transaction.category_id == None)  # noqa: E711
    elif needs_review is False:
        stmt = stmt.where(Transaction.category_id != None)  # noqa: E711
    if category_id is not None:
        stmt = stmt.where(Transaction.category_id == category_id)
    if amount_min is not None:
        stmt = stmt.where(Transaction.amount >= amount_min)
    if amount_max is not None:
        stmt = stmt.where(Transaction.amount <= amount_max)
    if spend_pattern is not None:
        stmt = stmt.where(Transaction.spend_pattern == spend_pattern)
    if q:
        stmt = stmt.where(
            or_(
                Transaction.description.contains(q),
                Transaction.raw_row_data.contains(q),
            )
        )

    stmt = stmt.order_by(Transaction.id.desc())
    stmt = stmt.offset(offset).limit(limit)
    transactions = session.exec(stmt).all()
    return [TransactionRead.from_orm(t) for t in transactions]


@router.post("/{transaction_id}/categorize", response_model=CategorizeResponse)
def categorize_transaction(
    transaction_id: int,
    body: CategorizeRequest,
    session: SessionDep,
):
    txn = session.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, detail="Transaction not found")

    txn.category_id = body.category_id
    txn.confidence = 1.0
    txn.needs_review = False
    session.add(txn)

    rule_created = False
    rule_id = None
    backfill_count = 0

    if body.create_rule:
        match_type = body.rule_match_type or "merchant_key"
        pattern = body.rule_pattern or txn.description

        existing_rule = session.exec(
            select(ClassificationRule).where(
                func.lower(ClassificationRule.pattern) == pattern.lower(),
                ClassificationRule.match_type == match_type,
                ClassificationRule.category_id == body.category_id,
            )
        ).first()

        if existing_rule:
            rule_id = existing_rule.id
        else:
            new_rule = ClassificationRule(
                pattern=pattern,
                match_type=match_type,
                category_id=body.category_id,
                priority=100,
                active=True,
            )
            session.add(new_rule)
            session.commit()
            session.refresh(new_rule)
            rule_id = new_rule.id
            rule_created = True

            backfill_count = apply_single_rule(session, new_rule)

    session.commit()

    return CategorizeResponse(
        transaction_id=txn.id,
        category_id=body.category_id,
        rule_created=rule_created,
        rule_id=rule_id,
        backfill_count=backfill_count,
    )


@router.patch("/{transaction_id}/spend-pattern", response_model=TransactionRead)
def update_spend_pattern(
    transaction_id: int,
    body: SpendPatternUpdate,
    session: SessionDep,
):
    """Set recurring / one_time / unknown; marks as user override so auto-categorize won't change it."""
    txn = session.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, detail="Transaction not found")
    txn.spend_pattern = body.spend_pattern
    txn.spend_pattern_user_set = True
    session.add(txn)
    session.commit()
    session.refresh(txn)
    return TransactionRead.from_orm(txn)


@router.post("/auto-categorize", response_model=AutoCategorizeSummary)
def auto_categorize(
    session: SessionDep,
    month: str = Query(..., description="Statement month YYYY-MM"),
    force: bool = Query(
        False,
        description="If true, process all transactions in the month and overwrite existing categorization",
    ),
):
    """Batch-categorize transactions for a month.

    If force=false (default): only uncategorized or low-confidence transactions.
    If force=true: all transactions; overwrites category_id, confidence, reason_he, needs_review.

    Tries DB rules and keyword dictionary; LLM runs only if CSA_AUTO_CATEGORIZE_USE_LLM is true.
    Otherwise use POST /transactions/llm-categorize-pending for opt-in AI.
    """
    if force:
        stmt = select(Transaction).join(Upload).where(Upload.month == month)
    else:
        stmt = select(Transaction).join(Upload).where(
            Upload.month == month,
            _pending_auto_categorize_clause(),
        )
    txns = list(session.exec(stmt).all())
    return batch_categorize_transactions(session, txns)


@router.get("/categorize-queue", response_model=CategorizeQueueResponse)
def categorize_queue(session: SessionDep, month: str = Query(..., description="Statement month YYYY-MM")):
    """Count transactions in this month still needing auto-categorization (same filter as auto-categorize)."""
    _validate_month_ym(month)
    n = pending_categorization_count(session, month)
    return CategorizeQueueResponse(pending_count=n)


@router.get(
    "/llm-categorize-pending/count",
    response_model=LlmPendingCountResponse,
)
def llm_categorize_pending_count(
    session: SessionDep,
    month: str = Query(..., description="Statement month YYYY-MM"),
):
    """Count uncategorized rows in the month (category_id IS NULL)."""
    _validate_month_ym(month)
    return LlmPendingCountResponse(pending_count=llm_pending_uncategorized_count(session, month))


@router.post("/llm-categorize-pending", response_model=AutoCategorizeSummary)
def llm_categorize_pending(
    session: SessionDep,
    month: str = Query(..., description="Statement month YYYY-MM"),
    limit: int = Query(300, ge=1, le=500, description="Max rows to send to the model"),
):
    """Opt-in AI categorization for uncategorized rows only (rules/dictionary are not re-run)."""
    _validate_month_ym(month)
    stmt = (
        select(Transaction)
        .join(Upload)
        .where(
            Upload.month == month,
            Transaction.category_id == None,  # noqa: E711
        )
        .order_by(Transaction.id.asc())
        .limit(limit)
    )
    txns = list(session.exec(stmt).all())
    return llm_categorize_transactions(session, txns)


@router.post("/auto-categorize-chunk", response_model=AutoCategorizeChunkResponse)
def auto_categorize_chunk(
    session: SessionDep,
    month: str = Query(..., description="Statement month YYYY-MM"),
    limit: int = Query(64, ge=1, le=300, description="Max transactions to process in this request"),
):
    """Process up to *limit* pending transactions for *month*; use for progress UI."""
    _validate_month_ym(month)
    stmt = (
        select(Transaction)
        .join(Upload)
        .where(Upload.month == month, _pending_auto_categorize_clause())
        .order_by(Transaction.id.asc())
        .limit(limit)
    )
    txns = list(session.exec(stmt).all())
    progress_events: list[dict] = []
    if txns:
        chunk_summary = batch_categorize_transactions(
            session, txns, progress_sink=progress_events
        )
    else:
        chunk_summary = AutoCategorizeSummary(
            processed=0,
            categorized=0,
            needs_review=0,
            failed=0,
            failures_sample=[],
        )
    pending = pending_categorization_count(session, month)
    last = progress_events[-1] if progress_events else None
    stage: str | None = None
    detail: dict | None = None
    if last:
        stage = str(last.get("stage", "")) or None
        detail = {k: v for k, v in last.items() if k != "stage"} or None
    return AutoCategorizeChunkResponse(
        chunk=chunk_summary,
        pending_remaining=pending,
        done=pending == 0,
        categorize_stage=stage,
        categorize_stage_detail=detail,
    )


@router.get("/needs-review", response_model=list[TransactionRead])
def get_needs_review(
    session: SessionDep,
    month: str = Query(..., description="Statement month YYYY-MM"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Return transactions flagged for manual review in a given month."""
    stmt = (
        select(Transaction)
        .join(Upload)
        .where(
            Upload.month == month,
            Transaction.needs_review == True,  # noqa: E712
        )
        .order_by(Transaction.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return [TransactionRead.from_orm(t) for t in session.exec(stmt).all()]
