// Category API contract (cashiers manage their own branch's categories; D-23). Used by the
// backend (validation) and the frontend (forms).
import { z } from 'zod';
import { paginationSchema, type PaginationQuery } from './pagination.js';

/** Trimmed, 1–100 characters, any script. Uniqueness (ignoring case, per branch) is the server's call. */
export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the category name')
  .max(100, 'Use at most 100 characters');

export const createCategorySchema = z.object({ name: categoryNameSchema });
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** Renaming is the only edit a category has. */
export const updateCategorySchema = z.object({ name: categoryNameSchema });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const listCategoriesQuerySchema = paginationSchema;
export type ListCategoriesQuery = PaginationQuery;

export interface Category {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}
