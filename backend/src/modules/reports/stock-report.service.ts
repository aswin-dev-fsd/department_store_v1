// The stock and low-stock reports (D-22; overview §6.10): a branch's active items with their
// stock, category and selling price, and the ones that need reordering. An item is low when it
// has a reorder level and its stock is at or below it; an item without a reorder level never is.
// The movement history per item is the stock screen's (GET /stock/:itemId/movements).
import type { Db } from '@ds/database';
import type { Page } from '@ds/shared';
import * as model from './stock-report.model.js';

export interface StockReportRow {
  item: { id: number; code: string; name: string };
  category: { id: number; name: string } | null;
  /** Packs on hand. */
  quantity: number;
  sellingPricePaise: number;
  /** In packs; null when no warning is wanted. */
  reorderLevel: number | null;
}

export interface StockReportQuery {
  branchId: number;
  categoryId?: number | undefined;
  limit: number;
  offset: number;
}

async function report(
  db: Db,
  query: StockReportQuery,
  lowOnly: boolean,
): Promise<Page<StockReportRow>> {
  const { rows, total } = await model.listStockRows(
    db,
    { branchId: query.branchId, categoryId: query.categoryId, lowOnly },
    query.limit,
    query.offset,
  );
  return {
    items: rows.map((row) => ({
      item: { id: row.itemId, code: row.code, name: row.name },
      category:
        row.categoryId === null || row.categoryName === null
          ? null
          : { id: row.categoryId, name: row.categoryName },
      quantity: row.quantity,
      sellingPricePaise: row.sellingPricePaise,
      reorderLevel: row.reorderLevel,
    })),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

/** One page of the branch's active items with stock, category and price, by name. */
export function stockReport(db: Db, query: StockReportQuery): Promise<Page<StockReportRow>> {
  return report(db, query, false);
}

/** One page of the branch's active items at or below their reorder level, the emptiest first. */
export function lowStockReport(db: Db, query: StockReportQuery): Promise<Page<StockReportRow>> {
  return report(db, query, true);
}
