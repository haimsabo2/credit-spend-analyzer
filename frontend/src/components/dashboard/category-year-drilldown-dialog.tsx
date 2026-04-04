import { useEffect, useMemo, useState } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  getCategoryYearMerchants,
  getCategoryYearSubcategories,
  type CategoryMerchantsScope,
} from "@/api/insights"
import { getMerchantGroupSeries, listMerchantSpendGroups } from "@/api/merchantSpendGroups"
import { stackedBarModelFromSeriesResponse } from "@/components/dashboard/stacked-month-bar-model"
import { formatCurrency, formatMonthShort } from "@/utils/format"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

function StackedSeriesMonthChart({
  chartRows,
  keys,
  labels,
  yMax,
  currency,
  currencySymbol,
  stackId,
  t,
}: {
  chartRows: Record<string, string | number>[]
  keys: string[]
  labels: string[]
  yMax: number
  currency: string
  currencySymbol: string
  stackId: string
  t: TFunction
}) {
  const n = labels.length
  return (
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
                          <span className="tabular-nums">{formatCurrency(Number(p.value), currency)}</span>
                        </li>
                      ))}
                  </ul>
                  <p className="border-border text-foreground mt-2 border-t pt-1 font-medium">
                    {t("dashboard.categoryDrilldownMonthTotal")} {formatCurrency(total, currency)}
                  </p>
                </div>
              )
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {labels.map((lbl, i) => (
            <Bar
              key={`${stackId}-${keys[i]}`}
              dataKey={keys[i]}
              name={lbl}
              stackId={stackId}
              fill={MERCHANT_COLORS[i % MERCHANT_COLORS.length]}
              radius={i === n - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

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

  const {
    data: subData,
    isLoading: subLoading,
    isError: subError,
  } = useQuery({
    queryKey: ["category-year-subcategories", scopeKey, categoryId],
    queryFn: () => getCategoryYearSubcategories(categoryId, merchantsScope),
    enabled: open,
  })

  const [trendGroupId, setTrendGroupId] = useState<string>("")
  useEffect(() => {
    if (!open) setTrendGroupId("")
  }, [open])

  const { data: spendGroups } = useQuery({
    queryKey: ["merchant-spend-groups"],
    queryFn: listMerchantSpendGroups,
    enabled: open,
  })

  const seriesScope = useMemo(
    () =>
      "year" in merchantsScope
        ? { year: merchantsScope.year }
        : { trailingCalendarMonths: merchantsScope.trailingCalendarMonths },
    [merchantsScope],
  )

  const gid = trendGroupId ? Number(trendGroupId) : 0
  const { data: groupSeries, isLoading: seriesLoading } = useQuery({
    queryKey: ["merchant-group-series", gid, seriesScope],
    queryFn: () => getMerchantGroupSeries(gid, seriesScope),
    enabled: open && gid > 0,
  })

  const groupTrendRows = useMemo(() => {
    if (!groupSeries?.months.length) return []
    return groupSeries.months.map((ym, i) => ({
      label: formatMonthShort(ym),
      total: groupSeries.amounts[i] ?? 0,
    }))
  }, [groupSeries])

  const merchantModel = useMemo(() => stackedBarModelFromSeriesResponse(data), [data])
  const subModel = useMemo(() => stackedBarModelFromSeriesResponse(subData), [subData])

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

        {isLoading && subLoading ? (
          <Skeleton className="h-[420px] w-full rounded-md" />
        ) : isError && subError ? (
          <p className="text-muted-foreground text-sm">{t("dashboard.categoryDrilldownError")}</p>
        ) : (
          <div className="space-y-8">
            <div>
              <h3 className="text-muted-foreground mb-2 text-sm font-medium">
                {t("dashboard.drilldownSubcategorySection")}
              </h3>
              {subLoading ? (
                <Skeleton className="h-[min(420px,50vh)] min-h-[280px] w-full rounded-md" />
              ) : subError ? (
                <p className="text-muted-foreground text-sm">{t("dashboard.categoryDrilldownError")}</p>
              ) : !subData?.merchants?.length ? (
                <p className="text-muted-foreground text-sm">{t("dashboard.drilldownSubcategoryEmpty")}</p>
              ) : (
                <StackedSeriesMonthChart
                  chartRows={subModel.chartRows}
                  keys={subModel.keys}
                  labels={subModel.seriesLabels}
                  yMax={subModel.yMax}
                  currency={currency}
                  currencySymbol={currencySymbol}
                  stackId="subcat"
                  t={t}
                />
              )}
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                {t("dashboard.drilldownSubcategoryHint")}
              </p>
            </div>
            <div>
              <h3 className="text-muted-foreground mb-2 text-sm font-medium">
                {t("dashboard.drilldownMerchantSection")}
              </h3>
              {isLoading ? (
                <Skeleton className="h-[min(420px,50vh)] min-h-[280px] w-full rounded-md" />
              ) : isError ? (
                <p className="text-muted-foreground text-sm">{t("dashboard.categoryDrilldownError")}</p>
              ) : !data?.merchants?.length ? (
                <p className="text-muted-foreground text-sm">{t("dashboard.categoryDrilldownEmpty")}</p>
              ) : (
                <StackedSeriesMonthChart
                  chartRows={merchantModel.chartRows}
                  keys={merchantModel.keys}
                  labels={merchantModel.seriesLabels}
                  yMax={merchantModel.yMax}
                  currency={currency}
                  currencySymbol={currencySymbol}
                  stackId="merchant"
                  t={t}
                />
              )}
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                {t("dashboard.drilldownMerchantHint")}
              </p>
            </div>
          </div>
        )}

        {open && spendGroups && spendGroups.length > 0 ? (
          <div className="border-border space-y-2 border-t pt-4">
            <p className="text-sm font-medium">{t("merchantSpendGroups.drilldownTrendTitle")}</p>
            <Select value={trendGroupId || "__none__"} onValueChange={(v) => setTrendGroupId(v === "__none__" ? "" : v)}>
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder={t("merchantSpendGroups.drilldownPickGroup")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("merchantSpendGroups.drilldownPickGroup")}</SelectItem>
                {spendGroups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {gid > 0 ? (
              <div className="h-[220px] w-full min-h-[180px]">
                {seriesLoading ? (
                  <Skeleton className="h-full w-full rounded-md" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={groupTrendRows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={(v) => `${currencySymbol}${v}`} />
                      <Tooltip
                        formatter={(v) => [
                          formatCurrency(Number(v ?? 0), currency),
                          t("dashboard.monthTableSpend"),
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke="var(--color-chart-2)"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
