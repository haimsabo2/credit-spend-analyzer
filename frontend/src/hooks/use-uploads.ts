import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { UploadRead } from "@/types/api"

export function useUploads() {
  return useQuery({
    queryKey: ["uploads"],
    queryFn: () => api.get<UploadRead[]>("/api/uploads"),
  })
}
