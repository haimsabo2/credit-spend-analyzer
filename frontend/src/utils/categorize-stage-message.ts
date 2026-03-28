import type { TFunction } from "i18next"

/** Server chunk response detail (snake_case from API). */
export type CategorizeStageDetail = Record<string, unknown> | null

export function categorizeStageMessage(
  t: TFunction,
  stageId: string | null,
  detail: CategorizeStageDetail,
): string {
  if (!stageId) return ""
  const d = detail ?? {}
  const num = (k: string): number | undefined =>
    typeof d[k] === "number" && Number.isFinite(d[k] as number)
      ? (d[k] as number)
      : undefined
  const key = `upload.categorizeStage.${stageId}`
  const fallback = t("upload.categorizeStage.unknown")
  const params: Record<string, number> = {}
  const c = num("count")
  if (c !== undefined) params.count = c
  const rows = num("rows")
  if (rows !== undefined) params.rows = rows
  const unique = num("unique")
  if (unique !== undefined) params.unique = unique
  const batch = num("batch")
  if (batch !== undefined) params.batch = batch
  const batchesTotal = num("batches_total")
  if (batchesTotal !== undefined) params.batchesTotal = batchesTotal
  try {
    const msg = t(key, params)
    if (msg === key) return fallback
    return msg
  } catch {
    return fallback
  }
}
