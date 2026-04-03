import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { CategoryMonthlyRow } from "@/api/types"
import { formatCompact, formatCurrency, formatMonthShort } from "@/utils/format"

export function computeCategoryYearSharedYMax(rows: CategoryMonthlyRow[]): number {
  let max = 0
  for (const r of rows) {
    for (const a of r.amounts) {
      if (a > max) max = a
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

/** Per-category hue; lightness shifts across months (small-multiples style). */
function monthBarColor(categoryIndex: number, monthIndex: number, n: number): string {
  const hue = (categoryIndex * 47) % 360
  const t = n <= 1 ? 0 : monthIndex / (n - 1)
  const light = 58 - t * 22
  return `hsl(${hue} 52% ${Math.max(30, light)}%)`
}

function rowKey(row: CategoryMonthlyRow): string {
  return row.category_id == null ? "__uncat__" : String(row.category_id)
}

export interface CategoryYearSmallMultiplesProps {
  rows: CategoryMonthlyRow[]
  monthLabels: string[]
  currency: string
  currencySymbol: string
  /** When set, all panels use this Y-axis max (e.g. from full category list). */
  sharedYMax?: number
  onPanelClick?: (row: CategoryMonthlyRow) => void
  /** `carousel`: one column on narrow screens, three on sm+ */
  layout?: "grid" | "carousel"
}

export function CategoryYearSmallMultiples({
  rows,
  monthLabels,
  currency,
  currencySymbol,
  sharedYMax: sharedYMaxProp,
  onPanelClick,
  layout = "grid",
}: CategoryYearSmallMultiplesProps) {
  const yMax = useMemo(
    () => (sharedYMaxProp != null ? sharedYMaxProp : computeCategoryYearSharedYMax(rows)),
    [rows, sharedYMaxProp],
  )
  const n = monthLabels.length

  const gridClass =
    layout === "carousel"
      ? "grid grid-cols-1 gap-4 sm:grid-cols-3"
      : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"

  return (
    <div className={gridClass}>
      {rows.map((row, catIndex) => {
        const data = monthLabels.map((ym, i) => ({
          label: formatMonthShort(ym),
          value: row.amounts[i] ?? 0,
        }))
        const interactive = Boolean(onPanelClick)
        return (
          <div
            key={rowKey(row)}
            className={`rounded-md bg-muted/25 px-2 pb-2 pt-3 ${
              interactive ? "cursor-pointer transition-colors hover:bg-muted/40" : ""
            }`}
            role={interactive ? "button" : "figure"}
            tabIndex={interactive ? 0 : undefined}
            aria-label={row.category_name}
            onClick={interactive ? () => onPanelClick?.(row) : undefined}
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onPanelClick?.(row)
                    }
                  }
                : undefined
            }
          >
            <p className="mb-1 truncate px-1 text-xs font-semibold text-foreground">
              {row.category_name}
            </p>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 22, right: 4, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9 }}
                    interval={0}
                    angle={-40}
                    textAnchor="end"
                    height={44}
                  />
                  <YAxis
                    domain={[0, yMax]}
                    tick={{ fontSize: 9 }}
                    width={36}
                    tickFormatter={(v) => `${currencySymbol}${v}`}
                  />
                  <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0, currency)} />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={28}>
                    {data.map((_, i) => (
                      <Cell key={i} fill={monthBarColor(catIndex, i, n)} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="top"
                      className="hidden fill-foreground text-[9px] tabular-nums sm:block"
                      formatter={(label) => {
                        const num =
                          typeof label === "number"
                            ? label
                            : typeof label === "string"
                              ? Number(label)
                              : Number.NaN
                        return Number.isFinite(num) && num > 0 ? formatCompact(num) : ""
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}
    </div>
  )
}
