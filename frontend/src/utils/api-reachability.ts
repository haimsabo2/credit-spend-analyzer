import { ApiError } from "@/api/client"

/** True when the failure is likely "no API / proxy / connection" rather than a bad request or server bug. */
export function isBackendUnreachable(err: unknown): boolean {
  if (err instanceof TypeError) return true
  if (!(err instanceof ApiError)) return false
  return [502, 503, 504].includes(err.status)
}
