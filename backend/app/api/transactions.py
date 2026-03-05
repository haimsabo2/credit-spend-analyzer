from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import or_
from sqlmodel import func, select

from ..dependencies import SessionDep
from ..models import ClassificationRule, Transaction, Upload
from ..schemas import (
    AutoCategorizeSummary,
    CategorizeRequest,
    CategorizeResponse,
    TransactionRead,
)
from ..services.categories import get_category_id_by_name_he
from ..services.categorizer import categorize_transaction as llm_categorize
from ..services.classification import apply_single_rule, find_matching_rule
from ..services.dictionary_rules import dictionary_categorize

logger = logging.getLogger(__name__)

router = APIRouter()


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
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List transactions with optional filters, text search, and pagination."""
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


_MAX_FAILURE_SAMPLES = 5
_BATCH_SIZE = 25


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

    Tries three layers: DB rules, keyword dictionary, then LLM.
    """
    if force:
        stmt = select(Transaction).join(Upload).where(Upload.month == month)
    else:
        stmt = (
            select(Transaction)
            .join(Upload)
            .where(
                Upload.month == month,
                or_(
                    Transaction.category_id == None,  # noqa: E711
                    Transaction.confidence < 0.6,
                ),
            )
        )
    txns = list(session.exec(stmt).all())

    processed = len(txns)
    categorized = 0
    needs_review_count = 0
    failed = 0
    failures_sample: list[str] = []

    for idx, txn in enumerate(txns, 1):
        tx_id = txn.id
        try:
            # --- Layer 1: DB classification rules ---
            with session.no_autoflush:
                rule = find_matching_rule(session, txn)
            if rule is not None:
                txn.category_id = rule.category_id
                txn.confidence = 0.9
                txn.rule_id_applied = rule.id
                txn.needs_review = False
                txn.reason_he = f"rule:{rule.pattern}"
                session.add(txn)
                categorized += 1
                logger.info("tx %s -> rule (pattern=%s)", tx_id, rule.pattern)
                if idx % _BATCH_SIZE == 0:
                    session.commit()
                continue

            # --- Layer 2: keyword dictionary ---
            dict_hit = dictionary_categorize(txn)
            if dict_hit is not None:
                with session.no_autoflush:
                    cat_id = get_category_id_by_name_he(
                        session, dict_hit.category_name_he
                    )
                txn.category_id = cat_id
                txn.confidence = dict_hit.confidence
                txn.reason_he = dict_hit.reason_he
                txn.needs_review = False
                session.add(txn)
                categorized += 1
                logger.info("tx %s -> dict (%s)", tx_id, dict_hit.category_name_he)
                if idx % _BATCH_SIZE == 0:
                    session.commit()
                continue

            # --- Layer 3: LLM ---
            result = llm_categorize(txn)

            with session.no_autoflush:
                cat_id = get_category_id_by_name_he(session, result.category_name_he)
            txn.category_id = cat_id
            txn.confidence = result.confidence
            txn.reason_he = result.reason_he
            txn.needs_review = result.needs_review

            if result.suggested_new_category is not None:
                txn.meta_json = json.dumps(
                    {
                        "suggest_new_category": {
                            "name_he": result.suggested_new_category.name_he,
                            "why_needed_he": result.suggested_new_category.why_needed_he,
                        }
                    },
                    ensure_ascii=False,
                )
                txn.needs_review = True

            session.add(txn)
            logger.info("tx %s -> llm (%s)", tx_id, result.category_name_he)

            if txn.needs_review:
                needs_review_count += 1
            else:
                categorized += 1
        except Exception as exc:
            session.rollback()
            logger.warning("Categorization failed for tx %s: %s", tx_id, exc)
            failed += 1
            if len(failures_sample) < _MAX_FAILURE_SAMPLES:
                failures_sample.append(f"tx {tx_id}: {exc}")
            continue

        if idx % _BATCH_SIZE == 0:
            session.commit()

    session.commit()

    return AutoCategorizeSummary(
        processed=processed,
        categorized=categorized,
        needs_review=needs_review_count,
        failed=failed,
        failures_sample=failures_sample,
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
