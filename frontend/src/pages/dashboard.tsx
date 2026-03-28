import { useMemo } from "react"
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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { Upload } from "lucide-react"
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
import type { SummaryResponse } from "@/api/types"
import { ApiError } from "@/api/client"
import { getSummary } from "@/api/insights"
import { getTrends } from "@/api/insights"
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

function last12Months(): string[] {
  const now = new Date()
  const months: string[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }
  return months
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

export default function DashboardPage() {
  const { t } = useTranslation()
  const months = useMemo(() => last12Months(), [])

  const { month: storeMonth, setMonth: setStoreMonth } = useMonthStore()
  const selectedMonth = storeMonth

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

  const { data: trends } = useQuery({
    queryKey: ["trends", 6],
    queryFn: () => getTrends(6),
  })

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

  const pieData = useMemo(() => {
    if (!effectiveSummary?.spend_by_category) return []
    const cats = effectiveSummary.spend_by_category.filter((c) => c.amount > 0)
    const top = cats.slice(0, TOP_CATEGORIES)
    const rest = cats.slice(TOP_CATEGORIES)
    const restAmount = rest.reduce((s, c) => s + c.amount, 0)
    const result = top.map((c) => ({ name: c.category_name, value: c.amount }))
    if (restAmount > 0) {
      result.push({ name: t("charts.other"), value: restAmount })
    }
    return result
  }, [effectiveSummary, t])

  const trendData = useMemo(() => {
    if (!trends?.months?.length) return []
    return trends.months.map((m, i) => ({
      month: formatMonthShort(m),
      total: trends.total_spend_series[i] ?? 0,
    }))
  }, [trends])

  const categoriesCount = effectiveSummary?.spend_by_category?.filter((c) => c.amount > 0).length ?? 0
  const totalTransactions = transactions?.length ?? 0
  const hasData =
    (effectiveSummary?.total_spend ?? 0) > 0 || (transactions?.length ?? 0) > 0

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("dashboard.month")}:</span>
          <Select value={selectedMonth} onValueChange={setStoreMonth}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m} value={m}>
                  {formatMonthShort(m)} {m.slice(0, 4)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!hasData && !summaryLoading ? (
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

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title={t("charts.byCategory")}>
              {summaryLoading ? (
                <Skeleton className="h-[200px] w-full" />
              ) : pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0, currency)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                  —
                </p>
              )}
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

          <ChartCard title={t("charts.trend6m")}>
            {!trends ? (
              <Skeleton className="h-[200px] w-full" />
            ) : trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${currencySymbol}${v}`} />
                  <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0, currency)} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                —
              </p>
            )}
          </ChartCard>
        </>
      )}
    </div>
  )
}
