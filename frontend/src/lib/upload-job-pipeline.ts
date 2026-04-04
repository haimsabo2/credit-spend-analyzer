import i18n from "@/i18n"
import { clearJobFiles, getJobFiles } from "@/lib/upload-job-files"
import { queryClient } from "@/lib/query-client"
import { uploadXlsWithProgress } from "@/lib/upload-xhr"
import type { UploadCreateResponse } from "@/types/api"
import { toast } from "sonner"

const CHUNK_LIMIT = 64
const MAX_CHUNKS = 2000

const _pipelines = new Set<string>()

export type UploadJobPhase = "idle" | "uploading" | "categorizing" | "completed" | "error"

export interface FileSlot {
  id: string
  name: string
  size: number
  status: "pending" | "uploading" | "done" | "error"
  error?: string
}

export interface UploadJobPatch {
  phase?: UploadJobPhase
  uploadPercent?: number
  categorizePercent?: number
  categorizeStageId?: string | null
  categorizeStageDetail?: Record<string, unknown> | null
  fileSlots?: FileSlot[]
  errorMessage?: string | null
  serverProcessing?: boolean
}

function invalidateDataQueries(): void {
  void queryClient.invalidateQueries({ queryKey: ["uploads"] })
  void queryClient.invalidateQueries({ queryKey: ["summary"] })
  void queryClient.invalidateQueries({ queryKey: ["transactions"] })
  void queryClient.invalidateQueries({ queryKey: ["needs-review"] })
  void queryClient.invalidateQueries({ queryKey: ["trends"] })
}

