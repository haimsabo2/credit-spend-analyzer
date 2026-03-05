import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { TrendsResponse } from "@/types/api"

export function useTrends(months = 12) {
  return useQuery({
    queryKey: ["trends", months],
    queryFn: () => api.get<TrendsResponse>("/api/insights/trends", { months }),
  })
}
