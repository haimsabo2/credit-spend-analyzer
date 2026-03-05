import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { BudgetAlertItem } from "@/types/api"
import { useMonthStore } from "@/stores/use-month-store"

export function useBudgetAlerts() {
  const month = useMonthStore((s) => s.month)
  return useQuery({
    queryKey: ["budget-alerts", month],
    queryFn: () => api.get<BudgetAlertItem[]>("/api/budgets/alerts", { month }),
  })
}
