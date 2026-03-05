import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { CategoryRead } from "@/types/api"

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<CategoryRead[]>("/api/categories"),
    staleTime: 5 * 60 * 1000,
  })
}
