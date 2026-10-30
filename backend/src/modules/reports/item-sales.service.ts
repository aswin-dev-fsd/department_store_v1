// Item-wise sales (D-22; overview §6.10): packs and value sold per item over a range of IST
// business dates, both included. Only completed bills count. The value is each line's total
// (after its discount); the bill-level round-off belongs to no item, so the items' grand total
// differs from the bills' total (the day summary) by exactly the summed round-off.
import type { Db } from '@ds/database';
import type { ItemSalesReport } from '@ds/shared';
import * as model from './item-sales.model.js';

export interface ItemSalesQuery {
  from: string;
  to: string;
  branchId?: number | undefined;
  limit: number;
  offset: number;
}

export const ROUND_OFF_NOTE =
  'Item values are line totals after discounts. The bill round-off is not in any item, so the ' +
  'items add up to the bills total less the round-off.';

/** One page of items sold in the range, the highest value first, with the range's totals. */
export async function itemSales(db: Db, query: ItemSalesQuery): Promise<ItemSalesReport> {
  const filter = { from: query.from, to: query.to, branchId: query.branchId };
  const [rows, totals] = await Promise.all([
    model.sumByItem(db, filter, query.limit, query.offset),
    model.rangeTotals(db, filter),
  ]);
  return {
    items: rows.map((row) => ({
      item: { id: row.itemId, code: row.code, name: row.name },
      branch: { id: row.branchId, code: row.branchCode },
      quantity: row.quantity,
      valuePaise: row.valuePaise,
    })),
    total: totals.itemCount,
    limit: query.limit,
    offset: query.offset,
    from: query.from,
    to: query.to,
    itemsValuePaise: totals.valuePaise,
    roundOffPaise: totals.roundOffPaise,
    billsTotalPaise: totals.totalPaise,
    note: ROUND_OFF_NOTE,
  };
}
