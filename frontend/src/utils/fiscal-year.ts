/** Household fiscal year starts in July (Jul through following June). */
export const FISCAL_START_MONTH = 7

/** Fiscal start years offered in the dashboard period selector. */
export const FISCAL_YEAR_FIRST = 2023
export const FISCAL_YEAR_LAST = 2026

/** Default overview when opening the dashboard (7/2025–6/2026). */
export const DEFAULT_FISCAL_START_YEAR = 2025

/** Select value prefix for fiscal-year periods in the dashboard. */
export const PERIOD_FISCAL_PREFIX = "__fy__"

export const PERIOD_TRAILING12 = "__trailing12__"

export function monthsInclusiveRange(firstYm: string, lastYm: string): string[] {
  const y1 = parseInt(firstYm.slice(0, 4), 10)
  const m1 = parseInt(firstYm.slice(5, 7), 10)
  const y2 = parseInt(lastYm.slice(0, 4), 10)
  const m2 = parseInt(lastYm.slice(5, 7), 10)
  const out: string[] = []
  let y = y1
  let m = m1
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/** Calendar year in which the fiscal year starts (Jul of startYear → Jun of startYear+1). */
export function fiscalYearStartYearForDate(
  d = new Date(),
  startMonth = FISCAL_START_MONTH,
): number {
  const month = d.getMonth() + 1
  const year = d.getFullYear()
  return month >= startMonth ? year : year - 1
}

/** Fiscal start year for a statement month YYYY-MM. */
export function fiscalYearStartYearForMonth(
  month: string,
  startMonth = FISCAL_START_MONTH,
): number {
  const y = parseInt(month.slice(0, 4), 10)
  const m = parseInt(month.slice(5, 7), 10)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return fiscalYearStartYearForDate()
  return m >= startMonth ? y : y - 1
}

/** All YYYY-MM labels from fiscal start through end (inclusive). */
export function fiscalYearMonths(
  startYear: number,
  startMonth = FISCAL_START_MONTH,
): string[] {
  const from = `${startYear}-${String(startMonth).padStart(2, "0")}`
  const endYear = startMonth === 1 ? startYear : startYear + 1
  const endMonth = startMonth === 1 ? 12 : startMonth - 1
  const to = `${endYear}-${String(endMonth).padStart(2, "0")}`
  return monthsInclusiveRange(from, to)
}

/** Human label e.g. 7/2025–6/2026 */
export function formatFiscalYearLabel(
  startYear: number,
  startMonth = FISCAL_START_MONTH,
): string {
  const months = fiscalYearMonths(startYear, startMonth)
  const from = months[0]!
  const to = months[months.length - 1]!
  const fm1 = parseInt(from.slice(5, 7), 10)
  const fy1 = parseInt(from.slice(0, 4), 10)
  const fm2 = parseInt(to.slice(5, 7), 10)
  const fy2 = parseInt(to.slice(0, 4), 10)
  return `${fm1}/${fy1}–${fm2}/${fy2}`
}

export function fiscalPeriodSelectValue(startYear: number): string {
  return `${PERIOD_FISCAL_PREFIX}${startYear}`
}

export function parseFiscalPeriodSelectValue(value: string): number | null {
  if (!value.startsWith(PERIOD_FISCAL_PREFIX)) return null
  const y = parseInt(value.slice(PERIOD_FISCAL_PREFIX.length), 10)
  return Number.isFinite(y) ? y : null
}

export function fiscalYearSelectOptions(): number[] {
  const out: number[] = []
  for (let y = FISCAL_YEAR_LAST; y >= FISCAL_YEAR_FIRST; y--) out.push(y)
  return out
}

export function clampFiscalStartYear(startYear: number): number {
  return Math.min(FISCAL_YEAR_LAST, Math.max(FISCAL_YEAR_FIRST, startYear))
}

/** Last month in a fiscal year (June) — sensible default for month detail. */
export function defaultFiscalDetailMonth(
  startYear: number = DEFAULT_FISCAL_START_YEAR,
  startMonth = FISCAL_START_MONTH,
): string {
  const months = fiscalYearMonths(startYear, startMonth)
  return months[months.length - 1]!
}

export function monthInFiscalYear(
  month: string,
  fiscalStartYear: number,
  startMonth = FISCAL_START_MONTH,
): boolean {
  return fiscalYearMonths(fiscalStartYear, startMonth).includes(month)
}
