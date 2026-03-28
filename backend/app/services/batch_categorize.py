"""Batch categorization: rules, keyword dictionary, then LLM (same pipeline as auto-categorize API)."""

from __future__ import annotations

import json
import logging
from collections import OrderedDict
from typing import Any, List, Optional

from sqlmodel import Session

from ..config import get_settings
from ..models import Transaction
from ..schemas import AutoCategorizeSummary, LLMCategorizationResult
from .categories import get_category_id_by_name_he
from .classification import find_matching_rule
from .categorizer import categorize_transaction as llm_categorize
from .categorizer import categorize_transactions_batch
from .categorizer import transaction_llm_dedupe_key
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


def _chunk_transactions(txns: List[Transaction], chunk_size: int) -> List[List[Transaction]]:
    n = max(1, chunk_size)
    return [txns[i : i + n] for i in range(0, len(txns), n)]


def _progress_emit(sink: list[dict[str, Any]] | None, stage: str, **detail: Any) -> None:
    if sink is None:
        return
    payload: dict[str, Any] = {"stage": stage}
    payload.update(detail)
    sink.append(payload)


def _group_transactions_for_llm_dedupe(
    txns: List[Transaction],
) -> tuple[List[Transaction], dict[int, List[Transaction]]]:
    """One representative per identical merchant fingerprint; map rep id -> all rows that share it."""
    groups: OrderedDict[tuple, List[Transaction]] = OrderedDict()
    for t in txns:
        k = transaction_llm_dedupe_key(t)
        groups.setdefault(k, []).append(t)
    rep_to_all: dict[int, List[Transaction]] = {}
    reps: List[Transaction] = []
    for g in groups.values():
        rep = g[0]
        assert rep.id is not None
        rep_to_all[rep.id] = g
        reps.append(rep)
    return reps, rep_to_all


def batch_categorize_transactions(
    session: Session,
    txns: List[Transaction],
    *,
    progress_sink: Optional[list[dict[str, Any]]] = None,
) -> AutoCategorizeSummary:
    """Run rules, dictionary, then LLM (batched + deduped by merchant fingerprint)."""
    processed = len(txns)
    _progress_emit(progress_sink, "rules_dictionary", rows=processed)
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
        by_id: dict[int, tuple[LLMCategorizationResult | None, Exception | None]] = {}

        llm_reps, rep_id_to_group = _group_transactions_for_llm_dedupe(llm_ready)
        saved = len(llm_ready) - len(llm_reps)
        if saved > 0:
            logger.info(
                "LLM dedupe: %d rows -> %d unique signatures (%d fewer API rows)",
                len(llm_ready),
                len(llm_reps),
                saved,
            )

        rep_chunks = _chunk_transactions(llm_reps, settings.categorize_llm_batch_size)
        total_llm_batches = len(rep_chunks)
        _progress_emit(
            progress_sink,
            "llm_queue",
            rows=len(llm_ready),
            unique=len(llm_reps),
            batches_total=total_llm_batches,
        )

        def _fan_out_result(
            chunk_reps: List[Transaction],
            pair_for_rep_id: dict[int, tuple[LLMCategorizationResult | None, Exception | None]],
        ) -> None:
            for rep in chunk_reps:
                assert rep.id is not None
                pair = pair_for_rep_id[rep.id]
                for t in rep_id_to_group[rep.id]:
                    assert t.id is not None
                    by_id[t.id] = pair

        for batch_idx, chunk in enumerate(rep_chunks, start=1):
            _progress_emit(
                progress_sink,
                "llm_batch",
                batch=batch_idx,
                batches_total=total_llm_batches,
            )
            pair_by_rep: dict[int, tuple[LLMCategorizationResult | None, Exception | None]] = {}
            try:
                batch_map = categorize_transactions_batch(chunk)
                for rep in chunk:
                    assert rep.id is not None
                    res = batch_map[rep.id]
                    pair_by_rep[rep.id] = (res, None)
                _fan_out_result(chunk, pair_by_rep)
            except Exception as batch_exc:
                logger.warning(
                    "LLM batch failed (%d reps), falling back per representative: %s",
                    len(chunk),
                    batch_exc,
                )
                for rep in chunk:
                    assert rep.id is not None
                    tid, res, err = _run_llm_safe(rep)
                    pair_by_rep[tid] = (res, err)
                _fan_out_result(chunk, pair_by_rep)

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

    else:
        _progress_emit(progress_sink, "classification_local", rows=processed)

    session.commit()

    return AutoCategorizeSummary(
        processed=processed,
        categorized=categorized,
        needs_review=needs_review_count,
        failed=failed,
        failures_sample=failures_sample,
    )
