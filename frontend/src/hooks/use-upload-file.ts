import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api, ApiError } from "@/lib/api-client"
import type { UploadCreateResponse } from "@/types/api"
import { toast } from "sonner"

interface UploadParams {
  file: File
  month: string
}

export function useUploadFile() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ file, month }: UploadParams) => {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("month", month)
      return api.upload<UploadCreateResponse>("/api/uploads", fd)
    },
    onSuccess(data) {
      qc.invalidateQueries({ queryKey: ["uploads"] })
      toast.success(
        `Uploaded ${data.file_name} — ${data.inserted_count} transactions imported`,
      )
    },
    onError(err) {
      if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const detail = (err.body as { detail?: string }).detail
        toast.error(detail ?? "Upload failed")
      } else {
        toast.error("Upload failed")
      }
    },
  })
}
