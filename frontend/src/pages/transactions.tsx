import { useState, useEffect, useMemo, useCallback } from "react"
import { AlertTriangle } from "lucide-react"
import type { TransactionRead } from "@/types/api"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMonthStore } from "@/stores/use-month-store"
import { useTransactions } from "@/hooks/use-transactions"
import { useMerchantGroups } from "@/hooks/use-merchant-groups"
import { useCategories } from "@/hooks/use-categories"
import { useAnomalies } from "@/hooks/use-anomalies"
import { TransactionFilters, EMPTY_FILTERS, type FilterValues } from "@/components/transactions/transaction-filters"
import { SubcategoryManageDialog } from "@/components/transactions/subcategory-manage-dialog"
import { DataTable } from "@/components/transactions/data-table"
import { TransactionsByMonthGroupedTable } from "@/components/transactions/transactions-by-month-grouped-table"
import { getTransactionColumns } from "@/components/transactions/columns"
import { TransactionSourceDialog } from "@/components/transactions/transaction-source-dialog"
import { getMerchantGroupColumns } from "@/components/transactions/merchant-group-columns"
import type { TransactionQueryParams } from "@/types/api"
import type { MerchantGroupRow } from "@/types/api"
import { approveMerchantGroup, unapproveMerchantGroup } from "@/api/transactions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const PAGE_SIZE = 50
const MONTH_GROUPED_LIMIT = 500

type ViewMode = "month" | "merchant"

