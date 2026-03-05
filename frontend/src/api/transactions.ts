import { api } from "./client"
import type { Transaction, AutoCategorizeSummary, CategorizeRequest, CategorizeResponse } from "./types"

export async function listTransactions(month: string, limit = 500, offset = 0): Promise<Transaction[]> {
  return api.get<Transaction[]>("/transactions", { month, limit, offset })
}

export async function getNeedsReview(month: string, limit = 500): Promise<Transaction[]> {
  return api.get<Transaction[]>("/transactions/needs-review", { month, limit })
}

/** Alias for getNeedsReview */
export const needsReview = getNeedsReview

export async function updateCategory(
  transactionId: number,
  categoryId: number,
  options?: { createRule?: boolean; rulePattern?: string; ruleMatchType?: string },
): Promise<CategorizeResponse> {
  return categorizeTransaction(transactionId, {
    category_id: categoryId,
    create_rule: options?.createRule ?? false,
    rule_match_type: options?.ruleMatchType ?? "contains",
    rule_pattern: options?.rulePattern ?? undefined,
  })
}

export async function categorizeTransaction(
  transactionId: number,
  body: CategorizeRequest,
): Promise<CategorizeResponse> {
  return api.post<CategorizeResponse>(`/transactions/${transactionId}/categorize`, body)
}

export async function autoCategorize(
  month: string,
  force = false,
): Promise<AutoCategorizeSummary> {
  return api.post<AutoCategorizeSummary>(
    "/transactions/auto-categorize",
    undefined,
    { month: month, force: force },
  )
}
