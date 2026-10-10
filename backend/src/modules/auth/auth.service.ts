// Passwords, login sessions and the login flow (overview §4.7, §7.2; D-04, D-10, D-30).
// The browser holds a random token in an httpOnly cookie; the database stores only its
// SHA-256 hash, so a database leak can't be replayed as a login.
import type { Db, DbOrTx } from '@ds/database';
import {
  PASSWORD_MAX_BYTES,
  ROLE_PERMISSIONS,
  type BranchSummary,
  type ChangePasswordInput,
  type MeResponse,
  type Role,
} from '@ds/shared';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { logAudit } from '../../lib/audit.js';
import { AppError, AuthError, ForbiddenError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import * as model from './auth.model.js';

export const BCRYPT_COST = 12;
const TOKEN_BYTES = 32;

// A real cost-12 bcrypt hash of a random throwaway string. Unknown usernames are checked
// against it, so they take as long as real ones and usernames can't be discovered by timing.
const DUMMY_PASSWORD_HASH = '$2b$12$eWaSOpdsW3qehd/p1BCLwu/KuexaBuFbpFIVFkwrKy.Jyl7efdrsm';

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
  db: DbOrTx,
  { userId, activeBranchId = null, ttlHours = env.SESSION_TTL_HOURS }: CreateSessionInput,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await model.insertSession(db, { tokenHash: hashToken(token), userId, activeBranchId, expiresAt });
  return { token, expiresAt };
}

/**
 * Resolve a cookie token to its user and active branch, or throw AuthError (401).
 * Expired sessions are deleted; a deactivated user loses every session. The active branch is
 * reported as null once the user is unmapped from it or it is deactivated, so access ends at
 * once rather than at the next login.
 */
export async function verifySession(db: DbOrTx, token: string): Promise<VerifiedSession> {
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
    activeBranchId: row.branchUsable ? row.activeBranchId : null,
    expiresAt: row.expiresAt,
  };
}

/** End one session. */
export async function deleteSession(db: DbOrTx, token: string): Promise<void> {
  await model.deleteSessionByTokenHash(db, hashToken(token));
}

/**
 * End all of a user's sessions — e.g. on deactivation or password reset — optionally keeping
 * one (the session that is changing its own password). Returns how many ended.
 */
export async function deleteUserSessions(
  db: DbOrTx,
  userId: number,
  { except }: { except?: string } = {},
): Promise<number> {
  return model.deleteSessionsForUser(
    db,
    userId,
    except === undefined ? undefined : hashToken(except),
  );
}

// ---------------------------------------------------------------------------------------
// Login flow (routes in auth.routes.ts)

function buildMe(
  user: SessionUser,
  branches: BranchSummary[],
  activeBranchId: number | null,
): MeResponse {
  return {
    user,
    permissions: [...ROLE_PERMISSIONS[user.role]],
    branches,
    activeBranchId,
    needsBranchSelection: user.role === 'cashier' && activeBranchId === null,
  };
}

/** Admins aren't tied to branches (D-10). */
async function branchesFor(db: DbOrTx, user: SessionUser): Promise<BranchSummary[]> {
  return user.role === 'cashier' ? model.listActiveBranchesForUser(db, user.id) : [];
}

export interface LoginAttempt {
  username: string;
  password: string;
  ip: string | null;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  me: MeResponse;
}

/**
 * Check credentials and start a session. Every failure gets the same answer, and is audited
 * with the attempted username (never the password). A cashier with exactly one active branch
 * starts in it; with several, they pick one.
 */
