import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { BudgetRead } from "@/types/api"
import { useMonthStore } from "@/stores/use-month-store"

export function useBudgets() {
  const month = useMonthStore((s) => s.month)
  return useQuery({
    queryKey: ["budgets", month],
    queryFn: () => api.get<BudgetRead[]>("/api/budgets", { month }),
  })
}
