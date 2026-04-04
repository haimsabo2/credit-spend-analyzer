from __future__ import annotations

import json
import logging
from typing import Any, Iterable

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import and_, or_, text
from sqlmodel import Session, func, select

from ..dependencies import SessionDep
from ..models import MerchantKeyUserApproval, Subcategory, Transaction, Upload
from ..schemas import (
    AutoCategorizeChunkResponse,
    AutoCategorizeSummary,
    CategorizeQueueResponse,
    CategorizeRequest,
    CategorizeResponse,
    LlmPendingCountResponse,
    MerchantGroupActionBody,
    MerchantGroupActionResponse,
    MerchantGroupListResponse,
    MerchantGroupRow,
    SpendPatternUpdate,
    TransactionRead,
    TransactionSubcategoryPatch,
)
from ..services.batch_categorize import (
    REASON_PENDING_MANUAL_OR_AI,
    batch_categorize_transactions,
    llm_categorize_transactions,
)
from ..services.merchant_subcategory import apply_merchant_subcategory_preference
from ..services.spend_pattern import ALLOWED_SPEND_PATTERNS
from ..services.classification import upsert_merchant_key_rule_and_propagate
from ..utils import normalize_merchant_pattern_key

logger = logging.getLogger(__name__)

router = APIRouter()


def _source_cells_from_raw(raw_row_data: str | None) -> list[str] | None:
    if not raw_row_data:
        return None
    try:
        data = json.loads(raw_row_data)
        cells = data.get("source_cells")
        if isinstance(cells, list) and all(isinstance(x, str) for x in cells):
            return cells
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def transaction_to_read(session: Session, t: Transaction) -> TransactionRead:
    r = TransactionRead.model_validate(t)
    r.source_cells = _source_cells_from_raw(t.raw_row_data)
    tid = t.source_trace_upload_id
    if tid:
        u = session.get(Upload, tid)
        if u:
            r.source_upload_original_filename = u.original_filename
            r.source_stored_file_available = bool(u.stored_path)
    return r


def transactions_to_reads(session: Session, rows: Iterable[Transaction]) -> list[TransactionRead]:
    txs = list(rows)
    trace_ids = {t.source_trace_upload_id for t in txs if t.source_trace_upload_id}
    up_map: dict[int, Upload] = {}
    if trace_ids:
        ups = session.exec(select(Upload).where(Upload.id.in_(trace_ids))).all()
        up_map = {u.id: u for u in ups}
    out: list[TransactionRead] = []
    for t in txs:
        r = TransactionRead.model_validate(t)
        r.source_cells = _source_cells_from_raw(t.raw_row_data)
        tid = t.source_trace_upload_id
        if tid and tid in up_map:
            u = up_map[tid]
            r.source_upload_original_filename = u.original_filename
            r.source_stored_file_available = bool(u.stored_path)
        out.append(r)
    return out


def _merchant_group_search_clause(q: str | None) -> tuple[str, dict[str, str]]:
    if q and q.strip():
        return (
            " AND (t.description LIKE :q_like OR COALESCE(t.raw_row_data, '') LIKE :q_like)",
            {"q_like": f"%{q.strip()}%"},
        )
    return "", {}


def _merchant_groups_base_cte(search_clause: str) -> str:
    # "transaction" is quoted — reserved word in SQLite.
    return f"""
WITH grp AS (
  SELECT
    lower(trim(t.description)) AS pattern_key,
    MIN(t.description) AS display_description,
    COUNT(*) AS occurrence_count,
    SUM(t.amount) AS total_amount,
    MAX(t.id) AS representative_transaction_id,
    MAX(CASE WHEN t.needs_review THEN 1 ELSE 0 END) AS needs_review_int
  FROM "transaction" t
  INNER JOIN upload u ON t.upload_id = u.id
  WHERE 1=1 {search_clause}
  GROUP BY lower(trim(t.description))
)"""


