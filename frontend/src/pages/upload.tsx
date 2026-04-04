import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
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
import { useUploadJobStore } from "@/stores/upload-job-store"
import { formatMonthShort } from "@/utils/format"
import { recentMonths } from "@/utils/month"
import { inferStatementMonthFromFiles } from "@/utils/infer-month-from-filename"
import { CategorizeStageLine } from "@/components/upload/categorize-stage-line"
import { Loader2, X } from "lucide-react"

function fileKey(f: File): string {
  return `${f.name}:${f.size}`
}

function mergeXlsFiles(prev: File[], added: File[]): File[] {
  const seen = new Set(prev.map(fileKey))
  const out = [...prev]
  for (const f of added) {
    const k = fileKey(f)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(f)
  }
  return out
}

export default function UploadPage() {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { month: storeMonth, setMonth: setStoreMonth } = useMonthStore()
  const [month, setMonth] = useState(storeMonth)
  const monthOptions = useMemo(() => {
    const base = recentMonths(48)
    return month && !base.includes(month) ? [month, ...base] : base
  }, [month])
  const [files, setFiles] = useState<File[]>([])
  const [replaceMonth, setReplaceMonth] = useState(false)
  const [enrichOnly, setEnrichOnly] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const monthLockedByUserRef = useRef(false)

  const phase = useUploadJobStore((s) => s.phase)
  const jobMonth = useUploadJobStore((s) => s.month)
  const fileSlots = useUploadJobStore((s) => s.fileSlots)
  const uploadPercent = useUploadJobStore((s) => s.uploadPercent)
  const categorizePercent = useUploadJobStore((s) => s.categorizePercent)
  const errorMessage = useUploadJobStore((s) => s.errorMessage)
  const beginJob = useUploadJobStore((s) => s.beginJob)
  const dismiss = useUploadJobStore((s) => s.dismiss)

  const jobRunning = phase === "uploading" || phase === "categorizing"

  const handleMonthChange = (m: string) => {
    monthLockedByUserRef.current = true
    setMonth(m)
    setStoreMonth(m)
  }

  useEffect(() => {
    if (files.length === 0) {
      monthLockedByUserRef.current = false
      return
    }
    if (monthLockedByUserRef.current) return
    const { month: inferred, conflict } = inferStatementMonthFromFiles(files)
    if (inferred) {
      setMonth(inferred)
      setStoreMonth(inferred)
      if (conflict) {
        toast.info(t("upload.filenameMonthConflict"))
      }
    }
  }, [files, setStoreMonth, t])

  const addFilesFromList = (list: FileList | File[]) => {
    const arr = Array.from(list)
    const valid: File[] = []
    const rejected: string[] = []
    for (const f of arr) {
      if (f.name.toLowerCase().endsWith(".xls")) {
        valid.push(f)
      } else {
        rejected.push(f.name)
      }
    }
    if (rejected.length) {
      toast.error(t("upload.invalidFileType"))
    }
    if (valid.length) {
      setFiles((prev) => mergeXlsFiles(prev, valid))
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list?.length) {
      return
    }
    addFilesFromList(list)
    e.target.value = ""
  }

  const removeFile = (f: File) => {
    setFiles((prev) => prev.filter((x) => fileKey(x) !== fileKey(f)))
  }

  const startPipeline = () => {
    const ok = beginJob(month, replaceMonth, enrichOnly, files)
    if (!ok) {
      toast.error(t("upload.jobAlreadyRunning"))
      return
    }
    setFiles([])
    setReplaceMonth(false)
    setEnrichOnly(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
    setConfirmOpen(false)
  }

  const handleSubmit = () => {
    if (files.length === 0 || jobRunning) return
    if (replaceMonth && !enrichOnly) {
      setConfirmOpen(true)
      return
    }
    startPipeline()
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("upload.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("upload.mergeHint")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("upload.replaceHint")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("upload.statementMonthHint")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("upload.jobParallelNote")}</p>
      </div>

      {(phase === "uploading" || phase === "categorizing" || phase === "error" || phase === "completed") && (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {phase === "uploading" && t("upload.jobPhaseUpload")}
              {phase === "categorizing" && t("upload.jobPhaseCategorize")}
              {phase === "completed" && t("upload.jobPhaseDone")}
              {phase === "error" && t("upload.jobPhaseError")}
            </span>
            <span className="text-muted-foreground text-xs">{jobMonth}</span>
          </div>
          {phase === "uploading" && (
            <>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t("upload.jobProgressUpload")}</span>
                <span>{uploadPercent}%</span>
              </div>
              <Progress value={uploadPercent} />
            </>
          )}
          {phase === "categorizing" && (
            <>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t("upload.jobProgressCategorize")}</span>
                <span>{categorizePercent}%</span>
              </div>
              <Progress value={categorizePercent} />
              <CategorizeStageLine phase={phase} />
            </>
          )}
          {fileSlots.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
              {fileSlots.map((s) => (
                <li key={s.id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{s.name}</span>
                  <span className="text-muted-foreground shrink-0">{t(`upload.jobFileStatus.${s.status}`)}</span>
                </li>
              ))}
            </ul>
          )}
          {phase === "error" && errorMessage && (
            <p className="text-destructive text-xs break-words">
              {errorMessage === "refresh_lost_job"
                ? t("upload.jobErrorRefreshLost")
                : errorMessage === "categorize_stuck"
                  ? t("upload.jobErrorStuck")
                  : errorMessage === "no_files"
                    ? t("upload.jobErrorNoFiles")
                    : errorMessage}
            </p>
          )}
          {(phase === "completed" || phase === "error") && (
            <Button variant="outline" size="sm" onClick={() => dismiss()}>
              {t("upload.jobDismiss")}
            </Button>
          )}
        </div>
      )}

      <div className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-2">
          <span className="text-sm font-medium">{t("upload.statementMonth")}</span>
          <Select value={month} onValueChange={handleMonthChange} disabled={jobRunning}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => (
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
          <p className="text-xs text-muted-foreground">{t("upload.selectFileHint")}</p>
          <input
            id="upload-file"
            aria-labelledby="upload-file-label"
            ref={fileInputRef}
            type="file"
            accept=".xls,application/vnd.ms-excel"
            multiple
            disabled={jobRunning}
            className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground disabled:opacity-50"
            onChange={onFileChange}
          />
        </div>

        {files.length > 0 && !jobRunning && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2 text-sm">
            {files.map((f) => (
              <li key={fileKey(f)} className="flex items-center justify-between gap-2 py-0.5">
                <span className="min-w-0 truncate" title={f.name}>
                  {f.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => removeFile(f)}
                  aria-label={t("upload.removeFile")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-start gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
          <Checkbox
            id="enrich-only"
            checked={enrichOnly}
            disabled={jobRunning}
            onCheckedChange={(c) => {
              const v = c === true
              setEnrichOnly(v)
              if (v) setReplaceMonth(false)
            }}
          />
          <div className="grid gap-1">
            <label htmlFor="enrich-only" className="cursor-pointer text-sm font-medium leading-none">
              {t("upload.enrichOnlyCheckbox")}
            </label>
            <p className="text-xs text-muted-foreground">{t("upload.enrichOnlyHint")}</p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <Checkbox
            id="replace-month"
            checked={replaceMonth}
            disabled={jobRunning || enrichOnly}
            onCheckedChange={(c) => {
              const v = c === true
              setReplaceMonth(v)
              if (v) setEnrichOnly(false)
            }}
          />
          <div className="grid gap-1">
            <label htmlFor="replace-month" className="cursor-pointer text-sm font-medium leading-none">
              {t("upload.replaceCheckbox")}
            </label>
          </div>
        </div>

        <Button
          type="button"
          disabled={files.length === 0 || jobRunning}
          className="w-full sm:w-auto"
          onClick={handleSubmit}
        >
          {jobRunning ? (
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
              {files.length <= 1
                ? t("upload.confirmReplaceDescriptionOne", { month })
                : t("upload.confirmReplaceDescriptionMany", { month, fileCount: files.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                startPipeline()
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
