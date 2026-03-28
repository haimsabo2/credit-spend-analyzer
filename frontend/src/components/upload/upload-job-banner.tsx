import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { CategorizeStageLine } from "@/components/upload/categorize-stage-line"
import { useUploadJobStore } from "@/stores/upload-job-store"
import { cn } from "@/lib/utils"

function resolveErrorKey(code: string | null): string {
  if (!code) return ""
  if (code === "refresh_lost_job") return "upload.jobErrorRefreshLost"
  if (code === "categorize_stuck") return "upload.jobErrorStuck"
  if (code === "no_files") return "upload.jobErrorNoFiles"
  return ""
}

export function UploadJobBanner() {
  const { t } = useTranslation()
  const phase = useUploadJobStore((s) => s.phase)
  const month = useUploadJobStore((s) => s.month)
  const uploadPercent = useUploadJobStore((s) => s.uploadPercent)
  const categorizePercent = useUploadJobStore((s) => s.categorizePercent)
  const errorMessage = useUploadJobStore((s) => s.errorMessage)
  const dismiss = useUploadJobStore((s) => s.dismiss)

  if (phase === "idle") return null

  const errKey = resolveErrorKey(errorMessage)
  const errDisplay = errKey ? t(errKey) : errorMessage

  return (
    <div
      className={cn(
        "border-b px-6 py-3",
        phase === "error" ? "border-destructive/40 bg-destructive/10" : "border-border bg-muted/40",
      )}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {phase === "uploading" && <span>{t("upload.jobPhaseUpload")}</span>}
            {phase === "categorizing" && <span>{t("upload.jobPhaseCategorize")}</span>}
            {phase === "completed" && <span>{t("upload.jobPhaseDone")}</span>}
            {phase === "error" && <span className="text-destructive">{t("upload.jobPhaseError")}</span>}
            <span className="text-muted-foreground font-normal">({month})</span>
          </div>
          {phase === "error" && errDisplay && (
            <p className="text-destructive text-xs break-words">{errDisplay}</p>
          )}
          {(phase === "uploading" || phase === "categorizing") && (
            <div className="space-y-1">
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
            </div>
          )}
          <Link to="/upload" className="text-primary text-xs underline-offset-4 hover:underline">
            {t("upload.jobOpenUpload")}
          </Link>
        </div>
        {(phase === "completed" || phase === "error") && (
          <Button variant="outline" size="sm" className="shrink-0 gap-1" onClick={() => dismiss()}>
            <X className="h-3.5 w-3.5" />
            {t("upload.jobDismiss")}
          </Button>
        )}
      </div>
    </div>
  )
}
