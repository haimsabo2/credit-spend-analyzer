import type { ColumnDef } from "@tanstack/react-table"
import type { TFunction } from "i18next"
import type { TransactionRead } from "@/types/api"
import { Badge } from "@/components/ui/badge"
import { CategoryCell } from "./category-cell"
import { SubcategoryCell } from "./subcategory-cell"
import { SpendPatternCell } from "./spend-pattern-cell"
import { formatCurrency } from "@/lib/format"
import { formatTransactionTableDate } from "@/utils/format"
import { ArrowUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"

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
  options?: { plainHeaders?: boolean },
): ColumnDef<TransactionRead>[] {
  const plain = options?.plainHeaders === true
  return [
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
      cell: ({ getValue }) => (
        <span className="block max-w-[260px] truncate" title={getValue<string>()}>
          {getValue<string>()}
        </span>
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
}
