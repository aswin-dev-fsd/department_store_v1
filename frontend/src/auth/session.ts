import { ApiError } from '../api/client';
import type { MessageKey } from '../i18n/en';

/** 401 codes that mean "you are not logged in (any more)". A wrong password is not one. */
const SESSION_LOST_CODES = new Set(['UNAUTHORIZED', 'SESSION_EXPIRED', 'ACCOUNT_DISABLED']);

/** 403 codes that mean the account changed under the screen: reload who the user is. */
const ACCOUNT_CHANGED_CODES = new Set([
  'NO_ACTIVE_BRANCH',
  'PASSWORD_CHANGE_REQUIRED',
  'BRANCH_NOT_ASSIGNED',
]);

/** Whether the server says this visitor no longer has a session. */
export function isSessionLost(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401 && SESSION_LOST_CODES.has(error.code);
}

/** What to tell the login page when a session ended on its own; null for a quiet end. */
export function sessionNoticeFor(error: ApiError): MessageKey | null {
  if (error.code === 'SESSION_EXPIRED') return 'login.sessionExpired';
  if (error.code === 'ACCOUNT_DISABLED') return 'login.accountDisabled';
  return null;
}

/** Whether a failure means the user's branch or password state changed and `me` is stale. */
export function shouldRefreshMe(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && ACCOUNT_CHANGED_CODES.has(error.code);
}

/**
 * Retry policy for queries: one retry when the server couldn't be reached or failed (a
 * sleeping free-tier backend, a proxy timeout), none for a refusal — asking again can't
 * change a 401, 403, 404 or 422.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof ApiError) return error.status === 0 || error.status >= 500;
  return true;
}
