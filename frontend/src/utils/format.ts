import i18n from "i18next"

const locale = () => (i18n.language === "he" ? "he-IL" : "en-US")

const SYMBOL_TO_CODE: Record<string, string> = {
  "₪": "ILS",
  "ILS": "ILS",
  "$": "USD",
  "USD": "USD",
  "€": "EUR",
  "EUR": "EUR",
}

export function formatCurrency(amount: number, currency = "ILS"): string {
  const code = SYMBOL_TO_CODE[currency] ?? (currency?.length === 3 ? currency : "ILS")
  return new Intl.NumberFormat(locale(), {
    style: "currency",
    currency: code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatPct(pct: number, signed = true): string {
  const prefix = signed && pct > 0 ? "+" : ""
  return `${prefix}${pct.toFixed(1)}%`
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
  return d.toLocaleDateString(locale(), { month: "short" })
}

export function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(y, m - 1)
  return d.toLocaleDateString(locale(), { month: "long", year: "numeric" })
}

export function formatDayOfMonth(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString(locale(), { day: "numeric" })
}
