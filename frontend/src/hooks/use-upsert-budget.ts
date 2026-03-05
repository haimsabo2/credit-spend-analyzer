import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { BudgetRead, BudgetUpsertRequest } from "@/types/api"
import { toast } from "sonner"

export function useUpsertBudget() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (body: BudgetUpsertRequest) =>
      api.post<BudgetRead>("/api/budgets", body),
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["budgets"] })
      qc.invalidateQueries({ queryKey: ["budget-alerts"] })
      toast.success("Budget saved")
    },
  })
}
