"""Batch categorization: rules, keyword dictionary, then LLM (same pipeline as auto-categorize API)."""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List

from sqlmodel import Session

from ..config import get_settings
from ..models import Transaction
from ..schemas import AutoCategorizeSummary, LLMCategorizationResult
from .categories import get_category_id_by_name_he
from .classification import find_matching_rule
from .categorizer import categorize_transaction as llm_categorize
from .dictionary_rules import dictionary_categorize
from .spend_pattern import apply_auto_spend_pattern

logger = logging.getLogger(__name__)

_MAX_FAILURE_SAMPLES = 5
_BATCH_SIZE = 25


def _run_llm_safe(txn: Transaction) -> tuple[int, LLMCategorizationResult | None, Exception | None]:
    try:
        return txn.id, llm_categorize(txn), None
    except Exception as exc:
        return txn.id, None, exc


def batch_categorize_transactions(
    session: Session, txns: List[Transaction]
) -> AutoCategorizeSummary:
    """Run the three-layer pipeline on each transaction; LLM calls run in parallel threads."""
    processed = len(txns)
    categorized = 0
    needs_review_count = 0
    failed = 0
    failures_sample: list[str] = []
    llm_needed: list[Transaction] = []

    def commit_if_batch(idx: int) -> None:
        if idx % _BATCH_SIZE == 0:
            session.commit()

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
                commit_if_batch(idx)
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
                commit_if_batch(idx)
                continue

            llm_needed.append(txn)
        except Exception as exc:
            session.rollback()
            logger.warning("Categorization failed for tx %s: %s", tx_id, exc)
            failed += 1
            if len(failures_sample) < _MAX_FAILURE_SAMPLES:
                failures_sample.append(f"tx {tx_id}: {exc}")
            continue

    session.commit()

    refresh_failed: set[int] = set()
    for txn in llm_needed:
        try:
            session.refresh(txn)
        except Exception as exc:
            logger.warning("refresh failed for tx %s before LLM: %s", txn.id, exc)
            refresh_failed.add(txn.id)
            failed += 1
            if len(failures_sample) < _MAX_FAILURE_SAMPLES:
                failures_sample.append(f"tx {txn.id}: {exc}")
            txn.needs_review = True
            session.add(txn)

    llm_ready = [t for t in llm_needed if t.id not in refresh_failed]

    if llm_ready:
        settings = get_settings()
        workers = max(1, min(settings.categorize_llm_workers, len(llm_ready)))
        by_id: dict[int, tuple[LLMCategorizationResult | None, Exception | None]] = {}

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_run_llm_safe, t) for t in llm_ready]
            for fut in as_completed(futures):
                tid, res, err = fut.result()
                by_id[tid] = (res, err)

        for idx, txn in enumerate(llm_ready, 1):
            tx_id = txn.id
            pair = by_id.get(tx_id)
            if pair is None:
                failed += 1
                if len(failures_sample) < _MAX_FAILURE_SAMPLES:
                    failures_sample.append(f"tx {tx_id}: missing LLM result")
                txn.needs_review = True
                session.add(txn)
                continue
            result, err = pair
            if err is not None:
                failed += 1
                if len(failures_sample) < _MAX_FAILURE_SAMPLES:
                    failures_sample.append(f"tx {tx_id}: {err}")
                txn.needs_review = True
                session.add(txn)
                continue
            if result is None:
                failed += 1
                if len(failures_sample) < _MAX_FAILURE_SAMPLES:
                    failures_sample.append(f"tx {tx_id}: empty LLM result")
                txn.needs_review = True
                session.add(txn)
                continue

            try:
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
                logger.warning("Categorization apply failed for tx %s: %s", tx_id, exc)
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
