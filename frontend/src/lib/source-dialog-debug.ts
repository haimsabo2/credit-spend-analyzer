/**
 * Source dialog debug: DevTools → localStorage.setItem("csa:debugSource", "1") then refresh.
 * Disable: localStorage.removeItem("csa:debugSource") or set "0".
 */
import type { TransactionRead } from "@/types/api"

const STORAGE_KEY = "csa:debugSource"

export function sourceDialogRowPayload(
  row: TransactionRead,
  timeStamp?: number,
): Record<string, unknown> {
  return {
    transactionId: row.id,
    upload_id: row.upload_id,
    source_trace_upload_id: row.source_trace_upload_id ?? null,
    source_stored_file_available: row.source_stored_file_available ?? null,
    timeStamp: timeStamp ?? null,
  }
}

export function isSourceDialogDebug(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function debugSourceDialog(phase: string, payload?: Record<string, unknown>): void {
  if (!isSourceDialogDebug()) return
  console.info("[csa:source]", phase, payload ?? {})
}

/** Call from click handler; paired with markSourceDialogLayout in dialog. */
export function markSourceDialogClick(): void {
  if (!isSourceDialogDebug() || typeof performance === "undefined") return
  try {
    performance.mark("csa:source:click")
  } catch {
    /* ignore */
  }
}

export function markSourceDialogLayout(): void {
  if (!isSourceDialogDebug() || typeof performance === "undefined") return
  try {
    performance.mark("csa:source:dialog-layout")
    performance.measure("csa:source:click-to-layout", "csa:source:click", "csa:source:dialog-layout")
  } catch {
    /* ignore */
  }
}
