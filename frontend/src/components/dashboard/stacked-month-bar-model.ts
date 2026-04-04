import type { CategoryYearMerchantsResponse } from "@/api/types"
import { formatMonthShort } from "@/utils/format"

/** Build Recharts-friendly rows + stack keys from category-year merchants/subcategories API. */
export function stackedBarModelFromSeriesResponse(
  data: CategoryYearMerchantsResponse | undefined,
): {
  chartRows: Record<string, string | number>[]
  keys: string[]
  seriesLabels: string[]
  yMax: number
} {
  if (!data?.merchants?.length || !data.months.length) {
    return { chartRows: [], keys: [], seriesLabels: [], yMax: 1 }
  }
  const merchants = data.merchants
  const safeKeys = merchants.map((_, i) => `s_${i}`)
  const rows = data.months.map((ym, mi) => {
    const row: Record<string, string | number> = {
      label: formatMonthShort(ym),
      ym,
    }
    let sum = 0
    merchants.forEach((m, i) => {
      const v = m.amounts[mi] ?? 0
      row[safeKeys[i]] = v
      sum += v
    })
    row._total = sum
    return row
  })
  let maxMonth = 0
  for (const row of rows) {
    const tot = Number(row._total)
    if (tot > maxMonth) maxMonth = tot
  }
  let yMax = 1
  if (maxMonth > 0) {
    const padded = maxMonth * 1.08
    const magnitude = 10 ** Math.floor(Math.log10(padded))
    const normalized = padded / magnitude
    const nice =
      normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
    yMax = nice * magnitude
  }
  return {
    chartRows: rows,
    keys: safeKeys,
    seriesLabels: merchants.map((m) => m.merchant_key),
    yMax,
  }
}
