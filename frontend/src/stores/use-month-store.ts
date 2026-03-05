import { create } from "zustand"

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

interface MonthStore {
  month: string
  setMonth: (month: string) => void
  prevMonth: () => void
  nextMonth: () => void
}

export const useMonthStore = create<MonthStore>((set) => ({
  month: currentMonth(),
  setMonth: (month) => set({ month }),
  prevMonth: () => set((s) => ({ month: shiftMonth(s.month, -1) })),
  nextMonth: () => set((s) => ({ month: shiftMonth(s.month, 1) })),
}))

export function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(y, m - 1)
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}
