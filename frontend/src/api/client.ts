const BASE = "/api"

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

export async function request<T>(
  method: string,
  path: string,
  options?: {
    params?: Record<string, string | number | boolean | undefined>
    body?: unknown
  },
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
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, res.statusText, body)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>) {
    return request<T>("GET", BASE + path, { params })
  },
  post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>) {
    return request<T>("POST", BASE + path, { body, params })
  },
  patch<T>(path: string, body?: unknown) {
    return request<T>("PATCH", BASE + path, { body })
  },
  del<T = void>(path: string) {
    return request<T>("DELETE", BASE + path)
  },
}
