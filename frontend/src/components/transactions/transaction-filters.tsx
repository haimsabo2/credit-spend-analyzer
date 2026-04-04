import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import type { CategoryRead } from "@/types/api"
import { listSubcategories } from "@/api/categories"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search, X } from "lucide-react"

export interface FilterValues {
  q: string
  category_id: string
  subcategory_id: string
  card_label: string
  section: string
  needs_review: string
  spend_pattern: string
  amount_min: string
  amount_max: string
}

export const EMPTY_FILTERS: FilterValues = {
  q: "",
  category_id: "",
  subcategory_id: "",
  card_label: "",
  section: "",
  needs_review: "",
  spend_pattern: "",
  amount_min: "",
  amount_max: "",
}

interface Props {
  filters: FilterValues
  onChange: (f: FilterValues) => void
  categories: CategoryRead[] | undefined
  cardLabels: string[]
}

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function TransactionFilters({ filters, onChange, categories, cardLabels }: Props) {
  const { t } = useTranslation()
  const catNum = filters.category_id ? Number(filters.category_id) : 0
  const { data: subcategories } = useQuery({
    queryKey: ["subcategories", catNum],
    queryFn: () => listSubcategories(catNum),
    enabled: catNum > 0,
  })
  const [localQ, setLocalQ] = useState(filters.q)
  const [localMin, setLocalMin] = useState(filters.amount_min)
  const [localMax, setLocalMax] = useState(filters.amount_max)

  const debouncedQ = useDebounced(localQ, 300)
  const debouncedMin = useDebounced(localMin, 500)
  const debouncedMax = useDebounced(localMax, 500)

  useEffect(() => {
    if (debouncedQ !== filters.q) onChange({ ...filters, q: debouncedQ })
  }, [debouncedQ])

  useEffect(() => {
    if (debouncedMin !== filters.amount_min) onChange({ ...filters, amount_min: debouncedMin })
  }, [debouncedMin])

  useEffect(() => {
    if (debouncedMax !== filters.amount_max) onChange({ ...filters, amount_max: debouncedMax })
  }, [debouncedMax])

  useEffect(() => { setLocalQ(filters.q) }, [filters.q])
  useEffect(() => { setLocalMin(filters.amount_min) }, [filters.amount_min])
  useEffect(() => { setLocalMax(filters.amount_max) }, [filters.amount_max])

  function update(patch: Partial<FilterValues>) {
    onChange({ ...filters, ...patch })
  }

  const hasFilters = Object.values(filters).some((v) => v !== "")

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative w-56">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("transactionsTable.searchPlaceholder")}
          value={localQ}
          onChange={(e) => setLocalQ(e.target.value)}
          className="pl-9"
        />
      </div>

      <Select
        value={filters.category_id || "all"}
        onValueChange={(v) =>
          update({
            category_id: v === "all" ? "" : v,
            subcategory_id: "",
          })
        }
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder={t("transactionsTable.filterCategoryPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("transactionsTable.allCategories")}</SelectItem>
          {categories?.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.subcategory_id || "all"}
        onValueChange={(v) => update({ subcategory_id: v === "all" ? "" : v })}
        disabled={!catNum || !subcategories?.length}
      >
        <SelectTrigger className="w-36">
          <SelectValue placeholder={t("transactionsTable.filterSubcategoryPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("transactionsTable.allSubcategories")}</SelectItem>
          {subcategories?.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.card_label || "all"} onValueChange={(v) => update({ card_label: v === "all" ? "" : v })}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder={t("transactionsTable.filterCardPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("transactionsTable.allCards")}</SelectItem>
          {cardLabels.map((l) => (
            <SelectItem key={l} value={l}>
              {l.length > 20 ? l.slice(0, 20) + "..." : l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.section || "all"} onValueChange={(v) => update({ section: v === "all" ? "" : v })}>
        <SelectTrigger className="w-28">
          <SelectValue placeholder={t("transactionsTable.filterSectionPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("transactionsTable.allSections")}</SelectItem>
          <SelectItem value="IL">{t("transactionsTable.sectionIL")}</SelectItem>
          <SelectItem value="FOREIGN">{t("transactionsTable.sectionForeign")}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filters.needs_review || "all"} onValueChange={(v) => update({ needs_review: v === "all" ? "" : v })}>
        <SelectTrigger className="w-32">
          <SelectValue placeholder={t("transactionsTable.filterReviewPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("transactionsTable.reviewAll")}</SelectItem>
          <SelectItem value="true">{t("transactionsTable.reviewNeedsReview")}</SelectItem>
          <SelectItem value="false">{t("transactionsTable.reviewCategorized")}</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.spend_pattern || "all"}
        onValueChange={(v) => update({ spend_pattern: v === "all" ? "" : v })}
      >
        <SelectTrigger className="w-[9.5rem]">
          <SelectValue placeholder={t("transactionsTable.filterPattern")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("transactionsTable.filterAllPatterns")}</SelectItem>
          <SelectItem value="unknown">{t("transactionsTable.unknown")}</SelectItem>
          <SelectItem value="recurring">{t("transactionsTable.recurring")}</SelectItem>
          <SelectItem value="one_time">{t("transactionsTable.oneTime")}</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          placeholder={t("transactionsTable.amountMinPlaceholder")}
          value={localMin}
          onChange={(e) => setLocalMin(e.target.value)}
          className="w-20"
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="number"
          placeholder={t("transactionsTable.amountMaxPlaceholder")}
          value={localMax}
          onChange={(e) => setLocalMax(e.target.value)}
          className="w-20"
        />
      </div>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1 text-xs text-muted-foreground"
          onClick={() => {
            onChange(EMPTY_FILTERS)
            setLocalQ("")
            setLocalMin("")
            setLocalMax("")
          }}
        >
          <X className="h-3.5 w-3.5" />
          {t("transactionsTable.resetFilters")}
        </Button>
      )}
    </div>
  )
}
