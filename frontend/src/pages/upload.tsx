import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useMonthStore } from "@/stores/use-month-store"
import { useUploadFile } from "@/hooks/use-upload-file"
import { formatMonthShort } from "@/utils/format"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

function last12Months(): string[] {
  const now = new Date()
  const months: string[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }
  return months
}

export default function UploadPage() {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { month: storeMonth, setMonth: setStoreMonth } = useMonthStore()
  const months = useMemo(() => last12Months(), [])
  const [month, setMonth] = useState(storeMonth)
  const [file, setFile] = useState<File | null>(null)
  const [replaceMonth, setReplaceMonth] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const upload = useUploadFile()

  const handleMonthChange = (m: string) => {
    setMonth(m)
    setStoreMonth(m)
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) {
      setFile(null)
      return
    }
    if (!f.name.toLowerCase().endsWith(".xls")) {
      setFile(null)
      e.target.value = ""
      toast.error(t("upload.invalidFileType"))
      return
    }
    setFile(f)
  }

  const runUpload = () => {
    if (!file) return
    upload.mutate(
      { file, month, replaceMonth },
      {
        onSuccess() {
          setFile(null)
          setReplaceMonth(false)
          if (fileInputRef.current) fileInputRef.current.value = ""
        },
      },
    )
    setConfirmOpen(false)
  }

  const handleSubmit = () => {
    if (!file) return
    if (replaceMonth) {
      setConfirmOpen(true)
      return
    }
    runUpload()
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("upload.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("upload.mergeHint")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("upload.replaceHint")}</p>
      </div>

      <div className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-2">
          <span className="text-sm font-medium">{t("dashboard.month")}</span>
          <Select value={month} onValueChange={handleMonthChange}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m} value={m}>
                  {formatMonthShort(m)} {m.slice(0, 4)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium" id="upload-file-label">
            {t("upload.selectFile")}
          </span>
          <input
            id="upload-file"
            aria-labelledby="upload-file-label"
            ref={fileInputRef}
            type="file"
            accept=".xls,application/vnd.ms-excel"
            className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground"
            onChange={onFileChange}
          />
        </div>

        <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <Checkbox
            id="replace-month"
            checked={replaceMonth}
            onCheckedChange={(c) => setReplaceMonth(c === true)}
          />
          <div className="grid gap-1">
            <label htmlFor="replace-month" className="cursor-pointer text-sm font-medium leading-none">
              {t("upload.replaceCheckbox")}
            </label>
          </div>
        </div>

        <Button
          type="button"
          disabled={!file || upload.isPending}
          className="w-full sm:w-auto"
          onClick={handleSubmit}
        >
          {upload.isPending ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
              {t("upload.uploading")}
            </>
          ) : (
            t("upload.submit")
          )}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("upload.confirmReplaceTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("upload.confirmReplaceDescription", { month })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                runUpload()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("upload.confirmReplaceAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
