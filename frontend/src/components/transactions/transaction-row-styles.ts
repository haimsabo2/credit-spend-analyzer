import { cn } from "@/lib/utils"

export type TransactionRowStyleInput = {
  isAnomaly?: boolean
  categoryConflict?: boolean
  spendPattern?: string | null
}

export function getTransactionRowClassName(input: TransactionRowStyleInput): string {
  const { isAnomaly, categoryConflict, spendPattern } = input
  const pattern = spendPattern ?? "unknown"

  return cn(
    isAnomaly && "border-s-2 border-s-destructive bg-destructive/5",
    !isAnomaly &&
      categoryConflict &&
      "border-s-2 border-s-amber-500/70 bg-amber-500/[0.06] dark:bg-amber-500/10",
    !isAnomaly &&
      !categoryConflict &&
      pattern === "recurring" &&
      "bg-sky-500/[0.07] dark:bg-sky-500/10",
    !isAnomaly &&
      !categoryConflict &&
      pattern === "one_time" &&
      "bg-violet-500/[0.08] dark:bg-violet-500/12",
  )
}

export function getMerchantGroupHeaderClassName(categoryConflict: boolean): string {
  return cn(
    "hover:bg-muted/50",
    categoryConflict
      ? "border-s-2 border-s-amber-500/60 bg-amber-500/[0.08] dark:bg-amber-950/20"
      : "bg-muted/40",
  )
}
