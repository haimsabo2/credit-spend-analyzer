import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { CategorizeRequest, CategorizeResponse } from "@/types/api"
import { toast } from "sonner"

export function useCategorize() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ txnId, body }: { txnId: number; body: CategorizeRequest }) =>
      api.post<CategorizeResponse>(`/api/transactions/${txnId}/categorize`, body),
    onSuccess(data) {
      qc.invalidateQueries({ queryKey: ["transactions"] })
      if (data.rule_created) {
        toast.success(
          `Rule created — ${data.backfill_count} existing transaction${data.backfill_count === 1 ? "" : "s"} updated`,
        )
      } else {
        toast.success("Category updated")
      }
    },
  })
}
