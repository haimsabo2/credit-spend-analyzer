import { useTranslation } from "react-i18next"
import { useUploadJobStore } from "@/stores/upload-job-store"
import { categorizeStageMessage } from "@/utils/categorize-stage-message"
import type { UploadJobPhase } from "@/lib/upload-job-pipeline"

type Props = { phase: UploadJobPhase }

export function CategorizeStageLine({ phase }: Props) {
  const { t } = useTranslation()
  const categorizeStageId = useUploadJobStore((s) => s.categorizeStageId)
  const categorizeStageDetail = useUploadJobStore((s) => s.categorizeStageDetail)
  if (phase !== "categorizing" || !categorizeStageId) return null
  const text = categorizeStageMessage(t, categorizeStageId, categorizeStageDetail)
  if (!text) return null
  return <p className="text-muted-foreground text-xs leading-snug">{text}</p>
}
