import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api-client"

export type TransferTag = "stock" | "gift" | "reimbursement" | "reserve"

export type BankFlowGroup =
  | "income_regular"
  | "income_unemployment"
  | "income_anomaly"
  | "wash_in"
  | "expense_cc"
  | "expense_living"
  | "savings"
  | "expense_anomaly"
  | "wash_out"

export interface BankUploadHistoryItem {
  id: number
  original_filename: string
  account_number: string
  date_from: string | null
  date_to: string | null
  previous_max_date: string | null
  inserted_count: number
  skipped_duplicates_count: number
  created_at: string
}

export interface BankStatusResponse {
  has_data: boolean
  account_number: string
  total_transactions: number
  first_date: string | null
  last_synced_date: string | null
  total_months: number
  uploads: BankUploadHistoryItem[]
}

export interface BankSettings {
  inc_muni_dig: boolean
  inc_bit: boolean
  inc_bituach_leumi: boolean
  inc_sav_600_as_expense: boolean
  inc_khs_as_expense: boolean
}

export interface BankPeriodDef {
  key: string
  label: string
  subtitle: string
  months: string[]
  tone: "success" | "info" | "warning" | "neutral"
}

export interface BankMonthRow {
  ym: string
  sal1: number
  sal2: number
  sal_misc: number
  child: number
  muni_dig_in: number
  health_ins_in: number
  bit_in: number
  bank_misc_in: number
  bituach_leumi: number
  anom_in: number
  wash_fin_in: number
  cc_raw: number
  cc_isracard: number
  cc_mc_other: number
  mortgage: number
  reg_transfers: number
  loans_monthly: number
  vaad_454: number
  sav_600: number
  cash_checks: number
  health_out: number
  fees_out: number
  khs_20k: number
  anom_out: number
  wash_fin_out: number
  end_bal: number
  cc_rec: number
  cc_sav: number
  cc_ot: number
  cc_source: "db" | "est"
}

export interface BankCcCategoryRow {
  name: string
  rec_mo: number
  ot_mo: number
  total: number
}

export interface BankSavingsVehicleRow {
  name: string
  cadence: string
  total: number
  monthly_equiv: number
  details: string
}

export interface BankWashRow {
  category: string
  count_label: string
  inflows: number
  outflows: number
  net: number
  detail: string
}

export interface BankExternalTransferRow {
  id: number
  date: string
  source: string
  amount: number
  tag: TransferTag
  context: string
  is_user_override: boolean
}

export interface BankOtherAnomalyInflowRow {
  source: string
  count: number
  total: number
  monthly_equiv: number
  explanation: string
}

export interface BankOneTimeOutflowRow {
  bucket: string
  scope: string
  total: number
  monthly_equiv: number
  details: string
}

export interface BankTripSummaryRow {
  trip: string
  timing: string
  billed_so_far: number
  remaining_future: number
  total_est: number
  status: string
}

export interface BankOpenInstallmentRow {
  description: string
  card_label: string
  monthly_amount: number
  current_installment: number
  total_installments: number
  remaining_installments: number
  remaining_total: number
  original_total: number
  is_travel: boolean
}

export interface BankCapitalEventItem {
  date: string
  description: string
  reference: string
  signed_amount: number
  role: string
}

export interface BankCapitalEvent {
  title: string
  net_checking_impact: number
  items: BankCapitalEventItem[]
}

export interface BankDynamicInsight {
  id: string
  tone: "success" | "info" | "warning" | "neutral"
  badge: string
  title: string
  body: string
}

export interface BankAnalysisResponse {
  status: BankStatusResponse
  settings: BankSettings
  periods: BankPeriodDef[]
  monthly: BankMonthRow[]
  cc_categories: BankCcCategoryRow[]
  savings_vehicles: BankSavingsVehicleRow[]
  wash_ledger: BankWashRow[]
  external_transfers: BankExternalTransferRow[]
  other_anomaly_inflows: BankOtherAnomalyInflowRow[]
  one_time_outflows: BankOneTimeOutflowRow[]
  trips_summary: BankTripSummaryRow[]
  open_installments: BankOpenInstallmentRow[]
  capital_events: BankCapitalEvent[]
  insights: BankDynamicInsight[]
}

export interface BankLedgerItem {
  id: number
  activity_date: string
  value_date: string | null
  month: string
  description: string
  reference: string
  debit: number
  credit: number
  balance: number | null
  flow_group: BankFlowGroup
  stream_key: string
  transfer_tag: TransferTag | null
  context_note: string | null
  is_user_override: boolean
}

export interface BankLedgerResponse {
  total: number
  items: BankLedgerItem[]
}

export interface BankUploadResponse {
  files_processed: number
  total_inserted: number
  total_skipped_duplicates: number
  previous_max_date: string | null
  new_max_date: string | null
  files: Array<{
    upload_id: number | null
    filename: string
    account_number: string
    date_from: string | null
    date_to: string | null
    inserted_count: number
    skipped_duplicates_count: number
    total_rows_in_file: number
  }>
}

export function useBankStatus() {
  return useQuery({
    queryKey: ["bank-status"],
    queryFn: () => api.get<BankStatusResponse>("/api/bank/status"),
  })
}

export function useBankAnalysis() {
  return useQuery({
    queryKey: ["bank-analysis"],
    queryFn: () => api.get<BankAnalysisResponse>("/api/bank/analysis"),
  })
}

export function useBankTransactions(params: {
  month?: string
  flow_group?: string
  q?: string
  limit?: number
}) {
  return useQuery({
    queryKey: ["bank-transactions", params],
    queryFn: () =>
      api.get<BankLedgerResponse>("/api/bank/transactions", {
        month: params.month || undefined,
        flow_group: params.flow_group || undefined,
        q: params.q || undefined,
        limit: params.limit ?? 400,
      }),
  })
}

export function useUploadBankStatements() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData()
      for (const f of files) {
        fd.append("files", f)
      }
      return api.upload<BankUploadResponse>("/api/bank/uploads", fd)
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["bank-status"] }),
        qc.invalidateQueries({ queryKey: ["bank-analysis"] }),
        qc.invalidateQueries({ queryKey: ["bank-transactions"] }),
      ])
    },
  })
}

export function usePatchBankTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      id: number
      flow_group?: BankFlowGroup
      transfer_tag?: TransferTag
      context_note?: string
    }) => {
      const { id, ...body } = vars
      return api.patch(`/api/bank/transactions/${id}`, body)
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["bank-analysis"] }),
        qc.invalidateQueries({ queryKey: ["bank-transactions"] }),
      ])
    },
  })
}

export function useUpdateBankSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: BankSettings) =>
      api.put<BankSettings>("/api/bank/settings", payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bank-analysis"] })
    },
  })
}
