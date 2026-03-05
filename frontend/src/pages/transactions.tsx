import { useState, useEffect, useMemo, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { useMonthStore } from "@/stores/use-month-store"
import { useTransactions } from "@/hooks/use-transactions"
import { useCategories } from "@/hooks/use-categories"
import { useAnomalies } from "@/hooks/use-anomalies"
import { TransactionFilters, EMPTY_FILTERS, type FilterValues } from "@/components/transactions/transaction-filters"
import { DataTable } from "@/components/transactions/data-table"
import { columns } from "@/components/transactions/columns"
import type { TransactionQueryParams } from "@/types/api"

const PAGE_SIZE = 50

export default function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const month = useMonthStore((s) => s.month)

  const [filters, setFilters] = useState<FilterValues>(() => ({
    ...EMPTY_FILTERS,
    q: searchParams.get("q") ?? "",
  }))
  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => {
    setPageIndex(0)
  }, [filters, month])

  const handleFiltersChange = useCallback((f: FilterValues) => {
    setFilters(f)
    const sp = new URLSearchParams()
    if (f.q) sp.set("q", f.q)
    setSearchParams(sp, { replace: true })
  }, [setSearchParams])

  const queryParams = useMemo<TransactionQueryParams>(() => {
    const p: TransactionQueryParams = {
      month,
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
    }
    if (filters.q) p.q = filters.q
    if (filters.category_id) p.category_id = Number(filters.category_id)
    if (filters.card_label) p.card_label = filters.card_label
    if (filters.section) p.section = filters.section
    if (filters.needs_review === "true") p.needs_review = true
    else if (filters.needs_review === "false") p.needs_review = false
    if (filters.amount_min) p.amount_min = Number(filters.amount_min)
    if (filters.amount_max) p.amount_max = Number(filters.amount_max)
    return p
  }, [month, filters, pageIndex])

  const txns = useTransactions(queryParams)
  const categories = useCategories()
  const anomalies = useAnomalies()

  const anomalyNames = useMemo(() => {
    if (!anomalies.data) return new Set<string>()
    return new Set(
      anomalies.data
        .filter((a) => a.type === "merchant")
        .map((a) => a.name),
    )
  }, [anomalies.data])

  const cardLabels = useMemo(() => {
    if (!txns.data) return []
    const set = new Set<string>()
    for (const t of txns.data) {
      if (t.card_label) set.add(t.card_label)
    }
    return Array.from(set).sort()
  }, [txns.data])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>

      <TransactionFilters
        filters={filters}
        onChange={handleFiltersChange}
        categories={categories.data}
        cardLabels={cardLabels}
      />

      <DataTable
        columns={columns}
        data={txns.data ?? []}
        isLoading={txns.isLoading}
        isFetching={txns.isFetching}
        anomalyNames={anomalyNames}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        onPageChange={setPageIndex}
      />
    </div>
  )
}
