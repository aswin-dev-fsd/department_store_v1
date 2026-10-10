// Database queries for branches — no business rules here (DreamLand §4).
import { schema, type DbOrTx } from '@ds/database';
import { asc, eq, sql } from 'drizzle-orm';

const { branches } = schema;

export type BranchRow = typeof branches.$inferSelect;

export interface NewBranch {
  code: string;
  name: string;
  address: string;
  phone: string | null;
  billFooter: string | null;
}

/** The columns an Admin can change. */
export type BranchChanges = Partial<
  Pick<BranchRow, 'code' | 'name' | 'address' | 'phone' | 'billFooter' | 'isActive'>
>;

/**
 * Insert a branch unless its code is already taken, in which case nothing is inserted and
 * undefined is returned. Atomic, so of two simultaneous callers with the same code exactly one wins.
 */
export async function insertBranchIfCodeFree(
  db: DbOrTx,
  values: NewBranch,
): Promise<BranchRow | undefined> {
  const [row] = await db
    .insert(branches)
    .values(values)
    .onConflictDoNothing({ target: branches.code })
    .returning();
  return row;
}

/** Load a branch and lock its row until the transaction ends, so edits can't interleave. */
export async function findBranchForUpdate(db: DbOrTx, id: number): Promise<BranchRow | undefined> {
  const [row] = await db.select().from(branches).where(eq(branches.id, id)).limit(1).for('update');
  return row;
}

/** One page of branches ordered by code, with the total number matching the filter. */
export async function listBranches(
  db: DbOrTx,
  { limit, offset, isActive }: { limit: number; offset: number; isActive?: boolean | undefined },
): Promise<{ rows: BranchRow[]; total: number }> {
  const where = isActive === undefined ? undefined : eq(branches.isActive, isActive);
  const rows = await db
    .select()
    .from(branches)
    .where(where)
    .orderBy(asc(branches.code))
    .limit(limit)
    .offset(offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(branches)
    .where(where);
  return { rows, total: count?.n ?? 0 };
}

/** Apply changes to a branch and return the updated row. */
export async function updateBranch(
  db: DbOrTx,
  id: number,
  changes: BranchChanges,
): Promise<BranchRow> {
  const [row] = await db.update(branches).set(changes).where(eq(branches.id, id)).returning();
  if (!row) {
    throw new Error(`Branch ${id} disappeared while it was being updated`);
  }
  return row;
}