export default function TransactionsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const month = useMonthStore((s) => s.month)

  const [viewMode, setViewMode] = useState<ViewMode>("merchant")
  const [filters, setFilters] = useState<FilterValues>(() => ({
    ...EMPTY_FILTERS,
    q: searchParams.get("q") ?? "",
  }))
  const [pagePending, setPagePending] = useState(0)
  const [pageApproved, setPageApproved] = useState(0)

  useEffect(() => {
    setPagePending(0)
    setPageApproved(0)
  }, [filters.q, viewMode])

  const handleFiltersChange = useCallback(
    (f: FilterValues) => {
      setFilters(f)
      const sp = new URLSearchParams()
      if (f.q) sp.set("q", f.q)
      setSearchParams(sp, { replace: true })
    },
    [setSearchParams],
  )

  const queryParams = useMemo<TransactionQueryParams>(() => {
    const p: TransactionQueryParams = {
      month,
      limit: MONTH_GROUPED_LIMIT,
      offset: 0,
    }
    if (filters.q) p.q = filters.q
    if (filters.category_id) p.category_id = Number(filters.category_id)
    if (filters.card_label) p.card_label = filters.card_label
    if (filters.section) p.section = filters.section
    if (filters.needs_review === "true") p.needs_review = true
    else if (filters.needs_review === "false") p.needs_review = false
    if (filters.amount_min) p.amount_min = Number(filters.amount_min)
    if (filters.amount_max) p.amount_max = Number(filters.amount_max)
    if (filters.spend_pattern) p.spend_pattern = filters.spend_pattern
    return p
  }, [month, filters])

  const approveMut = useMutation({
    mutationFn: (row: MerchantGroupRow) =>
      approveMerchantGroup({ transaction_id: row.representative_transaction_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["merchant-groups"] })
    },
  })

  const unapproveMut = useMutation({
    mutationFn: (row: MerchantGroupRow) =>
      unapproveMerchantGroup({ pattern_key: row.pattern_key }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["merchant-groups"] })
    },
  })

  const actionBusy = approveMut.isPending || unapproveMut.isPending

  const pendingCols = useMemo(
    () =>
      getMerchantGroupColumns(t, {
        variant: "pending",
        onApprove: (row) => approveMut.mutate(row),
        onUnapprove: () => {},
        actionDisabled: actionBusy,
      }),
    [t, approveMut.mutate, actionBusy],
  )

  const approvedCols = useMemo(
    () =>
      getMerchantGroupColumns(t, {
        variant: "approved",
        onApprove: () => {},
        onUnapprove: (row) => unapproveMut.mutate(row),
        actionDisabled: actionBusy,
      }),
    [t, unapproveMut.mutate, actionBusy],
  )

  const [sourceTxn, setSourceTxn] = useState<TransactionRead | null>(null)
  const [sourceOpen, setSourceOpen] = useState(false)

  const columns = useMemo(
    () =>
      getTransactionColumns(t, {
        plainHeaders: true,
        onOpenSource: (row) => {
          setSourceTxn(row)
          setSourceOpen(true)
        },
      }),
    [t],
  )

  const txns = useTransactions(queryParams)
  const merchantQ = filters.q.trim()
  const pendingGroups = useMerchantGroups({
    approved: false,
    q: merchantQ || undefined,
    limit: PAGE_SIZE,
    offset: pagePending * PAGE_SIZE,
    enabled: viewMode === "merchant",
  })
  const approvedGroups = useMerchantGroups({
    approved: true,
    q: merchantQ || undefined,
    limit: PAGE_SIZE,
    offset: pageApproved * PAGE_SIZE,
    enabled: viewMode === "merchant",
  })

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

  const monthCategoryConflictCount = useMemo(
    () => txns.data?.filter((t) => t.merchant_category_conflict).length ?? 0,
    [txns.data],
  )
  const merchantCategoryConflictCount = useMemo(() => {
    const p = pendingGroups.data?.items.filter((g) => g.category_conflict).length ?? 0
    const a = approvedGroups.data?.items.filter((g) => g.category_conflict).length ?? 0
    return p + a
  }, [pendingGroups.data, approvedGroups.data])

  return (
    <div className="space-y-6">
      <TransactionSourceDialog
        open={sourceOpen}
        onOpenChange={setSourceOpen}
        transaction={sourceTxn}
      />
      <h1 className="text-2xl font-semibold tracking-tight">{t("transactionsTable.title")}</h1>

      <div className="inline-flex rounded-md border p-0.5 bg-muted/40">
        <Button
          type="button"
          variant={viewMode === "merchant" ? "secondary" : "ghost"}
          size="sm"
          className="shadow-none"
          onClick={() => setViewMode("merchant")}
        >
          {t("merchantGroups.viewByMerchant")}
        </Button>
        <Button
          type="button"
          variant={viewMode === "month" ? "secondary" : "ghost"}
          size="sm"
          className="shadow-none"
          onClick={() => setViewMode("month")}
        >
          {t("merchantGroups.viewByMonth")}
        </Button>
      </div>

      {viewMode === "month" ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <TransactionFilters
              filters={filters}
              onChange={handleFiltersChange}
              categories={categories.data}
              cardLabels={cardLabels}
            />
            <SubcategoryManageDialog />
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
            {t("transactionsTable.legend")}
          </p>
          {monthCategoryConflictCount > 0 ? (
            <p className="flex max-w-3xl items-start gap-2 text-xs text-amber-800 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("transactionsTable.categoryConflictBanner", {
                count: monthCategoryConflictCount,
              })}
            </p>
          ) : null}

          <TransactionsByMonthGroupedTable
            columns={columns}
            data={txns.data ?? []}
            isLoading={txns.isLoading}
            isFetching={txns.isFetching}
            anomalyNames={anomalyNames}
            emptyLabel={t("transactionsTable.noRows")}
            capReached={(txns.data?.length ?? 0) >= MONTH_GROUPED_LIMIT}
          />
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
            {t("merchantGroups.hint")}
          </p>
          {merchantCategoryConflictCount > 0 ? (
            <p className="flex max-w-3xl items-start gap-2 text-xs text-amber-800 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("merchantGroups.categoryConflictBanner", {
                count: merchantCategoryConflictCount,
              })}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-sm"
              placeholder={t("merchantGroups.searchPlaceholder")}
              value={filters.q}
              onChange={(e) => handleFiltersChange({ ...filters, q: e.target.value })}
              aria-label={t("merchantGroups.searchPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">
              {t("merchantGroups.pendingTitle")}
            </h2>
            <DataTable
              columns={pendingCols}
              data={pendingGroups.data?.items ?? []}
              isLoading={pendingGroups.isLoading}
              isFetching={pendingGroups.isFetching}
              anomalyNames={anomalyNames}
              descriptionAccessor="display_description"
              pageIndex={pagePending}
              pageSize={PAGE_SIZE}
              onPageChange={setPagePending}
              emptyLabel={t("transactionsTable.noRows")}
            />
          </div>

          <div className="space-y-2 pt-4 border-t">
            <h2 className="text-sm font-medium text-foreground">
              {t("merchantGroups.approvedTitle")}
            </h2>
            <DataTable
              columns={approvedCols}
              data={approvedGroups.data?.items ?? []}
              isLoading={approvedGroups.isLoading}
              isFetching={approvedGroups.isFetching}
              anomalyNames={anomalyNames}
              descriptionAccessor="display_description"
              pageIndex={pageApproved}
              pageSize={PAGE_SIZE}
              onPageChange={setPageApproved}
              emptyLabel={t("transactionsTable.noRows")}
            />
          </div>
        </>
      )}
    </div>
  )
}
