import type { UseQueryResult } from "@tanstack/react-query"
import type { SummaryResponse } from "@/types/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts"
import { formatCurrency, formatPct } from "@/lib/format"

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "#8884d8",
  "#82ca9d",
  "#ffc658",
]

interface Props {
  query: UseQueryResult<SummaryResponse>
}

export function CategoryDonut({ query }: Props) {
  const { data, isLoading, isError } = query
  const categories = data?.spend_by_category ?? []

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Category Mix
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {isLoading ? (
          <div className="flex items-start gap-6">
            <Skeleton className="h-44 w-44 shrink-0 rounded-full" />
            <div className="flex-1 space-y-3 pt-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          </div>
        ) : isError ? (
          <p className="py-12 text-center text-sm text-destructive">Failed to load</p>
        ) : categories.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No category data
          </p>
        ) : (
          <div className="flex items-start gap-6">
            <div className="w-44 shrink-0">
              <ResponsiveContainer width="100%" height={176}>
                <PieChart>
                  <Pie
                    data={categories}
                    dataKey="amount"
                    nameKey="category_name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {categories.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            <ul className="flex-1 space-y-2.5 pt-1">
              {categories.slice(0, 6).map((cat, i) => (
                <li key={cat.category_name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: COLORS[i % COLORS.length] }}
                      />
                      <span className="truncate text-foreground">
                        {cat.category_name}
                      </span>
                    </div>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatCurrency(cat.amount)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${cat.pct}%`,
                        background: COLORS[i % COLORS.length],
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatPct(cat.pct, false)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