def _merchant_groups_main_where_sql(
    *,
    approved: bool,
    category_id: int | None,
    uncategorized_only: bool,
    subcategory_id: int | None,
    missing_subcategory: bool,
) -> tuple[str, dict[str, Any]]:
    """Build WHERE clause on grp+tr (after join to representative transaction)."""
    extra: dict[str, Any] = {}
    if uncategorized_only:
        return "tr.category_id IS NULL", extra
    if category_id is not None:
        parts = ["tr.category_id = :filter_category_id"]
        extra["filter_category_id"] = category_id
        if subcategory_id is not None:
            parts.append("tr.subcategory_id = :filter_subcategory_id")
            extra["filter_subcategory_id"] = subcategory_id
        elif missing_subcategory:
            parts.append("tr.subcategory_id IS NULL")
        return " AND ".join(parts), extra
    approved_int = 1 if approved else 0
    extra["approved"] = approved_int
    return (
        """(
  (:approved = 0 AND NOT EXISTS (
    SELECT 1 FROM merchant_key_user_approval a WHERE a.pattern_key = g.pattern_key
  ))
  OR
  (:approved = 1 AND EXISTS (
    SELECT 1 FROM merchant_key_user_approval a WHERE a.pattern_key = g.pattern_key
  ))
)""",
        extra,
    )


def _resolve_merchant_action_pattern_key(
    session: Session, body: MerchantGroupActionBody
) -> str:
    has_tid = body.transaction_id is not None
    pk_raw = (body.pattern_key or "").strip()
    has_pk = bool(pk_raw)
    if has_tid and has_pk:
        raise HTTPException(
            422, detail="Provide only one of transaction_id or pattern_key"
        )
    if not has_tid and not has_pk:
        raise HTTPException(
            422, detail="Provide transaction_id or pattern_key"
        )
    if has_tid:
        assert body.transaction_id is not None
        txn = session.get(Transaction, body.transaction_id)
        if not txn:
            raise HTTPException(404, detail="Transaction not found")
        return normalize_merchant_pattern_key(txn.description)
    return normalize_merchant_pattern_key(pk_raw)


def _representative_transaction_for_pattern(
    session: Session, pattern_key: str
) -> Transaction | None:
    pk = normalize_merchant_pattern_key(pattern_key)
    stmt = (
        select(Transaction)
        .where(func.lower(func.trim(Transaction.description)) == pk)
        .order_by(Transaction.id.desc())
        .limit(1)
    )
    return session.exec(stmt).first()


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
    subcategory_id: int | None = Query(None, description="Filter by subcategory id"),
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
    stmt = select(Transaction).join(Upload, Transaction.upload_id == Upload.id)

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
    if subcategory_id is not None:
        stmt = stmt.where(Transaction.subcategory_id == subcategory_id)
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
    return transactions_to_reads(session, transactions)


