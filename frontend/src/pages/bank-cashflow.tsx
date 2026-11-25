import { useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChevronDown,
  ChevronUp,
  Landmark,
  Plane,
  PiggyBank,
  Scale,
  Sparkles,
  TrendingUp,
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
import { getApiErrorToastDescription } from "@/lib/api-client"
import {
  useBankAnalysis,
  usePatchBankTransaction,
  useUpdateBankSettings,
  type BankMonthRow,
  type BankSettings,
  type TransferTag,
} from "@/api/bank"
import { BankUploadPanel } from "@/components/bank/bank-upload-panel"
import { BankLedgerTab } from "@/components/bank/bank-ledger-tab"

type CashflowTabKey =
  | "overview"
  | "breakdown"
  | "anomalies"
  | "insights"
  | "ledger"

const TRANSFER_TAG_OPTIONS: Array<{ value: TransferTag; label: string }> = [
  { value: "stock", label: "מניות והשקעות" },
  { value: "gift", label: "מתנה / סיוע משפחתי" },
  { value: "reimbursement", label: "החזר הוצאות" },
  { value: "reserve", label: "רזרבה מחשבון חיצוני" },
]

function fmtILS(n: number): string {
  const sign = n < 0 ? "-" : ""
  return `${sign}₪${Math.round(Math.abs(n)).toLocaleString("en-US")}`
}

function fmtSignedILS(n: number): string {
  const sign = n >= 0 ? "+" : "-"
  return `${sign}₪${Math.round(Math.abs(n)).toLocaleString("en-US")}`
}

function fmtIsoDateHe(iso: string | null | undefined): string {
  if (!iso) return "—"
  const p = iso.split("-")
  if (p.length !== 3) return iso
  return `${p[2]}/${p[1]}/${p[0]}`
}

export default function BankCashflowPage() {
  const { data, isLoading, isError } = useBankAnalysis()
  const settingsMut = useUpdateBankSettings()
  const patchTxMut = usePatchBankTransaction()

  const [selectedPeriod, setSelectedPeriod] = useState<string>("steady")
  const [activeTab, setActiveTab] = useState<CashflowTabKey>("overview")
  const [showUploadDrawer, setShowUploadDrawer] = useState<boolean>(false)
  const [openInsights, setOpenInsights] = useState<Record<string, boolean>>({
    paradox: true,
    barcelona_forward: true,
    wealth: true,
    housing: true,
    unemployment_roi: true,
  })

  const settings: BankSettings = data?.settings ?? {
    inc_muni_dig: true,
    inc_bit: true,
    inc_bituach_leumi: false,
    inc_sav_600_as_expense: false,
    inc_khs_as_expense: false,
  }

  const toggleSetting = async (key: keyof BankSettings, val: boolean) => {
    try {
      await settingsMut.mutateAsync({ ...settings, [key]: val })
    } catch (err) {
      const desc = getApiErrorToastDescription(err)
      toast.error("לא ניתן לשמור את הגדרת החישוב", desc ? { description: desc } : undefined)
    }
  }

  const handleTransferTagChange = async (id: number, tag: TransferTag) => {
    try {
      await patchTxMut.mutateAsync({ id, transfer_tag: tag })
      toast.success("תיוג ההעברה נשמר במסד הנתונים")
    } catch (err) {
      const desc = getApiErrorToastDescription(err)
      toast.error("שגיאה בשמירת התיוג", desc ? { description: desc } : undefined)
    }
  }

  const activePeriodObj = useMemo(() => {
    if (!data?.periods.length) return null
    return (
      data.periods.find((p) => p.key === selectedPeriod) ?? data.periods[0]
    )
  }, [data, selectedPeriod])

  const filteredMonths = useMemo(() => {
    if (!data?.monthly.length) return []
    if (!activePeriodObj) return data.monthly
    const set = new Set(activePeriodObj.months)
    return data.monthly.filter((m) => set.has(m.ym))
  }, [data, activePeriodObj])

  const computeRegIncome = (m: BankMonthRow) =>
    m.sal1 +
    m.sal2 +
    m.sal_misc +
    m.child +
    m.health_ins_in +
    m.bank_misc_in +
    (settings.inc_muni_dig ? m.muni_dig_in : 0) +
    (settings.inc_bit ? m.bit_in : 0) +
    (settings.inc_bituach_leumi ? m.bituach_leumi : 0)

  const computeNormExpense = (m: BankMonthRow) =>
    m.cc_rec +
    m.mortgage +
    m.reg_transfers +
    m.loans_monthly +
    m.vaad_454 +
    m.cash_checks +
    m.health_out +
    m.fees_out +
    (settings.inc_sav_600_as_expense ? m.sav_600 : 0) +
    (settings.inc_khs_as_expense ? m.khs_20k : 0)

  if (isLoading) {
    return (
      <div dir="rtl" className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div dir="rtl" className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-right">
        <h2 className="text-lg font-semibold text-destructive">
          שגיאה בטעינת נתוני תזרים ובנק
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ודא ששרת ה-Backend רץ על פורט 8000 ורענן את העמוד.
        </p>
      </div>
    )
  }

  if (!data.status.has_data) {
    return (
      <div dir="rtl" className="mx-auto max-w-2xl space-y-6 text-right">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            תזרים ובנק (עו״ש)
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            טרם הועלו תנועות חשבון עו״ש למסד הנתונים. העלה תדפיס &quot;תנועות בחשבון&quot; (‎.xls) כדי להפעיל את הדשבורד הדינמי.
          </p>
        </div>
        <BankUploadPanel />
      </div>
    )
  }

  const n = Math.max(1, filteredMonths.length)
  const avg = (fn: (m: BankMonthRow) => number) =>
    filteredMonths.reduce((acc, m) => acc + fn(m), 0) / n

  const avgRegInc = avg(computeRegIncome)
  const avgNormExp = avg(computeNormExpense)
  const avgNetBaseline = avgRegInc - avgNormExp
  const avgCcOneTime = avg((m) => m.cc_ot)
  const avgSavingsTotal = avg((m) => m.sav_600 + m.khs_20k + m.cc_sav)

  const avgSal1 = avg((m) => m.sal1)
  const avgSal2 = avg((m) => m.sal2)
  const avgChild = avg((m) => m.child)
  const avgHealthInsIn = avg((m) => m.health_ins_in + m.sal_misc + m.bank_misc_in)
  const avgMuniDig = avg((m) => m.muni_dig_in)
  const avgBit = avg((m) => m.bit_in)
  const avgBL = avg((m) => m.bituach_leumi)

  const avgCcRec = avg((m) => m.cc_rec)
  const avgMortgage = avg((m) => m.mortgage)
  const avgRegTransfers = avg((m) => m.reg_transfers)
  const avgLoansMo = avg((m) => m.loans_monthly)
  const avgVaad = avg((m) => m.vaad_454)
  const avgSav600 = avg((m) => m.sav_600)
  const avgCashChecks = avg((m) => m.cash_checks)
  const avgHealthFeesOut = avg((m) => m.health_out + m.fees_out)
  const avgKhs = avg((m) => m.khs_20k)

  // Chart data
  const lineChartData = filteredMonths.map((m) => ({
    ym: m.ym,
    income: Math.round(computeRegIncome(m)),
    expense: Math.round(computeNormExpense(m)),
  }))

  const stackedOutflowData = filteredMonths.map((m) => ({
    ym: m.ym,
    bankBills: Math.round(
      m.mortgage +
        m.reg_transfers +
        m.loans_monthly +
        m.vaad_454 +
        m.cash_checks +
        m.health_out +
        m.fees_out,
    ),
    ccRec: Math.round(m.cc_rec),
    savings: Math.round(m.sav_600 + m.cc_sav),
    ccSpikes: Math.round(m.cc_ot),
  }))

  // Tag totals for external transfers
  const tagTotals: Record<TransferTag, number> = {
    stock: 0,
    gift: 0,
    reimbursement: 0,
    reserve: 0,
  }
  for (const t of data.external_transfers) {
    tagTotals[t.tag] = (tagTotals[t.tag] ?? 0) + t.amount
  }

  const totalSavingsAllMonths = data.savings_vehicles.reduce(
    (s, v) => s + v.total,
    0,
  )
  const totalOneTimeAllMonths = data.one_time_outflows.reduce(
    (s, o) => s + o.total,
    0,
  )

  const allocDenom = Math.max(
    1,
    avgRegInc,
    avgNormExp + (settings.inc_sav_600_as_expense ? 0 : avgSav600),
  )
  const freeCashFlowAfter600 =
    avgRegInc - avgNormExp - (settings.inc_sav_600_as_expense ? 0 : avgSav600)

  return (
    <div dir="rtl" className="space-y-6 text-right">
      {/* Top Header + Sync Watermark + Incremental Upload Drawer */}
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Landmark className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">
              תזרים ובנק — נרמול הכנסות, הוצאות וחיסכון
            </h1>
            {data.status.account_number && (
              <Badge variant="outline" dir="ltr" className="tabular-nums">
                {data.status.account_number}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            משלב דינמית את תנועות העו״ש במסד הנתונים ({data.status.total_transactions.toLocaleString("he-IL")} שורות,{" "}
            <span dir="ltr" className="tabular-nums">
              {fmtIsoDateHe(data.status.first_date)}
            </span>{" "}
            עד{" "}
            <span dir="ltr" className="font-medium text-foreground tabular-nums">
              {fmtIsoDateHe(data.status.last_synced_date)}
            </span>
            ) יחד עם פירוט עסקאות האשראי ב-app.db — ללא שינוי ברשומות האשראי הקיימות.
          </p>
        </div>

        <Button
          variant={showUploadDrawer ? "secondary" : "default"}
          onClick={() => setShowUploadDrawer((v) => !v)}
          className="shrink-0"
        >
          <Upload className="me-2 h-4 w-4" />
          {showUploadDrawer ? "סגור חלונית העלאה" : "הוספת תדפיס עו״ש חדש"}
        </Button>
      </div>

      {showUploadDrawer && (
        <BankUploadPanel onUploaded={() => setShowUploadDrawer(false)} />
      )}

      {/* Period Selector Pills */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {data.periods.map((p) => {
            const active = activePeriodObj?.key === p.key
            return (
              <Button
                key={p.key}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => setSelectedPeriod(p.key)}
                className="h-8 text-xs"
              >
                {p.label}
              </Button>
            )
          })}
        </div>
        {activePeriodObj && (
          <p className="text-xs text-muted-foreground">
            טווח פעיל: {activePeriodObj.subtitle}
          </p>
        )}
      </div>

      {/* Primary KPI Strip + Persisted Assumption Toggles */}
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-emerald-500/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  הכנסה קבועה מנורמלת (ממוצע {n} חוד׳)
                </span>
                <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p dir="ltr" className="mt-2 text-right text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                {fmtILS(avgRegInc)}
                <span className="ms-1 text-xs font-normal text-muted-foreground">/ חודש</span>
              </p>
            </div>

            <div className="rounded-lg border bg-blue-500/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  הוצאת מחיה שוטפת (כולל ועד ₪454, ללא חופשות)
                </span>
                <Scale className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <p dir="ltr" className="mt-2 text-right text-2xl font-bold text-blue-700 tabular-nums dark:text-blue-400">
                {fmtILS(avgNormExp)}
                <span className="ms-1 text-xs font-normal text-muted-foreground">/ חודש</span>
              </p>
            </div>

            <div
              className={`rounded-lg border p-4 ${
                avgNetBaseline >= 0 ? "bg-emerald-500/5" : "bg-rose-500/5"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  עודף תפעולי שוטף (לפני חיסכון {fmtILS(avgSavingsTotal)}/חודש)
                </span>
                <PiggyBank className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p
                dir="ltr"
                className={`mt-2 text-right text-2xl font-bold tabular-nums ${
                  avgNetBaseline >= 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-rose-700 dark:text-rose-400"
                }`}
              >
                {fmtSignedILS(avgNetBaseline)}
                <span className="ms-1 text-xs font-normal text-muted-foreground">/ חודש</span>
              </p>
            </div>

            <div className="rounded-lg border bg-amber-500/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  חופשות וחד-פעמי באשראי (מוחרג מהבסיס)
                </span>
                <Plane className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <p dir="ltr" className="mt-2 text-right text-2xl font-bold text-amber-700 tabular-nums dark:text-amber-400">
                {fmtILS(avgCcOneTime)}
                <span className="ms-1 text-xs font-normal text-muted-foreground">/ חודש</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-xs">
            <span className="font-semibold text-muted-foreground">
              מתגי הנחות לחישוב (נשמר אוטומטית):
            </span>

            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={settings.inc_muni_dig}
                onCheckedChange={(c) => toggleSetting("inc_muni_dig", c === true)}
              />
              <span>עיריית רעננה + דיגיטל חודשי ({fmtILS(avgMuniDig)}/חודש)</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={settings.inc_bit}
                onCheckedChange={(c) => toggleSetting("inc_bit", c === true)}
              />
              <span>תקבולי ביט שוטפים ({fmtILS(avgBit)}/חודש)</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={settings.inc_bituach_leumi}
                onCheckedChange={(c) => toggleSetting("inc_bituach_leumi", c === true)}
              />
              <span>דמי אבטלה 2025 ({fmtILS(avgBL)}/חודש)</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={settings.inc_sav_600_as_expense}
                onCheckedChange={(c) =>
                  toggleSetting("inc_sav_600_as_expense", c === true)
                }
              />
              <span>הכלל הו״ק חיסכון ₪600 כהוצאה ({fmtILS(avgSav600)}/חודש)</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={settings.inc_khs_as_expense}
                onCheckedChange={(c) => toggleSetting("inc_khs_as_expense", c === true)}
              />
              <span>הכלל קרן השתלמות כהוצאה ({fmtILS(avgKhs)}/חודש)</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {(
          [
            ["overview", "1. סקירה ומגמות חודשיות"],
            ["breakdown", "2. הכנסות, הוצאות וחיסכון"],
            ["anomalies", "3. חריגים, טיולים והעברות"],
            ["insights", "4. תובנות פיננסיות"],
            ["ledger", "5. יומן תנועות עו״ש"],
          ] as Array<[CashflowTabKey, string]>
        ).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            variant={activeTab === key ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* ===================== TAB 1: OVERVIEW ===================== */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            <p className="font-semibold text-emerald-800 dark:text-emerald-300">
              סיכום התקופה הנבחרת ({activePeriodObj?.label}):
            </p>
            <p className="mt-1 text-muted-foreground">
              הכנסה חודשית קבועה מנורמלת של{" "}
              <strong className="text-foreground">{fmtILS(avgRegInc)}</strong> מול הוצאות מחיה שוטפות של{" "}
              <strong className="text-foreground">{fmtILS(avgNormExp)}</strong> (כולל ועד בית ₪454 וללא חופשות/נסיעות) מותירה עודף תפעולי שוטף של{" "}
              <strong className="text-foreground">{fmtSignedILS(avgNetBaseline)} לחודש</strong>, ותזרים חופשי של{" "}
              <strong className="text-foreground">{fmtSignedILS(freeCashFlowAfter600)} לחודש</strong> לאחר הוראת הקבע החודשית לחיסכון (₪600).
            </p>
          </div>

          {/* Line Chart: Income vs Expense */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                הכנסה חודשית מנורמלת מול הוצאת מחיה שוטפת (₪ לחודש)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                ממוצע הוצאת מחיה בתקופה: {fmtILS(avgNormExp)} · ללא עסקאות סיבוביות, בונוסים, הלוואות וחופשות חד-פעמיות
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lineChartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="ym" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) => `₪${Math.round(v / 1000)}k`}
                    />
                    <Tooltip
                      formatter={(val) => fmtILS(Number(val ?? 0))}
                    />
                    <Legend />
                    <ReferenceLine
                      y={Math.round(avgNormExp)}
                      stroke="#64748b"
                      strokeDasharray="4 4"
                    />
                    <Line
                      type="monotone"
                      dataKey="income"
                      name="הכנסה קבועה מנורמלת"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dot={{ r: 2.5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="expense"
                      name="הוצאת מחיה שוטפת (כולל ועד)"
                      stroke="#ef4444"
                      strokeWidth={2.5}
                      dot={{ r: 2.5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Stacked Bar Chart: Outflow Decomposition */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                פירוק יציאות חודשי: בסיס מחיה מול חיסכון שוטף וקפיצות חופשה באשראי (₪ לחודש)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                התאמת חיובי אשראי בבנק לאומי בפיגור חודש אחד לעסקאות מסד הנתונים (הפקדות קרן השתלמות חד-פעמיות מוצגות בלשוניות 2 ו-3)
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stackedOutflowData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="ym" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) => `₪${Math.round(v / 1000)}k`}
                    />
                    <Tooltip formatter={(val) => fmtILS(Number(val ?? 0))} />
                    <Legend />
                    <Bar
                      dataKey="bankBills"
                      name="חיובי בנק קבועים (משכנתא, הלוואות, ועד, העברות <₪2k)"
                      stackId="a"
                      fill="#3b82f6"
                    />
                    <Bar
                      dataKey="ccRec"
                      name="כרטיסי אשראי שוטפים"
                      stackId="a"
                      fill="#6366f1"
                    />
                    <Bar
                      dataKey="savings"
                      name="חיסכון חודשי (הו״ק ₪600 + Kraken)"
                      stackId="a"
                      fill="#10b981"
                    />
                    <Bar
                      dataKey="ccSpikes"
                      name="חופשות וחד-פעמי באשראי"
                      stackId="a"
                      fill="#f59e0b"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Multi-Period Comparison Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">טבלת השוואה רב-תקופתית</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">תקופה</TableHead>
                    <TableHead className="text-right">חודשים</TableHead>
                    <TableHead className="text-right">שכר בסיס + ילדים</TableHead>
                    <TableHead className="text-right">סה״כ הכנסה קבועה</TableHead>
                    <TableHead className="text-right">חיובי בנק קבועים</TableHead>
                    <TableHead className="text-right">אשראי שוטף</TableHead>
                    <TableHead className="text-right">סה״כ הוצאת מחיה</TableHead>
                    <TableHead className="text-right">עודף שוטף</TableHead>
                    <TableHead className="text-right">ממוצע חיסכון כולל</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.periods.map((p) => {
                    const pSet = new Set(p.months)
                    const rows = data.monthly.filter((m) => pSet.has(m.ym))
                    const cnt = Math.max(1, rows.length)
                    const coreSal =
                      rows.reduce(
                        (s, r) => s + r.sal1 + r.sal2 + r.sal_misc + r.child,
                        0,
                      ) / cnt
                    const regIn =
                      rows.reduce((s, r) => s + computeRegIncome(r), 0) / cnt
                    const ccR = rows.reduce((s, r) => s + r.cc_rec, 0) / cnt
                    const normEx =
                      rows.reduce((s, r) => s + computeNormExpense(r), 0) / cnt
                    const bankEx = normEx - ccR
                    const net = regIn - normEx
                    const savAvg =
                      rows.reduce(
                        (s, r) => s + r.sav_600 + r.khs_20k + r.cc_sav,
                        0,
                      ) / cnt

                    return (
                      <TableRow
                        key={p.key}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedPeriod(p.key)}
                      >
                        <TableCell className="font-medium">{p.label}</TableCell>
                        <TableCell className="tabular-nums">{rows.length}</TableCell>
                        <TableCell dir="ltr" className="text-right tabular-nums">
                          {fmtILS(coreSal)}
                        </TableCell>
                        <TableCell dir="ltr" className="text-right font-medium tabular-nums">
                          {fmtILS(regIn)}
                        </TableCell>
                        <TableCell dir="ltr" className="text-right tabular-nums">
                          {fmtILS(bankEx)}
                        </TableCell>
                        <TableCell dir="ltr" className="text-right tabular-nums">
                          {fmtILS(ccR)}
                        </TableCell>
                        <TableCell dir="ltr" className="text-right font-medium tabular-nums">
                          {fmtILS(normEx)}
                        </TableCell>
                        <TableCell
                          dir="ltr"
                          className={`text-right font-semibold tabular-nums ${
                            net >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {fmtSignedILS(net)}
                        </TableCell>
                        <TableCell dir="ltr" className="text-right text-emerald-600 tabular-nums dark:text-emerald-400">
                          {fmtILS(savAvg)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===================== TAB 2: BREAKDOWN & SAVINGS ===================== */}
      {activeTab === "breakdown" && (
        <div className="space-y-6">
          {/* Proportional Allocation Bar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                לאן הולך כל שקל מההכנסה החודשית המנורמלת ({fmtILS(avgRegInc)} לחודש)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                הוצאות מחיה: {fmtILS(avgNormExp)} ({Math.round((avgNormExp / Math.max(1, avgRegInc)) * 100)}%) · הו״ק חיסכון: {fmtILS(avgSav600)} · תזרים חופשי לאחר הו״ק חיסכון:{" "}
                <strong className="text-foreground">{fmtSignedILS(freeCashFlowAfter600)} לחודש</strong>
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
                {[
                  { val: avgCcRec, cls: "bg-blue-500", label: "אשראי שוטף" },
                  { val: avgMortgage, cls: "bg-violet-500", label: "משכנתא" },
                  { val: avgLoansMo, cls: "bg-pink-500", label: "הלוואות" },
                  { val: avgRegTransfers, cls: "bg-amber-500", label: "העברות <₪2k" },
                  { val: avgVaad, cls: "bg-cyan-500", label: "ועד בית" },
                  { val: avgCashChecks + avgHealthFeesOut, cls: "bg-slate-400", label: "מזומן וקופ״ח" },
                  { val: avgSav600, cls: "bg-emerald-500", label: "הו״ק חיסכון ₪600" },
                ].map((seg) => (
                  <div
                    key={seg.label}
                    style={{ width: `${Math.max(0, (seg.val / allocDenom) * 100)}%` }}
                    className={seg.cls}
                    title={`${seg.label}: ${fmtILS(seg.val)}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" />אשראי שוטף ({fmtILS(avgCcRec)})</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-violet-500" />משכנתא ({fmtILS(avgMortgage)})</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-pink-500" />הלוואות חודשיות ({fmtILS(avgLoansMo)})</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />העברות &lt;₪2k ({fmtILS(avgRegTransfers)})</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-cyan-500" />ועד בית ({fmtILS(avgVaad)})</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" />מזומן, שיקים וקופ״ח ({fmtILS(avgCashChecks + avgHealthFeesOut)})</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />הו״ק חיסכון ({fmtILS(avgSav600)})</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Income Streams Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">זרמי הכנסה חודשיים מנורמלים</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">מקור הכנסה</TableHead>
                      <TableHead className="text-right">ממוצע חודשי</TableHead>
                      <TableHead className="text-right">משקל</TableHead>
                      <TableHead className="text-right">פירוט</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      {
                        name: "שכר בסיס נטו — מפרנס 1",
                        val: fmtILS(avgSal1),
                        pct: `${Math.round((avgSal1 / Math.max(1, avgRegInc)) * 100)}%`,
                        note: "סימילרווב (העברת משכורת ב-2024; מנוכה מרכיבי בונוס)",
                      },
                      {
                        name: "שכר בסיס נטו — מפרנס 2",
                        val: fmtILS(avgSal2),
                        pct: `${Math.round((avgSal2 / Math.max(1, avgRegInc)) * 100)}%`,
                        note: "יו-ביטק (ארו/רפק עד אפריל 2025; מנוכה מרכיבי בונוס)",
                      },
                      {
                        name: "עיריית רעננה + דיגיטל חודשי קבוע",
                        val: settings.inc_muni_dig ? fmtILS(avgMuniDig) : "מוחרג",
                        pct: settings.inc_muni_dig
                          ? `${Math.round((avgMuniDig / Math.max(1, avgRegInc)) * 100)}%`
                          : "—",
                        note: "אושר כהכנסה שוטפת (עיריית רעננה + הפקדות סביב ה-10 לחודש)",
                      },
                      {
                        name: "החזרי בריאות, ביטוח ומענקי בנק",
                        val: fmtILS(avgHealthInsIn),
                        pct: `${Math.round((avgHealthInsIn / Math.max(1, avgRegInc)) * 100)}%`,
                        note: "קופ״ח, פמי פרימיום, איילון, מענקי לאומי ותלושים משלימים",
                      },
                      {
                        name: "תקבולי ביט ופייבוקס שוטפים",
                        val: settings.inc_bit ? fmtILS(avgBit) : "מוחרג",
                        pct: settings.inc_bit
                          ? `${Math.round((avgBit / Math.max(1, avgRegInc)) * 100)}%`
                          : "—",
                        note: "העברות ביט נכנסות שוטפות לאורך השנה",
                      },
                      {
                        name: "קצבת ילדים (ביטוח לאומי)",
                        val: fmtILS(avgChild),
                        pct: `${Math.round((avgChild / Math.max(1, avgRegInc)) * 100)}%`,
                        note: "קצבה חודשית קבועה ב-20 לכל חודש",
                      },
                      ...(settings.inc_bituach_leumi
                        ? [
                            {
                              name: "דמי אבטלה (מאי–אוקטובר 2025)",
                              val: fmtILS(avgBL),
                              pct: `${Math.round((avgBL / Math.max(1, avgRegInc)) * 100)}%`,
                              note: "מופעל כעת במתג ההנחות (ברירת מחדל: מוחרג לחריגים)",
                            },
                          ]
                        : []),
                      {
                        name: "סה״כ הכנסה קבועה מנורמלת",
                        val: fmtILS(avgRegInc),
                        pct: "100%",
                        note: "ללא בונוסים, הלוואות, אקסלנס והעברות הון",
                        bold: true,
                      },
                    ].map((row) => (
                      <TableRow key={row.name} className={row.bold ? "font-semibold" : ""}>
                        <TableCell>{row.name}</TableCell>
                        <TableCell dir="ltr" className="text-right tabular-nums">
                          {row.val}
                        </TableCell>
                        <TableCell dir="ltr" className="text-right tabular-nums">
                          {row.pct}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.note}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Living Expenses Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">הוצאות מחיה חודשיות מנורמלות</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">סעיף הוצאה</TableHead>
                      <TableHead className="text-right">ממוצע חודשי</TableHead>
                      <TableHead className="text-right">משקל</TableHead>
                      <TableHead className="text-right">פירוט</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      {
                        name: "כרטיסי אשראי שוטפים (5644 + 6813 + 8838)",
                        val: fmtILS(avgCcRec),
                        pct: `${Math.round((avgCcRec / Math.max(1, avgNormExp)) * 100)}%`,
                        note: "ללא הפקדות Kraken וללא חופשות/חד-פעמי (מוחרג בשכבת החישוב)",
                      },
                      {
                        name: "משכנתא (טפחות-משכנתא-י)",
                        val: fmtILS(avgMortgage),
                        pct: `${Math.round((avgMortgage / Math.max(1, avgNormExp)) * 100)}%`,
                        note: "יציבה סביב ~₪7,200 לחודש על פני 3 מסלולים",
                      },
                      {
                        name: "העברות דיגיטל ואינטרנט שוטפות (<₪2,000)",
                        val: fmtILS(avgRegTransfers),
                        pct: `${Math.round((avgRegTransfers / Math.max(1, avgNormExp)) * 100)}%`,
                        note: "כ-82% מהן כפולות מדויקות של ₪450",
                      },
                      {
                        name: "החזרי הלוואות בנקאיות חודשיים",
                        val: fmtILS(avgLoansMo),
                        pct: `${Math.round((avgLoansMo / Math.max(1, avgNormExp)) * 100)}%`,
                        note: "תשלומי הלוואות חודשיים שוטפים (ללא סילוקי קרן מוקדמים)",
                      },
                      {
                        name: "ועד בית (הוראת קבע ₪454)",
                        val: fmtILS(avgVaad),
                        pct: `${Math.round((avgVaad / Math.max(1, avgNormExp)) * 100)}%`,
                        note: "אושר כהוצאת ועד בית חודשית קבועה",
                      },
                      {
                        name: "משיכות מזומן ושיקים",
                        val: fmtILS(avgCashChecks),
                        pct: `${Math.round((avgCashChecks / Math.max(1, avgNormExp)) * 100)}%`,
                        note: "כספומט ושיקים שוטפים",
                      },
                      {
                        name: "קופת חולים ועמלות בנק",
                        val: fmtILS(avgHealthFeesOut),
                        pct: `${Math.round((avgHealthFeesOut / Math.max(1, avgNormExp)) * 100)}%`,
                        note: "חיובי שירותי בריאות בהרשאה ועמלות עו״ש",
                      },
                      {
                        name: "סה״כ הוצאת מחיה קבועה מנורמלת",
                        val: fmtILS(avgNormExp),
                        pct: "100%",
                        note: "כולל ועד בית ₪454; ללא חופשות וללא חיסכון",
                        bold: true,
                      },
                    ].map((row) => (
                      <TableRow key={row.name} className={row.bold ? "font-semibold" : ""}>
                        <TableCell>{row.name}</TableCell>
                        <TableCell dir="ltr" className="text-right tabular-nums">
                          {row.val}
                        </TableCell>
                        <TableCell dir="ltr" className="text-right tabular-nums">
                          {row.pct}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.note}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Confirmed Savings Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                צבירת הון וחיסכון מוכחת של משק הבית ({fmtILS(totalSavingsAllMonths)} סה״כ)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">אפיק חיסכון / השקעה</TableHead>
                    <TableHead className="text-right">תדירות</TableHead>
                    <TableHead className="text-right">סה״כ מצטבר</TableHead>
                    <TableHead className="text-right">שווה-ערך חודשי</TableHead>
                    <TableHead className="text-right">פירוט</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.savings_vehicles.map((sv) => (
                    <TableRow key={sv.name}>
                      <TableCell className="font-medium">{sv.name}</TableCell>
                      <TableCell className="text-xs">{sv.cadence}</TableCell>
                      <TableCell dir="ltr" className="text-right font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                        {fmtILS(sv.total)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-right tabular-nums">
                        {fmtILS(sv.monthly_equiv)}/חודש
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sv.details}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Credit Card Category Drilldown BarChart */}
          {data.cc_categories.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  פילוח כרטיסי האשראי לפי קטגוריה (מתוך app.db · שוטף מול חופשות וחד-פעמי)
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  ממוצע חודשי בשקלים על פני כל חודשי האשראי שהועלו (קטגוריית נסיעות וחו״ל מופרדת במלואה לעמודת החד-פעמי בשכבת החישוב)
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-[420px] w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.cc_categories}
                      layout="vertical"
                      margin={{ top: 5, right: 25, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v: number) => `₪${v.toLocaleString("en-US")}`}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={240}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip formatter={(val) => fmtILS(Number(val ?? 0))} />
                      <Legend />
                      <Bar
                        dataKey="rec_mo"
                        name="בסיס שוטף חודשי (₪)"
                        fill="#3b82f6"
                      />
                      <Bar
                        dataKey="ot_mo"
                        name="חופשות וחד-פעמי מוחרג (₪)"
                        fill="#f59e0b"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ===================== TAB 3: ANOMALIES, TRIPS & TRANSFERS ===================== */}
      {activeTab === "anomalies" && (
        <div className="space-y-6">
          {/* Trips & Open Installments Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                ריכוז טיולים, חופשות והתחייבויות תשלומים פתוחות (כולל ברצלונה אוקטובר 2026)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                מחושב דינמית מתוך עסקאות האשראי ותנועות הבנק — כל הסכומים מוחרגים מבסיס המחיה החודשי
              </p>
            </CardHeader>
            <CardContent className="space-y-5 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">טיול / חופשה</TableHead>
                    <TableHead className="text-right">מועד חיוב</TableHead>
                    <TableHead className="text-right">כבר ירד מהבנק</TableHead>
                    <TableHead className="text-right">יתרה עתידית צפויה</TableHead>
                    <TableHead className="text-right">סה״כ משוער</TableHead>
                    <TableHead className="text-right">סטטוס תזרימי</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.trips_summary.map((tr) => (
                    <TableRow key={tr.trip}>
                      <TableCell className="font-medium">{tr.trip}</TableCell>
                      <TableCell className="text-xs">{tr.timing}</TableCell>
                      <TableCell dir="ltr" className="text-right tabular-nums">
                        {fmtILS(tr.billed_so_far)}
                      </TableCell>
                      <TableCell
                        dir="ltr"
                        className={`text-right font-medium tabular-nums ${
                          tr.remaining_future > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {tr.remaining_future > 0
                          ? fmtILS(tr.remaining_future)
                          : "₪0"}
                      </TableCell>
                      <TableCell dir="ltr" className="text-right font-semibold tabular-nums">
                        {fmtILS(tr.total_est)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {tr.status}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {data.open_installments.length > 0 && (
                <div className="space-y-2 border-t pt-4">
                  <h4 className="text-sm font-semibold">
                    עסקאות תשלומים פתוחות בכרטיסי האשראי (זוהו אוטומטית מהחודש האחרון ב-app.db)
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">בית עסק</TableHead>
                        <TableHead className="text-right">כרטיס</TableHead>
                        <TableHead className="text-right">תשלום נוכחי</TableHead>
                        <TableHead className="text-right">חיוב חודשי</TableHead>
                        <TableHead className="text-right">יתרה לתשלום</TableHead>
                        <TableHead className="text-right">עסקה מקורית</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.open_installments.map((inst, idx) => (
                        <TableRow key={`${inst.description}-${idx}`}>
                          <TableCell className="font-medium">
                            {inst.description}{" "}
                            {inst.is_travel && (
                              <Badge variant="secondary" className="ms-1 text-[10px]">
                                חופשה / מוחרג
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{inst.card_label}</TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {inst.current_installment} מתוך {inst.total_installments} (נותרו{" "}
                            {inst.remaining_installments})
                          </TableCell>
                          <TableCell dir="ltr" className="text-right tabular-nums">
                            {fmtILS(inst.monthly_amount)}
                          </TableCell>
                          <TableCell dir="ltr" className="text-right font-medium text-amber-600 tabular-nums dark:text-amber-400">
                            {fmtILS(inst.remaining_total)}
                          </TableCell>
                          <TableCell dir="ltr" className="text-right tabular-nums">
                            {fmtILS(inst.original_total)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tier 1: Washes & Loans */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                שכבה 1: עסקאות סיבוביות (Wash), מק״מ וקרן הלוואות
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">קטגוריה</TableHead>
                    <TableHead className="text-right">כמות</TableHead>
                    <TableHead className="text-right">סה״כ כניסות (+)</TableHead>
                    <TableHead className="text-right">סה״כ יציאות (-)</TableHead>
                    <TableHead className="text-right">השפעה נטו</TableHead>
                    <TableHead className="text-right">הסבר</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.wash_ledger.map((w) => (
                    <TableRow key={w.category}>
                      <TableCell className="font-medium">{w.category}</TableCell>
                      <TableCell className="text-xs">{w.count_label}</TableCell>
                      <TableCell dir="ltr" className="text-right tabular-nums">
                        {fmtILS(w.inflows)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-right tabular-nums">
                        {fmtILS(w.outflows)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-right font-semibold tabular-nums">
                        {fmtSignedILS(w.net)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {w.detail}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Tier 2A: Interactive External Transfers Tagger */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  שכבה 2א: תיוג העברות בנקאיות חיצוניות (נשמר במסד הנתונים ולא נדרס בהעלאות עתידיות)
                </CardTitle>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">מניות והשקעות: {fmtILS(tagTotals.stock)}</Badge>
                  <Badge variant="secondary">מתנות משפחה: {fmtILS(tagTotals.gift)}</Badge>
                  <Badge variant="secondary">החזרי הוצאות: {fmtILS(tagTotals.reimbursement)}</Badge>
                  <Badge variant="secondary">רזרבה: {fmtILS(tagTotals.reserve)}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">תאריך</TableHead>
                    <TableHead className="text-right">מקור ואסמכתא</TableHead>
                    <TableHead className="text-right">סכום</TableHead>
                    <TableHead className="text-right">הקשר תזרימי בדף החשבון</TableHead>
                    <TableHead className="text-right">סיווג (נשמר ב-DB)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.external_transfers.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell dir="ltr" className="text-right text-xs tabular-nums">
                        {fmtIsoDateHe(t.date)}
                      </TableCell>
                      <TableCell className="font-medium">{t.source}</TableCell>
                      <TableCell dir="ltr" className="text-right font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                        {fmtILS(t.amount)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.context}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={t.tag}
                          onValueChange={(val) =>
                            handleTransferTagChange(t.id, val as TransferTag)
                          }
                        >
                          <SelectTrigger className="h-8 w-[190px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TRANSFER_TAG_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Tier 2B: Other Anomaly Inflows */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                שכבה 2ב: הכנסות חד-פעמיות נוספות (בונוסים, מכירת רכב, דמי אבטלה והחזרי מס)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">מקור תקבול</TableHead>
                    <TableHead className="text-right">תנועות</TableHead>
                    <TableHead className="text-right">סה״כ מצטבר</TableHead>
                    <TableHead className="text-right">שווה-ערך חודשי</TableHead>
                    <TableHead className="text-right">הסבר</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.other_anomaly_inflows.map((row) => (
                    <TableRow key={row.source}>
                      <TableCell className="font-medium">{row.source}</TableCell>
                      <TableCell className="tabular-nums">{row.count}</TableCell>
                      <TableCell dir="ltr" className="text-right font-semibold tabular-nums">
                        {fmtILS(row.total)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-right tabular-nums">
                        {fmtILS(row.monthly_equiv)}/חודש
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.explanation}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Tier 3: One-Time Outflows */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                שכבה 3: הוצאות חד-פעמיות ורכישת נכסים ({fmtILS(totalOneTimeAllMonths)} סה״כ)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">סעיף יציאה חד-פעמית</TableHead>
                    <TableHead className="text-right">היקף</TableHead>
                    <TableHead className="text-right">סה״כ מצטבר</TableHead>
                    <TableHead className="text-right">שווה-ערך חודשי</TableHead>
                    <TableHead className="text-right">פירוט</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.one_time_outflows.map((o) => (
                    <TableRow key={o.bucket}>
                      <TableCell className="font-medium">{o.bucket}</TableCell>
                      <TableCell className="text-xs">{o.scope}</TableCell>
                      <TableCell dir="ltr" className="text-right font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                        {fmtILS(o.total)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-right tabular-nums">
                        {fmtILS(o.monthly_equiv)}/חודש
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {o.details}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Capital Events Reconstruction */}
          {data.capital_events.map((ev) => (
            <Card key={ev.title}>
              <CardHeader>
                <CardTitle className="text-base">{ev.title}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">תאריך</TableHead>
                      <TableHead className="text-right">תיאור</TableHead>
                      <TableHead className="text-right">אסמכתא</TableHead>
                      <TableHead className="text-right">תזרים</TableHead>
                      <TableHead className="text-right">תפקיד באירוע</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ev.items.map((item, idx) => (
                      <TableRow key={`${item.date}-${idx}`}>
                        <TableCell dir="ltr" className="text-right text-xs tabular-nums">
                          {fmtIsoDateHe(item.date)}
                        </TableCell>
                        <TableCell className="font-medium">{item.description}</TableCell>
                        <TableCell dir="ltr" className="text-right text-xs tabular-nums">
                          {item.reference}
                        </TableCell>
                        <TableCell
                          dir="ltr"
                          className={`text-right font-semibold tabular-nums ${
                            item.signed_amount >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {fmtSignedILS(item.signed_amount)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.role}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell colSpan={3}>השפעה נטו על יתרת העו״ש באירוע</TableCell>
                      <TableCell dir="ltr" className="text-right tabular-nums">
                        {fmtSignedILS(ev.net_checking_impact)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        בנוסף לתשלום החודשי של ההלוואה החדשה מהחודש העוקב
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ===================== TAB 4: DYNAMIC INSIGHTS ===================== */}
      {activeTab === "insights" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">
              תובנות פיננסיות דינמיות (מחושבות בזמן אמת ממסד הנתונים)
            </h2>
          </div>

          {data.insights.map((ins) => {
            const isOpen = openInsights[ins.id] ?? true
            return (
              <Card key={ins.id}>
                <CardHeader
                  className="cursor-pointer py-4"
                  onClick={() =>
                    setOpenInsights((prev) => ({ ...prev, [ins.id]: !isOpen }))
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <CardTitle className="text-base">{ins.title}</CardTitle>
                      <Badge variant="secondary" className="text-xs">
                        {ins.badge}
                      </Badge>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </div>
                </CardHeader>
                {isOpen && (
                  <CardContent className="pt-0 text-sm leading-relaxed text-muted-foreground">
                    {ins.body}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* ===================== TAB 5: RAW BANK LEDGER ===================== */}
      {activeTab === "ledger" && (
        <BankLedgerTab availableMonths={data.monthly.map((m) => m.ym)} />
      )}
    </div>
  )
}
