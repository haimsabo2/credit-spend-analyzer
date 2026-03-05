import { api } from "./client"

/**
 * Probes if the rules API is available. Used to show/hide "create rule" UI.
 * Returns true if GET /api/rules succeeds.
 */
export async function probeRulesAvailable(): Promise<boolean> {
  try {
    await api.get<unknown[]>("/rules")
    return true
  } catch {
    return false
  }
}
