// Database queries for users and their branch mapping — no business rules here (DreamLand §4).
import { schema, type DbOrTx } from '@ds/database';
import type { Role, UserBranch } from '@ds/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

const { branches, userBranches, users } = schema;

/** A full user row, including the password hash: services must not pass it on. */
export type UserRow = typeof users.$inferSelect;

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

/** Insert a user and return its id. Throws if the username is taken. */
export async function insertUser(db: DbOrTx, user: NewUser): Promise<{ id: number }> {
  const [row] = await db.insert(users).values(user).returning({ id: users.id });
  if (!row) {
    throw new Error('Inserting the user returned no row');
  }
  return row;
}

/**
 * Insert a user unless the username is taken (ignoring letter case), in which case nothing is
 * inserted and undefined is returned. Atomic, so of two simultaneous callers exactly one wins.
 */
export async function insertUserIfUsernameFree(
  db: DbOrTx,
  user: NewUser,
): Promise<UserRow | undefined> {
  const [row] = await db.insert(users).values(user).onConflictDoNothing().returning();
  return row;
}

/** Load a user and lock the row until the transaction ends, so edits can't interleave. */
export async function findUserForUpdate(db: DbOrTx, id: number): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1).for('update');
  return row;
}

/** Find a user by username, ignoring letter case. */
export async function findUserByUsername(
  db: DbOrTx,
  username: string,
): Promise<UserRow | undefined> {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  return row;
}

/** One page of users ordered by username (ignoring case), with the total matching the filters. */
export async function listUsers(
  db: DbOrTx,
  {
    limit,
    offset,
    role,
    isActive,
  }: { limit: number; offset: number; role?: Role | undefined; isActive?: boolean | undefined },
): Promise<{ rows: UserRow[]; total: number }> {
  const filters = [
    role === undefined ? undefined : eq(users.role, role),
    isActive === undefined ? undefined : eq(users.isActive, isActive),
  ];
  const where = and(...filters);
  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(sql`lower(${users.username})`, asc(users.id))
    .limit(limit)
    .offset(offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(where);
  return { rows, total: count?.n ?? 0 };
}

/** Apply changes to a user and return the updated row. */
export async function updateUser(
  db: DbOrTx,
  id: number,
  changes: { fullName?: string; isActive?: boolean },
): Promise<UserRow> {
  const [row] = await db.update(users).set(changes).where(eq(users.id, id)).returning();
  if (!row) {
    throw new Error(`User ${id} disappeared while it was being updated`);
  }
  return row;
}

/** Store a new password hash and require the user to change it at next login. */
export async function setTemporaryPassword(
  db: DbOrTx,
  id: number,
  passwordHash: string,
): Promise<void> {
  await db.update(users).set({ passwordHash, mustChangePassword: true }).where(eq(users.id, id));
}

/** The branches mapped to each of the given users (active or not), ordered by code. */
export async function listBranchesForUsers(
  db: DbOrTx,
  userIds: number[],
): Promise<Map<number, UserBranch[]>> {
  const byUser = new Map<number, UserBranch[]>();
  if (userIds.length === 0) return byUser;
  const rows = await db
    .select({
      userId: userBranches.userId,
      id: branches.id,
      code: branches.code,
      name: branches.name,
      isActive: branches.isActive,
    })
    .from(userBranches)
    .innerJoin(branches, eq(branches.id, userBranches.branchId))
    .where(inArray(userBranches.userId, userIds))
    .orderBy(asc(branches.code));
  for (const { userId, ...branch } of rows) {
    byUser.set(userId, [...(byUser.get(userId) ?? []), branch]);
  }
  return byUser;
}

/** Which of the given branch ids exist, and whether each is active. */
export async function findBranchesByIds(
  db: DbOrTx,
  ids: number[],
): Promise<{ id: number; isActive: boolean }[]> {
  if (ids.length === 0) return [];
  return db
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(inArray(branches.id, ids));
}

/** Remove a cashier's mapping to the given branches. */
export async function deleteMappings(
  db: DbOrTx,
  userId: number,
  branchIds: number[],
): Promise<void> {
  if (branchIds.length === 0) return;
  await db
    .delete(userBranches)
    .where(and(eq(userBranches.userId, userId), inArray(userBranches.branchId, branchIds)));
}

/** Map a cashier to the given branches; ones already mapped are left alone. */
export async function insertMappings(
  db: DbOrTx,
  userId: number,
  branchIds: number[],
): Promise<void> {
  if (branchIds.length === 0) return;
  await db
    .insert(userBranches)
    .values(branchIds.map((branchId) => ({ userId, branchId })))
    .onConflictDoNothing();
}
