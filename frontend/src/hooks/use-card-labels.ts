import { useQuery } from "@tanstack/react-query"
import { listCardLabels } from "@/api/transactions"

export function useCardLabels(month: string | undefined) {
  return useQuery({
    queryKey: ["card-labels", month],
    queryFn: () => listCardLabels(month as string),
    enabled: Boolean(month?.length === 7 && month[4] === "-"),
  })
}
