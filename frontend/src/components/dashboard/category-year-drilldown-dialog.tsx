import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  getCategoryYearMerchants,
  type CategoryMerchantsScope,
} from "@/api/insights"
import { formatCurrency, formatMonthShort } from "@/utils/format"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

const MERCHANT_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "oklch(0.55 0.2 250)",
  "oklch(0.6 0.18 300)",
  "oklch(0.65 0.2 20)",
  "oklch(0.55 0.15 180)",
  "oklch(0.58 0.14 140)",
  "oklch(0.52 0.12 320)",
  "oklch(0.62 0.16 60)",
  "oklch(0.5 0.1 200)",
  "oklch(0.56 0.17 100)",
  "oklch(0.6 0.14 280)",
]

export interface CategoryYearDrilldownDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  merchantsScope: CategoryMerchantsScope
  /** Shown in title after em dash (e.g. "2026" or translated trailing label). */
  periodLabel: string
  categoryId: number | null
  categoryName: string
  currency: string
  currencySymbol: string
}

export function CategoryYearDrilldownDialog({
  open,
  onOpenChange,
  merchantsScope,
  periodLabel,
  categoryId,
  categoryName,
  currency,
  currencySymbol,
}: CategoryYearDrilldownDialogProps) {
  const { t } = useTranslation()
  const scopeKey =
    "year" in merchantsScope
      ? `y:${merchantsScope.year}`
      : `t:${merchantsScope.trailingCalendarMonths}`
  const { data, isLoading, isError } = useQuery({
    queryKey: ["category-year-merchants", scopeKey, categoryId],
    queryFn: () => getCategoryYearMerchants(categoryId, merchantsScope),
    enabled: open,
  })

  const { chartRows, keys, yMax } = useMemo(() => {
    if (!data?.merchants?.length || !data.months.length) {
      return { chartRows: [] as Record<string, string | number>[], keys: [] as string[], yMax: 1 }
    }
    const merchants = data.merchants
    const safeKeys = merchants.map((_, i) => `s_${i}`)
    const rows = data.months.map((ym, mi) => {
      const row: Record<string, string | number> = {
        label: formatMonthShort(ym),
        ym,
      }
      let sum = 0
      merchants.forEach((m, i) => {
        const v = m.amounts[mi] ?? 0
        row[safeKeys[i]] = v
        sum += v
      })
      row._total = sum
      return row
    })
    let maxMonth = 0
    for (const row of rows) {
      const tot = Number(row._total)
      if (tot > maxMonth) maxMonth = tot
    }
    let y = 1
    if (maxMonth > 0) {
      const padded = maxMonth * 1.08
      const magnitude = 10 ** Math.floor(Math.log10(padded))
      const normalized = padded / magnitude
      const nice =
        normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
      y = nice * magnitude
    }
    return { chartRows: rows, keys: safeKeys, yMax: y }
  }, [data])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="max-h-[min(90vh,920px)] w-full max-w-[min(96rem,calc(100vw-2rem))] gap-4 overflow-y-auto sm:max-w-[min(96rem,calc(100vw-2rem))]"
      >
        <DialogHeader>
          <DialogTitle>
            {t("dashboard.categoryDrilldownTitle", { name: categoryName, period: periodLabel })}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-[420px] w-full rounded-md" />
        ) : isError ? (
          <p className="text-muted-foreground text-sm">{t("dashboard.categoryDrilldownError")}</p>
        ) : !data?.merchants.length ? (
          <p className="text-muted-foreground text-sm">{t("dashboard.categoryDrilldownEmpty")}</p>
        ) : (
          <div className="h-[min(420px,50vh)] w-full min-h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={48} />
                <YAxis
                  domain={[0, yMax]}
                  tick={{ fontSize: 11 }}
                  width={48}
                  tickFormatter={(v) => `${currencySymbol}${v}`}
                />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.length) return null
                    const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0)
                    return (
                      <div className="bg-background border-border max-w-xs rounded-md border px-3 py-2 text-xs shadow-md">
                        <p className="text-foreground mb-1 font-medium">
                          {(payload[0]?.payload as { label?: string })?.label}
                        </p>
                        <ul className="text-muted-foreground space-y-0.5">
                          {payload
                            .filter((p) => p.value != null && Number(p.value) > 0)
                            .map((p) => (
                              <li key={String(p.dataKey)} className="flex justify-between gap-4">
                                <span className="truncate">{p.name}</span>
                                <span className="tabular-nums">
                                  {formatCurrency(Number(p.value), currency)}
                                </span>
                              </li>
                            ))}
                        </ul>
                        <p className="border-border text-foreground mt-2 border-t pt-1 font-medium">
                          {t("dashboard.categoryDrilldownMonthTotal")}{" "}
                          {formatCurrency(total, currency)}
                        </p>
                      </div>
                    )
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {data.merchants.map((m, i) => (
                  <Bar
                    key={keys[i]}
                    dataKey={keys[i]}
                    name={m.merchant_key}
                    stackId="stack"
                    fill={MERCHANT_COLORS[i % MERCHANT_COLORS.length]}
                    radius={i === data.merchants.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
