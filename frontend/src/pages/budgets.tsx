import { useState } from "react"
import { useMonthStore, formatMonthLabel } from "@/stores/use-month-store"
import { useCategories } from "@/hooks/use-categories"
import { useBudgets } from "@/hooks/use-budgets"
import { useBudgetAlerts } from "@/hooks/use-budget-alerts"
import { useUpsertBudget } from "@/hooks/use-upsert-budget"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Wallet, Plus, AlertTriangle, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { BudgetAlertItem } from "@/types/api"

const STATUS_CONFIG: Record<string, { label: string; color: string; barColor: string; icon: typeof CheckCircle2 }> = {
  ok: { label: "On track", color: "text-emerald-600 bg-emerald-50", barColor: "bg-emerald-500", icon: CheckCircle2 },
  warn: { label: "Warning", color: "text-amber-600 bg-amber-50", barColor: "bg-amber-500", icon: AlertTriangle },
  exceeded: { label: "Over budget", color: "text-red-600 bg-red-50", barColor: "bg-red-500", icon: AlertCircle },
}

function BudgetBar({ alert }: { alert: BudgetAlertItem }) {
  const config = STATUS_CONFIG[alert.status] ?? STATUS_CONFIG.ok
  const pct = alert.budget > 0 ? Math.min((alert.spent / alert.budget) * 100, 100) : 0
  const StatusIcon = config.icon

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-medium">{alert.category_name}</h3>
              <Badge variant="outline" className={cn("text-[10px]", config.color)}>
                <StatusIcon className="mr-1 h-3 w-3" />
                {config.label}
              </Badge>
            </div>

            <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all duration-500", config.barColor)}
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatCurrency(alert.spent)} of {formatCurrency(alert.budget)}
              </span>
              <span>{pct.toFixed(0)}% used</span>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <p
              className={cn(
                "text-lg font-bold tabular-nums",
                alert.remaining < 0 ? "text-red-600" : "text-emerald-600",
              )}
            >
              {formatCurrency(Math.abs(alert.remaining))}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {alert.remaining >= 0 ? "remaining" : "over"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function BudgetsPage() {
  const month = useMonthStore((s) => s.month)
  const categories = useCategories()
  const budgets = useBudgets()
  const alerts = useBudgetAlerts()
  const upsert = useUpsertBudget()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState("")
  const [budgetAmount, setBudgetAmount] = useState("")

  const isLoading = categories.isLoading || budgets.isLoading || alerts.isLoading

  const existingCategoryIds = new Set(budgets.data?.map((b) => b.category_id) ?? [])

  function openDialog() {
    setSelectedCategoryId("")
    setBudgetAmount("")
    setDialogOpen(true)
  }

  function handleSave() {
    if (!selectedCategoryId || !budgetAmount) return
    upsert.mutate(
      {
        category_id: Number(selectedCategoryId),
        month,
        budget_amount: Number(budgetAmount),
      },
      {
        onSuccess() {
          setDialogOpen(false)
        },
      },
    )
  }

  function handleEditBudget(alert: BudgetAlertItem) {
    setSelectedCategoryId(String(alert.category_id))
    setBudgetAmount(String(alert.budget))
    setDialogOpen(true)
  }

  const exceeded = alerts.data?.filter((a) => a.status === "exceeded") ?? []
  const warned = alerts.data?.filter((a) => a.status === "warn") ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Budgets</h1>
          <p className="text-sm text-muted-foreground">{formatMonthLabel(month)}</p>
        </div>
        <Button className="gap-1.5" onClick={openDialog}>
          <Plus className="h-4 w-4" />
          Set Budget
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          {(exceeded.length > 0 || warned.length > 0) && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardContent className="py-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div className="space-y-1 text-sm">
                    {exceeded.length > 0 && (
                      <p className="font-medium text-red-700">
                        {exceeded.length} budget{exceeded.length > 1 ? "s" : ""} exceeded:{" "}
                        {exceeded.map((a) => a.category_name).join(", ")}
                      </p>
                    )}
                    {warned.length > 0 && (
                      <p className="text-amber-700">
                        {warned.length} budget{warned.length > 1 ? "s" : ""} nearing limit:{" "}
                        {warned.map((a) => a.category_name).join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {alerts.data && alerts.data.length > 0 ? (
            <div className="space-y-3">
              {alerts.data.map((alert) => (
                <div
                  key={alert.category_id}
                  className="cursor-pointer"
                  onClick={() => handleEditBudget(alert)}
                >
                  <BudgetBar alert={alert} />
                </div>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <div className="rounded-full bg-muted p-3">
                  <Wallet className="h-8 w-8 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-semibold">No budgets set</h2>
                <p className="text-sm text-muted-foreground">
                  Set monthly budgets per category to track your spending.
                </p>
                <Button variant="outline" className="mt-2 gap-1.5" onClick={openDialog}>
                  <Plus className="h-4 w-4" />
                  Set Your First Budget
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {selectedCategoryId && budgets.data?.some((b) => b.category_id === Number(selectedCategoryId))
                ? "Edit Budget"
                : "Set Budget"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  {categories.data?.map((c) => (
                    <SelectItem
                      key={c.id}
                      value={String(c.id)}
                      disabled={existingCategoryIds.has(c.id) && selectedCategoryId !== String(c.id)}
                    >
                      {c.name}
                      {existingCategoryIds.has(c.id) && selectedCategoryId !== String(c.id) && " (has budget)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Monthly Budget Amount</label>
              <Input
                type="number"
                min={0}
                step={100}
                placeholder="e.g. 3000"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!selectedCategoryId || !budgetAmount || Number(budgetAmount) <= 0 || upsert.isPending}
            >
              {upsert.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
