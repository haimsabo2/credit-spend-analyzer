import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useMonthStore } from "@/stores/use-month-store"
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts"
import { Upload } from "lucide-react"
import { AnnualSpendMomLabels } from "@/components/dashboard/annual-spend-mom-labels"
import { DataQualityCard } from "@/components/dashboard/data-quality-card"
import { CardSpendSection } from "@/components/dashboard/card-spend-section"
import { CategoryYearCarousel } from "@/components/dashboard/category-year-carousel"
import { CategoryYearDrilldownDialog } from "@/components/dashboard/category-year-drilldown-dialog"
import { MonthPieSubcategoryDrilldown } from "@/components/dashboard/month-pie-subcategory-drilldown"
import { StatCard } from "@/components/dashboard/stat-card"
import { ChartCard } from "@/components/dashboard/chart-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { CategoryMonthlyRow, SummaryResponse } from "@/api/types"
import { ApiError } from "@/api/client"
import { getSummary, getTrailingOverview, getYearOverview } from "@/api/insights"
import { getNeedsReview } from "@/api/transactions"
import { listTransactions } from "@/api/transactions"
import { formatCurrency, formatMonthShort } from "@/utils/format"
import { priorMonth } from "@/utils/month"
import { isBackendUnreachable } from "@/utils/api-reachability"

const EMPTY_SUMMARY: SummaryResponse = {
  total_spend: 0,
  spend_by_category: [],
  spend_by_card: [],
  top_merchants: [],
}

const TOP_CATEGORIES = 8
const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "oklch(0.55 0.2 250)",
  "oklch(0.6 0.18 300)",
  "oklch(0.65 0.2 20)",
  "oklch(0.55 0.15 180)",
]

const MIN_DASHBOARD_YEAR = 2020

/** Select value for trailing 12 calendar months (not a calendar year). */
const PERIOD_TRAILING12 = "__trailing12__"

type AnnualChartRow = {
  ym: string
  label: string
  total: number
  count: number
  /** Month-over-month % change in total spend; null if previous month was 0 or first slot. */
  momPctChange: number | null
}

function monthOverMonthPctChange(prevTotal: number, currTotal: number): number | null {
  if (prevTotal <= 0) return null
  return ((currTotal - prevTotal) / prevTotal) * 100
}

