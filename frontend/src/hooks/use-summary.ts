import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { SummaryResponse } from "@/types/api"
import { useMonthStore } from "@/stores/use-month-store"

export function useSummary() {
  const month = useMonthStore((s) => s.month)
  return useQuery({
    queryKey: ["summary", month],
    queryFn: () => api.get<SummaryResponse>("/api/insights/summary", { month }),
  })
}
