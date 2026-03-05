import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { ForecastResponse } from "@/types/api"
import { useMonthStore } from "@/stores/use-month-store"

export function useForecast() {
  const month = useMonthStore((s) => s.month)
  return useQuery({
    queryKey: ["forecast", month],
    queryFn: () => api.get<ForecastResponse>("/api/forecast", { month }),
  })
}
