import { useState } from "react"
import { Search } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
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
import { getApiErrorToastDescription } from "@/lib/api-client"
import {
  useBankTransactions,
  usePatchBankTransaction,
  type BankFlowGroup,
} from "@/api/bank"

const FLOW_GROUP_OPTIONS: Array<{ value: BankFlowGroup; label: string }> = [
  { value: "income_regular", label: "הכנסה שוטפת (בסיס)" },
  { value: "income_unemployment", label: "דמי אבטלה (ביטוח לאומי)" },
  { value: "income_anomaly", label: "הכנסה חריגה / הון" },
  { value: "wash_in", label: "כניסה סיבובית / הלוואה" },
  { value: "expense_cc", label: "חיוב כרטיס אשראי" },
  { value: "expense_living", label: "הוצאת מחיה שוטפת" },
  { value: "savings", label: "חיסכון והשקעה" },
  { value: "expense_anomaly", label: "הוצאה חד-פעמית / נכס" },
  { value: "wash_out", label: "יציאה סיבובית / סילוק הלוואה" },
]

function fmtShekel(n: number): string {
  const sign = n < 0 ? "-" : ""
  return `${sign}₪${Math.round(Math.abs(n)).toLocaleString("en-US")}`
}

function fmtDateHe(iso: string): string {
  const p = iso.split("-")
  if (p.length !== 3) return iso
  return `${p[2]}/${p[1]}/${p[0]}`
}

interface BankLedgerTabProps {
  availableMonths: string[]
}

export function BankLedgerTab({ availableMonths }: BankLedgerTabProps) {
  const [monthFilter, setMonthFilter] = useState<string>("all")
  const [flowFilter, setFlowFilter] = useState<string>("all")
  const [search, setSearch] = useState<string>("")

  const { data, isLoading } = useBankTransactions({
    month: monthFilter === "all" ? undefined : monthFilter,
    flow_group: flowFilter === "all" ? undefined : flowFilter,
    q: search.trim() || undefined,
    limit: 500,
  })
  const patchMut = usePatchBankTransaction()

  const handleFlowChange = async (id: number, nextGroup: BankFlowGroup) => {
    try {
      await patchMut.mutateAsync({ id, flow_group: nextGroup })
      toast.success("סיווג התנועה נשמר במסד הנתונים והתזרים חושב מחדש")
    } catch (err) {
      const desc = getApiErrorToastDescription(err)
      toast.error("שגיאה בעדכון סיווג התנועה", desc ? { description: desc } : undefined)
    }
  }

  return (
    <div dir="rtl" className="space-y-4 text-right">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי תיאור או אסמכתא…"
            className="ps-9"
          />
        </div>

        <Select value={monthFilter} onValueChange={setMonthFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="כל החודשים" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל החודשים</SelectItem>
            {[...availableMonths].reverse().map((ym) => (
              <SelectItem key={ym} value={ym}>
                {ym}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={flowFilter} onValueChange={setFlowFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="כל קבוצות התזרים" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל קבוצות התזרים</SelectItem>
            {FLOW_GROUP_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {data && (
          <Badge variant="secondary" className="text-xs">
            מציג {data.items.length.toLocaleString("he-IL")} מתוך{" "}
            {data.total.toLocaleString("he-IL")} תנועות
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">תאריך</TableHead>
                <TableHead className="text-right">תיאור</TableHead>
                <TableHead className="text-right">אסמכתא</TableHead>
                <TableHead className="text-right">חובה (-)</TableHead>
                <TableHead className="text-right">זכות (+)</TableHead>
                <TableHead className="text-right">יתרה</TableHead>
                <TableHead className="text-right">סיווג בתזרים (נשמר ב-DB)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span dir="ltr" className="text-xs tabular-nums">
                      {fmtDateHe(row.activity_date)}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{row.description}</span>
                      {row.is_user_override && (
                        <Badge variant="outline" className="text-[10px]">
                          מותאם אישית
                        </Badge>
                      )}
                    </div>
                    {row.context_note && (
                      <p className="text-xs text-muted-foreground">
                        {row.context_note}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span dir="ltr" className="text-xs text-muted-foreground tabular-nums">
                      {row.reference || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.debit > 0 ? (
                      <span
                        dir="ltr"
                        className="font-medium text-rose-600 tabular-nums dark:text-rose-400"
                      >
                        -{fmtShekel(row.debit)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.credit > 0 ? (
                      <span
                        dir="ltr"
                        className="font-medium text-emerald-600 tabular-nums dark:text-emerald-400"
                      >
                        +{fmtShekel(row.credit)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.balance != null ? (
                      <span dir="ltr" className="text-xs tabular-nums">
                        {fmtShekel(row.balance)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={row.flow_group}
                      onValueChange={(val) =>
                        handleFlowChange(row.id, val as BankFlowGroup)
                      }
                    >
                      <SelectTrigger className="h-8 w-[210px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FLOW_GROUP_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {data && data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    לא נמצאו תנועות התואמות לסינון הנוכחי.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
