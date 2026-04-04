import { api } from "./client"
import type { Category } from "./types"
import type { SubcategoryRead } from "@/types/api"

export async function getCategories(): Promise<Category[]> {
  return api.get<Category[]>("/categories")
}

export const listCategories = getCategories

export async function createCategory(name: string, description?: string): Promise<Category> {
  return api.post<Category>("/categories", { name, description })
}

export async function listSubcategories(categoryId: number): Promise<SubcategoryRead[]> {
  return api.get<SubcategoryRead[]>(`/categories/${categoryId}/subcategories`)
}

export async function createSubcategory(
  categoryId: number,
  name: string,
): Promise<SubcategoryRead> {
  return api.post<SubcategoryRead>(`/categories/${categoryId}/subcategories`, { name })
}

export async function deleteSubcategory(subcategoryId: number): Promise<void> {
  await api.del(`/categories/subcategories/${subcategoryId}`)
}
