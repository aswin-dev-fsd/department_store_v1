// Database queries for categories — no business rules here (DreamLand §4). Every function takes
// the branch: categories are branch-owned, so a category of another branch is simply not found.
import { schema, type DbOrTx } from '@ds/database';
import { and, asc, eq, sql } from 'drizzle-orm';

const { categories } = schema;

export type CategoryRow = typeof categories.$inferSelect;

/**
 * Insert a category unless the branch already has one of that name (ignoring case), in which case
 * nothing is inserted and undefined is returned. Atomic, so of two simultaneous callers with the
 * same name exactly one wins.
 */
export async function insertCategoryIfNameFree(
  db: DbOrTx,
  branchId: number,
  name: string,
): Promise<CategoryRow | undefined> {
  const [row] = await db
    .insert(categories)
    .values({ branchId, name })
    .onConflictDoNothing()
    .returning();
  return row;
}

/** Load a category of this branch and lock its row until the transaction ends. */
export async function findCategoryForUpdate(
  db: DbOrTx,
  branchId: number,
  id: number,
): Promise<CategoryRow | undefined> {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.branchId, branchId)))
    .limit(1)
    .for('update');
  return row;
}

/** One page of the branch's categories by name (ignoring case), with the total. */
export async function listCategories(
  db: DbOrTx,
  branchId: number,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ rows: CategoryRow[]; total: number }> {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.branchId, branchId))
    .orderBy(sql`lower(${categories.name})`, asc(categories.id))
    .limit(limit)
    .offset(offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(categories)
    .where(eq(categories.branchId, branchId));
  return { rows, total: count?.n ?? 0 };
}

/** Rename a category and return the updated row. */
export async function renameCategory(db: DbOrTx, id: number, name: string): Promise<CategoryRow> {
  const [row] = await db.update(categories).set({ name }).where(eq(categories.id, id)).returning();
  return row!;
}
