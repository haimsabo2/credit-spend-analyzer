// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export interface UploadRead {
  id: number
  created_at: string
  month: string
  original_filename: string
  size_bytes: number
  file_hash: string
  num_transactions: number
}

export interface AutoCategorizeSummary {
  processed: number
  categorized: number
  needs_review: number
  failed: number
  failures_sample: string[]
}

export interface UploadCreateResponse {
  upload_id: number
  month: string
  file_name: string
  file_hash: string
  cards_detected: string[]
  sections_detected: string[]
  inserted_count: number
  skipped_duplicates_count: number
  skipped_noise_count: number
  categorization: AutoCategorizeSummary
  categorization_deferred?: boolean
}

export interface CategorizeQueueResponse {
  pending_count: number
}

export interface AutoCategorizeChunkResponse {
  chunk: AutoCategorizeSummary
  pending_remaining: number
  done: boolean
  categorize_stage?: string | null
  categorize_stage_detail?: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface TransactionRead {
  id: number
  upload_id: number
  card_label: string | null
  section: string | null
  posted_at: string | null
  description: string
  amount: number
  currency: string | null
  needs_review: boolean
  category_id: number | null
  subcategory_id?: number | null
  confidence: number
  rule_id_applied: number | null
  spend_pattern?: string
  spend_pattern_user_set?: boolean
}

export interface CategorizeRequest {
  category_id: number
  create_rule?: boolean
  rule_match_type?: string | null
  rule_pattern?: string | null
}

export interface CategorizeResponse {
  transaction_id: number
  category_id: number
  rule_created: boolean
  rule_id: number | null
  backfill_count: number
}

export interface TransactionQueryParams {
  month?: string
  card_label?: string
  section?: string
  category_id?: number
  subcategory_id?: number
  needs_review?: boolean
  q?: string
  amount_min?: number
  amount_max?: number
  spend_pattern?: string
  limit?: number
  offset?: number
}

export interface SubcategoryRead {
  id: number
  category_id: number
  name: string
}

export interface MerchantSpendGroupRead {
  id: number
  display_name: string
  created_at: string
}

export interface MerchantSpendGroupMemberRead {
  id: number
  group_id: number
  pattern_key: string
}

export interface MerchantGroupSeriesResponse {
  months: string[]
  amounts: number[]
}

export interface MerchantGroupRow {
  pattern_key: string
  display_description: string
  occurrence_count: number
  total_amount: number
  representative_transaction_id: number
  category_id: number | null
  subcategory_id?: number | null
  needs_review_any: boolean
  spend_group_name?: string | null
}

export interface MerchantGroupListResponse {
  items: MerchantGroupRow[]
  total: number
}

export interface MerchantGroupActionBody {
  transaction_id?: number
  pattern_key?: string
  subcategory_id?: number | null
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export interface CategorySpend {
  category_id: number | null
  category_name: string
  amount: number
  pct: number
}

export interface CardSpend {
  card_label: string | null
  amount: number
}

export interface MerchantSpend {
  merchant_key: string
  display_name: string
  amount: number
  txn_count: number
}

export interface SummaryResponse {
  total_spend: number
  spend_by_category: CategorySpend[]
  spend_by_card: CardSpend[]
  top_merchants: MerchantSpend[]
}

export interface CategoryMonthlyRow {
  category_id: number | null
  category_name: string
  amounts: number[]
  year_total: number
}

export interface TrendsResponse {
  months: string[]
  total_spend_series: number[]
  category_series: Record<string, number[]>
  /** Same length as `months` when returned by the API (rolling or calendar year). */
  txn_count_series?: number[]
  /** Filled for calendar `year` requests: every category with spend in that year. */
  category_monthly?: CategoryMonthlyRow[]
}

export interface MerchantMonthlySeries {
  merchant_key: string
  amounts: number[]
}

export interface CategoryYearMerchantsResponse {
  months: string[]
  merchants: MerchantMonthlySeries[]
}

export interface MonthCategorySubcategoriesResponse {
  items: { label: string; amount: number }[]
}

export interface AnomalyItem {
  type: string
  name: string
  current: number
  baseline: number
  delta: number
  pct: number
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export interface BudgetRead {
  id: number
  category_id: number
  month: string
  budget_amount: number
}

export interface BudgetUpsertRequest {
  category_id: number
  month: string
  budget_amount: number
}

export interface BudgetAlertItem {
  category_id: number
  category_name: string
  budget: number
  spent: number
  remaining: number
  status: "ok" | "warn" | "exceeded"
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

export interface RecurringMerchant {
  merchant_key: string
  display_name: string
  avg_amount: number
  months_present: number
}

export interface CategoryForecast {
  category_id: number | null
  category_name: string
  amount: number
}

export interface ForecastResponse {
  forecast_month: string
  total_forecast: number
  category_forecasts: CategoryForecast[]
  recurring_merchants: RecurringMerchant[]
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryRead {
  id: number
  name: string
  description: string | null
  is_system: boolean
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface RuleRead {
  id: number
  category_id: number
  category_name: string
  pattern: string
  match_type: string
  priority: number
  active: boolean
  card_label_filter: string | null
}

export interface RuleCreateRequest {
  category_id: number
  pattern: string
  match_type?: string
  priority?: number
  active?: boolean
  card_label_filter?: string | null
}

export interface RuleUpdateRequest {
  category_id?: number
  pattern?: string
  match_type?: string
  priority?: number
  active?: boolean
  card_label_filter?: string | null
}
