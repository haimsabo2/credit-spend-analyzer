"""LLM-based transaction categorization service."""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Sequence

from openai import OpenAI

from ..config import get_settings
from ..models import Transaction
from ..schemas import LLMCategorizationResult, SuggestedCategory
from .spend_pattern import normalize_spend_pattern

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[3] / "prompts"

_REQUIRED_KEYS = {"category", "confidence", "needs_review", "reason_he", "merchant_key_guess"}

# Compact user JSON saves input tokens on every request.
_USER_JSON_KW: Dict[str, Any] = {"ensure_ascii": False, "separators": (",", ":")}

_BATCH_MODE_SUFFIX = """

## Batch mode (critical)
The user message is JSON: `{"transactions":[...]}` — one object per row, each including integer **id** (transaction id) plus merchant fields.

Return **only** a JSON **array** (no markdown fences). The array must have **exactly one object per input transaction**. Each object must include:
- **id** (same integer as input)
- **category**, **subcategory** (optional, same rules as single-transaction output), **confidence**, **needs_review**, **reason_he**, **spend_pattern**, **merchant_key_guess**, **suggest_new_category** (same rules as single-transaction output).

Order of array elements is free; every input **id** must appear exactly once.
"""


@lru_cache(maxsize=1)
def _load_system_prompt() -> str:
    path = _PROMPTS_DIR / "transaction_categorizer.md"
    return path.read_text(encoding="utf-8")


def _txn_fields_dict(transaction: Transaction) -> Dict[str, Any]:
    details: str | None = None
    if transaction.raw_row_data:
        try:
            raw = json.loads(transaction.raw_row_data)
            details = raw.get("details")
        except json.JSONDecodeError:
            pass

    return {
        "merchant_raw": transaction.description,
        "details": details,
        "amount_original": None,
        "currency_original": None,
        "amount_charged": transaction.amount,
        "currency_charged": transaction.currency,
        "section": transaction.section,
        "card_label": transaction.card_label,
        "purchase_date": str(transaction.posted_at) if transaction.posted_at else None,
    }


def transaction_llm_dedupe_key(transaction: Transaction) -> tuple[Any, ...]:
    """Fingerprint for LLM: same key => same category/spend_pattern assumption, one API row."""
    d = _txn_fields_dict(transaction)
    raw = (d.get("merchant_raw") or "").strip().lower()
    det = d.get("details")
    det_n = str(det).strip().lower() if det else ""
    sec = d.get("section") or ""
    cur = d.get("currency_charged")
    card = d.get("card_label") or ""
    return (raw, det_n, sec, cur, card)


def _build_user_prompt(transaction: Transaction) -> str:
    return json.dumps(_txn_fields_dict(transaction), **_USER_JSON_KW)


def _get_client() -> OpenAI:
    settings = get_settings()
    kwargs: Dict[str, Any] = {"api_key": settings.llm_api_key}
    if settings.llm_base_url:
        kwargs["base_url"] = settings.llm_base_url
    return OpenAI(**kwargs)


def _call_llm(system_prompt: str, user_prompt: str) -> str:
    settings = get_settings()
    client = _get_client()
    response = client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.0,
    )
    return response.choices[0].message.content or ""


def _extract_json(raw: str) -> str:
    """Strip optional markdown code fences surrounding the JSON payload."""
    match = re.search(r"```(?:json)?\s*\n?(.*?)```", raw, re.DOTALL)
    if match:
        return match.group(1).strip()
    return raw.strip()


def _dict_to_llm_result(data: dict[str, Any]) -> LLMCategorizationResult:
    missing = _REQUIRED_KEYS - set(data.keys())
    if missing:
        raise ValueError(f"LLM response missing required keys: {missing}")

    suggested: SuggestedCategory | None = None
    if data.get("suggest_new_category"):
        sc = data["suggest_new_category"]
        suggested = SuggestedCategory(
            name_he=sc.get("name_he", ""),
            why_needed_he=sc.get("why_needed_he", ""),
        )

    sub_raw = data.get("subcategory") or data.get("subcategory_name_he")
    if sub_raw is None or not isinstance(sub_raw, str):
        sub_he = None
    else:
        sub_he = sub_raw.strip() or None

    return LLMCategorizationResult(
        category_name_he=data["category"],
        confidence=float(data["confidence"]),
        needs_review=bool(data["needs_review"]),
        reason_he=data["reason_he"],
        merchant_key_guess=data.get("merchant_key_guess"),
        suggested_new_category=suggested,
        spend_pattern=normalize_spend_pattern(data.get("spend_pattern")),
        subcategory_name_he=sub_he,
    )


def _parse_llm_response(raw: str) -> LLMCategorizationResult:
    cleaned = _extract_json(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("LLM returned invalid JSON. Raw response:\n%s", raw)
        raise ValueError(f"LLM response is not valid JSON: {raw[:300]}")
    return _dict_to_llm_result(data)


def categorize_transaction(transaction: Transaction) -> LLMCategorizationResult:
    """Categorize a single transaction using the LLM.

    Returns the classification result without modifying the database.
    If the LLM suggests a new category, it is returned as a suggestion only.
    """
    system_prompt = _load_system_prompt()
    user_prompt = _build_user_prompt(transaction)
    raw_response = _call_llm(system_prompt, user_prompt)
    return _parse_llm_response(raw_response)


def categorize_transactions_batch(transactions: Sequence[Transaction]) -> dict[int, LLMCategorizationResult]:
    """Categorize many transactions in **one** API call (one shared system prompt).

    Raises ValueError or json errors if the model output cannot be parsed; caller may fall back per-txn.
    """
    tx_list = list(transactions)
    if not tx_list:
        return {}
    if len(tx_list) == 1:
        t = tx_list[0]
        assert t.id is not None
        return {t.id: categorize_transaction(t)}

    expected_ids = {t.id for t in tx_list if t.id is not None}
    if len(expected_ids) != len(tx_list):
        raise ValueError("all transactions must have ids for batch categorization")

    payload = {
        "transactions": [{**_txn_fields_dict(t), "id": t.id} for t in tx_list],
    }
    user_prompt = json.dumps(payload, **_USER_JSON_KW)
    system_prompt = _load_system_prompt() + _BATCH_MODE_SUFFIX
    raw_response = _call_llm(system_prompt, user_prompt)
    cleaned = _extract_json(raw_response)
    try:
        arr = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning("Batch LLM invalid JSON. Raw:\n%s", raw[:800])
        raise ValueError(f"batch LLM response is not valid JSON: {e}") from e

    if not isinstance(arr, list):
        raise ValueError("batch LLM response must be a JSON array")

    out: dict[int, LLMCategorizationResult] = {}
    for item in arr:
        if not isinstance(item, dict):
            continue
        tid = item.get("id")
        if tid is None:
            continue
        tid_i = int(tid)
        row = {k: v for k, v in item.items() if k != "id"}
        try:
            out[tid_i] = _dict_to_llm_result(row)
        except (ValueError, TypeError, KeyError) as e:
            logger.warning("batch item parse failed for id=%s: %s", tid, e)
            raise ValueError(f"invalid batch item for id {tid}: {e}") from e

    missing = expected_ids - set(out.keys())
    if missing:
        sm = sorted(missing)
        head, tail = sm[:20], sm[20:]
        msg = f"batch LLM missing results for ids: {head}"
        if tail:
            msg += f" (+{len(tail)} more)"
        raise ValueError(msg)
    extra = set(out.keys()) - expected_ids
    if extra:
        raise ValueError(f"batch LLM returned unexpected ids: {extra}")
    return out
