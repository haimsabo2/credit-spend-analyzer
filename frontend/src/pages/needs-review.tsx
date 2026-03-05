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
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Loader2, Plus } from "lucide-react"
import { useMonthStore } from "@/stores/use-month-store"
import { getNeedsReview, categorizeTransaction } from "@/api/transactions"
import { listCategories, createCategory } from "@/api/categories"
import { probeRulesAvailable } from "@/api/probe"
import { formatCurrency, formatMonthShort } from "@/utils/format"
import type { Transaction } from "@/api/types"
import { ApiError } from "@/api/client"
import { toast } from "sonner"

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
  const [createRuleFor, setCreateRuleFor] = useState<Set<number>>(new Set())
  const [pendingOtherForRow, setPendingOtherForRow] = useState<number | null>(null)
  const [newCategoryName, setNewCategoryName] = useState("")

  const { data: txns = [], isLoading } = useQuery({
    queryKey: ["needs-review", month],
    queryFn: () => getNeedsReview(month),
  })

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  })

  const { data: rulesAvailable = true } = useQuery({
    queryKey: ["probe-rules"],
    queryFn: probeRulesAvailable,
    staleTime: 5 * 60 * 1000,
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

  const categorizeMutation = useMutation({
    mutationFn: ({ txnId, categoryId, createRule, pattern }: {
      txnId: number
      categoryId: number
      createRule: boolean
      pattern: string
    }) =>
      categorizeTransaction(txnId, {
        category_id: categoryId,
        create_rule: createRule,
        rule_match_type: "contains",
        rule_pattern: pattern,
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
    onSuccess(_, variables) {
      qc.invalidateQueries({ queryKey: ["needs-review", month] })
      qc.invalidateQueries({ queryKey: ["summary", month] })
      setSelectedCategory((prev) => {
        const next = { ...prev }
        delete next[variables.txnId]
        return next
      })
      setCreateRuleFor((prev) => {
        const next = new Set(prev)
        next.delete(variables.txnId)
        return next
      })
      toast.success(t("review.successToast"))
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
    const createRule = createRuleFor.has(txn.id)
    const pattern = getRulePattern(txn)
    categorizeMutation.mutate({
      txnId: txn.id,
      categoryId: catId,
      createRule,
      pattern,
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
        <div className="flex items-center gap-2">
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
        </div>
      </div>

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
                const createRuleChecked = createRuleFor.has(txn.id)

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

                        {rulesAvailable && (
                          <div className="flex items-center gap-1.5">
                            <Checkbox
                              id={`rule-${txn.id}`}
                              checked={createRuleChecked}
                              onCheckedChange={(checked) => {
                                setCreateRuleFor((prev) => {
                                  const next = new Set(prev)
                                  if (checked) next.add(txn.id)
                                  else next.delete(txn.id)
                                  return next
                                })
                              }}
                            />
                            <label
                              htmlFor={`rule-${txn.id}`}
                              className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap"
                            >
                              {t("review.createRule")}
                              {hasSimilar && createRuleChecked && (
                                <span className="ms-1 text-primary">
                                  ({t("review.willUpdateSimilar", { count: similarCount - 1 })})
                                </span>
                              )}
                            </label>
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
