import type { Page } from '@ds/shared';

/** Rows per screen in the Admin lists: the API's default (its maximum is 100). */
export const ADMIN_PAGE_SIZE = 20;

export interface PageInfo {
  /** 1-based number of the first row shown; 0 for an empty list. */
  from: number;
  to: number;
  total: number;
  /** Offset of the previous page, or null on the first. */
  prevOffset: number | null;
  /** Offset of the next page, or null on the last. */
  nextOffset: number | null;
}

/** What a pager needs to know about one page of a list. */
export function pageInfo({ items, total, limit, offset }: Page<unknown>): PageInfo {
  return {
    from: items.length === 0 ? 0 : offset + 1,
    to: offset + items.length,
    total,
    prevOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    nextOffset: offset + limit < total ? offset + limit : null,
  };
}
