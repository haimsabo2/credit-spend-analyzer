import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { TransactionRead } from "@/types/api"
import { debugSourceDialog, markSourceDialogLayout } from "@/lib/source-dialog-debug"

const DOWNLOAD_TIMEOUT_MS = 90_000

export function TransactionSourceDialog({
  open,
  onOpenChange,
  transaction,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  transaction: TransactionRead | null
}) {
  const { t } = useTranslation()
  const [downloading, setDownloading] = useState(false)
  const downloadAbortRef = useRef<AbortController | null>(null)
  const traceId = transaction?.source_trace_upload_id
  const canDownload = Boolean(traceId && transaction?.source_stored_file_available)
  const row = transaction?.source_row_1based
  const sheet = transaction?.source_sheet_index

  useEffect(() => {
    debugSourceDialog("dialog props", {
      open,
      transactionId: transaction?.id ?? null,
    })
  }, [open, transaction?.id])

  useLayoutEffect(() => {
    if (open) markSourceDialogLayout()
  }, [open])

  useEffect(() => {
    if (!open) {
      downloadAbortRef.current?.abort()
      downloadAbortRef.current = null
      setDownloading(false)
    }
  }, [open])

  const copyRowHint = () => {
    if (row == null) return
    void navigator.clipboard.writeText(String(row))
    toast.success(t("transactionSource.rowCopied"))
  }

  async function handleDownload() {
    if (traceId == null) return
    const filename = transaction?.source_upload_original_filename ?? "report.xls"
    debugSourceDialog("download start", { traceId, filename })
    downloadAbortRef.current?.abort()
    const ac = new AbortController()
    downloadAbortRef.current = ac
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      ac.abort()
    }, DOWNLOAD_TIMEOUT_MS)
    setDownloading(true)
    try {
      const res = await fetch(`${window.location.origin}/api/uploads/${traceId}/file`, {
        signal: ac.signal,
      })
      debugSourceDialog("download response", { status: res.status, ok: res.ok })
      if (!res.ok) throw new Error("download_failed")
      const blob = await res.blob()
      debugSourceDialog("download blob", { size: blob.size, type: blob.type })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.setAttribute("download", filename)
      a.rel = "noopener"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      debugSourceDialog("download error", {
        name: e instanceof Error ? e.name : typeof e,
        message: e instanceof Error ? e.message : String(e),
        timedOut,
      })
      if (e instanceof DOMException && e.name === "AbortError") {
        if (timedOut) toast.error(t("transactionSource.downloadTimeout"))
      } else {
        toast.error(t("transactionSource.downloadFailed"))
      }
    } finally {
      window.clearTimeout(timeoutId)
      if (downloadAbortRef.current === ac) downloadAbortRef.current = null
      setDownloading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        debugSourceDialog("dialog openChange", { open: v })
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("transactionSource.title")}</DialogTitle>
          <DialogDescription>{t("transactionSource.description")}</DialogDescription>
        </DialogHeader>
        {transaction && (
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">{t("transactionSource.fileLabel")}</span>{" "}
              {transaction.source_upload_original_filename ?? "—"}
            </div>
            <div>
              <span className="text-muted-foreground">{t("transactionSource.rowLabel")}</span>{" "}
              {row ?? "—"}
              {sheet != null && (
                <>
                  {" "}
                  <span className="text-muted-foreground">
                    {t("transactionSource.sheetLabel", { n: sheet + 1 })}
                  </span>
                </>
              )}
            </div>
            {transaction.source_cells?.length ? (
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {t("transactionSource.cellsTitle")}
                </div>
                <ol className="list-decimal space-y-0.5 pl-4 font-mono text-xs">
                  {transaction.source_cells.map((c, i) => (
                    <li key={i}>{c || "—"}</li>
                  ))}
                </ol>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {canDownload && traceId != null ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={downloading}
                  className="gap-1.5"
                  onClick={() => void handleDownload()}
                >
                  {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t("transactionSource.download")}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">{t("transactionSource.noFile")}</p>
              )}
              {row != null ? (
                <Button type="button" variant="outline" size="sm" onClick={copyRowHint}>
                  {t("transactionSource.copyRow")}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{t("transactionSource.excelHint")}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
