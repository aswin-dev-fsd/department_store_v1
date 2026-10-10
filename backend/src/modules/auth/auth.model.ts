// Database queries for login, sessions and their users — no business rules here (DreamLand §4).
// Every function takes DbOrTx so the service can run several of them in one transaction.
import { schema, type DbOrTx } from '@ds/database';
import type { BranchSummary, Role } from '@ds/shared';
import { and, asc, eq, lt, ne, sql } from 'drizzle-orm';

const { branches, sessions, userBranches, users } = schema;

export interface NewSession {
  tokenHash: string;
  userId: number;
  activeBranchId: number | null;
  expiresAt: Date;
}

export interface SessionRow {
  sessionId: number;
  expiresAt: Date;
  activeBranchId: number | null;
  /** The active branch is still mapped to this user and still active. */
  branchUsable: boolean;
  user: {
    id: number;
    username: string;
    fullName: string;
    role: Role;
    isActive: boolean;
    mustChangePassword: boolean;
  };
}

export interface UserWithPassword {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  passwordHash: string;
}

const userWithPasswordColumns = {
  id: users.id,
  username: users.username,
  fullName: users.fullName,
  role: users.role,
  isActive: users.isActive,
  mustChangePassword: users.mustChangePassword,
  passwordHash: users.passwordHash,
};

/** Find a user by username, ignoring letter case (matches the users_username_lower_key index). */
export async function findUserByUsername(
  db: DbOrTx,
  username: string,
): Promise<UserWithPassword | undefined> {
  const [row] = await db
    .select(userWithPasswordColumns)
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  return row;
}

/** Find a user, with their password hash, by id. */
export async function findUserWithPasswordById(
  db: DbOrTx,
  userId: number,
): Promise<UserWithPassword | undefined> {
  const [row] = await db
    .select(userWithPasswordColumns)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row;
}

/** The active branches a user is mapped to, ordered by code. */
export async function listActiveBranchesForUser(
  db: DbOrTx,
  userId: number,
): Promise<BranchSummary[]> {
  return db
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(userBranches)
    .innerJoin(branches, eq(branches.id, userBranches.branchId))
    .where(and(eq(userBranches.userId, userId), eq(branches.isActive, true)))
    .orderBy(asc(branches.code));
}

/** Record a successful login time. */
export async function updateLastLogin(db: DbOrTx, userId: number): Promise<void> {
  await db
    .update(users)
    .set({ lastLoginAt: sql`now()` })
    .where(eq(users.id, userId));
}

/** Store a new password hash and clear the forced-change flag. */
export async function updatePassword(
  db: DbOrTx,
  userId: number,
  passwordHash: string,
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(users.id, userId));
}

/** Insert a session row. */
export async function insertSession(db: DbOrTx, session: NewSession): Promise<void> {
  await db.insert(sessions).values(session);
}

/**
 * Find a session and its user by the token's hash, and — in the same query — whether its
 * active branch is still mapped to the user and still active.
 */
export async function findSessionByTokenHash(
  db: DbOrTx,
  tokenHash: string,
): Promise<SessionRow | undefined> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      activeBranchId: sessions.activeBranchId,
      branchUsable: sql<boolean>`(${userBranches.userId} is not null and ${branches.isActive} is true)`,
      user: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        role: users.role,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(
      userBranches,
      and(
        eq(userBranches.userId, sessions.userId),
        eq(userBranches.branchId, sessions.activeBranchId),
      ),
    )
    .leftJoin(branches, eq(branches.id, sessions.activeBranchId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/** Point a session at a different active branch. */
export async function updateSessionBranch(
  db: DbOrTx,
  sessionId: number,
  branchId: number,
): Promise<void> {
  await db.update(sessions).set({ activeBranchId: branchId }).where(eq(sessions.id, sessionId));
}

/** Set last_seen_at to now, only if it is older than a minute (database clock). */
export async function touchSession(db: DbOrTx, sessionId: number): Promise<void> {
  await db
    .update(sessions)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(eq(sessions.id, sessionId), lt(sessions.lastSeenAt, sql`now() - interval '1 minute'`)),
    );
}

/** Delete one session by id. */
export async function deleteSessionById(db: DbOrTx, sessionId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Delete one session by the token's hash. */
export async function deleteSessionByTokenHash(db: DbOrTx, tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** Delete all of a user's sessions, optionally keeping one; returns how many were deleted. */
export async function deleteSessionsForUser(
  db: DbOrTx,
  userId: number,
  keepTokenHash?: string,
): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(
      keepTokenHash === undefined
        ? eq(sessions.userId, userId)
        : and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepTokenHash)),
    )
    .returning({ id: sessions.id });
  return deleted.length;
}
