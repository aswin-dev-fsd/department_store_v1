// Database queries for users — no business rules here (DreamLand §4). Grows with Task 2.9.
import { schema, type DbOrTx } from '@ds/database';
import type { Role } from '@ds/shared';
import { sql } from 'drizzle-orm';

const { users } = schema;

export interface NewUser {
  username: string;
  passwordHash: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

/** How many users exist, of any role or status. */
export async function countUsers(db: DbOrTx): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row?.n ?? 0;
}

/** Insert a user and return its id. */
export async function insertUser(db: DbOrTx, user: NewUser): Promise<{ id: number }> {
  const [row] = await db.insert(users).values(user).returning({ id: users.id });
  if (!row) {
    throw new Error('Inserting the user returned no row');
  }
  return row;
}
