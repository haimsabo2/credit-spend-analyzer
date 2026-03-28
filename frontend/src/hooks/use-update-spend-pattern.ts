import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api-client"
import type { TransactionRead } from "@/types/api"
import { toast } from "sonner"

export function useUpdateSpendPattern() {
  const qc = useQueryClient()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: async ({
      txnId,
      spend_pattern,
    }: {
      txnId: number
      spend_pattern: string
    }) => {
      return api.patch<TransactionRead>(`/api/transactions/${txnId}/spend-pattern`, {
        spend_pattern,
      })
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["transactions"] })
      qc.invalidateQueries({ queryKey: ["needs-review"] })
      toast.success(t("transactionsTable.patternUpdated"))
    },
    onError() {
      toast.error(t("transactionsTable.patternUpdateError"))
    },
  })
}
