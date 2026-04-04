import type { ColumnDef } from "@tanstack/react-table"
import type { TFunction } from "i18next"
import type { MerchantGroupRow, TransactionRead } from "@/types/api"
import { CategoryCell } from "./category-cell"
import { MerchantGroupSubcategoryCell } from "./merchant-group-subcategory-cell"
import { formatCurrency } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

function syntheticTransaction(row: MerchantGroupRow): TransactionRead {
  return {
    id: row.representative_transaction_id,
    upload_id: 0,
    card_label: null,
    section: null,
    posted_at: null,
    description: row.display_description,
    amount: 0,
    currency: null,
    needs_review: row.needs_review_any,
    category_id: row.category_id,
    subcategory_id: row.subcategory_id ?? null,
    confidence: 0,
    rule_id_applied: null,
    spend_pattern: "unknown",
    spend_pattern_user_set: false,
  }
}

export function getMerchantGroupColumns(
  t: TFunction,
  options: {
    variant: "pending" | "approved"
    onApprove: (row: MerchantGroupRow) => void
    onUnapprove: (row: MerchantGroupRow) => void
    actionDisabled: boolean
  },
): ColumnDef<MerchantGroupRow>[] {
  const { variant, onApprove, onUnapprove, actionDisabled } = options
  const cols: ColumnDef<MerchantGroupRow>[] = [
    {
      accessorKey: "display_description",
      header: t("transactionsTable.colDescription"),
      cell: ({ row, getValue }) => (
        <div className="max-w-[280px] space-y-0.5">
          <span className="block truncate" title={getValue<string>()}>
            {getValue<string>()}
          </span>
          {row.original.spend_group_name ? (
            <Badge variant="outline" className="text-[10px] font-normal">
              {row.original.spend_group_name}
            </Badge>
          ) : null}
        </div>
      ),
      size: 280,
    },
    {
      accessorKey: "occurrence_count",
      header: t("merchantGroups.colOccurrences"),
      cell: ({ getValue }) => (
        <span className="tabular-nums">{getValue<number>()}</span>
      ),
      size: 90,
    },
    {
      accessorKey: "total_amount",
      header: t("merchantGroups.colTotal"),
      cell: ({ getValue }) => (
        <span className="tabular-nums font-medium">{formatCurrency(getValue<number>())}</span>
      ),
      size: 110,
    },
    {
      id: "category",
      header: t("transactionsTable.colCategory"),
      cell: ({ row }) => <CategoryCell transaction={syntheticTransaction(row.original)} />,
      size: 200,
      enableSorting: false,
    },
    {
      id: "subcategory",
      header: t("transactionsTable.colSubcategory"),
      cell: ({ row }) => <MerchantGroupSubcategoryCell row={row.original} />,
      size: 160,
      enableSorting: false,
    },
    {
      id: "review",
      header: t("transactionsTable.colReview"),
      cell: ({ row }) =>
        row.original.needs_review_any ? (
          <Badge variant="secondary" className="text-[10px]">
            {t("transactionsTable.reviewDotNeedsReview")}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
      size: 100,
      enableSorting: false,
    },
    {
      id: "action",
      header: "",
      cell: ({ row }) =>
        variant === "pending" ? (
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-8"
            disabled={actionDisabled}
            onClick={() => onApprove(row.original)}
          >
            {t("merchantGroups.approve")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={actionDisabled}
            onClick={() => onUnapprove(row.original)}
          >
            {t("merchantGroups.unapprove")}
          </Button>
        ),
      size: 120,
      enableSorting: false,
    },
  ]
  return cols
}
