from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import field_validator
from sqlmodel import SQLModel

from .spend_pattern_constants import ALLOWED_SPEND_PATTERNS
from .utils import normalize_currency_code


class UploadRead(SQLModel):
    id: int
    created_at: datetime
    month: str
    original_filename: str
    size_bytes: int
    file_hash: str
    num_transactions: int

    model_config = {"from_attributes": True}


class AutoCategorizeSummary(SQLModel):
    processed: int
    categorized: int
    needs_review: int
    failed: int
    failures_sample: List[str]


class UploadCreateResponse(SQLModel):
    upload_id: int
    month: str
    file_name: str
    file_hash: str
    cards_detected: List[str]
    sections_detected: List[str]
    inserted_count: int
    skipped_duplicates_count: int
    skipped_noise_count: int
    categorization: AutoCategorizeSummary
    categorization_deferred: bool = False


class CategorizeQueueResponse(SQLModel):
    pending_count: int


class AutoCategorizeChunkResponse(SQLModel):
    chunk: AutoCategorizeSummary
    pending_remaining: int
    done: bool
    categorize_stage: Optional[str] = None
    categorize_stage_detail: Optional[Dict[str, Any]] = None


class TransactionRead(SQLModel):
    id: int
    upload_id: int
    card_label: Optional[str]
    section: Optional[str]
    posted_at: Optional[date]
    description: str
    amount: float
    currency: Optional[str]
    needs_review: bool
    category_id: Optional[int]
    confidence: float
    rule_id_applied: Optional[int]
    reason_he: Optional[str] = None
    meta_json: Optional[str] = None
    spend_pattern: str = "unknown"
    spend_pattern_user_set: bool = False

    model_config = {"from_attributes": True}

    @field_validator("currency", mode="before")
    @classmethod
    def _normalize_currency(cls, v: Optional[str]) -> Optional[str]:
        return normalize_currency_code(v)


# ---------------------------------------------------------------------------
# Categorize request / response
# ---------------------------------------------------------------------------

class CategorizeRequest(SQLModel):
    category_id: int
    create_rule: bool = False
    rule_match_type: Optional[str] = None
    rule_pattern: Optional[str] = None


class CategorizeResponse(SQLModel):
    transaction_id: int
    category_id: int
    rule_created: bool
    rule_id: Optional[int]
    backfill_count: int


# ---------------------------------------------------------------------------
# LLM categorization schemas
# ---------------------------------------------------------------------------

class SuggestedCategory(SQLModel):
    name_he: str
    why_needed_he: str


class LLMCategorizationResult(SQLModel):
    category_name_he: str
    confidence: float
    needs_review: bool
    reason_he: str
    merchant_key_guess: Optional[str] = None
    suggested_new_category: Optional[SuggestedCategory] = None
    spend_pattern: str = "unknown"


class SpendPatternUpdate(SQLModel):
    spend_pattern: str

    @field_validator("spend_pattern", mode="before")
    @classmethod
    def _valid_pattern(cls, v: str) -> str:
        s = (v or "").strip()
        if s not in ALLOWED_SPEND_PATTERNS:
            raise ValueError("spend_pattern must be unknown, recurring, or one_time")
        return s


# ---------------------------------------------------------------------------
# Insight response schemas
# ---------------------------------------------------------------------------

class CategorySpend(SQLModel):
    category_id: Optional[int]
    category_name: str
    amount: float
    pct: float


class CardSpend(SQLModel):
    card_label: Optional[str]
    amount: float


class MerchantSpend(SQLModel):
    merchant_key: str
    display_name: str
    amount: float
    txn_count: int


class SummaryResponse(SQLModel):
    total_spend: float
    spend_by_category: List[CategorySpend]
    spend_by_card: List[CardSpend]
    top_merchants: List[MerchantSpend]


class TrendsResponse(SQLModel):
    months: List[str]
    total_spend_series: List[float]
    category_series: Dict[str, List[float]]


class AnomalyItem(SQLModel):
    type: str
    name: str
    current: float
    baseline: float
    delta: float
    pct: float


# ---------------------------------------------------------------------------
# Budget schemas
# ---------------------------------------------------------------------------

class BudgetRead(SQLModel):
    id: int
    category_id: int
    month: str
    budget_amount: float


class BudgetUpsertRequest(SQLModel):
    category_id: int
    month: str
    budget_amount: float


class BudgetAlertItem(SQLModel):
    category_id: int
    category_name: str
    budget: float
    spent: float
    remaining: float
    status: str


# ---------------------------------------------------------------------------
# Forecast schemas
# ---------------------------------------------------------------------------

class RecurringMerchant(SQLModel):
    merchant_key: str
    display_name: str
    avg_amount: float
    months_present: int


class CategoryForecast(SQLModel):
    category_id: Optional[int]
    category_name: str
    amount: float


class ForecastResponse(SQLModel):
    forecast_month: str
    total_forecast: float
    category_forecasts: List[CategoryForecast]
    recurring_merchants: List[RecurringMerchant]


# ---------------------------------------------------------------------------
# Category schemas
# ---------------------------------------------------------------------------

class CategoryRead(SQLModel):
    id: int
    name: str
    description: Optional[str]
    is_system: bool

    model_config = {"from_attributes": True}


class CategoryCreate(SQLModel):
    name: str
    description: Optional[str] = None


# ---------------------------------------------------------------------------
# Classification rule schemas
# ---------------------------------------------------------------------------

class RuleRead(SQLModel):
    id: int
    category_id: int
    category_name: str
    pattern: str
    match_type: str
    priority: int
    active: bool
    card_label_filter: Optional[str]


class RuleCreateRequest(SQLModel):
    category_id: int
    pattern: str
    match_type: str = "contains"
    priority: int = 100
    active: bool = True
    card_label_filter: Optional[str] = None


class RuleUpdateRequest(SQLModel):
    category_id: Optional[int] = None
    pattern: Optional[str] = None
    match_type: Optional[str] = None
    priority: Optional[int] = None
    active: Optional[bool] = None
    card_label_filter: Optional[str] = None
