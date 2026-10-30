import { schema, type Db } from '@ds/database';
import { and, asc, eq, isNotNull, lte, sql, type SQL } from 'drizzle-orm';

// Database queries for the stock and low-stock reports only; the rules live in
// stock-report.service.

const { categories, items, itemStock } = schema;

export interface StockFilter {
  branchId: number;
  categoryId?: number | undefined;
  /** Only items with a reorder level that their stock is at or below. */
  lowOnly: boolean;
}

function conditions({ branchId, categoryId, lowOnly }: StockFilter): SQL {
  const where: SQL[] = [eq(items.branchId, branchId), eq(items.isActive, true)];
  if (categoryId !== undefined) where.push(eq(items.categoryId, categoryId));
  if (lowOnly) {
    where.push(isNotNull(items.reorderLevel), lte(itemStock.quantity, items.reorderLevel));
  }
  return and(...where)!;
}

/** One page of the branch's active items with stock, category and price. */
export async function listStockRows(db: Db, filter: StockFilter, limit: number, offset: number) {
  const where = conditions(filter);
  const rows = await db
    .select({
      itemId: items.id,
      code: items.code,
      name: items.name,
      categoryId: categories.id,
      categoryName: categories.name,
      quantity: itemStock.quantity,
      sellingPricePaise: items.sellingPricePaise,
      reorderLevel: items.reorderLevel,
    })
    .from(items)
    .innerJoin(itemStock, eq(itemStock.itemId, items.id))
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .where(where)
    // Low stock: the emptiest first; otherwise by name
    .orderBy(
      ...(filter.lowOnly ? [asc(itemStock.quantity)] : []),
      sql`lower(${items.name})`,
      asc(items.id),
    )
    .limit(limit)
    .offset(offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .innerJoin(itemStock, eq(itemStock.itemId, items.id))
    .where(where);
  return { rows, total: count?.n ?? 0 };
}
