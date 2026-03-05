import { api } from "./client"
import type { UploadRead } from "./types"

export async function getUploads(): Promise<UploadRead[]> {
  return api.get<UploadRead[]>("/uploads")
}
