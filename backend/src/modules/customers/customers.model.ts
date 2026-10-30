// Database queries for customers — no business rules here (DreamLand §4). Customers are
// client-wide (D-08), so nothing here takes a branch.
import { schema, type DbOrTx } from '@ds/database';
import { and, eq, isNull } from 'drizzle-orm';

const { customers } = schema;

export type CustomerRow = typeof customers.$inferSelect;

/** The customer with exactly this (normalised) phone. */
export async function findByPhone(db: DbOrTx, phone: string): Promise<CustomerRow | undefined> {
  const [row] = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
  return row;
}

/**
 * Insert a customer unless the phone is already taken (by another counter a moment ago, say);
 * returns the new row, or undefined when nothing was inserted.
 */
export async function insertIfAbsent(
  db: DbOrTx,
  phone: string,
  name: string | null,
): Promise<CustomerRow | undefined> {
  const [row] = await db
    .insert(customers)
    .values({ phone, name })
    .onConflictDoNothing({ target: customers.phone })
    .returning();
  return row;
}

/** Give a customer a name, only while they have none; returns the updated row, if any. */
export async function fillMissingName(
  db: DbOrTx,
  id: number,
  name: string,
): Promise<CustomerRow | undefined> {
  const [row] = await db
    .update(customers)
    .set({ name })
    .where(and(eq(customers.id, id), isNull(customers.name)))
    .returning();
  return row;
}
