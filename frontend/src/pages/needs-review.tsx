import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Loader2, Plus, Sparkles } from "lucide-react"
import { useMonthStore } from "@/stores/use-month-store"
import {
  getNeedsReview,
  categorizeTransaction,
  getLlmPendingCount,
  llmCategorizePending,
} from "@/api/transactions"
import { listCategories, createCategory } from "@/api/categories"
import { formatCurrency, formatMonthShort } from "@/utils/format"
import type { Transaction } from "@/api/types"
import { ApiError } from "@/api/client"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const LLM_PENDING_LIMIT = 500

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "detail" in err.body) {
    const d = (err.body as { detail?: string }).detail
    return typeof d === "string" ? d : fallback
  }
  return err instanceof Error ? err.message : fallback
}

const OTHER_VALUE = "__other__"

const last12Months = (): string[] => {
  const now = new Date()
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  })
}

function getRulePattern(txn: Transaction): string {
  try {
    const meta = txn.meta_json ? JSON.parse(txn.meta_json) : null
    if (meta?.merchant_key_guess) return meta.merchant_key_guess
  } catch {
    /* ignore */
  }
  return txn.description
}

export default function NeedsReviewPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { month: storeMonth, setMonth: setStoreMonth } = useMonthStore()
  const months = useMemo(() => last12Months(), [])

  const month = storeMonth
  const [search, setSearch] = useState("")
  const [filterLow, setFilterLow] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<Record<number, number>>({})
  const [pendingOtherForRow, setPendingOtherForRow] = useState<number | null>(null)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [aiDialogOpen, setAiDialogOpen] = useState(false)

  const { data: txns = [], isLoading } = useQuery({
    queryKey: ["needs-review", month],
    queryFn: () => getNeedsReview(month),
  })

  const { data: llmPending } = useQuery({
    queryKey: ["llm-pending-count", month],
    queryFn: () => getLlmPendingCount(month),
  })
  const uncategorizedForAi = llmPending?.pending_count ?? 0

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  })

  const createCategoryMutation = useMutation({
    mutationFn: (name: string) => createCategory(name.trim()),
    onSuccess(newCat) {
      qc.invalidateQueries({ queryKey: ["categories"] })
      if (pendingOtherForRow != null) {
        setSelectedCategory((prev) => ({ ...prev, [pendingOtherForRow]: newCat.id }))
        setPendingOtherForRow(null)
        setNewCategoryName("")
      }
    },
    onError() {
      toast.error(t("review.createCategoryError"))
    },
  })

  const llmSuggestMutation = useMutation({
    mutationFn: () => llmCategorizePending(month, LLM_PENDING_LIMIT),
    onSuccess() {
      toast.success(t("review.aiSuggestSuccess"))
      void qc.invalidateQueries({ queryKey: ["needs-review", month] })
      void qc.invalidateQueries({ queryKey: ["llm-pending-count", month] })
      void qc.invalidateQueries({ queryKey: ["summary", month] })
      void qc.invalidateQueries({ queryKey: ["transactions"] })
      setAiDialogOpen(false)
    },
    onError(err) {
      toast.error(getErrorMessage(err, t("review.aiSuggestError")))
    },
  })

  const categorizeMutation = useMutation({
    mutationFn: ({
      txnId,
      categoryId,
      pattern,
    }: {
      txnId: number
      categoryId: number
      pattern: string
    }) =>
      categorizeTransaction(txnId, {
        category_id: categoryId,
        rule_pattern: pattern || undefined,
      }),
    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: ["needs-review", month] })
      const prev = qc.getQueryData<Transaction[]>(["needs-review", month])
      qc.setQueryData(
        ["needs-review", month],
        (prev ?? []).filter((t) => t.id !== variables.txnId),
      )
      return { prev }
    },
    onSuccess(data) {
      qc.invalidateQueries({ queryKey: ["needs-review", month] })
      qc.invalidateQueries({ queryKey: ["summary", month] })
      qc.invalidateQueries({ queryKey: ["transactions"] })
      setSelectedCategory((prev) => {
        const next = { ...prev }
        delete next[data.transaction_id]
        return next
      })
      if (data.backfill_count <= 0) {
        toast.success(t("transactionsTable.categoryUpdated"))
      } else {
        toast.success(
          t("transactionsTable.categoryPropagated", { count: data.backfill_count }),
        )
      }
    },
    onError(err, _variables, context) {
      if (context?.prev != null) {
        qc.setQueryData(["needs-review", month], context.prev)
      }
      toast.error(getErrorMessage(err, t("review.errorToast")))
    },
  })

  const filtered = useMemo(() => {
    let list = txns
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((t) => t.description.toLowerCase().includes(q))
    }
    if (filterLow) {
      list = list.filter((t) => t.confidence < 0.6)
    }
    return list
  }, [txns, search, filterLow])

  const descriptionCount = useMemo(() => {
    const map: Record<string, number> = {}
    for (const txn of filtered) {
      map[txn.description] = (map[txn.description] ?? 0) + 1
    }
    return map
  }, [filtered])

  const handleMonthChange = (m: string) => {
    setStoreMonth(m)
  }

  const handleCategoryChange = (txnId: number, value: string) => {
    if (value === OTHER_VALUE) {
      setPendingOtherForRow(txnId)
      setSelectedCategory((prev) => {
        const next = { ...prev }
        delete next[txnId]
        return next
      })
    } else {
      setPendingOtherForRow((prev) => (prev === txnId ? null : prev))
      setSelectedCategory((prev) => ({ ...prev, [txnId]: Number(value) }))
    }
  }

  const handleAddCategory = () => {
    const name = newCategoryName.trim()
    if (!name || pendingOtherForRow == null) return
    createCategoryMutation.mutate(name)
  }

  const handleSave = (txn: Transaction) => {
    const catId = selectedCategory[txn.id]
    if (catId == null) return
    categorizeMutation.mutate({
      txnId: txn.id,
      categoryId: catId,
      pattern: getRulePattern(txn),
    })
  }

  const categoryById = useMemo(() => {
    const map: Record<number, string> = {}
    for (const c of categories) map[c.id] = c.name
    return map
  }, [categories])

  const categoriesForSelect = useMemo(
    () => categories.filter((c) => c.name !== "אחר" && c.name !== "Other"),
    [categories],
  )

  const pendingId = categorizeMutation.isPending ? categorizeMutation.variables?.txnId : null

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("review.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("review.month")}:</span>
          <Select value={month} onValueChange={handleMonthChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m} value={m}>
                  {formatMonthShort(m)} {m.slice(0, 4)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {uncategorizedForAi > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setAiDialogOpen(true)}
              disabled={llmSuggestMutation.isPending}
            >
              {llmSuggestMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {llmSuggestMutation.isPending
                ? t("review.aiSuggestRunning")
                : t("review.aiSuggestButton", { count: uncategorizedForAi })}
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("review.aiSuggestTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("review.aiSuggestDescription", { limit: LLM_PENDING_LIMIT })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={llmSuggestMutation.isPending}>
              {t("review.aiSuggestCancel")}
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={llmSuggestMutation.isPending}
                onClick={(e) => {
                  e.preventDefault()
                  llmSuggestMutation.mutate()
                }}
              >
                {llmSuggestMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t("review.aiSuggestConfirm")}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Input
          placeholder={t("review.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-2">
          <Button
            variant={!filterLow ? "secondary" : "outline"}
            size="sm"
            onClick={() => setFilterLow(false)}
          >
            {t("review.filterAll")}
          </Button>
          <Button
            variant={filterLow ? "secondary" : "outline"}
            size="sm"
            onClick={() => setFilterLow(true)}
          >
            {t("review.filterLowConfidence")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">{t("review.emptyTitle")}</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("review.date")}</TableHead>
                <TableHead>{t("review.description")}</TableHead>
                <TableHead className="text-end">{t("review.amount")}</TableHead>
                <TableHead>{t("review.category")}</TableHead>
                <TableHead>{t("review.confidence")}</TableHead>
                <TableHead>{t("review.reason")}</TableHead>
                <TableHead>{t("review.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((txn) => {
                const isSaving = pendingId === txn.id
                const catId = selectedCategory[txn.id]
                const isOtherMode = pendingOtherForRow === txn.id
                const similarCount = descriptionCount[txn.description] ?? 1
                const hasSimilar = similarCount > 1

                return (
                  <TableRow key={txn.id} className={isSaving ? "opacity-60" : undefined}>
                    <TableCell>
                      {txn.posted_at
                        ? new Date(txn.posted_at + "T00:00:00").toLocaleDateString(
                            undefined,
                            { day: "2-digit", month: "short", year: "numeric" },
                          )
                        : t("review.emptyValue")}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={txn.description}>
                      {txn.description}
                    </TableCell>
                    <TableCell className="text-end font-mono tabular-nums">
                      {formatCurrency(txn.amount, txn.currency ?? "ILS")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {txn.category_id ? categoryById[txn.category_id] ?? t("review.emptyValue") : t("review.emptyValue")}
                      </Badge>
                    </TableCell>
                    <TableCell>{(txn.confidence * 100).toFixed(0)}%</TableCell>
                    <TableCell className="max-w-[150px] truncate text-muted-foreground" title={txn.reason_he ?? ""}>
                      {txn.reason_he ?? t("review.emptyValue")}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[min(100%,22rem)] flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={isOtherMode ? OTHER_VALUE : (catId != null ? String(catId) : "")}
                          onValueChange={(v) => handleCategoryChange(txn.id, v)}
                        >
                          <SelectTrigger className="w-[140px] h-8">
                            <SelectValue placeholder={t("review.chooseCategory")} />
                          </SelectTrigger>
                          <SelectContent>
                            {categoriesForSelect.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.name}
                              </SelectItem>
                            ))}
                            <SelectItem value={OTHER_VALUE}>{t("review.other")}</SelectItem>
                          </SelectContent>
                        </Select>

                        {isOtherMode && (
                          <div className="flex items-center gap-1.5">
                            <Input
                              placeholder={t("review.newCategoryName")}
                              value={newCategoryName}
                              onChange={(e) => setNewCategoryName(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                              className="h-8 w-36"
                            />
                            <Button
                              size="sm"
                              className="h-8 gap-1"
                              disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
                              onClick={handleAddCategory}
                            >
                              {createCategoryMutation.isPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Plus className="h-3.5 w-3.5" />
                              )}
                              {t("review.addCategory")}
                            </Button>
                          </div>
                        )}

                        <Button
                          size="sm"
                          disabled={catId == null || isSaving}
                          onClick={() => handleSave(txn)}
                        >
                          {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            t("review.save")
                          )}
                        </Button>
                        </div>
                        {hasSimilar && (
                          <p className="text-xs text-muted-foreground">
                            {t("review.propagateHint", { count: similarCount })}
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
