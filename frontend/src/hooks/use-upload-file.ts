import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { api, ApiError } from "@/lib/api-client"
import type { UploadCreateResponse } from "@/types/api"
import { toast } from "sonner"

interface UploadParams {
  file: File
  month: string
  replaceMonth?: boolean
}

export function useUploadFile() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ file, month, replaceMonth }: UploadParams) => {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("month", month)
      if (replaceMonth) {
        fd.append("replace_month", "true")
      }
      return api.upload<UploadCreateResponse>("/api/uploads", fd)
    },
    onSuccess(data) {
      qc.invalidateQueries({ queryKey: ["uploads"] })
      qc.invalidateQueries({ queryKey: ["summary"] })
      qc.invalidateQueries({ queryKey: ["transactions"] })
      qc.invalidateQueries({ queryKey: ["needs-review"] })
      qc.invalidateQueries({ queryKey: ["trends"] })
      toast.success(
        t("upload.successToast", {
          fileName: data.file_name,
          count: data.inserted_count,
        }),
      )
    },
    onError(err) {
      if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const detail = (err.body as { detail?: string }).detail
        toast.error(detail ?? t("upload.errorToast"))
      } else {
        toast.error(t("upload.errorToast"))
      }
    },
  })
}
