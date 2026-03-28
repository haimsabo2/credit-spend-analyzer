import { useState, useRef, useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useMonthStore, formatMonthLabel } from "@/stores/use-month-store"
import { formatUploadTimestamp } from "@/utils/format"
import { useUploadJobStore } from "@/stores/upload-job-store"
import { useUploads } from "@/hooks/use-uploads"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { UploadCloud, FileSpreadsheet, Loader2, Inbox, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { inferStatementMonthFromFiles } from "@/utils/infer-month-from-filename"

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

export default function MonthsPage() {
  const { t } = useTranslation()
  const month = useMonthStore((s) => s.month)
  const setMonth = useMonthStore((s) => s.setMonth)
  const uploads = useUploads()
  const beginJob = useUploadJobStore((s) => s.beginJob)
  const phase = useUploadJobStore((s) => s.phase)
  const jobRunning = phase === "uploading" || phase === "categorizing"

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadMonth, setUploadMonth] = useState(month)
  const [dragOver, setDragOver] = useState(false)
  const uploadMonthLockedRef = useRef(false)

  const addXlsFiles = useCallback((list: FileList | File[]) => {
    const valid: File[] = []
    for (const f of Array.from(list)) {
      if (f.name.toLowerCase().endsWith(".xls")) valid.push(f)
    }
    if (valid.length) {
      setSelectedFiles((prev) => mergeXlsFiles(prev, valid))
    }
  }, [])

  useEffect(() => {
    if (selectedFiles.length === 0) {
      uploadMonthLockedRef.current = false
      return
    }
    if (uploadMonthLockedRef.current) return
    const { month: inferred, conflict } = inferStatementMonthFromFiles(selectedFiles)
    if (inferred) {
      setUploadMonth(inferred)
      setMonth(inferred)
      if (conflict) {
        toast.info(t("upload.filenameMonthConflict"))
      }
    }
  }, [selectedFiles, setMonth, t])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (jobRunning) return
    if (e.dataTransfer.files?.length) addXlsFiles(e.dataTransfer.files)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!jobRunning) setDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
  }

  function handleBrowse() {
    if (jobRunning) return
    fileInputRef.current?.click()
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files
    if (list?.length) addXlsFiles(list)
    e.target.value = ""
  }

  function handleUpload() {
    if (selectedFiles.length === 0 || jobRunning) return
    const ok = beginJob(uploadMonth, false, selectedFiles)
    if (!ok) {
      toast.error(t("upload.jobAlreadyRunning"))
      return
    }
    setSelectedFiles([])
  }

  function handleClear() {
    setSelectedFiles([])
  }

  function removeSelectedFile(f: File) {
    setSelectedFiles((prev) => prev.filter((x) => fileKey(x) !== fileKey(f)))
  }

  function handleRowClick(rowMonth: string) {
    setMonth(rowMonth)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Months</h1>
        <p className="text-sm text-muted-foreground">
          {t("upload.monthsIntro")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UploadCloud className="h-5 w-5 text-muted-foreground" />
            Upload Statement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleBrowse}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
              jobRunning && "pointer-events-none opacity-50",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50",
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls"
              multiple
              disabled={jobRunning}
              className="hidden"
              onChange={handleInputChange}
            />
            {selectedFiles.length > 0 ? (
              <>
                <FileSpreadsheet className="h-10 w-10 text-emerald-600" />
                <div className="w-full max-w-md space-y-1 text-start">
                  <p className="text-center font-medium">
                    {selectedFiles.length === 1
                      ? t("monthsPage.filesSelectedSingle")
                      : t("monthsPage.filesSelectedMulti", { count: selectedFiles.length })}
                  </p>
                  <ul className="max-h-28 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                    {selectedFiles.map((f) => (
                      <li key={fileKey(f)} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{f.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          disabled={jobRunning}
                          onClick={(ev) => {
                            ev.stopPropagation()
                            removeSelectedFile(f)
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-center text-xs text-muted-foreground">
                    {t("monthsPage.clickToAddOrChange")}
                  </p>
                </div>
              </>
            ) : (
              <>
                <UploadCloud className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">{t("monthsPage.dropHint")}</p>
                  <p className="text-xs text-muted-foreground">{t("monthsPage.dropSubhint")}</p>
                </div>
              </>
            )}
          </div>

          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("monthsPage.monthLabel")}</label>
                <Input
                  type="month"
                  value={uploadMonth}
                  disabled={jobRunning}
                  onChange={(e) => {
                    uploadMonthLockedRef.current = true
                    setUploadMonth(e.target.value)
                  }}
                  className="w-44"
                />
              </div>
              <Button className="gap-1.5" onClick={handleUpload} disabled={jobRunning}>
                {jobRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                {t("monthsPage.uploadButton")}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleClear} disabled={jobRunning}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload History</CardTitle>
        </CardHeader>
        <CardContent>
          {uploads.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !uploads.data || uploads.data.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Inbox className="h-8 w-8" />
              <p className="text-sm">{t("monthsPage.noUploads")}</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Filename</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Uploaded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploads.data.map((u) => (
                    <TableRow
                      key={u.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleRowClick(u.month)}
                    >
                      <TableCell>
                        <Badge variant={u.month === month ? "default" : "outline"}>
                          {formatMonthLabel(u.month)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {u.original_filename}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {u.num_transactions}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {t("monthsPage.sizeKB", { n: (u.size_bytes / 1024).toFixed(0) })}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatUploadTimestamp(u.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
