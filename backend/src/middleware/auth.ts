import type { Db } from '@ds/database';
import type { Request, RequestHandler } from 'express';
import { AuthError } from '../lib/errors.js';
import { verifySession, type SessionUser } from '../modules/auth/auth.service.js';

/** Name of the httpOnly session cookie (Phase 2 convention). */
export const SESSION_COOKIE = 'ds_session';

/** Who is calling and where they work — set on req.ctx by requireAuth. */
export interface RequestContext {
  user: SessionUser;
  /** null for admins, and for cashiers who haven't picked (or lost access to) a branch. */
  activeBranchId: number | null;
  sessionId: number;
  /** The raw cookie token, kept in memory only (needed to end "other" sessions). */
  sessionToken: string;
}

/** Require a valid session cookie; attaches req.ctx or answers 401. */
export function requireAuth(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token === '') {
      throw new AuthError('Please log in');
    }
    const session = await verifySession(db, token);
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
