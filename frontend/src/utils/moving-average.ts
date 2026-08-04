/** Round to nearest 100 (e.g. 7598 → 7600). */
export function roundToHundreds(amount: number): number {
  return Math.round(amount / 100) * 100
}

/** Count fiscal-window months that have upload/spend data. */
export function countMonthsWithData(totalSpendByMonth: number[]): number {
  return totalSpendByMonth.filter((total) => total > 0).length
}

/** Mean monthly spend = year total ÷ months with data in the period. */
export function categoryPeriodAverage(yearTotal: number, monthsWithData: number): number | null {
  if (monthsWithData <= 0 || yearTotal <= 0) return null
  return yearTotal / monthsWithData
}

/** Percent above (+) or below (−) the period average. */
export function pctVsAverage(current: number, average: number): number | null {
  if (average <= 0) return null
  return ((current - average) / average) * 100
}

export function formatPctVsAverage(pct: number): string {
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(1)}%`
}

/** Green when below average (lower spend), red when above; stronger tint for larger deviation. */
export function deviationFromAverageColorClass(pct: number): string {
  const abs = Math.abs(pct)
  const isBelow = pct < 0

  if (abs >= 25) {
    return isBelow
      ? "text-emerald-700 dark:text-emerald-300 font-semibold"
      : "text-red-700 dark:text-red-300 font-semibold"
  }
  if (abs >= 15) {
    return isBelow
      ? "text-emerald-600 dark:text-emerald-400 font-medium"
      : "text-red-600 dark:text-red-400 font-medium"
  }
  if (abs >= 5) {
    return isBelow
      ? "text-emerald-600/90 dark:text-emerald-500"
      : "text-red-600/90 dark:text-red-500"
  }
  return isBelow
    ? "text-emerald-600/70 dark:text-emerald-500/80"
    : "text-red-600/70 dark:text-red-500/80"
}

export function computeVsPeriodAverage(
  current: number,
  yearTotal: number,
  monthsWithData: number,
): { average: number; pct: number } | null {
  if (current <= 0) return null
  const average = categoryPeriodAverage(yearTotal, monthsWithData)
  if (average == null || average <= 0) return null
  const pct = pctVsAverage(current, average)
  if (pct == null) return null
  return { average, pct }
}
