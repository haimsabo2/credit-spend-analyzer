import { api } from "./client"
import type { Category } from "./types"

export async function getCategories(): Promise<Category[]> {
  return api.get<Category[]>("/categories")
}

export const listCategories = getCategories

export async function createCategory(name: string, description?: string): Promise<Category> {
  return api.post<Category>("/categories", { name, description })
}
