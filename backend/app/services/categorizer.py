"""LLM-based transaction categorization service."""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

from openai import OpenAI

from ..config import get_settings
from ..models import Transaction
from ..schemas import LLMCategorizationResult, SuggestedCategory
from .spend_pattern import normalize_spend_pattern

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[3] / "prompts"

_REQUIRED_KEYS = {"category", "confidence", "needs_review", "reason_he", "merchant_key_guess"}


@lru_cache(maxsize=1)
def _load_system_prompt() -> str:
    path = _PROMPTS_DIR / "transaction_categorizer.md"
    return path.read_text(encoding="utf-8")


def _build_user_prompt(transaction: Transaction) -> str:
    details: str | None = None
    if transaction.raw_row_data:
        try:
            raw = json.loads(transaction.raw_row_data)
            details = raw.get("details")
        except json.JSONDecodeError:
            pass

    fields: Dict[str, Any] = {
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
    return json.dumps(fields, ensure_ascii=False, indent=2)


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


def _parse_llm_response(raw: str) -> LLMCategorizationResult:
    cleaned = _extract_json(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("LLM returned invalid JSON. Raw response:\n%s", raw)
        raise ValueError(f"LLM response is not valid JSON: {raw[:300]}")

    missing = _REQUIRED_KEYS - set(data.keys())
    if missing:
        logger.warning("LLM JSON missing keys %s. Raw response:\n%s", missing, raw)
        raise ValueError(f"LLM response missing required keys: {missing}")

    suggested: SuggestedCategory | None = None
    if data.get("suggest_new_category"):
        sc = data["suggest_new_category"]
        suggested = SuggestedCategory(
            name_he=sc.get("name_he", ""),
            why_needed_he=sc.get("why_needed_he", ""),
        )

    return LLMCategorizationResult(
        category_name_he=data["category"],
        confidence=float(data["confidence"]),
        needs_review=bool(data["needs_review"]),
        reason_he=data["reason_he"],
        merchant_key_guess=data.get("merchant_key_guess"),
        suggested_new_category=suggested,
        spend_pattern=normalize_spend_pattern(data.get("spend_pattern")),
    )


def categorize_transaction(transaction: Transaction) -> LLMCategorizationResult:
    """Categorize a single transaction using the LLM.

    Returns the classification result without modifying the database.
    If the LLM suggests a new category, it is returned as a suggestion only.
    """
    system_prompt = _load_system_prompt()
    user_prompt = _build_user_prompt(transaction)
    raw_response = _call_llm(system_prompt, user_prompt)
    return _parse_llm_response(raw_response)
