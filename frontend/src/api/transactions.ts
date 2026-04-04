import { api } from "./client"
import type { Transaction, AutoCategorizeSummary, CategorizeRequest, CategorizeResponse } from "./types"
import type {
  MerchantGroupActionBody,
  MerchantGroupListResponse,
  TransactionRead,
} from "@/types/api"

export async function listTransactions(month: string, limit = 500, offset = 0): Promise<Transaction[]> {
  return api.get<Transaction[]>("/transactions", { month, limit, offset })
}

export async function listMerchantGroups(params: {
  approved: boolean
  q?: string
  limit?: number
  offset?: number
}): Promise<MerchantGroupListResponse> {
  const { approved, q, limit = 100, offset = 0 } = params
  return api.get<MerchantGroupListResponse>("/transactions/merchant-groups", {
    approved,
    q,
    limit,
    offset,
  })
}

export async function approveMerchantGroup(
  body: MerchantGroupActionBody,
): Promise<{ pattern_key: string }> {
  return api.post<{ pattern_key: string }>("/transactions/merchant-groups/approve", body)
}

export async function unapproveMerchantGroup(
  body: MerchantGroupActionBody,
): Promise<{ pattern_key: string }> {
  return api.post<{ pattern_key: string }>("/transactions/merchant-groups/unapprove", body)
}

export async function setMerchantGroupSubcategory(
  body: MerchantGroupActionBody,
): Promise<{ pattern_key: string }> {
  return api.post<{ pattern_key: string }>("/transactions/merchant-groups/subcategory", body)
}

export async function patchTransactionSubcategory(
  transactionId: number,
  subcategoryId: number | null,
): Promise<TransactionRead> {
  return api.patch<TransactionRead>(`/transactions/${transactionId}/subcategory`, {
    subcategory_id: subcategoryId,
  })
}

export async function getNeedsReview(month: string, limit = 500): Promise<Transaction[]> {
  return api.get<Transaction[]>("/transactions/needs-review", { month, limit })
}

/** Alias for getNeedsReview */
export const needsReview = getNeedsReview

export async function updateCategory(
  transactionId: number,
  categoryId: number,
  options?: { rulePattern?: string },
): Promise<CategorizeResponse> {
  return categorizeTransaction(transactionId, {
    category_id: categoryId,
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

export async function getLlmPendingCount(month: string): Promise<{ pending_count: number }> {
  return api.get<{ pending_count: number }>("/transactions/llm-categorize-pending/count", {
    month,
  })
}

export async function llmCategorizePending(
  month: string,
  limit = 300,
): Promise<AutoCategorizeSummary> {
  return api.post<AutoCategorizeSummary>(
    "/transactions/llm-categorize-pending",
    undefined,
    { month, limit },
  )
}
