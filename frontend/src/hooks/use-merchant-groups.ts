import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { listMerchantGroups } from "@/api/transactions"

export function useMerchantGroups(params: {
  approved: boolean
  q?: string
  limit: number
  offset: number
  enabled?: boolean
}) {
  const q = (params.q ?? "").trim()
  const enabled = params.enabled !== false
  return useQuery({
    queryKey: [
      "merchant-groups",
      params.approved,
      q,
      params.limit,
      params.offset,
    ],
    queryFn: () =>
      listMerchantGroups({
        approved: params.approved,
        q: q || undefined,
        limit: params.limit,
        offset: params.offset,
      }),
    placeholderData: keepPreviousData,
    enabled,
  })
}
