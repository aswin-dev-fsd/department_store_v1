// Database queries for vendors — no business rules here (DreamLand §4). Every function takes the
// branch: vendors are branch-owned, so a vendor of another branch is simply not found.
import { schema, type DbOrTx } from '@ds/database';
import { and, asc, eq, ilike, sql, type SQL } from 'drizzle-orm';

const { vendors } = schema;

export type VendorRow = typeof vendors.$inferSelect;
export type NewVendorRow = typeof vendors.$inferInsert;
/** The fields an edit may change. */
export type VendorChanges = Partial<
  Pick<VendorRow, 'name' | 'phone' | 'address' | 'gstin' | 'isActive'>
>;

/** Escape the characters LIKE treats as wildcards, so a search for "100%" means those characters. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

/** Insert a vendor and return the new row. */
export async function insertVendor(db: DbOrTx, values: NewVendorRow): Promise<VendorRow> {
  const [row] = await db.insert(vendors).values(values).returning();
  return row!;
}

/** Load a vendor of this branch and lock its row until the transaction ends. */
export async function findVendorForUpdate(
  db: DbOrTx,
  branchId: number,
  id: number,
): Promise<VendorRow | undefined> {
  const [row] = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.id, id), eq(vendors.branchId, branchId)))
    .limit(1)
    .for('update');
  return row;
}

/** Change fields of a vendor and return the updated row. */
export async function updateVendor(
  db: DbOrTx,
  id: number,
  changes: VendorChanges,
): Promise<VendorRow> {
  const [row] = await db.update(vendors).set(changes).where(eq(vendors.id, id)).returning();
  return row!;
}

/**
 * One page of the branch's vendors by name (ignoring case), with the total. `search` matches any
 * part of the name, ignoring case; `active` is optional.
 */
export async function listVendors(
  db: DbOrTx,
  branchId: number,
  query: { search?: string; active?: boolean; limit: number; offset: number },
): Promise<{ rows: VendorRow[]; total: number }> {
  const conditions: SQL[] = [eq(vendors.branchId, branchId)];
  if (query.search !== undefined) {
    conditions.push(ilike(vendors.name, likePattern(query.search)));
  }
  if (query.active !== undefined) {
    conditions.push(eq(vendors.isActive, query.active));
  }
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(vendors)
    .where(where)
    .orderBy(sql`lower(${vendors.name})`, asc(vendors.id))
    .limit(query.limit)
    .offset(query.offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vendors)
    .where(where);
  return { rows, total: count?.n ?? 0 };
}
