// Passwords and login sessions (overview §4.7). The browser holds a random token in an
// httpOnly cookie; the database stores only its SHA-256 hash, so a database leak can't be
// replayed as a login.
import type { Db } from '@ds/database';
import type { Role } from '@ds/shared';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { AuthError } from '../../lib/errors.js';
import * as model from './auth.model.js';

export const BCRYPT_COST = 12;
// bcrypt silently ignores everything after 72 bytes; refuse longer passwords instead
export const PASSWORD_MAX_BYTES = 72;
const TOKEN_BYTES = 32;

/** Hash a password with bcrypt (cost 12). Throws for passwords over 72 bytes. */
export async function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new Error(`Password must be at most ${PASSWORD_MAX_BYTES} bytes`);
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

/** Check a password against its bcrypt hash. Over-long passwords never match. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return false;
  return bcrypt.compare(password, hash);
}

/** SHA-256 hex of a session token: the only form of it the database ever sees. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionUser {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface VerifiedSession {
  sessionId: number;
  user: SessionUser;
  activeBranchId: number | null;
  expiresAt: Date;
}

export interface CreateSessionInput {
  userId: number;
  activeBranchId?: number | null;
  /** Defaults to SESSION_TTL_HOURS. */
  ttlHours?: number;
}

/** Start a session. Returns the raw token for the cookie (never stored) and its expiry. */
export async function createSession(
  db: Db,
  { userId, activeBranchId = null, ttlHours = env.SESSION_TTL_HOURS }: CreateSessionInput,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await model.insertSession(db, { tokenHash: hashToken(token), userId, activeBranchId, expiresAt });
  return { token, expiresAt };
}

/**
 * Resolve a cookie token to its user and active branch, or throw AuthError (401).
 * Expired sessions are deleted; a deactivated user loses every session.
 */
export async function verifySession(db: Db, token: string): Promise<VerifiedSession> {
  const row = await model.findSessionByTokenHash(db, hashToken(token));
  if (!row) {
    throw new AuthError('Please log in');
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    await model.deleteSessionById(db, row.sessionId);
    throw new AuthError('Your session has expired — please log in again', 'SESSION_EXPIRED');
  }
  if (!row.user.isActive) {
    await model.deleteSessionsForUser(db, row.user.id);
    throw new AuthError('This account has been deactivated', 'ACCOUNT_DISABLED');
  }
  await model.touchSession(db, row.sessionId);
  const { isActive: _isActive, ...user } = row.user;
  return {
    sessionId: row.sessionId,
    user,
    activeBranchId: row.activeBranchId,
    expiresAt: row.expiresAt,
  };
}

/** End one session (logout). */
export async function deleteSession(db: Db, token: string): Promise<void> {
  await model.deleteSessionByTokenHash(db, hashToken(token));
}

/**
 * End all of a user's sessions — e.g. on deactivation or password reset — optionally keeping
 * one (the session that is changing its own password). Returns how many ended.
 */
export async function deleteUserSessions(
  db: Db,
  userId: number,
  { except }: { except?: string } = {},
): Promise<number> {
  return model.deleteSessionsForUser(
    db,
    userId,
    except === undefined ? undefined : hashToken(except),
  );
}
