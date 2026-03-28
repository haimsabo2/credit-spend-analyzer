/** Previous calendar month as YYYY-MM, or null if invalid. */
export function priorMonth(month: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const [y, m] = month.split("-").map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
