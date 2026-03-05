import { useState } from "react"
import { useMonthStore, formatMonthLabel } from "@/stores/use-month-store"
import { useTransactions } from "@/hooks/use-transactions"
import { useCategories } from "@/hooks/use-categories"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Download, FileSpreadsheet, Loader2, Inbox, CheckCircle2 } from "lucide-react"
import { formatCurrency } from "@/lib/format"
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
    "ID",
    "Date",
    "Description",
    "Amount",
    "Currency",
    "Category",
    "Card",
    "Section",
    "Needs Review",
  ]
  const rows = txns.map((t) => [
    String(t.id),
    t.posted_at ?? "",
    escapeCSV(t.description),
    String(t.amount),
    t.currency ?? "",
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

export default function ExportPage() {
  const month = useMonthStore((s) => s.month)
  const txns = useTransactions({ month, limit: 500, offset: 0 })
  const categories = useCategories()
  const [exported, setExported] = useState(false)

  const isLoading = txns.isLoading || categories.isLoading
  const data = txns.data ?? []
  const hasData = data.length > 0

  const categoryMap = new Map<number, string>()
  for (const c of categories.data ?? []) {
    categoryMap.set(c.id, c.name)
  }

  const categorized = data.filter((t) => t.category_id != null).length
  const uncategorized = data.length - categorized
  const total = data.reduce((sum, t) => sum + t.amount, 0)

  function handleExport() {
    const csv = buildCSV(data, categoryMap)
    downloadBlob(csv, `transactions-${month}.csv`)
    setExported(true)
    setTimeout(() => setExported(false), 3000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Export</h1>
        <p className="text-sm text-muted-foreground">
          Download transaction data for {formatMonthLabel(month)}
        </p>
      </div>

      {isLoading ? (
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
            <h2 className="text-lg font-semibold">No transactions</h2>
            <p className="text-sm text-muted-foreground">
              No transactions found for {formatMonthLabel(month)}. Try selecting a different month.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                Export Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Transactions</p>
                  <p className="text-2xl font-bold tabular-nums">{data.length}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="text-2xl font-bold tabular-nums">{formatCurrency(total)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Categorized</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-bold tabular-nums text-emerald-600">{categorized}</p>
                    {uncategorized > 0 && (
                      <Badge variant="secondary" className="text-xs text-amber-600">
                        {uncategorized} uncategorized
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Format</p>
                  <p className="text-2xl font-bold">CSV</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="font-medium">transactions-{month}.csv</p>
                  <p className="text-xs text-muted-foreground">
                    {data.length} rows &middot; 9 columns &middot; UTF-8 with BOM
                  </p>
                </div>
                <Button
                  className="gap-1.5"
                  onClick={handleExport}
                  disabled={txns.isFetching}
                >
                  {exported ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      Downloaded
                    </>
                  ) : txns.isFetching ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download CSV
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground">
            <p>
              The exported CSV includes: ID, Date, Description, Amount, Currency, Category, Card,
              Section, and Needs Review status. Opens in Excel, Google Sheets, and most
              spreadsheet applications.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
