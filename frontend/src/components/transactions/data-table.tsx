import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TransactionRead, MerchantGroupRow } from "@/types/api"
import { getTransactionRowClassName } from "./transaction-row-styles"

function rowStyleFromOriginal<T>(original: T, anomalyNames?: Set<string>, description?: string) {
  const desc =
    description ??
    String(
      (original as { display_description?: string }).display_description ??
        (original as { description?: string }).description ??
        "",
    )
  const isAnomaly = anomalyNames?.has(desc) ?? false
  const mg = original as MerchantGroupRow
  const txn = original as unknown as TransactionRead
  const categoryConflict = mg.category_conflict ?? txn.merchant_category_conflict ?? false
  const spendPattern = txn.spend_pattern ?? "unknown"
  return getTransactionRowClassName({ isAnomaly, categoryConflict, spendPattern })
}

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  isLoading: boolean
  isFetching: boolean
  anomalyNames?: Set<string>
  descriptionAccessor?: keyof T
  pageIndex: number
  pageSize: number
  onPageChange: (page: number) => void
  emptyLabel?: string
}

export function DataTable<T>({
  columns,
  data,
  isLoading,
  isFetching,
  anomalyNames,
  descriptionAccessor = "description" as keyof T,
  pageIndex,
  pageSize,
  onPageChange,
  emptyLabel,
}: DataTableProps<T>) {
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([])
  const resolvedEmpty = emptyLabel ?? t("transactionsTable.noRows")

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const hasMore = data.length === pageSize
  const hasPrev = pageIndex > 0

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
      <div
        className={cn(
          "rounded-md border transition-opacity",
          isFetching && !isLoading && "opacity-60",
        )}
      >
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
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
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Inbox className="h-8 w-8" />
                    <p className="text-sm">{resolvedEmpty}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const desc = String(row.original[descriptionAccessor] ?? "")
                return (
                  <TableRow
                    key={row.id}
                    className={rowStyleFromOriginal(row.original, anomalyNames, desc)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} style={{ width: cell.column.getSize() }}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("transactionsTable.paginationPage", { page: pageIndex + 1 })}
          {data.length > 0 && (
            <>
              {" "}
              &middot;{" "}
              {data.length === 1
                ? t("transactionsTable.paginationRowsOne")
                : t("transactionsTable.paginationRowsMany", { count: data.length })}
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            disabled={!hasPrev}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t("transactionsTable.paginationPrev")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            disabled={!hasMore}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            {t("transactionsTable.paginationNext")}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
