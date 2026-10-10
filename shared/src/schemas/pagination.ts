// Every list route takes ?limit=20&offset=0 and answers with a Page (AGENTS.md → API standards).
import { z } from 'zod';
import { wholeNumberText } from './common.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const paginationSchema = z.object({
  limit: wholeNumberText()
    .pipe(
      z
        .number()
        .int()
        .min(1, 'Must be at least 1')
        .max(MAX_PAGE_SIZE, `Must be at most ${MAX_PAGE_SIZE}`),
    )
    .default(DEFAULT_PAGE_SIZE),
  offset: wholeNumberText().pipe(z.number().int().min(0)).default(0),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

/** One page of a list, with the total number of matching records. */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
