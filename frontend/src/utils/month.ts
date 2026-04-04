import type { UploadRead } from "@/types/api"

/** Distinct statement months (YYYY-MM) that have at least one imported transaction, newest first. */
export function monthsWithDataFromUploads(uploads: UploadRead[]): string[] {
  const seen = new Set<string>()
  for (const u of uploads) {
    if (u.num_transactions > 0) seen.add(u.month)
  }
  return [...seen].sort((a, b) => b.localeCompare(a))
}

/** Recent calendar months as YYYY-MM, newest first (for dropdowns). */
export function recentMonths(count: number): string[] {
  const now = new Date()
  const months: string[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }
  return months
}

/** Previous calendar month as YYYY-MM, or null if invalid. */
export function priorMonth(month: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const [y, m] = month.split("-").map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
