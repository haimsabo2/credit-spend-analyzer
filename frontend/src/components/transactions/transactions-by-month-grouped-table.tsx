import { useMemo, useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { useTranslation } from "react-i18next"
import { Inbox, Minus, Plus } from "lucide-react"
import {
  Table,
  TableBody,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { MerchantGroupRow, TransactionRead } from "@/types/api"
import { formatCurrency } from "@/lib/format"
import { CategoryCell } from "./category-cell"
import { MerchantGroupSubcategoryCell } from "./merchant-group-subcategory-cell"
import { groupTransactionsByMerchantKey, type MerchantTxnGroup } from "@/utils/merchant-key"

function toMerchantGroupRow(g: MerchantTxnGroup): MerchantGroupRow {
  const r = g.representative
  return {
    pattern_key: g.patternKey,
    display_description: g.displayDescription,
    occurrence_count: g.transactions.length,
    total_amount: g.totalAmount,
    representative_transaction_id: r.id,
    category_id: r.category_id,
    subcategory_id: r.subcategory_id ?? null,
    needs_review_any: g.transactions.some((t) => t.needs_review),
  }
}

function colKey(col: ColumnDef<TransactionRead>): string {
  if (col.id) return col.id
  if ("accessorKey" in col && typeof col.accessorKey === "string") return col.accessorKey
  return ""
}

function TransactionDataRow({
  transaction,
  columns,
  anomalyNames,
}: {
  transaction: TransactionRead
  columns: ColumnDef<TransactionRead>[]
  anomalyNames?: Set<string>
}) {
  const desc = transaction.description
  const isAnomaly = anomalyNames?.has(desc)
  const pattern = transaction.spend_pattern ?? "unknown"
  const table = useReactTable({
    data: [transaction],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  const row = table.getRowModel().rows[0]
  if (!row) return null
  return (
    <TableRow
      className={cn(
        isAnomaly && "bg-destructive/5 border-s-2 border-s-destructive",
        !isAnomaly && pattern === "recurring" && "bg-sky-500/[0.07] dark:bg-sky-500/10",
        !isAnomaly && pattern === "one_time" && "bg-violet-500/[0.08] dark:bg-violet-500/12",
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id} style={{ width: cell.column.getSize() }}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  )
}

type Props = {
  columns: ColumnDef<TransactionRead>[]
  data: TransactionRead[]
  isLoading: boolean
  isFetching: boolean
  anomalyNames?: Set<string>
  emptyLabel?: string
  /** True when API returned exactly the max limit (rows may be truncated). */
  capReached?: boolean
}

export function TransactionsByMonthGroupedTable({
  columns,
  data,
  isLoading,
  isFetching,
  anomalyNames,
  emptyLabel,
  capReached,
}: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const resolvedEmpty = emptyLabel ?? t("transactionsTable.noRows")

  const groups = useMemo(() => groupTransactionsByMerchantKey(data), [data])

  const headerTable = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  function toggleGroup(patternKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(patternKey)) next.delete(patternKey)
      else next.add(patternKey)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              {columns.map((col, i) => (
                <TableHead key={i} style={{ width: (col as { size?: number }).size }}>
                  <Skeleton className="h-4 w-16" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, rowIdx) => (
              <TableRow key={rowIdx}>
                {columns.map((col, colIdx) => (
                  <TableCell key={colIdx} style={{ width: (col as { size?: number }).size }}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {capReached ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">{t("transactionsTable.groupedCapHint")}</p>
      ) : null}
      <div
        className={cn(
          "rounded-md border transition-opacity",
          isFetching && !isLoading && "opacity-60",
        )}
      >
        <Table className="table-fixed">
          <TableHeader>
            {headerTable.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id} style={{ width: header.getSize() }}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Inbox className="h-8 w-8" />
                    <p className="text-sm">{resolvedEmpty}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              groups.flatMap((g) => {
                const mg = toMerchantGroupRow(g)
                const isOpen = expanded.has(g.patternKey)
                const headerRow = (
                  <TableRow key={`g-${g.patternKey}`} className="bg-muted/40 hover:bg-muted/50">
                    {columns.map((col) => (
                      <TableCell key={colKey(col)} style={{ width: col.size as number }}>
                        {renderGroupCell({
                          col,
                          group: g,
                          mgRow: mg,
                          isOpen,
                          onToggle: () => toggleGroup(g.patternKey),
                          t,
                        })}
                      </TableCell>
                    ))}
                  </TableRow>
                )
                const childRows = isOpen
                  ? g.transactions.map((txn) => (
                      <TransactionDataRow
                        key={`t-${txn.id}`}
                        transaction={txn}
                        columns={columns}
                        anomalyNames={anomalyNames}
                      />
                    ))
                  : []
                return [headerRow, ...childRows]
              })
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("transactionsTable.groupedMerchantCount", { count: groups.length })}
        {data.length > 0 && (
          <>
            {" "}
            &middot;{" "}
            {t("transactionsTable.groupedTxnCount", { count: data.length })}
          </>
        )}
      </p>
    </div>
  )
}

function renderGroupCell({
  col,
  group,
  mgRow,
  isOpen,
  onToggle,
  t,
}: {
  col: ColumnDef<TransactionRead>
  group: MerchantTxnGroup
  mgRow: MerchantGroupRow
  isOpen: boolean
  onToggle: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const key = colKey(col)
  switch (key) {
    case "posted_at":
      return (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-label={isOpen ? t("transactionsTable.collapseMerchant") : t("transactionsTable.expandMerchant")}
        >
          {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </Button>
      )
    case "description":
      return (
        <div className="flex max-w-[260px] items-center gap-2">
          <span className="block truncate font-medium" title={group.displayDescription}>
            {group.displayDescription}
          </span>
          <span className="tabular-nums text-xs text-muted-foreground">
            ({group.transactions.length})
          </span>
        </div>
      )
    case "amount":
      return (
        <span className="tabular-nums font-medium">{formatCurrency(group.totalAmount)}</span>
      )
    case "currency":
    case "card_label":
    case "section":
      return <span className="text-muted-foreground">—</span>
    case "spend_pattern":
      return <span className="text-muted-foreground text-xs">—</span>
    case "category_id":
      return <CategoryCell transaction={group.representative} />
    case "subcategory":
      return <MerchantGroupSubcategoryCell row={mgRow} />
    case "needs_review":
      return mgRow.needs_review_any ? (
        <span
          className="inline-block h-2 w-2 rounded-full bg-amber-500"
          title={t("transactionsTable.reviewDotNeedsReview")}
        />
      ) : (
        <span
          className="inline-block h-2 w-2 rounded-full bg-emerald-500"
          title={t("transactionsTable.reviewDotCategorized")}
        />
      )
    case "source":
      return <span className="text-muted-foreground">—</span>
    default:
      return null
  }
}
