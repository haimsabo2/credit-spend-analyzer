import type { ReactNode } from "react"
import { Layer } from "recharts"
import { useXAxis, useYAxis } from "recharts/lib/hooks.js"

export type AnnualSpendMomRow = {
  label: string
  total: number
  momPctChange: number | null
}

type Props = {
  rows: AnnualSpendMomRow[]
  formatPct: (pct: number) => string
}

/**
 * Month-over-month % labels above the spend line, centered between adjacent months.
 * Must render inside ComposedChart / LineChart (uses Recharts axis scales).
 */
export function AnnualSpendMomLabels({ rows, formatPct }: Props) {
  const xAxis = useXAxis(0)
  const yAxis = useYAxis(0)
  if (!xAxis?.scale || !yAxis?.scale || rows.length < 2) return null

  const sx = xAxis.scale
  const sy = yAxis.scale

  const nodes: ReactNode[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const pct = row.momPctChange
    if (pct == null || !Number.isFinite(pct)) continue

    const cxPrev = sx.map(rows[i - 1].label, { position: "middle" })
    const cxCurr = sx.map(row.label, { position: "middle" })
    const yLine = sy.map(row.total)
    if (cxPrev == null || cxCurr == null || yLine == null) continue

    const x = (cxPrev + cxCurr) / 2
    const y = yLine - 12

    const fill =
      pct > 0
        ? "hsl(var(--destructive))"
        : pct < 0
          ? "hsl(142.1 76.2% 36.3%)"
          : "hsl(var(--muted-foreground))"

    nodes.push(
      <text
        key={`${row.label}-${i}`}
        x={x}
        y={y}
        fill={fill}
        fontSize={10}
        textAnchor="middle"
        className="pointer-events-none select-none"
      >
        {formatPct(pct)}
      </text>,
    )
  }

  if (nodes.length === 0) return null
  return <Layer className="recharts-annual-mom-labels">{nodes}</Layer>
}
