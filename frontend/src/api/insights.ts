import { api } from "./client"
import type { SummaryResponse, TrendsResponse } from "./types"

export async function getSummary(month: string): Promise<SummaryResponse> {
  return api.get<SummaryResponse>("/insights/summary", { month })
}

export async function getTrends(months = 6): Promise<TrendsResponse> {
  return api.get<TrendsResponse>("/insights/trends", { months })
}
