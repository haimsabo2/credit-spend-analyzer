import { useState } from "react"
import { useNavigate } from "react-router-dom"
import type { UseQueryResult } from "@tanstack/react-query"
import type { AnomalyItem } from "@/types/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, ArrowUpRight, CheckCircle2 } from "lucide-react"
import { formatCurrency, formatPct } from "@/lib/format"
import { useMonthStore } from "@/stores/use-month-store"
import { cn } from "@/lib/utils"

type FilterType = "all" | "category" | "merchant"

interface Props {
  query: UseQueryResult<AnomalyItem[]>
}

export function AnomalyPanel({ query }: Props) {
  const { data, isLoading, isError } = query
  const [filter, setFilter] = useState<FilterType>("all")
  const month = useMonthStore((s) => s.month)
  const navigate = useNavigate()

  const anomalies = (data ?? []).filter(
    (a) => filter === "all" || a.type === filter,
  )

  function handleClick(a: AnomalyItem) {
    const params = new URLSearchParams({ month, q: a.name })
    navigate(`/transactions?${params.toString()}`)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Anomalies
        </CardTitle>
        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="py-8 text-center text-sm text-destructive">
            Failed to load anomalies
          </p>
        ) : !data?.length ? (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <CheckCircle2 className="h-8 w-8" />
            <p className="text-sm">No unusual spending detected this month</p>
          </div>
        ) : (
          <>
            <div className="flex gap-1">
              {(["all", "category", "merchant"] as const).map((t) => (
                <Button
                  key={t}
                  variant={filter === t ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 text-xs capitalize"
                  onClick={() => setFilter(t)}
                >
                  {t === "all" ? "All" : `${t}s`}
                </Button>
              ))}
              {data.length > 0 && (
                <Badge variant="secondary" className="ml-auto text-xs">
                  {anomalies.length}
                </Badge>
              )}
            </div>

            {anomalies.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No {filter} anomalies
              </p>
            ) : (
              <ul className="space-y-1">
                {anomalies.map((a) => (
                  <li
                    key={`${a.type}-${a.name}`}
                    className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent"
                    onClick={() => handleClick(a)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && handleClick(a)}
                  >
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {a.name}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 text-[10px] capitalize",
                            a.type === "category"
                              ? "border-chart-3 text-chart-3"
                              : "border-chart-2 text-chart-2",
                          )}
                        >
                          {a.type}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(a.baseline)} baseline
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-destructive">
                        {formatCurrency(a.current)}
                      </p>
                      {a.pct > 0 && (
                        <p className="text-xs tabular-nums text-destructive/80">
                          {formatPct(a.pct)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
