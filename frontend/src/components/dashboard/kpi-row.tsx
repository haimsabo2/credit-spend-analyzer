import type { UseQueryResult } from "@tanstack/react-query"
import type { SummaryResponse, TrendsResponse, ForecastResponse } from "@/types/api"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DollarSign, TrendingDown, TrendingUp, Target, Crown } from "lucide-react"
import { formatCurrency, formatDelta, formatPct } from "@/lib/format"
import { useMonthStore } from "@/stores/use-month-store"
import { cn } from "@/lib/utils"

interface Props {
  summary: UseQueryResult<SummaryResponse>
  trends: UseQueryResult<TrendsResponse>
  forecast: UseQueryResult<ForecastResponse>
}

function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-4 rounded" />
        </div>
        <Skeleton className="mt-3 h-8 w-28" />
        <Skeleton className="mt-2 h-4 w-16" />
      </CardContent>
    </Card>
  )
}

interface KpiCardProps {
  label: string
  value: string
  subtitle?: string
  icon: React.ReactNode
  delta?: { amount: number; pct: number } | null
}

function KpiCard({ label, value, subtitle, icon, delta }: KpiCardProps) {
  const isUp = delta && delta.amount > 0
  const isDown = delta && delta.amount < 0

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
        {delta ? (
          <div className="mt-1 flex items-center gap-1">
            {isUp ? (
              <TrendingUp className="h-3.5 w-3.5 text-destructive" />
            ) : isDown ? (
              <TrendingDown className="h-3.5 w-3.5 text-emerald-600" />
            ) : null}
            <span
              className={cn(
                "text-xs font-medium",
                isUp && "text-destructive",
                isDown && "text-emerald-600",
                !isUp && !isDown && "text-muted-foreground",
              )}
            >
              {formatDelta(delta.amount)} ({formatPct(delta.pct)})
            </span>
          </div>
        ) : subtitle ? (
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function KpiRow({ summary, trends, forecast }: Props) {
  const month = useMonthStore((s) => s.month)
  const anyLoading = summary.isLoading || trends.isLoading || forecast.isLoading

  if (anyLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
    )
  }

  const totalSpend = summary.data?.total_spend ?? 0

  let momDelta: { amount: number; pct: number } | null = null
  if (trends.data) {
    const idx = trends.data.months.indexOf(month)
    if (idx > 0) {
      const cur = trends.data.total_spend_series[idx]
      const prev = trends.data.total_spend_series[idx - 1]
      momDelta = {
        amount: cur - prev,
        pct: prev !== 0 ? ((cur - prev) / prev) * 100 : 0,
      }
    }
  }

  const forecastTotal = forecast.data?.total_forecast ?? 0

  const topCat = summary.data?.spend_by_category?.[0]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Total Spend"
        value={formatCurrency(totalSpend)}
        icon={<DollarSign className="h-4 w-4" />}
        subtitle="This month"
      />
      <KpiCard
        label="vs Last Month"
        value={momDelta ? formatDelta(momDelta.amount) : "--"}
        icon={
          momDelta && momDelta.amount > 0 ? (
            <TrendingUp className="h-4 w-4" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          )
        }
        delta={momDelta}
      />
      <KpiCard
        label="Forecast"
        value={formatCurrency(forecastTotal)}
        icon={<Target className="h-4 w-4" />}
        subtitle="Predicted next month"
      />
      <KpiCard
        label="Top Category"
        value={topCat ? topCat.category_name : "--"}
        icon={<Crown className="h-4 w-4" />}
        subtitle={topCat ? formatCurrency(topCat.amount) : undefined}
      />
    </div>
  )
}
