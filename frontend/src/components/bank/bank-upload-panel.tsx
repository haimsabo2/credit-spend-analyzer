import { useRef, useState } from "react"
import { Link } from "react-router-dom"
import { CheckCircle2, FileSpreadsheet, Landmark, Loader2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getApiErrorToastDescription } from "@/lib/api-client"
import {
  useBankStatus,
  useUploadBankStatements,
  type BankUploadResponse,
} from "@/api/bank"

function formatIsoDateHe(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parts = iso.split("-")
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

interface BankUploadPanelProps {
  /** Show link button to navigate to /bank-cashflow after upload (useful inside /upload page). */
  showGoToCashflowLink?: boolean
  onUploaded?: (res: BankUploadResponse) => void
}

export function BankUploadPanel({
  showGoToCashflowLink = false,
  onUploaded,
}: BankUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [lastResult, setLastResult] = useState<BankUploadResponse | null>(null)

  const { data: status } = useBankStatus()
  const uploadMut = useUploadBankStatements()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    const valid = selected.filter(
      (f) =>
        f.name.toLowerCase().endsWith(".xls") ||
        f.name.toLowerCase().endsWith(".xlsx"),
    )
    if (valid.length < selected.length) {
      toast.error("נתמכים קבצי תדפיס תנועות בחשבון בפורמט .xls / .xlsx בלבד")
    }
    if (valid.length > 0) {
      setFiles((prev) => {
        const seen = new Set(prev.map((x) => `${x.name}:${x.size}`))
        const next = [...prev]
        for (const v of valid) {
          const k = `${v.name}:${v.size}`
          if (!seen.has(k)) {
            seen.add(k)
            next.push(v)
          }
        }
        return next
      })
    }
    e.target.value = ""
  }

  const removeFile = (target: File) => {
    setFiles((prev) =>
      prev.filter((f) => `${f.name}:${f.size}` !== `${target.name}:${target.size}`),
    )
  }

  const handleSubmit = async () => {
    if (!files.length || uploadMut.isPending) return
    try {
      const res = await uploadMut.mutateAsync(files)
      setLastResult(res)
      setFiles([])
      if (inputRef.current) inputRef.current.value = ""
      if (res.total_inserted > 0) {
        toast.success(
          `נוספו ${res.total_inserted.toLocaleString("he-IL")} תנועות עו״ש חדשות (דולגו ${res.total_skipped_duplicates.toLocaleString("he-IL")} תנועות קיימות)`,
        )
      } else {
        toast.info(
          `לא נמצאו תנועות חדשות — כל ${res.total_skipped_duplicates.toLocaleString("he-IL")} השורות בקובץ כבר קיימות במערכת`,
        )
      }
      onUploaded?.(res)
    } catch (err) {
      const desc = getApiErrorToastDescription(err)
      toast.error("העלאת תדפיס העו״ש נכשלה", desc ? { description: desc } : undefined)
    }
  }

  return (
    <div dir="rtl" className="space-y-4 rounded-lg border bg-card p-5 text-right">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold">
              קליטה מצטברת של תדפיסי חשבון בנק (עו״ש)
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            העלה קובץ &quot;תנועות בחשבון&quot; (‎.xls) מבנק לאומי מכל טווח תאריכים. המערכת מזהה אוטומטית מהו המידע האחרון שכבר נקלט, מדלגת על שורות חופפות בלי לדרוס סיווגים ותיוגים ידניים, ומוסיפה אך ורק תנועות חדשות.
          </p>
        </div>

        {status?.has_data && (
          <Badge variant="secondary" className="shrink-0 gap-1.5 px-2.5 py-1 text-xs">
            <span>תנועה אחרונה במערכת:</span>
            <span dir="ltr" className="font-semibold tabular-nums">
              {formatIsoDateHe(status.last_synced_date)}
            </span>
            <span>
              ({status.total_transactions.toLocaleString("he-IL")} שורות)
            </span>
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="bank-xls-input"
          className="block text-sm font-medium"
        >
          בחירת קובץ תנועות בחשבון (‎.xls)
        </label>
        <input
          id="bank-xls-input"
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx,application/vnd.ms-excel"
          multiple
          disabled={uploadMut.isPending}
          onChange={handleFileChange}
          className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground disabled:opacity-50"
        />
      </div>

      {files.length > 0 && (
        <ul className="max-h-36 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2 text-sm">
          {files.map((f) => (
            <li
              key={`${f.name}:${f.size}`}
              className="flex items-center justify-between gap-2 py-0.5"
            >
              <span className="flex min-w-0 items-center gap-2 truncate">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => removeFile(f)}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={files.length === 0 || uploadMut.isPending}
          onClick={handleSubmit}
        >
          {uploadMut.isPending ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
              קולט ומסנכרן תנועות…
            </>
          ) : (
            <>
              <Upload className="me-2 h-4 w-4" />
              העלה והוסף תנועות חדשות
            </>
          )}
        </Button>

        {showGoToCashflowLink && (
          <Button variant="outline" asChild>
            <Link to="/bank-cashflow">מעבר לעמוד תזרים ובנק</Link>
          </Button>
        )}
      </div>

      {lastResult && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
          <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              סנכרון הושלם: נוספו{" "}
              <strong>{lastResult.total_inserted.toLocaleString("he-IL")}</strong>{" "}
              תנועות חדשות · דולגו{" "}
              <strong>
                {lastResult.total_skipped_duplicates.toLocaleString("he-IL")}
              </strong>{" "}
              תנועות שכבר היו במערכת
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">
            נקודת סנכרון קודמת:{" "}
            <span dir="ltr" className="tabular-nums">
              {formatIsoDateHe(lastResult.previous_max_date)}
            </span>{" "}
            ← מעודכן כעת עד:{" "}
            <span dir="ltr" className="font-medium tabular-nums">
              {formatIsoDateHe(lastResult.new_max_date)}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
