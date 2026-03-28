import type { UploadCreateResponse } from "@/types/api"

export interface XlsUploadOptions {
  month: string
  replaceMonth?: boolean
  deferCategorization?: boolean
}

/** POST /api/uploads with upload progress (SPA navigation does not cancel XHR). */
export function uploadXlsWithProgress(
  file: File,
  opts: XlsUploadOptions,
  onProgress?: (loaded: number, total: number) => void,
): Promise<UploadCreateResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${window.location.origin}/api/uploads`)
    xhr.responseType = "json"

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(ev.loaded, ev.total)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as UploadCreateResponse)
        return
      }
      const body = xhr.response
      const detail =
        body && typeof body === "object" && "detail" in body
          ? String((body as { detail: unknown }).detail)
          : xhr.statusText
      reject(new Error(detail || `Upload failed (${xhr.status})`))
    }

    xhr.onerror = () => reject(new Error("Network error during upload"))
    xhr.onabort = () => reject(new Error("Upload aborted"))

    const fd = new FormData()
    fd.append("file", file)
    fd.append("month", opts.month)
    if (opts.replaceMonth) fd.append("replace_month", "true")
    if (opts.deferCategorization) fd.append("defer_categorization", "true")
    xhr.send(fd)
  })
}
