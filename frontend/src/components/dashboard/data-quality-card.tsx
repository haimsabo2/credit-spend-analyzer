import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { ShieldCheck, AlertTriangle, ExternalLink } from "lucide-react"
import { api } from "@/lib/api-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/utils/format"
import { useMonthStore } from "@/stores/use-month-store"

interface TopUncategorizedMerchant {
  description: string
  total_amount: number
  occurrence_count: number
}

interface DataQualityResponse {
  total_transactions: number
  categorized_count: number
  uncategorized_count: number
  coverage_pct: number
  high_confidence_count: number
  medium_confidence_count: number
  low_confidence_count: number
  needs_review_count: number
  top_uncategorized_merchants: TopUncategorizedMerchant[]
}

function useDataQuality(month: string) {
  return useQuery({
    queryKey: ["data-quality", month],
    queryFn: () =>
      api.get<DataQualityResponse>("/api/insights/data-quality", { month }),
  })
}

export function DataQualityCard() {
  const { t } = useTranslation()
  const month = useMonthStore((s) => s.month)
  const { data, isLoading } = useDataQuality(month)

  if (isLoading) {
    return <Skeleton className="h-[280px] w-full" />
  }

  if (!data || data.total_transactions === 0) return null

  const coverageColor =
    data.coverage_pct >= 90
      ? "text-emerald-600"
      : data.coverage_pct >= 70
        ? "text-amber-600"
        : "text-red-600"

  const progressColor =
    data.coverage_pct >= 90
      ? "[&>div]:bg-emerald-500"
      : data.coverage_pct >= 70
        ? "[&>div]:bg-amber-500"
        : "[&>div]:bg-red-500"

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          {t("dataQuality.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">{t("dataQuality.coverage")}</span>
            <span className={`text-2xl font-bold tabular-nums ${coverageColor}`}>
              {data.coverage_pct.toFixed(0)}%
            </span>
          </div>
          <Progress value={data.coverage_pct} className={`h-2.5 ${progressColor}`} />
          <p className="text-xs text-muted-foreground">
            {data.categorized_count}/{data.total_transactions} {t("dataQuality.coverageDesc")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-md bg-emerald-50 px-2 py-2 dark:bg-emerald-900/20">
            <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {data.high_confidence_count}
            </p>
            <p className="text-[10px] text-muted-foreground">{t("dataQuality.highConfidence")}</p>
          </div>
          <div className="rounded-md bg-amber-50 px-2 py-2 dark:bg-amber-900/20">
            <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {data.medium_confidence_count}
            </p>
            <p className="text-[10px] text-muted-foreground">{t("dataQuality.mediumConfidence")}</p>
          </div>
          <div className="rounded-md bg-red-50 px-2 py-2 dark:bg-red-900/20">
            <p className="text-lg font-bold tabular-nums text-red-600 dark:text-red-400">
              {data.low_confidence_count}
            </p>
            <p className="text-[10px] text-muted-foreground">{t("dataQuality.lowConfidence")}</p>
          </div>
          <div className="rounded-md bg-violet-50 px-2 py-2 dark:bg-violet-900/20">
            <p className="text-lg font-bold tabular-nums text-violet-600 dark:text-violet-400">
              {data.needs_review_count}
            </p>
            <p className="text-[10px] text-muted-foreground">{t("dataQuality.needsReview")}</p>
          </div>
        </div>

        {data.top_uncategorized_merchants.length > 0 ? (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <p className="text-xs font-medium">{t("dataQuality.topUncategorized")}</p>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {t("dataQuality.topUncategorizedHint")}
            </p>
            <div className="space-y-1.5">
              {data.top_uncategorized_merchants.slice(0, 5).map((m) => (
                <div
                  key={m.description}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="min-w-0 truncate text-muted-foreground">
                    {m.description}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className="text-[9px] tabular-nums">
                      x{m.occurrence_count}
                    </Badge>
                    <span className="tabular-nums font-medium">
                      {formatCurrency(m.total_amount)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {data.needs_review_count > 0 && (
              <Link
                to="/review"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {t("dataQuality.reviewLink")}
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        ) : (
          <p className="text-center text-xs text-emerald-600">
            {t("dataQuality.allCategorized")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
