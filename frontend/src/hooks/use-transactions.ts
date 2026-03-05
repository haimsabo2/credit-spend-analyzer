import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { TransactionRead, TransactionQueryParams } from "@/types/api"

export function useTransactions(params: TransactionQueryParams) {
  const cleaned: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) {
      cleaned[k] = v as string | number | boolean
    }
  }

  return useQuery({
    queryKey: ["transactions", cleaned],
    queryFn: () => api.get<TransactionRead[]>("/api/transactions", cleaned),
    placeholderData: keepPreviousData,
  })
}
