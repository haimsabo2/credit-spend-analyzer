import type { UseQueryResult } from "@tanstack/react-query"
import type { SummaryResponse, TrendsResponse } from "@/types/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowUpRight, ArrowDownRight, Equal } from "lucide-react"
import { formatCurrency, formatDelta } from "@/lib/format"
import { useMonthStore } from "@/stores/use-month-store"
import { cn } from "@/lib/utils"

interface Props {
  summary: UseQueryResult<SummaryResponse>
  trends: UseQueryResult<TrendsResponse>
}

interface CategoryDelta {
  name: string
  current: number
  previous: number
  delta: number
}

function computeCategoryDeltas(
  summary: SummaryResponse | undefined,
  trends: TrendsResponse | undefined,
  month: string,
): CategoryDelta[] {
  if (!trends || !summary) return []

  const idx = trends.months.indexOf(month)
  if (idx < 1) return []

  const nameMap = new Map<string, string>()
  for (const cat of summary.spend_by_category) {
    if (cat.category_id != null) {
      nameMap.set(String(cat.category_id), cat.category_name)
    }
  }

  const deltas: CategoryDelta[] = []
  for (const [catId, series] of Object.entries(trends.category_series)) {
    const cur = series[idx] ?? 0
    const prev = series[idx - 1] ?? 0
    const name = nameMap.get(catId) ?? `Category #${catId}`
    deltas.push({ name, current: cur, previous: prev, delta: cur - prev })
  }

  deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return deltas.slice(0, 3)
}

export function MonthComparison({ summary, trends }: Props) {
  const month = useMonthStore((s) => s.month)
  const isLoading = summary.isLoading || trends.isLoading
  const isError = summary.isError || trends.isError

  const deltas = computeCategoryDeltas(summary.data, trends.data, month)

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          This Month vs Last Month
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <p className="py-12 text-center text-sm text-destructive">Failed to load</p>
        ) : deltas.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Not enough data to compare months
          </p>
        ) : (
          <ul className="space-y-4">
            {deltas.map((d) => {
              const isUp = d.delta > 0
              const isDown = d.delta < 0
              return (
                <li key={d.name} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{d.name}</span>
                    <div className="flex items-center gap-1">
                      {isUp ? (
                        <ArrowUpRight className="h-3.5 w-3.5 text-destructive" />
                      ) : isDown ? (
                        <ArrowDownRight className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Equal className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          isUp && "text-destructive",
                          isDown && "text-emerald-600",
                          !isUp && !isDown && "text-muted-foreground",
                        )}
                      >
                        {formatDelta(d.delta)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Now: {formatCurrency(d.current)}</span>
                    <span>Was: {formatCurrency(d.previous)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        isUp ? "bg-destructive/60" : isDown ? "bg-emerald-500/60" : "bg-muted-foreground/30",
                      )}
                      style={{
                        width: `${Math.min(Math.abs(d.delta) / Math.max(d.current, d.previous, 1) * 100, 100)}%`,
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
