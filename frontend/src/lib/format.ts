const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function formatCurrency(amount: number): string {
  return currencyFmt.format(amount)
}

export function formatPct(pct: number, signed = true): string {
  const prefix = signed && pct > 0 ? "+" : ""
  return `${prefix}${pct.toFixed(1)}%`
}

export function formatDelta(amount: number): string {
  const prefix = amount > 0 ? "+" : ""
  return `${prefix}${currencyFmt.format(amount)}`
}

export function formatCompact(amount: number): string {
  if (Math.abs(amount) >= 1000) {
    return `${(amount / 1000).toFixed(1)}k`
  }
  return amount.toFixed(0)
}

export function formatMonthShort(month: string): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(y, m - 1)
  return d.toLocaleDateString("en-US", { month: "short" })
}
