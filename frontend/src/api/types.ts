export interface Transaction {
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
  confidence: number
  rule_id_applied: number | null
  reason_he?: string | null
  meta_json?: string | null
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

export interface Category {
  id: number
  name: string
  description: string | null
  is_system: boolean
}

export interface CategorySpend {
  category_id: number | null
  category_name: string
  amount: number
  pct: number
}

export interface SummaryResponse {
  total_spend: number
  spend_by_category: CategorySpend[]
  spend_by_card: { card_label: string | null; amount: number }[]
  top_merchants: { merchant_key: string; display_name: string; amount: number; txn_count: number }[]
}

export interface TrendsResponse {
  months: string[]
  total_spend_series: number[]
  category_series: Record<string, number[]>
}

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
