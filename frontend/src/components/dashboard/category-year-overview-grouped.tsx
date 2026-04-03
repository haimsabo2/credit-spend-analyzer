import { useMemo } from "react"
import { useTranslation } from "react-i18next"
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
import type { CategoryMonthlyRow } from "@/api/types"
import { formatCurrency, formatMonthShort } from "@/utils/format"

const MONTH_BAR_COLORS = [
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
]

function buildChartData(
  slice: CategoryMonthlyRow[],
  monthLabels: string[],
): Record<string, string | number>[] {
  return slice.map((row) => {
    const point: Record<string, string | number> = {
      categoryName: row.category_name,
    }
    for (let i = 0; i < monthLabels.length; i++) {
      point[monthLabels[i]] = row.amounts[i] ?? 0
    }
    return point
  })
}

function computeYMax(rows: CategoryMonthlyRow[], monthLabels: string[]): number {
  let max = 0
  for (const row of rows) {
    for (let i = 0; i < monthLabels.length; i++) {
      const v = row.amounts[i] ?? 0
      if (v > max) max = v
    }
  }
  if (max <= 0) return 1
  const padded = max * 1.08
  const magnitude = 10 ** Math.floor(Math.log10(padded))
  const normalized = padded / magnitude
  const nice =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * magnitude
}

interface PanelProps {
  chartData: Record<string, string | number>[]
  monthLabels: string[]
  currency: string
  currencySymbol: string
  yMax: number
  showLegend: boolean
  showYAxisLabel: boolean
}

function GroupedBarPanel({
  chartData,
  monthLabels,
  currency,
  currencySymbol,
  yMax,
  showLegend,
  showYAxisLabel,
}: PanelProps) {
  const { t } = useTranslation()
  const rowCount = chartData.length
  const minChartWidth = Math.max(400, 48 + rowCount * 56)

  return (
    <div className="w-full overflow-x-auto pb-2">
      <div style={{ minWidth: minChartWidth, height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 72 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal vertical={false} />
            <XAxis
              dataKey="categoryName"
              tick={{ fontSize: 10 }}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={68}
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fontSize: 10 }}
              width={44}
              tickFormatter={(v) => `${currencySymbol}${v}`}
              label={
                showYAxisLabel
                  ? {
                      value: t("dashboard.categoryYearOverviewYAxis"),
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                    }
                  : undefined
              }
            />
            <Tooltip
              formatter={(value: number | undefined) => formatCurrency(value ?? 0, currency)}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload as { categoryName?: string } | undefined
                return p?.categoryName ?? ""
              }}
            />
            {showLegend ? (
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value) => formatMonthShort(String(value))}
              />
            ) : null}
            {monthLabels.map((ym, i) => (
              <Bar
                key={ym}
                dataKey={ym}
                name={ym}
                fill={MONTH_BAR_COLORS[i % MONTH_BAR_COLORS.length]}
                radius={[2, 2, 0, 0]}
                maxBarSize={14}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export interface CategoryYearOverviewGroupedProps {
  rows: CategoryMonthlyRow[]
  monthLabels: string[]
  currency: string
  currencySymbol: string
}

export function CategoryYearOverviewGrouped({
  rows,
  monthLabels,
  currency,
  currencySymbol,
}: CategoryYearOverviewGroupedProps) {
  const { firstData, secondData, yMax } = useMemo(() => {
    const yMaxVal = computeYMax(rows, monthLabels)
    if (rows.length === 0) {
      return {
        firstData: [] as Record<string, string | number>[],
        secondData: [] as Record<string, string | number>[],
        yMax: yMaxVal,
      }
    }
    const splitAt = Math.ceil(rows.length / 2)
    return {
      firstData: buildChartData(rows.slice(0, splitAt), monthLabels),
      secondData: buildChartData(rows.slice(splitAt), monthLabels),
      yMax: yMaxVal,
    }
  }, [rows, monthLabels])

  if (rows.length === 0) {
    return null
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {firstData.length > 0 && (
        <GroupedBarPanel
          chartData={firstData}
          monthLabels={monthLabels}
          currency={currency}
          currencySymbol={currencySymbol}
          yMax={yMax}
          showLegend
          showYAxisLabel
        />
      )}
      {secondData.length > 0 && (
        <GroupedBarPanel
          chartData={secondData}
          monthLabels={monthLabels}
          currency={currency}
          currencySymbol={currencySymbol}
          yMax={yMax}
          showLegend={false}
          showYAxisLabel={firstData.length === 0}
        />
      )}
    </div>
  )
}
