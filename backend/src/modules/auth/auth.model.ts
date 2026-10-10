// Database queries for sessions and their users — no business rules here (DreamLand §4).
import { schema, type Db } from '@ds/database';
import type { Role } from '@ds/shared';
import { and, eq, lt, ne, sql } from 'drizzle-orm';

const { sessions, users } = schema;

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
  user: {
    id: number;
    username: string;
    fullName: string;
    role: Role;
    isActive: boolean;
    mustChangePassword: boolean;
  };
}

/** Insert a session row. */
export async function insertSession(db: Db, session: NewSession): Promise<void> {
  await db.insert(sessions).values(session);
}

/** Find a session and its user by the token's hash. */
export async function findSessionByTokenHash(
  db: Db,
  tokenHash: string,
): Promise<SessionRow | undefined> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      activeBranchId: sessions.activeBranchId,
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
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/** Set last_seen_at to now, only if it is older than a minute (database clock). */
export async function touchSession(db: Db, sessionId: number): Promise<void> {
  await db
    .update(sessions)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(eq(sessions.id, sessionId), lt(sessions.lastSeenAt, sql`now() - interval '1 minute'`)),
    );
}

/** Delete one session by id. */
export async function deleteSessionById(db: Db, sessionId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Delete one session by the token's hash. */
export async function deleteSessionByTokenHash(db: Db, tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** Delete all of a user's sessions, optionally keeping one; returns how many were deleted. */
export async function deleteSessionsForUser(
  db: Db,
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
