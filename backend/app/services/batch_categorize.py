"""Batch categorization: rules, keyword dictionary, then LLM (same pipeline as auto-categorize API)."""

from __future__ import annotations

import json
import logging
from typing import List

from sqlmodel import Session

from ..models import Transaction
from ..schemas import AutoCategorizeSummary
from .categories import get_category_id_by_name_he
from .classification import find_matching_rule
from .categorizer import categorize_transaction as llm_categorize
from .dictionary_rules import dictionary_categorize
from .spend_pattern import apply_auto_spend_pattern

logger = logging.getLogger(__name__)

_MAX_FAILURE_SAMPLES = 5
_BATCH_SIZE = 25


def batch_categorize_transactions(
    session: Session, txns: List[Transaction]
) -> AutoCategorizeSummary:
    """Run the three-layer pipeline on each transaction; commit in batches."""
    processed = len(txns)
    categorized = 0
    needs_review_count = 0
    failed = 0
    failures_sample: list[str] = []

    for idx, txn in enumerate(txns, 1):
        tx_id = txn.id
        try:
            with session.no_autoflush:
                rule = find_matching_rule(session, txn)
            if rule is not None:
                txn.category_id = rule.category_id
                txn.confidence = 0.9
                txn.rule_id_applied = rule.id
                txn.needs_review = False
                txn.reason_he = f"rule:{rule.pattern}"
                apply_auto_spend_pattern(txn, None)
                session.add(txn)
                categorized += 1
                logger.info("tx %s -> rule (pattern=%s)", tx_id, rule.pattern)
                if idx % _BATCH_SIZE == 0:
                    session.commit()
                continue

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
                apply_auto_spend_pattern(txn, None)
                session.add(txn)
                categorized += 1
                logger.info("tx %s -> dict (%s)", tx_id, dict_hit.category_name_he)
                if idx % _BATCH_SIZE == 0:
                    session.commit()
                continue

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

            apply_auto_spend_pattern(txn, result.spend_pattern)
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
