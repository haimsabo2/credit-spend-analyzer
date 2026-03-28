/**
 * Israeli bank exports often encode the billing cycle in the file name (e.g. 11_2025 =
 * charged in November). Statement / spend month is the previous calendar month (October).
 */

function billingCycleToSpendMonth(billingMonth: number, billingYear: number): string {
  const d = new Date(billingYear, billingMonth - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** Parse billing month+year from filename; return spend month YYYY-MM or null. */
export function inferStatementMonthFromFilename(filename: string): string | null {
  const stem = filename.replace(/\.[^.]+$/i, "")

  const triples = [...stem.matchAll(/(\d{1,2})[_.-](\d{1,2})[_.-](\d{4})(?!\d)/g)]
  if (triples.length > 0) {
    const m = triples[triples.length - 1]
    const day = parseInt(m[1], 10)
    const month = parseInt(m[2], 10)
    const year = parseInt(m[3], 10)
    if (month >= 1 && month <= 12 && year >= 1990 && year <= 2100 && day >= 1 && day <= 31) {
      return billingCycleToSpendMonth(month, year)
    }
  }

  const pairs = [...stem.matchAll(/(?:^|[^0-9])(\d{1,2})[_.-](\d{4})(?![0-9])/g)]
  if (pairs.length > 0) {
    const m = pairs[pairs.length - 1]
    const month = parseInt(m[1], 10)
    const year = parseInt(m[2], 10)
    if (month >= 1 && month <= 12 && year >= 1990 && year <= 2100) {
      return billingCycleToSpendMonth(month, year)
    }
  }

  return null
}

/** Single month if all files agree; otherwise first file wins. */
export function inferStatementMonthFromFiles(files: File[]): { month: string | null; conflict: boolean } {
  const months = files.map((f) => inferStatementMonthFromFilename(f.name)).filter((x): x is string => x != null)
  if (months.length === 0) return { month: null, conflict: false }
  const uniq = [...new Set(months)]
  if (uniq.length === 1) return { month: uniq[0], conflict: false }
  return { month: months[0], conflict: true }
}
