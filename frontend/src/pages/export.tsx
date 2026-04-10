import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useMonthStore, formatMonthLabel } from "@/stores/use-month-store"
import { useTransactions } from "@/hooks/use-transactions"
import { useCategories } from "@/hooks/use-categories"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Download, FileSpreadsheet, Loader2, Inbox, CheckCircle2, Globe } from "lucide-react"
import { formatCurrency } from "@/utils/format"
import type { TransactionRead } from "@/types/api"

function escapeCSV(value: string | null | undefined): string {
  if (value == null) return ""
  const s = String(value)
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function buildCSV(txns: TransactionRead[], categoryMap: Map<number, string>): string {
  const headers = [
    "ID", "Date", "Description", "Amount", "Currency",
    "Spend pattern", "Pattern manual", "Category", "Card", "Section", "Needs Review",
  ]
  const rows = txns.map((t) => [
    String(t.id),
    t.posted_at ?? "",
    escapeCSV(t.description),
    String(t.amount),
    t.currency ?? "",
    t.spend_pattern ?? "unknown",
    t.spend_pattern_user_set ? "Yes" : "No",
    escapeCSV(t.category_id != null ? categoryMap.get(t.category_id) ?? "" : ""),
    escapeCSV(t.card_label),
    escapeCSV(t.section),
    t.needs_review ? "Yes" : "No",
  ])
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
}

function downloadBlob(content: string, filename: string) {
  const bom = "\uFEFF"
  const blob = new Blob([bom + content], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

type ExportScope = "month" | "all"

export default function ExportPage() {
  const { t } = useTranslation()
  const month = useMonthStore((s) => s.month)
  const [scope, setScope] = useState<ExportScope>("month")
  const txns = useTransactions({ month, limit: 500, offset: 0 })
  const categories = useCategories()
  const [exported, setExported] = useState(false)
  const [serverExporting, setServerExporting] = useState(false)

  const isLoading = txns.isLoading || categories.isLoading
  const data = txns.data ?? []
  const hasData = scope === "all" || data.length > 0

  const categoryMap = new Map<number, string>()
  for (const c of categories.data ?? []) {
    categoryMap.set(c.id, c.name)
  }

  const categorized = data.filter((t) => t.category_id != null).length
  const uncategorized = data.length - categorized
  const total = data.reduce((sum, t) => sum + t.amount, 0)

  function handleClientExport() {
    const csv = buildCSV(data, categoryMap)
    downloadBlob(csv, `transactions-${month}.csv`)
    setExported(true)
    setTimeout(() => setExported(false), 3000)
  }

  async function handleServerExport() {
    setServerExporting(true)
    try {
      const params = new URLSearchParams()
      if (scope === "month") params.set("month", month)
      const res = await fetch(`/api/transactions/export?${params.toString()}`)
      if (!res.ok) throw new Error(`${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `transactions-${scope === "month" ? month : "all"}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setExported(true)
      setTimeout(() => setExported(false), 3000)
    } finally {
      setServerExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("export.title", "Export")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("export.subtitle", "Download transaction data as CSV")}
          </p>
        </div>
        <Select value={scope} onValueChange={(v) => setScope(v as ExportScope)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">
              {formatMonthLabel(month)}
            </SelectItem>
            <SelectItem value="all">
              {t("export.allMonths", "All months")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && scope === "month" ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-12 w-48" />
        </div>
      ) : !hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <Inbox className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold">
              {t("export.noData", "No transactions")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("export.noDataHint", "No transactions found for this month.")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {scope === "month" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                  {t("export.summaryTitle", "Export Summary")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {t("export.transactions", "Transactions")}
                    </p>
                    <p className="text-2xl font-bold tabular-nums">{data.length}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {t("export.totalAmount", "Total Amount")}
                    </p>
                    <p className="text-2xl font-bold tabular-nums">{formatCurrency(total)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {t("export.categorized", "Categorized")}
                    </p>
                    <div className="flex items-baseline gap-2">
                      <p className="text-2xl font-bold tabular-nums text-emerald-600">{categorized}</p>
                      {uncategorized > 0 && (
                        <Badge variant="secondary" className="text-xs text-amber-600">
                          {uncategorized} {t("export.uncategorized", "uncategorized")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {t("export.format", "Format")}
                    </p>
                    <p className="text-2xl font-bold">CSV</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="font-medium">
                    transactions-{scope === "month" ? month : "all"}.csv
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {scope === "month"
                      ? `${data.length} rows · 11 columns · UTF-8 with BOM`
                      : t("export.serverHint", "Server-side export with all enriched columns")}
                  </p>
                </div>
                <div className="flex gap-2">
                  {scope === "month" && (
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      onClick={handleClientExport}
                      disabled={txns.isFetching}
                    >
                      {exported ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          {t("export.downloaded", "Downloaded")}
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" />
                          {t("export.quickDownload", "Quick CSV")}
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    className="gap-1.5"
                    onClick={handleServerExport}
                    disabled={serverExporting}
                  >
                    {serverExporting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("export.exporting", "Exporting...")}
                      </>
                    ) : exported && scope === "all" ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        {t("export.downloaded", "Downloaded")}
                      </>
                    ) : (
                      <>
                        <Globe className="h-4 w-4" />
                        {scope === "all"
                          ? t("export.exportAll", "Export All Months")
                          : t("export.enrichedExport", "Full Export")}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground">
            <p>
              {t("export.footer", "The exported CSV includes: ID, Month, Date, Description, Amount, Currency, Category, Subcategory, Card, Section, Spend Pattern, Confidence, and Needs Review status. Opens in Excel, Google Sheets, and most spreadsheet applications.")}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
