import type { UseQueryResult } from "@tanstack/react-query"
import type { TrendsResponse } from "@/types/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import { formatCurrency, formatMonthShort, formatCompact } from "@/lib/format"
import { useMonthStore } from "@/stores/use-month-store"

interface Props {
  query: UseQueryResult<TrendsResponse>
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length || !label) return null
  const [y, m] = label.split("-").map(Number)
  const d = new Date(y, m - 1)
  const monthLabel = d.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{monthLabel}</p>
      <p className="tabular-nums text-muted-foreground">{formatCurrency(payload[0].value)}</p>
    </div>
  )
}

export function TrendsChart({ query }: Props) {
  const { data, isLoading, isError } = query
  const month = useMonthStore((s) => s.month)

  const chartData = (data?.months ?? []).map((m, i) => ({
    month: m,
    total: data?.total_spend_series[i] ?? 0,
    label: formatMonthShort(m),
  }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Monthly Spend
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : isError ? (
          <p className="py-12 text-center text-sm text-destructive">
            Failed to load trend data
          </p>
        ) : chartData.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No trend data available
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} barCategoryGap="20%">
              <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                className="fill-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                className="fill-muted-foreground"
                tickFormatter={(v: number) => formatCompact(v)}
                width={48}
              />
              <RechartsTooltip
                content={<CustomTooltip />}
                cursor={{ fill: "var(--color-accent)", opacity: 0.4 }}
              />
              <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell
                    key={entry.month}
                    fill={
                      entry.month === month
                        ? "var(--color-chart-1)"
                        : "var(--color-chart-2)"
                    }
                    opacity={entry.month === month ? 1 : 0.6}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
