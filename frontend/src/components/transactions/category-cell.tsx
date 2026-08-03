import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { TransactionRead } from "@/types/api"
import { useCategories } from "@/hooks/use-categories"
import { useCategorize } from "@/hooks/use-categorize"
import { createCategory } from "@/api/categories"
import { uncategorizeTransaction } from "@/api/transactions"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

const OTHER_VALUE = "__other__"

interface Props {
  transaction: TransactionRead
}

export function CategoryCell({ transaction }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: categories } = useCategories()
  const categorize = useCategorize()

  const [otherMode, setOtherMode] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")

  const categoriesForSelect = useMemo(
    () =>
      (categories ?? []).filter((c) => c.name !== "אחר" && c.name !== "Other"),
    [categories],
  )

  const uncategorizeMutation = useMutation({
    mutationFn: (sameMerchant: boolean) =>
      uncategorizeTransaction(transaction.id, sameMerchant),
    onSuccess(data) {
      qc.invalidateQueries({ queryKey: ["transactions"] })
      qc.invalidateQueries({ queryKey: ["merchant-groups"] })
      qc.invalidateQueries({ queryKey: ["summary"] })
      qc.invalidateQueries({ queryKey: ["trends"] })
      qc.invalidateQueries({ queryKey: ["card-trends"] })
      qc.invalidateQueries({ queryKey: ["month-category-subcategories"] })
      qc.invalidateQueries({ queryKey: ["category-year-merchants"] })
      qc.invalidateQueries({ queryKey: ["category-year-subcategories"] })
      qc.invalidateQueries({ queryKey: ["anomalies"] })
      qc.invalidateQueries({ queryKey: ["data-quality"] })
      qc.invalidateQueries({ queryKey: ["recurring-spend"] })
      toast.success(t("transactionsTable.uncategorizeSuccess", { count: data.updated_count }))
    },
    onError() {
      toast.error(t("transactionsTable.uncategorizeError"))
    },
  })

  const createCategoryMutation = useMutation({
    mutationFn: (name: string) => createCategory(name.trim()),
    onSuccess(cat) {
      qc.invalidateQueries({ queryKey: ["categories"] })
      setOtherMode(false)
      setNewCategoryName("")
      categorize.mutate({
        txnId: transaction.id,
        body: { category_id: cat.id },
      })
    },
    onError() {
      toast.error(t("review.createCategoryError"))
    },
  })

  const currentValue = transaction.category_id != null ? String(transaction.category_id) : ""
  const selectValue = otherMode ? OTHER_VALUE : currentValue || undefined
  const spendGroupOnly =
    transaction.category_id == null && Boolean(transaction.spend_group_name?.trim())

  const busy =
    categorize.isPending ||
    createCategoryMutation.isPending ||
    uncategorizeMutation.isPending

  function handleValueChange(value: string) {
    if (value === OTHER_VALUE) {
      setOtherMode(true)
      return
    }
    setOtherMode(false)
    setNewCategoryName("")
    const catId = Number(value)
    if (transaction.category_id === catId) return
    categorize.mutate({
      txnId: transaction.id,
      body: { category_id: catId },
    })
  }

  function handleAddCategory() {
    const name = newCategoryName.trim()
    if (!name) return
    createCategoryMutation.mutate(name)
  }

  if (busy) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{t("transactionsTable.categorySaving")}</span>
      </div>
    )
  }

  return (
    <div
      className="flex max-w-[min(100%,14rem)] flex-col gap-1"
      title={t("transactionsTable.categoryPropagateHint")}
    >
      <Select value={selectValue} onValueChange={handleValueChange}>
          <SelectTrigger size="sm" className="h-7 w-full max-w-36 text-xs">
            <SelectValue
              placeholder={
                spendGroupOnly
                  ? (transaction.spend_group_name ?? "")
                  : t("transactionsTable.uncategorized")
              }
            />
          </SelectTrigger>
          <SelectContent>
            {categoriesForSelect.map((cat) => (
              <SelectItem key={cat.id} value={String(cat.id)}>
                {cat.name}
              </SelectItem>
            ))}
            <SelectItem value={OTHER_VALUE}>{t("review.other")}</SelectItem>
          </SelectContent>
      </Select>
      {transaction.merchant_category_conflict ? (
        <div className="flex flex-col gap-1 pt-0.5">
          <p className="text-[10px] leading-tight text-amber-700 dark:text-amber-500">
            {t("transactionsTable.uncategorizeConflictHint")}
          </p>
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[10px]"
              disabled={busy}
              onClick={() => uncategorizeMutation.mutate(true)}
            >
              {t("transactionsTable.uncategorizeConflictAll")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[10px]"
              disabled={busy}
              onClick={() => uncategorizeMutation.mutate(false)}
            >
              {t("transactionsTable.uncategorizeConflictRow")}
            </Button>
          </div>
        </div>
      ) : null}
      {otherMode ? (
        <div className="flex flex-wrap items-center gap-1">
          <Input
            placeholder={t("review.newCategoryName")}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
            className="h-7 min-w-0 flex-1 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 shrink-0 gap-0.5 px-2"
            disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
            onClick={handleAddCategory}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="sr-only sm:not-sr-only sm:text-xs">{t("review.addCategory")}</span>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
