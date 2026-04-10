import type { ColumnDef } from "@tanstack/react-table"
import type { TFunction } from "i18next"
import type { TransactionRead } from "@/types/api"
import { Badge } from "@/components/ui/badge"
import { CategoryCell } from "./category-cell"
import { SubcategoryCell } from "./subcategory-cell"
import { SpendPatternCell } from "./spend-pattern-cell"
import { formatCurrency } from "@/lib/format"
import { formatTransactionTableDate } from "@/utils/format"
import { AlertTriangle, ArrowUpDown, FileSearch } from "lucide-react"
import { Button } from "@/components/ui/button"

function sourceButtonHoverTitle(txn: TransactionRead, t: TFunction): string {
  const file = txn.source_upload_original_filename?.trim()
  const row = txn.source_row_1based
  if (file && row != null) return t("transactionSource.hoverTitle", { file, row })
  if (file) return t("transactionSource.hoverTitleNoRow", { file })
  if (row != null) return t("transactionSource.hoverTitleNoFile", { row })
  return t("transactionSource.open")
}

function SortHeader({
  column,
  label,
}: {
  column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | "asc" | "desc" }
  label: string
}) {
  const sorted = column.getIsSorted()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 text-xs font-medium"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  )
}

export function getTransactionColumns(
  t: TFunction,
  options?: { plainHeaders?: boolean; onOpenSource?: (row: TransactionRead) => void },
): ColumnDef<TransactionRead>[] {
  const plain = options?.plainHeaders === true
  const onSource = options?.onOpenSource
  const cols: ColumnDef<TransactionRead>[] = [
    {
      accessorKey: "posted_at",
      header: plain
        ? t("transactionsTable.colDate")
        : ({ column }) => <SortHeader column={column} label={t("transactionsTable.colDate")} />,
      enableSorting: !plain,
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        if (!v) return <span className="text-muted-foreground">--</span>
        return <span className="tabular-nums">{formatTransactionTableDate(v)}</span>
      },
      size: 90,
    },
    {
      accessorKey: "description",
      header: plain
        ? t("transactionsTable.colDescription")
        : ({ column }) => (
            <SortHeader column={column} label={t("transactionsTable.colDescription")} />
          ),
      enableSorting: !plain,
      cell: ({ row, getValue }) => (
        <div className="flex max-w-[260px] items-start gap-1.5">
          {row.original.merchant_category_conflict ? (
            <span
              className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-500"
              title={t("transactionsTable.categoryConflictTitle")}
              aria-label={t("transactionsTable.categoryConflictTitle")}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <span className="block min-w-0 flex-1 truncate" title={getValue<string>()}>
            {getValue<string>()}
          </span>
        </div>
      ),
      size: 260,
    },
    {
      accessorKey: "amount",
      header: plain
        ? t("transactionsTable.colAmount")
        : ({ column }) => <SortHeader column={column} label={t("transactionsTable.colAmount")} />,
      enableSorting: !plain,
      cell: ({ getValue }) => (
        <span className="tabular-nums font-medium">{formatCurrency(getValue<number>())}</span>
      ),
      size: 100,
    },
    {
      accessorKey: "currency",
      header: t("transactionsTable.colCurrency"),
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        return v ? (
          <Badge variant="outline" className="text-[10px]">
            {v}
          </Badge>
        ) : null
      },
      size: 60,
      enableSorting: false,
    },
    {
      id: "spend_pattern",
      header: t("transactionsTable.spendPattern"),
      cell: ({ row }) => <SpendPatternCell transaction={row.original} />,
      size: 168,
      enableSorting: false,
    },
    {
      accessorKey: "category_id",
      header: t("transactionsTable.colCategory"),
      cell: ({ row }) => <CategoryCell transaction={row.original} />,
      size: 160,
      enableSorting: false,
    },
    {
      id: "subcategory",
      header: t("transactionsTable.colSubcategory"),
      cell: ({ row }) => <SubcategoryCell transaction={row.original} />,
      size: 140,
      enableSorting: false,
    },
    {
      accessorKey: "card_label",
      header: t("transactionsTable.colCard"),
      cell: ({ getValue }) => (
        <span
          className="block max-w-[140px] truncate text-muted-foreground"
          title={getValue<string | null>() ?? ""}
        >
          {getValue<string | null>() ?? "--"}
        </span>
      ),
      size: 140,
      enableSorting: false,
    },
    {
      accessorKey: "section",
      header: t("transactionsTable.colSection"),
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        if (!v) return null
        const label =
          v === "IL"
            ? t("transactionsTable.sectionIL")
            : v === "FOREIGN"
              ? t("transactionsTable.sectionForeign")
              : v
        return (
          <Badge variant="secondary" className="text-[10px]">
            {label}
          </Badge>
        )
      },
      size: 80,
      enableSorting: false,
    },
    {
      accessorKey: "needs_review",
      header: t("transactionsTable.colReview"),
      cell: ({ getValue }) => {
        const needs = getValue<boolean>()
        return (
          <span
            className={`inline-block h-2 w-2 rounded-full ${needs ? "bg-amber-500" : "bg-emerald-500"}`}
            title={
              needs ? t("transactionsTable.reviewDotNeedsReview") : t("transactionsTable.reviewDotCategorized")
            }
          />
        )
      },
      size: 60,
      enableSorting: false,
    },
  ]
  if (onSource) {
    cols.push({
      id: "source",
      header: t("transactionSource.colShort"),
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onSource(row.original)}
          title={sourceButtonHoverTitle(row.original, t)}
        >
          <FileSearch className="h-4 w-4" />
        </Button>
      ),
      size: 44,
      enableSorting: false,
    })
  }
  return cols
}
