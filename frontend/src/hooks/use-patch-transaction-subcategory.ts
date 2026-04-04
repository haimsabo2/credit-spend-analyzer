import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { patchTransactionSubcategory } from "@/api/transactions"
import { getApiErrorToastDescription } from "@/lib/api-client"
import { toast } from "sonner"

export function usePatchTransactionSubcategory() {
  const qc = useQueryClient()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({
      transactionId,
      subcategoryId,
    }: {
      transactionId: number
      subcategoryId: number | null
    }) => patchTransactionSubcategory(transactionId, subcategoryId),
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["transactions"] })
      qc.invalidateQueries({ queryKey: ["needs-review"] })
      qc.invalidateQueries({ queryKey: ["merchant-groups"] })
      toast.success(t("subcategories.updateSuccess"))
    },
    onError(err) {
      toast.error(t("subcategories.updateError"), {
        description: getApiErrorToastDescription(err),
      })
    },
  })
}
