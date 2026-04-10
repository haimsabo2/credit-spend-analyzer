import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CreditCard } from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { api } from "@/lib/api-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatMonthShort } from "@/utils/format"
import { useState } from "react"

interface CardTrendPoint {
  month: string
  amount: number
}

interface CategorySpendSlice {
  category_id: number | null
  category_name: string
  amount: number
  pct: number
}

interface CardTrendResponse {
  card_label: string
  total_amount: number
  transaction_count: number
  monthly_trend: CardTrendPoint[]
  top_categories: CategorySpendSlice[]
}

const CATEGORY_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "oklch(0.55 0.2 250)",
  "oklch(0.6 0.18 300)",
  "oklch(0.65 0.2 20)",
]

function useCardTrends(trailingMonths: number) {
  return useQuery({
    queryKey: ["card-trends", trailingMonths],
    queryFn: () =>
      api.get<CardTrendResponse[]>("/api/insights/card-trends", {
        trailing_months: trailingMonths,
      }),
  })
}

export function CardSpendSection() {
  const { t } = useTranslation()
  const [window, setWindow] = useState("12")
  const trailing = parseInt(window, 10)
  const { data, isLoading } = useCardTrends(trailing)

  if (isLoading) {
    return <Skeleton className="h-[300px] w-full" />
  }

  if (!data || data.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <CreditCard className="h-5 w-5 text-muted-foreground" />
          {t("cardTrends.title")}
        </h2>
        <Select value={window} onValueChange={setWindow}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="6">{t("cardTrends.last6")}</SelectItem>
            <SelectItem value="12">{t("cardTrends.last12")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((card) => (
          <Card key={card.card_label}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="truncate">{card.card_label}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="text-[10px] tabular-nums">
                    {card.transaction_count} {t("cardTrends.transactions")}
                  </Badge>
                  <span className="text-base font-bold tabular-nums">
                    {formatCurrency(card.total_amount)}
                  </span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {t("cardTrends.monthlyTrend")}
                </p>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart
                    data={card.monthly_trend.map((p) => ({
                      label: formatMonthShort(p.month),
                      amount: p.amount,
                    }))}
                    margin={{ top: 4, right: 4, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={0} />
                    <YAxis hide />
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v)}
                      contentStyle={{ fontSize: 11 }}
                    />
                    <Bar dataKey="amount" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {card.top_categories.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {t("cardTrends.topCategories")}
                  </p>
                  <div className="space-y-1.5">
                    {card.top_categories.slice(0, 5).map((cat, i) => (
                      <div key={cat.category_name} className="flex items-center gap-2 text-xs">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{cat.category_name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatCurrency(cat.amount)}{" "}
                          <span className="text-[10px]">({cat.pct}%)</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