export async function login(
  db: Db,
  { username, password, ip }: LoginAttempt,
): Promise<LoginResult> {
  const user = await model.findUserByUsername(db, username);
  // Always run bcrypt, even for unknown usernames, so timing reveals nothing
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !passwordOk || !user.isActive) {
    const reason = !user ? 'unknown_user' : !passwordOk ? 'wrong_password' : 'inactive';
    await logAudit(db, {
      actorId: null,
      action: 'auth.login_failed',
      entity: 'user',
      entityId: user?.id ?? null,
      after: { username, reason },
      ip,
    });
    throw new AuthError('Invalid username or password', 'INVALID_CREDENTIALS');
  }

  const sessionUser: SessionUser = {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
  return db.transaction(async (tx) => {
    const branches = await branchesFor(tx, sessionUser);
    const activeBranchId = branches.length === 1 ? branches[0]!.id : null;
    const session = await createSession(tx, { userId: user.id, activeBranchId });
    await model.updateLastLogin(tx, user.id);
    await logAudit(tx, {
      actorId: user.id,
      branchId: activeBranchId,
      action: 'auth.login',
      entity: 'user',
      entityId: user.id,
      ip,
    });
    return { ...session, me: buildMe(sessionUser, branches, activeBranchId) };
  });
}

/** The logged-in user's profile, permissions and branches. */
export async function getMe(db: DbOrTx, ctx: RequestContext): Promise<MeResponse> {
  return buildMe(ctx.user, await branchesFor(db, ctx.user), ctx.activeBranchId);
}

/** Move a cashier's session to another of their active branches. */
export async function selectBranch(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  ip: string | null,
): Promise<MeResponse> {
  if (ctx.user.role !== 'cashier') {
    throw new ForbiddenError('Only cashiers work in a branch');
  }
  const branches = await model.listActiveBranchesForUser(db, ctx.user.id);
  if (!branches.some((branch) => branch.id === branchId)) {
    throw new ForbiddenError('You are not assigned to that branch', 'BRANCH_NOT_ASSIGNED');
  }
  await db.transaction(async (tx) => {
    await model.updateSessionBranch(tx, ctx.sessionId, branchId);
    await logAudit(tx, {
      actorId: ctx.user.id,
      branchId,
      action: 'auth.select_branch',
      entity: 'session',
      entityId: ctx.sessionId,
      before: { activeBranchId: ctx.activeBranchId },
      after: { activeBranchId: branchId },
      ip,
    });
  });
  return buildMe(ctx.user, branches, branchId);
}

/**
 * Change the logged-in user's password. Clears a forced change, and ends every other
 * session of this user (a stolen session can't outlive the change).
 */
export async function changePassword(
  db: Db,
  ctx: RequestContext,
  { currentPassword, newPassword }: ChangePasswordInput,
  ip: string | null,
): Promise<MeResponse> {
  const user = await model.findUserWithPasswordById(db, ctx.user.id);
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    await logAudit(db, {
      actorId: ctx.user.id,
      branchId: ctx.activeBranchId,
      action: 'auth.password_change_failed',
      entity: 'user',
      entityId: ctx.user.id,
      ip,
    });
    // 400, not 401: a 401 would make the app treat the user as logged out
    throw new AppError('WRONG_CURRENT_PASSWORD', 'The current password is not correct');
  }
  if (newPassword === currentPassword) {
    throw new AppError('PASSWORD_UNCHANGED', 'Choose a password different from the current one');
  }

  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await model.updatePassword(tx, user.id, passwordHash);
    await model.deleteSessionsForUser(tx, user.id, hashToken(ctx.sessionToken));
    await logAudit(tx, {
      actorId: user.id,
      branchId: ctx.activeBranchId,
      action: 'auth.password_change',
      entity: 'user',
      entityId: user.id,
      before: { mustChangePassword: user.mustChangePassword },
      after: { mustChangePassword: false },
      ip,
    });
  });
  const updated: SessionUser = { ...ctx.user, mustChangePassword: false };
  return buildMe(updated, await branchesFor(db, updated), ctx.activeBranchId);
}

/** End the current session. */
export async function logout(db: Db, ctx: RequestContext, ip: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await deleteSession(tx, ctx.sessionToken);
    await logAudit(tx, {
      actorId: ctx.user.id,
      branchId: ctx.activeBranchId,
      action: 'auth.logout',
      entity: 'user',
      entityId: ctx.user.id,
      ip,
    });
  });
}
