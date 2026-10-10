import type { Db } from '@ds/database';
import type { CookieOptions, Request, RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AuthError, ForbiddenError } from '../lib/errors.js';
import { verifySession, type SessionUser } from '../modules/auth/auth.service.js';

/** Name of the httpOnly session cookie (Phase 2 convention). */
export const SESSION_COOKIE = 'ds_session';

/**
 * Session cookie settings: unreadable by page scripts (httpOnly), not sent on cross-site
 * requests (SameSite=lax — part of the CSRF defence), sent to every path, HTTPS-only when
 * COOKIE_SECURE is on (always in production).
 */
export function sessionCookieOptions(
  expires?: Date,
  secure: boolean = env.COOKIE_SECURE,
): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

/** Who is calling and where they work — set on req.ctx by requireAuth. */
export interface RequestContext {
  user: SessionUser;
  /** null for admins, and for cashiers who haven't picked (or lost access to) a branch. */
  activeBranchId: number | null;
  sessionId: number;
  /** The raw cookie token, kept in memory only (needed to end "other" sessions). */
  sessionToken: string;
}

export interface RequireAuthOptions {
  /**
   * Let a user who still has to replace a temporary password through. Only for
   * me / change-password / logout — every other route refuses them (403).
   */
  allowPendingPasswordChange?: boolean;
}

/** Require a valid session cookie; attaches req.ctx or answers 401 (403 if a password change is due). */
export function requireAuth(
  db: Db,
  { allowPendingPasswordChange = false }: RequireAuthOptions = {},
): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token === '') {
      throw new AuthError('Please log in');
    }
    const session = await verifySession(db, token);
    if (session.user.mustChangePassword && !allowPendingPasswordChange) {
      throw new ForbiddenError(
        'Change your password before continuing',
        'PASSWORD_CHANGE_REQUIRED',
      );
    }
    req.ctx = {
      user: session.user,
      activeBranchId: session.activeBranchId,
      sessionId: session.sessionId,
      sessionToken: token,
    };
    next();
  };
}

/** The request's context. Throws 401 if requireAuth didn't run — never treat that as allowed. */
export function requestContext(req: Request): RequestContext {
  if (!req.ctx) {
    throw new AuthError('Please log in');
  }
  return req.ctx;
}
