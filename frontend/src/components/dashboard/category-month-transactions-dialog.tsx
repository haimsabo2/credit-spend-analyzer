import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { listTransactions } from "@/api/transactions"
import { formatCurrency, formatMonthShort } from "@/utils/format"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export interface CategoryMonthTransactionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  month: string
  categoryId: number | null
  categoryName: string
  /** Cell total from the year table (for mismatch hint). */
  expectedTotal?: number
  currency: string
}

function formatPostedAt(iso: string | null): string {
  if (!iso) return "—"
  const d = iso.slice(0, 10)
  const [y, m, day] = d.split("-")
  if (!y || !m || !day) return d
  return `${day}/${m}/${y.slice(2)}`
}

export function CategoryMonthTransactionsDialog({
  open,
  onOpenChange,
  month,
  categoryId,
  categoryName,
  expectedTotal,
  currency,
}: CategoryMonthTransactionsDialogProps) {
  const { t } = useTranslation()
  const uncategorizedOnly = categoryId == null

  const { data, isLoading, isError } = useQuery({
    queryKey: ["category-month-transactions", month, categoryId, uncategorizedOnly],
    queryFn: () =>
      listTransactions({
        month,
        limit: 500,
        ...(uncategorizedOnly
          ? { needs_review: true }
          : { category_id: categoryId ?? undefined }),
      }),
    enabled: open && month.length > 0,
  })

  const rows = data ?? []
  const listTotal = useMemo(
    () => rows.reduce((sum, tx) => sum + (tx.amount ?? 0), 0),
    [rows],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,720px)] max-w-2xl flex-col gap-0 p-0" showCloseButton>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>
            {t("dashboard.categoryMonthTransactionsTitle", {
              category: categoryName,
              month: formatMonthShort(month),
            })}
          </DialogTitle>
          {!isLoading && !isError && rows.length > 0 ? (
            <p className="text-muted-foreground text-sm tabular-nums">
              {t("dashboard.categoryMonthTransactionsSummary", {
                count: rows.length,
                total: formatCurrency(listTotal, currency),
              })}
            </p>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <Skeleton className="h-[280px] w-full rounded-md" />
          ) : isError ? (
            <p className="text-muted-foreground text-sm">{t("dashboard.categoryDrilldownError")}</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dashboard.categoryMonthTransactionsEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[5.5rem]">{t("transactionsTable.colDate")}</TableHead>
                  <TableHead>{t("transactionsTable.colDescription")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("transactionsTable.colCard")}</TableHead>
                  <TableHead className="text-end">{t("transactionsTable.colAmount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-muted-foreground text-xs tabular-nums whitespace-nowrap">
                      {formatPostedAt(tx.posted_at)}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate text-sm" title={tx.description}>
                      {tx.description}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden max-w-[8rem] truncate text-xs sm:table-cell">
                      {tx.card_label ?? "—"}
                    </TableCell>
                    <TableCell className="text-end tabular-nums text-sm font-medium">
                      {formatCurrency(tx.amount, tx.currency ?? currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {!isLoading && rows.length >= 500 ? (
          <p className="text-muted-foreground border-t px-6 py-3 text-xs">
            {t("transactionsTable.groupedCapHint")}
          </p>
        ) : null}
        {!isLoading &&
        expectedTotal != null &&
        expectedTotal > 0 &&
        Math.abs(listTotal - expectedTotal) > 0.01 ? (
          <p className="text-muted-foreground border-t px-6 py-3 text-xs">
            {t("dashboard.categoryMonthTransactionsTotalNote", {
              tableTotal: formatCurrency(expectedTotal, currency),
            })}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
