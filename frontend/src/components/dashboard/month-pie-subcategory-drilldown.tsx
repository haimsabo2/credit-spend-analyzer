import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { getMonthCategorySubcategories } from "@/api/insights"
import { formatCurrency, formatMonthShort } from "@/utils/format"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

export interface MonthPieSubcategoryDrilldownProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  month: string
  categoryId: number | null
  categoryName: string
  currency: string
  currencySymbol: string
}

export function MonthPieSubcategoryDrilldown({
  open,
  onOpenChange,
  month,
  categoryId,
  categoryName,
  currency,
  currencySymbol,
}: MonthPieSubcategoryDrilldownProps) {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useQuery({
    queryKey: ["month-category-subcategories", month, categoryId],
    queryFn: () => getMonthCategorySubcategories(month, categoryId),
    enabled: open,
  })

  const chartRows =
    data?.items.map((it) => ({
      label: it.label,
      amount: it.amount,
    })) ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {t("dashboard.monthPieSubcategoryTitle", {
              category: categoryName,
              month: formatMonthShort(month),
            })}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-[280px] w-full rounded-md" />
        ) : isError ? (
          <p className="text-muted-foreground text-sm">{t("dashboard.categoryDrilldownError")}</p>
        ) : chartRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("dashboard.monthPieSubcategoryEmpty")}</p>
        ) : (
          <div className="h-[min(360px,50vh)] w-full min-h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartRows}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal vertical={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${currencySymbol}${v}`}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={Math.min(140, 12 + Math.max(...chartRows.map((r) => r.label.length)) * 7)}
                  tick={{ fontSize: 11 }}
                  interval={0}
                />
                <Tooltip
                  formatter={(v: number | undefined) => [
                    formatCurrency(Number(v ?? 0), currency),
                    t("dashboard.monthTableSpend"),
                  ]}
                />
                <Bar dataKey="amount" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("dashboard.monthPieSubcategoryHint")}
        </p>
      </DialogContent>
    </Dialog>
  )
}
