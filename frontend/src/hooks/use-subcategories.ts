import { useQuery } from "@tanstack/react-query"
import { listSubcategories } from "@/api/categories"

export function useSubcategories(categoryId: number | null | undefined) {
  return useQuery({
    queryKey: ["subcategories", categoryId],
    queryFn: () => listSubcategories(categoryId as number),
    enabled: categoryId != null && categoryId > 0,
  })
}
