import type { TransactionRead } from "@/types/api"

/** Matches backend `normalize_merchant_pattern_key` (lower(trim(description))). */
export function normalizeMerchantPatternKey(description: string): string {
  return (description ?? "").trim().toLowerCase()
}

export type MerchantTxnGroup = {
  patternKey: string
  displayDescription: string
  transactions: TransactionRead[]
  /** Same heuristic as API: MAX(id) representative */
  representative: TransactionRead
  totalAmount: number
}

/** Group by normalized description; sort groups by max posted_at desc then pattern key. */
export function groupTransactionsByMerchantKey(transactions: TransactionRead[]): MerchantTxnGroup[] {
  const map = new Map<string, TransactionRead[]>()
  for (const t of transactions) {
    const k = normalizeMerchantPatternKey(t.description)
    const list = map.get(k)
    if (list) list.push(t)
    else map.set(k, [t])
  }

  const groups: MerchantTxnGroup[] = []
  for (const [patternKey, txns] of map) {
    const representative = txns.reduce((a, b) => (a.id >= b.id ? a : b))
    const totalAmount = txns.reduce((s, x) => s + x.amount, 0)
    groups.push({
      patternKey,
      displayDescription: representative.description,
      transactions: txns,
      representative,
      totalAmount,
    })
  }

  groups.sort((a, b) => {
    const da = maxPostedAtMs(a.transactions)
    const db = maxPostedAtMs(b.transactions)
    if (db !== da) return db - da
    return a.patternKey.localeCompare(b.patternKey)
  })
  return groups
}

function maxPostedAtMs(txns: TransactionRead[]): number {
  let m = 0
  for (const t of txns) {
    if (!t.posted_at) continue
    const ms = Date.parse(t.posted_at)
    if (Number.isFinite(ms) && ms > m) m = ms
  }
  return m
}
