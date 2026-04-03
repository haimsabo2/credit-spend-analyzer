import { api } from "./client"
import type {
  CategoryYearMerchantsResponse,
  SummaryResponse,
  TrendsResponse,
} from "./types"

export async function getSummary(month: string): Promise<SummaryResponse> {
  return api.get<SummaryResponse>("/insights/summary", { month })
}

export async function getTrends(
  opts?: { months?: number; year?: number; trailingCalendarMonths?: number },
): Promise<TrendsResponse> {
  if (opts?.trailingCalendarMonths != null) {
    return api.get<TrendsResponse>("/insights/trends", {
      trailing_calendar_months: opts.trailingCalendarMonths,
    })
  }
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

/** Trailing N calendar months ending at latest upload month; includes category_monthly. */
export async function getTrailingOverview(trailingCalendarMonths = 12): Promise<TrendsResponse> {
  return getTrends({ trailingCalendarMonths })
}

export type CategoryMerchantsScope =
  | { year: number }
  | { trailingCalendarMonths: number }

/** Per-merchant monthly spend for one category over the given scope (omit categoryId for uncategorized). */
export async function getCategoryYearMerchants(
  categoryId: number | null,
  scope: CategoryMerchantsScope,
): Promise<CategoryYearMerchantsResponse> {
  const params: Record<string, string | number | undefined> = {}
  if (categoryId != null) {
    params.category_id = categoryId
  }
  if ("year" in scope) {
    params.year = scope.year
  } else {
    params.trailing_calendar_months = scope.trailingCalendarMonths
  }
  return api.get<CategoryYearMerchantsResponse>("/insights/category-year-merchants", params)
}
