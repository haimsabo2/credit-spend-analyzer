import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Repeat, TrendingUp, Calendar, DollarSign } from "lucide-react"
import { api } from "@/lib/api-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/utils/format"
import { useState } from "react"

interface RecurringSpendItem {
  merchant_key: string
  display_name: string
  avg_amount: number
  months_present: number
  total_months_in_window: number
  total_amount: number
  first_seen: string
  last_seen: string
  trend: string
  category_name: string | null
  category_id: number | null
}

interface RecurringSpendResponse {
  items: RecurringSpendItem[]
  total_monthly_recurring: number
  total_annual_estimate: number
  window_months: number
}

function useRecurringSpend(trailingMonths: number) {
  return useQuery({
    queryKey: ["recurring-spend", trailingMonths],
    queryFn: () =>
      api.get<RecurringSpendResponse>("/api/insights/recurring-spend", {
        trailing_months: trailingMonths,
      }),
  })
}

const TREND_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  stable: { label: "Stable", variant: "secondary" },
  new: { label: "New", variant: "default" },
  increasing: { label: "Increasing", variant: "default" },
  decreasing: { label: "Decreasing", variant: "outline" },
}

export default function RecurringSpendPage() {
  const { t } = useTranslation()
  const [window, setWindow] = useState("6")
  const trailing = parseInt(window, 10)
  const { data, isLoading } = useRecurringSpend(trailing)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("recurring.title", "Recurring & Subscriptions")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("recurring.subtitle", "Merchants that appear 3+ months in the selected window")}
          </p>
        </div>
        <Select value={window} onValueChange={setWindow}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="6">{t("recurring.last6", "Last 6 months")}</SelectItem>
            <SelectItem value="12">{t("recurring.last12", "Last 12 months")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30">
                    <Repeat className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("recurring.recurringCount", "Recurring merchants")}
                    </p>
                    <p className="text-2xl font-bold tabular-nums">{data.items.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900/30">
                    <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("recurring.monthlyTotal", "Monthly recurring")}
                    </p>
                    <p className="text-2xl font-bold tabular-nums">
                      {formatCurrency(data.total_monthly_recurring)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-violet-100 p-2 dark:bg-violet-900/30">
                    <Calendar className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("recurring.annualEstimate", "Annual estimate")}
                    </p>
                    <p className="text-2xl font-bold tabular-nums">
                      {formatCurrency(data.total_annual_estimate)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {data.items.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <div className="rounded-full bg-muted p-3">
                  <TrendingUp className="h-8 w-8 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-semibold">
                  {t("recurring.empty", "No recurring spend detected")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("recurring.emptyHint", "Upload at least 3 months of statements to detect recurring charges.")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Repeat className="h-5 w-5 text-muted-foreground" />
                  {t("recurring.tableTitle", "Recurring charges")}
                  <Badge variant="secondary" className="text-xs">
                    {data.items.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("recurring.colMerchant", "Merchant")}</TableHead>
                        <TableHead className="text-end">
                          {t("recurring.colMonthlyAvg", "Monthly avg")}
                        </TableHead>
                        <TableHead className="text-end">
                          {t("recurring.colTotal", "Total")}
                        </TableHead>
                        <TableHead className="text-center">
                          {t("recurring.colFrequency", "Frequency")}
                        </TableHead>
                        <TableHead>{t("recurring.colCategory", "Category")}</TableHead>
                        <TableHead>{t("recurring.colStatus", "Status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((item) => {
                        const badge = TREND_BADGE[item.trend] ?? TREND_BADGE.stable
                        return (
                          <TableRow key={item.merchant_key}>
                            <TableCell className="max-w-[200px] truncate font-medium">
                              {item.display_name}
                            </TableCell>
                            <TableCell className="text-end tabular-nums">
                              {formatCurrency(item.avg_amount)}
                            </TableCell>
                            <TableCell className="text-end tabular-nums text-muted-foreground">
                              {formatCurrency(item.total_amount)}
                            </TableCell>
                            <TableCell className="text-center tabular-nums">
                              {item.months_present}/{item.total_months_in_window}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {item.category_name ?? "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={badge.variant} className="text-[10px]">
                                {badge.label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  )
}