function formatMomPctForDisplay(pct: number): string {
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(1)}%`
}

function yearSelectOptions(): number[] {
  const cy = new Date().getFullYear()
  const out: number[] = []
  for (let y = cy + 1; y >= MIN_DASHBOARD_YEAR; y--) out.push(y)
  return out
}

function aggregateByDay(
  transactions: { posted_at: string | null; amount: number }[],
  month: string,
): { day: string; total: number; dayNum: number }[] {
  const [y, m] = month.split("-").map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const byDay: Record<number, number> = {}
  for (let d = 1; d <= daysInMonth; d++) byDay[d] = 0
  for (const t of transactions) {
    if (!t.posted_at) continue
    const d = parseInt(t.posted_at.slice(8, 10), 10)
    if (d >= 1 && d <= daysInMonth) byDay[d] = (byDay[d] ?? 0) + t.amount
  }
  return Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => ({
    day: String(d),
    dayNum: d,
    total: byDay[d] ?? 0,
  }))
}

function formatSignedDelta(delta: number, currency: string): string {
  if (delta === 0) return formatCurrency(0, currency)
  const sign = delta > 0 ? "+" : "−"
  return `${sign}${formatCurrency(Math.abs(delta), currency)}`
}

function categoryRowSelectValue(row: CategoryMonthlyRow): string {
  return row.category_id == null ? "__uncat__" : String(row.category_id)
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const yearOptions = useMemo(() => yearSelectOptions(), [])

  const { month: storeMonth, setMonth: setStoreMonth } = useMonthStore()
  const selectedMonth = storeMonth

  const [periodSelect, setPeriodSelect] = useState<string>(() => {
    const y = parseInt(storeMonth.slice(0, 4), 10)
    return Number.isFinite(y) ? String(y) : String(new Date().getFullYear())
  })

  const isTrailing12 = periodSelect === PERIOD_TRAILING12
  const selectedCalendarYear = isTrailing12 ? null : parseInt(periodSelect, 10)
  const calendarYearValid =
    selectedCalendarYear != null && Number.isFinite(selectedCalendarYear)

  const handlePickMonth = useCallback(
    (ym: string) => {
      setStoreMonth(ym)
      setPeriodSelect((prev) => {
        if (prev === PERIOD_TRAILING12) return prev
        const y = parseInt(ym.slice(0, 4), 10)
        return Number.isFinite(y) ? String(y) : prev
      })
      requestAnimationFrame(() => {
        document.getElementById("month-detail")?.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    },
    [setStoreMonth],
  )

  useEffect(() => {
    if (periodSelect === PERIOD_TRAILING12) return
    const y = parseInt(selectedMonth.slice(0, 4), 10)
    if (!Number.isFinite(y)) return
    setPeriodSelect((prev) => (prev === PERIOD_TRAILING12 ? prev : String(y)))
  }, [selectedMonth, periodSelect])

  const { data: summary, isLoading: summaryLoading, error: summaryError } = useQuery({
    queryKey: ["summary", selectedMonth],
    queryFn: () => getSummary(selectedMonth),
    enabled: !!selectedMonth,
    retry: 1,
  })

  const prevMonthKey = useMemo(() => priorMonth(selectedMonth), [selectedMonth])

  const { data: prevSummary, isLoading: prevSummaryLoading } = useQuery({
    queryKey: ["summary", prevMonthKey ?? ""],
    queryFn: () => getSummary(prevMonthKey!),
    enabled: !!prevMonthKey,
  })

  const { data: needsReview } = useQuery({
    queryKey: ["needs-review", selectedMonth],
    queryFn: () => getNeedsReview(selectedMonth),
    enabled: !!selectedMonth,
  })

  const { data: yearTrends, isLoading: yearTrendsLoading } = useQuery({
    queryKey: isTrailing12
      ? (["trends", "trailing", 12] as const)
      : (["trends", "year", selectedCalendarYear] as const),
    queryFn: () =>
      isTrailing12
        ? getTrailingOverview(12)
        : getYearOverview(selectedCalendarYear!),
    enabled: isTrailing12 || calendarYearValid,
  })

  const monthsInYear = useMemo(() => {
    if (isTrailing12) {
      return yearTrends?.months?.length ? yearTrends.months : []
    }
    const y = selectedCalendarYear
    if (y == null || !Number.isFinite(y)) return []
    if (yearTrends?.months?.length) {
      return yearTrends.months.filter((m) => m.startsWith(`${y}-`))
    }
    return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`)
  }, [isTrailing12, yearTrends?.months, selectedCalendarYear])

  /** Trailing-12: month outside window — exit to that calendar year instead of overwriting storeMonth. */
  useEffect(() => {
    if (!isTrailing12 || !yearTrends?.months?.length) return
    if (yearTrends.months.includes(selectedMonth)) return
    const y = parseInt(selectedMonth.slice(0, 4), 10)
    if (!Number.isFinite(y)) return
    setPeriodSelect(String(y))
  }, [isTrailing12, yearTrends?.months, selectedMonth])

  /** Calendar year: clamp only when trends match this year (avoids race with topbar cross-year pick). */
  useEffect(() => {
    if (isTrailing12 || !yearTrends?.months?.length || selectedCalendarYear == null) return
    const monthYear = parseInt(selectedMonth.slice(0, 4), 10)
    if (!Number.isFinite(monthYear) || monthYear !== selectedCalendarYear) return
    const prefix = `${selectedCalendarYear}-`
    if (!yearTrends.months.some((m) => m.startsWith(prefix))) return
    const first = yearTrends.months[0]
    if (first && !first.startsWith(`${selectedCalendarYear}-`)) return
    if (yearTrends.months.includes(selectedMonth)) return
    setStoreMonth(yearTrends.months[yearTrends.months.length - 1]!)
  }, [
    isTrailing12,
    yearTrends?.months,
    selectedMonth,
    setStoreMonth,
    selectedCalendarYear,
  ])

  const categoryMonthlyRows = yearTrends?.category_monthly

  const [categoryDrilldownRow, setCategoryDrilldownRow] = useState<CategoryMonthlyRow | null>(null)

  const [monthPieDrill, setMonthPieDrill] = useState<{
    categoryId: number | null
    categoryName: string
  } | null>(null)

  const { data: transactions } = useQuery({
    queryKey: ["transactions", selectedMonth],
    queryFn: () => listTransactions(selectedMonth),
    enabled: !!selectedMonth,
  })

  const unreachable = summaryError != null && isBackendUnreachable(summaryError)
  const effectiveSummary = summary ?? (unreachable ? EMPTY_SUMMARY : undefined)

  const dailyData = useMemo(() => {
    if (!transactions) return []
    return aggregateByDay(transactions, selectedMonth)
  }, [transactions, selectedMonth])

  type PieSlice = {
    name: string
    value: number
    categoryId: number | null
    isOther: boolean
  }

  const pieData = useMemo((): PieSlice[] => {
    if (!effectiveSummary?.spend_by_category) return []
    const cats = effectiveSummary.spend_by_category.filter((c) => c.amount > 0)
    const top = cats.slice(0, TOP_CATEGORIES)
    const rest = cats.slice(TOP_CATEGORIES)
    const restAmount = rest.reduce((s, c) => s + c.amount, 0)
    const result: PieSlice[] = top.map((c) => ({
      name: c.category_name,
      value: c.amount,
      categoryId: c.category_id,
      isOther: false,
    }))
    if (restAmount > 0) {
      result.push({
        name: t("charts.other"),
        value: restAmount,
        categoryId: null,
        isOther: true,
      })
    }
    return result
  }, [effectiveSummary, t])

  const pieTotal = useMemo(() => pieData.reduce((s, x) => s + x.value, 0), [pieData])

  const annualChartData = useMemo((): AnnualChartRow[] => {
    if (!yearTrends?.months?.length) return []
    return yearTrends.months.map((ym, i) => {
      const total = yearTrends.total_spend_series[i] ?? 0
      const prevTotal = i > 0 ? (yearTrends.total_spend_series[i - 1] ?? 0) : 0
      const momPctChange =
        i > 0 ? monthOverMonthPctChange(prevTotal, total) : null
      return {
        ym,
        label: formatMonthShort(ym),
        total,
        count: yearTrends.txn_count_series?.[i] ?? 0,
        momPctChange,
      }
    })
  }, [yearTrends])

  /** Nice Y max with headroom so bars use more vertical space and top labels fit. */
  const annualChartYMax = useMemo(() => {
    const max = Math.max(0, ...annualChartData.map((r) => r.total))
    if (max <= 0) return 1
    const padded = max * 1.2
    const magnitude = 10 ** Math.floor(Math.log10(padded))
    const normalized = padded / magnitude
    const nice =
      normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
    return nice * magnitude
  }, [annualChartData])

  const categoriesCount = effectiveSummary?.spend_by_category?.filter((c) => c.amount > 0).length ?? 0
  const totalTransactions = transactions?.length ?? 0
  const hasData =
    (effectiveSummary?.total_spend ?? 0) > 0 || (transactions?.length ?? 0) > 0
  const yearHasData = useMemo(
    () => (yearTrends?.total_spend_series ?? []).some((x) => x > 0),
    [yearTrends],
  )
  const showDashboard =
    yearHasData || hasData || summaryLoading || yearTrendsLoading

  const currency = transactions?.[0]?.currency ?? "ILS"
  const currencySymbol = currency === "ILS" ? "₪" : currency

  const totalSpendSubtitle = useMemo(() => {
    if (!prevMonthKey) return undefined
    if (prevSummaryLoading || prevSummary === undefined) return undefined
    const cur = effectiveSummary?.total_spend ?? 0
    const prev = prevSummary.total_spend
    const delta = cur - prev
    return `${t("dashboard.vsPreviousSubtitle", {
      month: formatMonthShort(prevMonthKey),
      amount: formatCurrency(prev, currency),
    })} · ${t("dashboard.deltaVsPrevious", { delta: formatSignedDelta(delta, currency) })}`
  }, [prevMonthKey, prevSummary, prevSummaryLoading, effectiveSummary, currency, t])

  const summaryErrorDetail =
    summaryError instanceof ApiError
      ? typeof summaryError.body === "object" &&
          summaryError.body &&
          "detail" in summaryError.body &&
          typeof (summaryError.body as { detail: unknown }).detail === "string"
        ? (summaryError.body as { detail: string }).detail
        : `${summaryError.status} ${summaryError.statusText}`
      : summaryError instanceof Error
        ? summaryError.message
        : null

  if (summaryError && !unreachable) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-2">
          <p className="text-destructive font-medium">{t("dashboard.errorLoading")}</p>
          {summaryErrorDetail ? (
            <p className="text-sm text-destructive/90 break-words">{summaryErrorDetail}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">{t("dashboard.errorLoadingHint")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {unreachable ? (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
          role="status"
        >
          {t("dashboard.backendUnreachableBanner")}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("dashboard.year")}:</span>
          <Select
            value={periodSelect}
            onValueChange={(v) => {
              if (v === PERIOD_TRAILING12) {
                setPeriodSelect(PERIOD_TRAILING12)
                return
              }
              const y = parseInt(v, 10)
              if (Number.isFinite(y)) {
                setPeriodSelect(v)
                setStoreMonth(`${y}-01`)
              }
            }}
          >
            <SelectTrigger className="w-[min(100%,11rem)] min-w-[9.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PERIOD_TRAILING12}>{t("dashboard.trailing12Months")}</SelectItem>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!showDashboard && !summaryLoading && !yearTrendsLoading ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">{t("dashboard.noDataTitle")}</p>
          <Button asChild className="mt-4">
            <Link to="/upload">
              <Upload className="me-2 h-4 w-4" />
              {t("dashboard.noDataCtaUpload")}
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <ChartCard title={t("dashboard.annualOverview")}>
            {yearTrendsLoading ? (
              <Skeleton className="h-[380px] w-full" />
            ) : annualChartData.length > 0 ? (
              <div className="space-y-4">
                <p className="text-muted-foreground text-xs">{t("dashboard.clickMonthHint")}</p>
                <p className="text-muted-foreground text-xs">{t("dashboard.annualOverviewTrendHint")}</p>
                <ResponsiveContainer width="100%" height={360}>
                  <ComposedChart
                    data={annualChartData}
                    margin={{ top: 40, right: 12, left: 4, bottom: 8 }}
                    barCategoryGap="18%"
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={56} />
                    <YAxis
                      domain={[0, annualChartYMax]}
                      tick={{ fontSize: 11 }}
                      width={52}
                      tickFormatter={(v) => `${currencySymbol}${v}`}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null
                        const row = payload[0].payload as AnnualChartRow
                        const c = row.count
                        const tx =
                          c != null && c > 0
                            ? t("dashboard.tooltipTxnSuffix", { count: c })
                            : ""
                        const mom = row.momPctChange
                        return (
                          <div className="rounded-md border bg-background/95 px-2 py-1.5 text-xs shadow-md">
                            <p className="font-medium text-foreground">{label}</p>
                            <p className="text-muted-foreground">
                              {t("dashboard.monthTableSpend")}:{" "}
                              {formatCurrency(row.total, currency)}
                              {tx}
                            </p>
                            {mom != null && Number.isFinite(mom) ? (
                              <p
                                className={
                                  mom > 0
                                    ? "text-destructive"
                                    : mom < 0
                                      ? "text-emerald-600 dark:text-emerald-500"
                                      : "text-muted-foreground"
                                }
                              >
                                {t("dashboard.annualMomVsPrev", {
                                  value: formatMomPctForDisplay(mom),
                                })}
                              </p>
                            ) : null}
                          </div>
                        )
                      }}
                    />
                    <Bar
                      dataKey="total"
                      fill="var(--color-chart-1)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={56}
                      cursor="pointer"
                      onClick={(e: { payload?: { ym?: string } }) => {
                        const ym = e?.payload?.ym
                        if (ym) handlePickMonth(ym)
                      }}
                    >
                      <LabelList
                        dataKey="total"
                        position="top"
                        content={(props) => {
                          const { x, y, width, value } = props as {
                            x?: number
                            y?: number
                            width?: number
                            value?: number
                          }
                          if (x == null || y == null || width == null) return null
                          const n = typeof value === "number" ? value : Number(value)
                          if (!Number.isFinite(n) || n <= 0) return null
                          return (
                            <text
                              x={x + width / 2}
                              y={y - 6}
                              fill="hsl(var(--muted-foreground))"
                              fontSize={11}
                              textAnchor="middle"
                            >
                              {formatCurrency(n, currency)}
                            </text>
                          )
                        }}
                      />
                    </Bar>
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="var(--color-chart-2)"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "var(--color-chart-2)" }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                    <AnnualSpendMomLabels rows={annualChartData} formatPct={formatMomPctForDisplay} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("dashboard.monthTableMonth")}</TableHead>
                        <TableHead className="text-end">{t("dashboard.monthTableSpend")}</TableHead>
                        <TableHead className="text-end">{t("dashboard.monthTableTxns")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {annualChartData.map((row) => (
                        <TableRow
                          key={row.ym}
                          className={
                            row.ym === selectedMonth ? "bg-muted/60" : "cursor-pointer hover:bg-muted/40"
                          }
                          onClick={() => handlePickMonth(row.ym)}
                        >
                          <TableCell className="font-medium">
                            {formatMonthShort(row.ym)} {row.ym.slice(0, 4)}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {row.total > 0 ? formatCurrency(row.total, currency) : t("dashboard.noMonthData")}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {row.count > 0 ? row.count : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">—</p>
            )}
          </ChartCard>

          <ChartCard title={t("dashboard.annualByCategory")}>
            {yearTrendsLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-[248px] w-full rounded-md" />
                ))}
              </div>
            ) : (categoryMonthlyRows?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground flex h-[120px] items-center justify-center text-sm">—</p>
            ) : (
              <div className="space-y-6">
                <div>
                  <h3 className="text-muted-foreground mb-2 text-sm font-medium">
                    {t("dashboard.categoryCarouselHeading")}
                  </h3>
                  <CategoryYearCarousel
                    rows={categoryMonthlyRows ?? []}
                    monthLabels={yearTrends?.months ?? []}
                    currency={currency}
                    currencySymbol={currencySymbol}
                    onPanelClick={setCategoryDrilldownRow}
                  />
                </div>
                <CategoryYearDrilldownDialog
                  open={categoryDrilldownRow != null}
                  onOpenChange={(open) => {
                    if (!open) setCategoryDrilldownRow(null)
                  }}
                  merchantsScope={
                    isTrailing12
                      ? { trailingCalendarMonths: 12 }
                      : { year: selectedCalendarYear! }
                  }
                  periodLabel={
                    isTrailing12
                      ? t("dashboard.trailing12Months")
                      : String(selectedCalendarYear)
                  }
                  categoryId={categoryDrilldownRow?.category_id ?? null}
                  categoryName={categoryDrilldownRow?.category_name ?? ""}
                  currency={currency}
                  currencySymbol={currencySymbol}
                />
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="bg-background sticky start-0 z-10 min-w-[9rem] shadow-[2px_0_4px_-2px_hsl(var(--border))]">
                          {t("dashboard.categoryYearTableCategory")}
                        </TableHead>
                        {(yearTrends?.months ?? []).map((ym) => (
                          <TableHead
                            key={ym}
                            className="min-w-[4.5rem] text-end text-xs font-normal whitespace-nowrap"
                          >
                            {formatMonthShort(ym)}
                          </TableHead>
                        ))}
                        <TableHead className="min-w-[5.5rem] text-end">
                          {t("dashboard.categoryYearTableTotal")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(categoryMonthlyRows ?? []).map((row) => (
                        <TableRow key={categoryRowSelectValue(row)}>
                          <TableCell className="bg-background sticky start-0 z-10 font-medium shadow-[2px_0_4px_-2px_hsl(var(--border))]">
                            {row.category_name}
                          </TableCell>
                          {row.amounts.map((amt, i) => (
                            <TableCell
                              key={yearTrends?.months[i] ?? i}
                              className="text-end tabular-nums text-sm"
                            >
                              {amt > 0 ? formatCurrency(amt, currency) : "—"}
                            </TableCell>
                          ))}
                          <TableCell className="text-end tabular-nums font-medium">
                            {formatCurrency(row.year_total, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </ChartCard>

          <div id="month-detail" className="scroll-mt-6 space-y-4 border-t pt-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold tracking-tight">{t("dashboard.monthDetailHeading")}</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t("dashboard.month")}:</span>
                <Select value={selectedMonth} onValueChange={handlePickMonth}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthsInYear.map((m) => (
                      <SelectItem key={m} value={m}>
                        {formatMonthShort(m)} {m.slice(0, 4)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

          {summaryLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title={t("dashboard.totalSpend")}
                value={formatCurrency(effectiveSummary?.total_spend ?? 0, currency)}
                subtitle={totalSpendSubtitle}
              />
              <StatCard title={t("dashboard.totalTransactions")} value={totalTransactions} />
              <StatCard title={t("dashboard.categoriesCount")} value={categoriesCount} />
              <StatCard title={t("dashboard.needsReviewCount")} value={needsReview?.length ?? 0} />
            </div>
          )}

          <DataQualityCard />

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title={t("charts.byCategory")} className="min-h-[240px] sm:min-h-[220px]">
              {summaryLoading ? (
                <Skeleton className="min-h-[220px] w-full" />
              ) : pieData.length > 0 ? (
                <div className="flex flex-col items-stretch gap-5 sm:flex-row sm:items-start sm:gap-6">
                  <div className="mx-auto h-[200px] w-[200px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={52}
                          outerRadius={88}
                          paddingAngle={2}
                          dataKey="value"
                          nameKey="name"
                          label={false}
                          labelLine={false}
                          stroke="var(--background)"
                          strokeWidth={2}
                          cursor="pointer"
                          onClick={(d: PieSlice) => {
                            if (d?.isOther) return
                            setMonthPieDrill({
                              categoryId: d.categoryId,
                              categoryName: d.name,
                            })
                          }}
                        >
                          {pieData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const p = payload[0].payload as { name: string; value: number }
                            const pct = pieTotal > 0 ? (p.value / pieTotal) * 100 : 0
                            return (
                              <div className="max-w-[min(90vw,280px)] rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                                <p className="break-words font-medium leading-snug">{p.name}</p>
                                <p className="mt-1 tabular-nums text-muted-foreground">
                                  {formatCurrency(p.value, currency)} ({pct.toFixed(1)}%)
                                </p>
                              </div>
                            )
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul
                    className="min-w-0 flex-1 space-y-2.5 text-sm"
                    aria-label={t("charts.byCategory")}
                  >
                    {pieData.map((entry, i) => {
                      const pct = pieTotal > 0 ? (entry.value / pieTotal) * 100 : 0
                      return (
                        <li key={`${entry.name}-${i}`} className="flex gap-2.5">
                          <span
                            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                              <button
                                type="button"
                                className="break-words text-start font-medium leading-snug text-foreground underline-offset-2 hover:underline disabled:no-underline disabled:opacity-100"
                                disabled={entry.isOther}
                                onClick={() => {
                                  if (entry.isOther) return
                                  setMonthPieDrill({
                                    categoryId: entry.categoryId,
                                    categoryName: entry.name,
                                  })
                                }}
                              >
                                {entry.name}
                              </button>
                              <span className="shrink-0 tabular-nums text-muted-foreground sm:text-end">
                                {formatCurrency(entry.value, currency)}
                                <span className="ms-1 text-xs">({pct.toFixed(0)}%)</span>
                              </span>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : (
                <p className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                  —
                </p>
              )}
              {!summaryLoading && pieData.length > 0 ? (
                <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                  {t("dashboard.monthPieSubcategoryClickHint")}
                </p>
              ) : null}
            </ChartCard>

            <ChartCard title={t("charts.byDay")}>
              {summaryLoading ? (
                <Skeleton className="h-[200px] w-full" />
              ) : dailyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dailyData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${currencySymbol}${v}`} />
                    <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0, currency)} />
                    <Bar dataKey="total" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                  —
                </p>
              )}
            </ChartCard>
          </div>
          </div>
          <CardSpendSection />
          <MonthPieSubcategoryDrilldown
            open={monthPieDrill != null}
            onOpenChange={(open) => {
              if (!open) setMonthPieDrill(null)
            }}
            month={selectedMonth}
            categoryId={monthPieDrill?.categoryId ?? null}
            categoryName={monthPieDrill?.categoryName ?? ""}
            currency={currency}
            currencySymbol={currencySymbol}
          />
        </>
      )}
    </div>
  )
}