export async function runUploadJobPipeline(
  jobId: string,
  month: string,
  replaceMonth: boolean,
  enrichOnly: boolean,
  onUpdate: (patch: UploadJobPatch) => void,
): Promise<void> {
  if (_pipelines.has(jobId)) return
  _pipelines.add(jobId)

  const files = getJobFiles(jobId)
  if (!files?.length) {
    onUpdate({ phase: "error", errorMessage: "no_files" })
    _pipelines.delete(jobId)
    return
  }

  const totalBytes = Math.max(1, files.reduce((s, f) => s + f.size, 0))
  const perLoaded = new Array<number>(files.length).fill(0)

  const fileSlots: FileSlot[] = files.map((f, i) => ({
    id: `${jobId}-${i}`,
    name: f.name,
    size: f.size,
    status: "pending",
  }))
  onUpdate({ fileSlots: [...fileSlots] })

  const setOverallUploadPct = () => {
    const sum = perLoaded.reduce((a, b) => a + b, 0)
    onUpdate({ uploadPercent: Math.min(100, Math.round((sum / totalBytes) * 100)) })
  }

  const uploadOne = async (
    idx: number,
    useReplace: boolean,
    useEnrich: boolean,
  ): Promise<UploadCreateResponse> => {
    fileSlots[idx].status = "uploading"
    onUpdate({ fileSlots: [...fileSlots] })
    try {
      const res = await uploadXlsWithProgress(
        files[idx],
        {
          month,
          replaceMonth: useReplace,
          deferCategorization: !useEnrich,
          enrichOnly: useEnrich,
          onUploadBodySent: () => onUpdate({ serverProcessing: true }),
        },
        (loaded, total) => {
          perLoaded[idx] = total > 0 ? Math.min(loaded, total) : loaded
          setOverallUploadPct()
        },
      )
      onUpdate({ serverProcessing: false })
      perLoaded[idx] = files[idx].size
      setOverallUploadPct()
      fileSlots[idx].status = "done"
      onUpdate({ fileSlots: [...fileSlots] })
      return res
    } catch (e) {
      const msg = e instanceof Error ? e.message : "upload_failed"
      fileSlots[idx].status = "error"
      fileSlots[idx].error = msg
      onUpdate({
        phase: "error",
        errorMessage: msg,
        fileSlots: [...fileSlots],
        uploadPercent: 100,
      })
      toast.error(i18n.t("upload.jobErrorToast", { message: msg }))
      throw e
    }
  }

  try {
    if (enrichOnly) {
      let totalEnriched = 0
      let dbOnly = 0
      let fileOnly = 0
      for (let i = 0; i < files.length; i++) {
        const r = await uploadOne(i, false, true)
        totalEnriched += r.enriched_count ?? 0
        dbOnly += r.conflict_only_in_database?.count ?? 0
        fileOnly += r.conflict_only_in_file?.count ?? 0
      }
      onUpdate({
        phase: "completed",
        uploadPercent: 100,
        categorizePercent: 100,
        categorizeStageId: null,
        categorizeStageDetail: null,
      })
      invalidateDataQueries()
      clearJobFiles(jobId)
      _pipelines.delete(jobId)
      toast.success(
        i18n.t("upload.enrichDoneToast", {
          enriched: totalEnriched,
          files: files.length,
        }),
      )
      if (dbOnly > 0 || fileOnly > 0) {
        toast.message(
          i18n.t("upload.enrichConflictToast", {
            dbOnly,
            fileOnly,
          }),
        )
      }
      return
    }

    if (replaceMonth && files.length > 0) {
      await uploadOne(0, true, false)
      await Promise.all(files.slice(1).map((_, i) => uploadOne(i + 1, false, false)))
    } else {
      await Promise.all(files.map((_, i) => uploadOne(i, false, false)))
    }
  } catch {
    clearJobFiles(jobId)
    _pipelines.delete(jobId)
    return
  }

  onUpdate({
    phase: "categorizing",
    uploadPercent: 100,
    categorizePercent: 0,
    categorizeStageId: null,
    categorizeStageDetail: null,
    serverProcessing: false,
  })

  try {
    const qRes = await fetch(
      `${window.location.origin}/api/transactions/categorize-queue?month=${encodeURIComponent(month)}`,
    )
    if (!qRes.ok) {
      throw new Error(await qRes.text())
    }
    const queue = (await qRes.json()) as { pending_count: number }
    const initial = queue.pending_count

    if (initial === 0) {
      onUpdate({
        phase: "completed",
        categorizePercent: 100,
        categorizeStageId: null,
        categorizeStageDetail: null,
      })
      invalidateDataQueries()
      clearJobFiles(jobId)
      _pipelines.delete(jobId)
      toast.success(i18n.t("upload.jobDoneToast"))
      return
    }

    onUpdate({
      categorizeStageId: "queue",
      categorizeStageDetail: { count: initial },
    })

    let chunks = 0
    let lastPending = initial
    while (chunks < MAX_CHUNKS) {
      chunks++
      const res = await fetch(
        `${window.location.origin}/api/transactions/auto-categorize-chunk?month=${encodeURIComponent(month)}&limit=${CHUNK_LIMIT}`,
        { method: "POST" },
      )
      if (!res.ok) {
        throw new Error(await res.text())
      }
      const data = (await res.json()) as {
        pending_remaining: number
        done: boolean
        chunk: { processed: number }
        categorize_stage?: string | null
        categorize_stage_detail?: Record<string, unknown> | null
      }
      const remaining = data.pending_remaining
      const pct = Math.round(((initial - remaining) / initial) * 100)
      const patch: UploadJobPatch = {
        categorizePercent: Math.min(100, Math.max(0, pct)),
      }
      if (data.categorize_stage) {
        patch.categorizeStageId = data.categorize_stage
        patch.categorizeStageDetail = data.categorize_stage_detail ?? null
      }
      onUpdate(patch)

      if (data.done) {
        break
      }
      if (data.chunk.processed === 0 && remaining === lastPending) {
        onUpdate({
          phase: "error",
          errorMessage: "categorize_stuck",
          categorizePercent: pct,
        })
        toast.error(i18n.t("upload.jobErrorToast", { message: i18n.t("upload.jobErrorStuck") }))
        clearJobFiles(jobId)
        _pipelines.delete(jobId)
        return
      }
      lastPending = remaining
      await new Promise<void>((r) => {
        setTimeout(r, 0)
      })
    }

    onUpdate({
      phase: "completed",
      categorizePercent: 100,
      categorizeStageId: null,
      categorizeStageDetail: null,
    })
    invalidateDataQueries()
    toast.success(i18n.t("upload.jobDoneToast"))
  } catch (e) {
    const msg = e instanceof Error ? e.message : "categorize_failed"
    onUpdate({ phase: "error", errorMessage: msg })
    toast.error(i18n.t("upload.jobErrorToast", { message: msg }))
  } finally {
    clearJobFiles(jobId)
    _pipelines.delete(jobId)
  }
}