@router.get("/merchant-groups", response_model=MerchantGroupListResponse)
def list_merchant_groups(
    session: SessionDep,
    approved: bool = Query(
        False,
        description="false = pending (not user-approved), true = approved groups",
    ),
    q: str | None = Query(None, description="Search description or raw row text"),
    category_id: int | None = Query(
        None,
        description="When set, list groups whose representative txn has this category (ignores approved filter).",
    ),
    uncategorized_only: bool = Query(
        False,
        description="When true, groups with uncategorized representative; ignores approved filter.",
    ),
    subcategory_id: int | None = Query(
        None,
        description="With category_id, filter representative txn subcategory_id.",
    ),
    missing_subcategory: bool = Query(
        False,
        description="With category_id, representative has no subcategory (subcategory_id IS NULL).",
    ),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Group all transactions by normalized description (merchant key); filter by user approval."""
    if uncategorized_only and category_id is not None:
        raise HTTPException(
            422,
            detail="Use either uncategorized_only or category_id, not both",
        )
    if subcategory_id is not None and missing_subcategory:
        raise HTTPException(
            422,
            detail="Use either subcategory_id or missing_subcategory, not both",
        )
    if (
        (subcategory_id is not None or missing_subcategory)
        and category_id is None
        and not uncategorized_only
    ):
        raise HTTPException(
            422,
            detail="subcategory filters require category_id or uncategorized_only",
        )

    search_clause, extra_params = _merchant_group_search_clause(q)
    base = _merchant_groups_base_cte(search_clause)
    main_where, filter_params = _merchant_groups_main_where_sql(
        approved=approved,
        category_id=category_id,
        uncategorized_only=uncategorized_only,
        subcategory_id=subcategory_id,
        missing_subcategory=missing_subcategory,
    )
    list_sql = (
        base
        + f"""
SELECT
  g.pattern_key,
  g.display_description,
  g.occurrence_count,
  g.total_amount,
  g.representative_transaction_id,
  tr.category_id AS category_id,
  g.needs_review_int AS needs_review_any,
  msg.display_name AS spend_group_name,
  a.subcategory_id AS subcategory_id
FROM grp g
INNER JOIN "transaction" tr ON tr.id = g.representative_transaction_id
LEFT JOIN merchant_spend_group_member msgm ON msgm.pattern_key = g.pattern_key
LEFT JOIN merchant_spend_group msg ON msg.id = msgm.group_id
LEFT JOIN merchant_key_user_approval a ON a.pattern_key = g.pattern_key
WHERE ({main_where})
ORDER BY g.occurrence_count DESC, g.pattern_key
LIMIT :limit OFFSET :offset
"""
    )
    count_sql = (
        base
        + f"""
SELECT COUNT(*) AS n
FROM grp g
INNER JOIN "transaction" tr ON tr.id = g.representative_transaction_id
WHERE ({main_where})
"""
    )
    params = {
        "limit": limit,
        "offset": offset,
        **extra_params,
        **filter_params,
    }
    count_params = {**extra_params, **filter_params}
    total = int(
        session.execute(text(count_sql), count_params).mappings().one()["n"]
    )
    rows = session.execute(text(list_sql), params).mappings().all()
    items = [
        MerchantGroupRow(
            pattern_key=r["pattern_key"],
            display_description=r["display_description"],
            occurrence_count=int(r["occurrence_count"]),
            total_amount=float(r["total_amount"]),
            representative_transaction_id=int(r["representative_transaction_id"]),
            category_id=r["category_id"],
            subcategory_id=r["subcategory_id"],
            needs_review_any=bool(r["needs_review_any"]),
            spend_group_name=r["spend_group_name"],
        )
        for r in rows
    ]
    return MerchantGroupListResponse(items=items, total=total)


@router.post("/merchant-groups/approve", response_model=MerchantGroupActionResponse)
def approve_merchant_group(
    session: SessionDep,
    body: MerchantGroupActionBody,
):
    pattern_key = _resolve_merchant_action_pattern_key(session, body)
    existing = session.exec(
        select(MerchantKeyUserApproval).where(
            MerchantKeyUserApproval.pattern_key == pattern_key
        )
    ).first()
    if not existing:
        session.add(MerchantKeyUserApproval(pattern_key=pattern_key))
        session.flush()
    approval = session.exec(
        select(MerchantKeyUserApproval).where(
            MerchantKeyUserApproval.pattern_key == pattern_key
        )
    ).first()
    assert approval is not None
    if body.subcategory_id is not None:
        sub = session.get(Subcategory, body.subcategory_id)
        if not sub:
            raise HTTPException(404, detail="Subcategory not found")
        rep = _representative_transaction_for_pattern(session, pattern_key)
        if rep is None or rep.category_id is None:
            raise HTTPException(
                422,
                detail="Cannot set subcategory: no categorized transaction for this merchant",
            )
        if sub.category_id != rep.category_id:
            raise HTTPException(
                422,
                detail="Subcategory must belong to the merchant group's category",
            )
        try:
            apply_merchant_subcategory_preference(
                session, pattern_key, body.subcategory_id, approval=approval
            )
        except ValueError as exc:
            raise HTTPException(400, detail=str(exc)) from exc
    session.commit()
    return MerchantGroupActionResponse(pattern_key=pattern_key)


@router.post("/merchant-groups/subcategory", response_model=MerchantGroupActionResponse)
def set_merchant_group_subcategory(
    session: SessionDep,
    body: MerchantGroupActionBody,
):
    """Set or clear preferred subcategory for an approved merchant (all matching rows)."""
    pattern_key = _resolve_merchant_action_pattern_key(session, body)
    approval = session.exec(
        select(MerchantKeyUserApproval).where(
            MerchantKeyUserApproval.pattern_key == pattern_key
        )
    ).first()
    if not approval:
        raise HTTPException(
            409,
            detail="Merchant must be approved before setting a subcategory preference",
        )
    if body.subcategory_id is not None:
        sub = session.get(Subcategory, body.subcategory_id)
        if not sub:
            raise HTTPException(404, detail="Subcategory not found")
        rep = _representative_transaction_for_pattern(session, pattern_key)
        if rep is None or rep.category_id is None:
            raise HTTPException(
                422,
                detail="Cannot set subcategory: no categorized transaction for this merchant",
            )
        if sub.category_id != rep.category_id:
            raise HTTPException(
                422,
                detail="Subcategory must belong to the merchant group's category",
            )
    try:
        apply_merchant_subcategory_preference(
            session, pattern_key, body.subcategory_id, approval=approval
        )
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc)) from exc
    session.commit()
    return MerchantGroupActionResponse(pattern_key=pattern_key)


@router.post("/merchant-groups/unapprove", response_model=MerchantGroupActionResponse)
def unapprove_merchant_group(
    session: SessionDep,
    body: MerchantGroupActionBody,
):
    pattern_key = _resolve_merchant_action_pattern_key(session, body)
    row = session.exec(
        select(MerchantKeyUserApproval).where(
            MerchantKeyUserApproval.pattern_key == pattern_key
        )
    ).first()
    if row:
        session.delete(row)
    session.commit()
    return MerchantGroupActionResponse(pattern_key=pattern_key)


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
    if txn.subcategory_id:
        sub = session.get(Subcategory, txn.subcategory_id)
        if not sub or sub.category_id != body.category_id:
            txn.subcategory_id = None
    txn.confidence = 1.0
    txn.needs_review = False
    session.add(txn)
    session.flush()

    pattern = (body.rule_pattern or txn.description or "").strip()
    if not pattern:
        session.commit()
        return CategorizeResponse(
            transaction_id=txn.id,
            category_id=body.category_id,
            rule_created=False,
            rule_id=None,
            backfill_count=0,
        )

    new_rule, backfill_count = upsert_merchant_key_rule_and_propagate(
        session, pattern, body.category_id
    )
    session.commit()

    return CategorizeResponse(
        transaction_id=txn.id,
        category_id=body.category_id,
        rule_created=True,
        rule_id=new_rule.id,
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
    return transaction_to_read(session, txn)


@router.patch("/{transaction_id}/subcategory", response_model=TransactionRead)
def patch_transaction_subcategory(
    transaction_id: int,
    body: TransactionSubcategoryPatch,
    session: SessionDep,
):
    txn = session.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, detail="Transaction not found")
    pk = normalize_merchant_pattern_key(txn.description)
    approval = session.exec(
        select(MerchantKeyUserApproval).where(
            MerchantKeyUserApproval.pattern_key == pk
        )
    ).first()
    if approval:
        if body.subcategory_id is not None:
            sub = session.get(Subcategory, body.subcategory_id)
            if not sub:
                raise HTTPException(404, detail="Subcategory not found")
            if txn.category_id is None or sub.category_id != txn.category_id:
                raise HTTPException(
                    422,
                    detail="Subcategory must belong to the transaction's category",
                )
        try:
            apply_merchant_subcategory_preference(
                session, pk, body.subcategory_id, approval=approval
            )
        except ValueError as exc:
            raise HTTPException(400, detail=str(exc)) from exc
        session.commit()
        session.refresh(txn)
        return transaction_to_read(session, txn)
    if body.subcategory_id is None:
        txn.subcategory_id = None
    else:
        sub = session.get(Subcategory, body.subcategory_id)
        if not sub:
            raise HTTPException(404, detail="Subcategory not found")
        if txn.category_id is None or sub.category_id != txn.category_id:
            raise HTTPException(
                422,
                detail="Subcategory must belong to the transaction's category",
            )
        txn.subcategory_id = body.subcategory_id
    session.add(txn)
    session.commit()
    session.refresh(txn)
    return transaction_to_read(session, txn)


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
        stmt = select(Transaction).join(Upload, Transaction.upload_id == Upload.id).where(
            Upload.month == month
        )
    else:
        stmt = select(Transaction).join(Upload, Transaction.upload_id == Upload.id).where(
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
        .join(Upload, Transaction.upload_id == Upload.id)
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
        .join(Upload, Transaction.upload_id == Upload.id)
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
        .join(Upload, Transaction.upload_id == Upload.id)
        .where(
            Upload.month == month,
            Transaction.needs_review == True,  # noqa: E712
        )
        .order_by(Transaction.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return transactions_to_reads(session, session.exec(stmt).all())
