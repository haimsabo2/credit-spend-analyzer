import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { AnomalyItem } from "@/types/api"
import { useMonthStore } from "@/stores/use-month-store"

export function useAnomalies() {
  const month = useMonthStore((s) => s.month)
  return useQuery({
    queryKey: ["anomalies", month],
    queryFn: () => api.get<AnomalyItem[]>("/api/insights/anomalies", { month }),
  })
}
