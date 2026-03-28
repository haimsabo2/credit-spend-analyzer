import { api } from "./client"
import type { SummaryResponse, TrendsResponse } from "./types"

export async function getSummary(month: string): Promise<SummaryResponse> {
  return api.get<SummaryResponse>("/insights/summary", { month })
}

export async function getTrends(opts?: { months?: number; year?: number }): Promise<TrendsResponse> {
  if (opts?.year != null) {
    return api.get<TrendsResponse>("/insights/trends", { year: opts.year })
  }
  const months = opts?.months ?? 12
  return api.get<TrendsResponse>("/insights/trends", { months })
}

/** Calendar year: 12 months YYYY-01 … YYYY-12 with zeros for empty months. */
export async function getYearOverview(year: number): Promise<TrendsResponse> {
  return getTrends({ year })
}
