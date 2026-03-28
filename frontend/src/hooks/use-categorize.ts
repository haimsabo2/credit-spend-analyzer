import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api-client"
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
      if (data.rule_created) {
        toast.success(
          data.backfill_count === 1
            ? t("transactionsTable.ruleCreatedOne")
            : t("transactionsTable.ruleCreatedMany", { count: data.backfill_count }),
        )
      } else {
        toast.success(t("transactionsTable.categoryUpdated"))
      }
    },
  })
}
