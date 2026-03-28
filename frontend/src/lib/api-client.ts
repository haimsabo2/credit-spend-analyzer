export class ApiError extends Error {
  status: number
  statusText: string
  body: unknown

  constructor(status: number, statusText: string, body: unknown) {
    super(`${status} ${statusText}`)
    this.name = "ApiError"
    this.status = status
    this.statusText = statusText
    this.body = body
  }
}

function formatFastApiDetail(body: unknown): string | null {
  if (body == null || typeof body !== "object" || !("detail" in body)) return null
  const d = (body as { detail: unknown }).detail
  if (typeof d === "string") return d
  if (Array.isArray(d)) {
    const msgs = d
      .map((item) =>
        item && typeof item === "object" && "msg" in item && typeof (item as { msg: unknown }).msg === "string"
          ? (item as { msg: string }).msg
          : null,
      )
      .filter(Boolean) as string[]
    if (msgs.length) return msgs.join(", ")
  }
  return null
}

/** Short line for toast description (HTTP errors, network, or FastAPI `detail`). */
export function getApiErrorToastDescription(err: unknown): string | undefined {
  if (err instanceof ApiError) {
    const fromBody = formatFastApiDetail(err.body)
    if (fromBody) return fromBody
    return `${err.status} ${err.statusText}`.trim() || undefined
  }
  if (err instanceof Error && err.message) return err.message
  return undefined
}

async function request<T>(
  method: string,
  path: string,
  options?: { params?: Record<string, string | number | boolean | undefined>; body?: unknown },
): Promise<T> {
  const url = new URL(path, window.location.origin)
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const init: RequestInit = { method, headers: {} }
  if (options?.body !== undefined) {
    ;(init.headers as Record<string, string>)["Content-Type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }

  const res = await fetch(url.toString(), init)
  const text = await res.text()

  if (!res.ok) {
    let body: unknown = null
    const trimmed = text.trim()
    if (trimmed) {
      try {
        body = JSON.parse(trimmed)
      } catch {
        body = { detail: trimmed.slice(0, 500) }
      }
    }
    throw new ApiError(res.status, res.statusText, body)
  }

  if (res.status === 204 || !text.trim()) {
    return undefined as T
  }
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined as T
  }
}

async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const url = new URL(path, window.location.origin)
  const res = await fetch(url.toString(), { method: "POST", body: formData })
  const text = await res.text()
  if (!res.ok) {
    let body: unknown = null
    const trimmed = text.trim()
    if (trimmed) {
      try {
        body = JSON.parse(trimmed)
      } catch {
        body = { detail: trimmed.slice(0, 500) }
      }
    }
    throw new ApiError(res.status, res.statusText, body)
  }
  if (!text.trim()) {
    return undefined as T
  }
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined as T
  }
}

export const api = {
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>) {
    return request<T>("GET", path, { params })
  },
  post<T>(path: string, body?: unknown) {
    return request<T>("POST", path, { body })
  },
  put<T>(path: string, body?: unknown) {
    return request<T>("PUT", path, { body })
  },
  patch<T>(path: string, body?: unknown) {
    return request<T>("PATCH", path, { body })
  },
  del<T = void>(path: string) {
    return request<T>("DELETE", path)
  },
  upload<T>(path: string, formData: FormData) {
    return uploadRequest<T>(path, formData)
  },
}
