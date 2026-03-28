import { useEffect } from "react"
import { getJobFiles } from "@/lib/upload-job-files"
import { useUploadJobStore } from "@/stores/upload-job-store"

/** After persist rehydration, uploads in progress cannot resume without in-memory File objects. */
export function UploadJobHydrationFix() {
  useEffect(() => {
    return useUploadJobStore.persist.onFinishHydration(() => {
      const s = useUploadJobStore.getState()
      if (
        (s.phase === "uploading" || s.phase === "categorizing") &&
        s.activeJobId &&
        !getJobFiles(s.activeJobId)?.length
      ) {
        useUploadJobStore.setState({
          phase: "error",
          errorMessage: "refresh_lost_job",
        })
      }
    })
  }, [])

  return null
}
