"""Spend pattern: recurring vs one-time (noise) vs unknown; auto + user override."""

from __future__ import annotations

from ..models import Transaction
from ..spend_pattern_constants import ALLOWED_SPEND_PATTERNS


def normalize_spend_pattern(raw: str | None) -> str:
    p = (raw or "unknown").strip()
    return p if p in ALLOWED_SPEND_PATTERNS else "unknown"


def infer_spend_pattern_heuristic(txn: Transaction) -> str | None:
    """Foreign / abroad sections often are one-off travel noise."""
    sec = (txn.section or "").strip().upper()
    if sec == "FOREIGN" or "FOREIGN" in sec:
        return "one_time"
    raw_sec = txn.section or ""
    if 'חו"ל' in raw_sec or "חוץ" in raw_sec:
        return "one_time"
    return None


def apply_auto_spend_pattern(txn: Transaction, llm_pattern: str | None) -> None:
    """Set spend_pattern when the user has not locked it. LLM beats heuristics when explicit."""
    if txn.spend_pattern_user_set:
        return
    p = normalize_spend_pattern(llm_pattern)
    if p in ("recurring", "one_time"):
        txn.spend_pattern = p
        return
    h = infer_spend_pattern_heuristic(txn)
    txn.spend_pattern = h if h else "unknown"
