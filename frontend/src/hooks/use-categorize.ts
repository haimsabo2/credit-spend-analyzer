import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { api, getApiErrorToastDescription } from "@/lib/api-client"
import type { CategorizeRequest, CategorizeResponse } from "@/types/api"
import { toast } from "sonner"

export function useCategorize() {
  const qc = useQueryClient()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ txnId, body }: { txnId: number; body: CategorizeRequest }) =>
      api.post<CategorizeResponse>(`/api/transactions/${txnId}/categorize`, body),
    onSuccess(data) {
      qc.invalidateQueries({ queryKey: ["transactions"] })
      qc.invalidateQueries({ queryKey: ["needs-review"] })
      qc.invalidateQueries({ queryKey: ["merchant-groups"] })
      qc.invalidateQueries({ queryKey: ["subcategories"] })
      qc.invalidateQueries({ queryKey: ["summary"] })
      if (data.backfill_count <= 0) {
        toast.success(t("transactionsTable.categoryUpdated"))
      } else {
        toast.success(
          t("transactionsTable.categoryPropagated", { count: data.backfill_count }),
        )
      }
    },
    onError(err) {
      toast.error(t("transactionsTable.categoryUpdateError"), {
        description: getApiErrorToastDescription(err),
      })
    },
  })
}
