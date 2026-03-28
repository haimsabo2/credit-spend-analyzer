import { create } from "zustand"
import { persist } from "zustand/middleware"
import { clearJobFiles, getJobFiles, setJobFiles } from "@/lib/upload-job-files"
import {
  runUploadJobPipeline,
  type FileSlot,
  type UploadJobPatch,
  type UploadJobPhase,
} from "@/lib/upload-job-pipeline"

interface UploadJobState {
  activeJobId: string | null
  phase: UploadJobPhase
  month: string
  replaceMonth: boolean
  fileSlots: FileSlot[]
  uploadPercent: number
  categorizePercent: number
  errorMessage: string | null

  beginJob: (month: string, replaceMonth: boolean, files: File[]) => boolean
  applyPatch: (patch: UploadJobPatch) => void
  dismiss: () => void
}

function jobInFlight(state: UploadJobState): boolean {
  if (state.phase !== "uploading" && state.phase !== "categorizing") return false
  if (!state.activeJobId) return false
  return Boolean(getJobFiles(state.activeJobId)?.length)
}

export const useUploadJobStore = create<UploadJobState>()(
  persist(
    (set, get) => ({
      activeJobId: null,
      phase: "idle",
      month: "",
      replaceMonth: false,
      fileSlots: [],
      uploadPercent: 0,
      categorizePercent: 0,
      errorMessage: null,

      beginJob: (month, replaceMonth, files) => {
        if (!files.length) return false
        const cur = get()
        if (jobInFlight(cur)) return false

        const jobId = crypto.randomUUID()
        setJobFiles(jobId, files)
        const fileSlots: FileSlot[] = files.map((f, i) => ({
          id: `${jobId}-${i}`,
          name: f.name,
          size: f.size,
          status: "pending",
        }))
        set({
          activeJobId: jobId,
          phase: "uploading",
          month,
          replaceMonth,
          fileSlots,
          uploadPercent: 0,
          categorizePercent: 0,
          errorMessage: null,
        })
        queueMicrotask(() => {
          void runUploadJobPipeline(jobId, month, replaceMonth, (patch) => {
            get().applyPatch(patch)
          })
        })
        return true
      },

      applyPatch: (patch) => {
        set((s) => ({ ...s, ...patch }))
      },

      dismiss: () => {
        const id = get().activeJobId
        if (id) clearJobFiles(id)
        set({
          activeJobId: null,
          phase: "idle",
          month: "",
          replaceMonth: false,
          fileSlots: [],
          uploadPercent: 0,
          categorizePercent: 0,
          errorMessage: null,
        })
      },
    }),
    {
      name: "csa-upload-job",
      partialize: (s) => ({
        phase: s.phase,
        activeJobId: s.activeJobId,
        month: s.month,
        replaceMonth: s.replaceMonth,
        fileSlots: s.fileSlots,
        uploadPercent: s.uploadPercent,
        categorizePercent: s.categorizePercent,
        errorMessage: s.errorMessage,
      }),
    },
  ),
)
