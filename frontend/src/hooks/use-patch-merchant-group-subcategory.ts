import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { approveMerchantGroup, setMerchantGroupSubcategory } from "@/api/transactions"
import { ApiError } from "@/api/client"
import { getApiErrorToastDescription } from "@/lib/api-client"
import { toast } from "sonner"

export function usePatchMerchantGroupSubcategory() {
  const qc = useQueryClient()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: async ({
      patternKey,
      subcategoryId,
      representativeTransactionId,
    }: {
      patternKey: string
      subcategoryId: number | null
      representativeTransactionId: number
    }) => {
      try {
        await setMerchantGroupSubcategory({
          pattern_key: patternKey,
          subcategory_id: subcategoryId,
        })
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.status === 409 &&
          representativeTransactionId != null
        ) {
          if (subcategoryId != null) {
            await approveMerchantGroup({
              transaction_id: representativeTransactionId,
              subcategory_id: subcategoryId,
            })
            return
          }
          await approveMerchantGroup({ transaction_id: representativeTransactionId })
          await setMerchantGroupSubcategory({
            pattern_key: patternKey,
            subcategory_id: null,
          })
          return
        }
        throw e
      }
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["merchant-groups"] })
      qc.invalidateQueries({ queryKey: ["transactions"] })
      qc.invalidateQueries({ queryKey: ["needs-review"] })
      toast.success(t("subcategories.updateSuccess"))
    },
    onError(err) {
      toast.error(t("subcategories.updateError"), {
        description: getApiErrorToastDescription(err),
      })
    },
  })
}
