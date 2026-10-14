import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { isSessionLost, sessionNoticeFor, shouldRefreshMe, shouldRetry } from './session';

const apiError = (code: string, status: number) => new ApiError(code, 'message', status);

describe('isSessionLost', () => {
  it.each([
    ['UNAUTHORIZED', 401],
    ['SESSION_EXPIRED', 401],
    ['ACCOUNT_DISABLED', 401],
  ])('is true for 401 %s', (code, status) => {
    expect(isSessionLost(apiError(code, status))).toBe(true);
  });

  it('is false for a wrong password, which is a 401 that must not log anyone out', () => {
    expect(isSessionLost(apiError('INVALID_CREDENTIALS', 401))).toBe(false);
  });

  it('is false for other failures and for things that are not API errors', () => {
    expect(isSessionLost(apiError('FORBIDDEN', 403))).toBe(false);
    expect(isSessionLost(apiError('NETWORK_ERROR', 0))).toBe(false);
    expect(isSessionLost(apiError('WRONG_CURRENT_PASSWORD', 400))).toBe(false);
    expect(isSessionLost(new Error('boom'))).toBe(false);
    expect(isSessionLost(null)).toBe(false);
  });
});

describe('sessionNoticeFor', () => {
  it('explains an expired or deactivated session, and stays quiet for a plain logout', () => {
    expect(sessionNoticeFor(apiError('SESSION_EXPIRED', 401))).toBe('login.sessionExpired');
    expect(sessionNoticeFor(apiError('ACCOUNT_DISABLED', 401))).toBe('login.accountDisabled');
    expect(sessionNoticeFor(apiError('UNAUTHORIZED', 401))).toBeNull();
  });
});

describe('shouldRefreshMe', () => {
  it.each(['NO_ACTIVE_BRANCH', 'PASSWORD_CHANGE_REQUIRED', 'BRANCH_NOT_ASSIGNED'])(
    'is true for 403 %s: the account changed under the screen',
    (code) => {
      expect(shouldRefreshMe(apiError(code, 403))).toBe(true);
    },
  );

  it('is false for an ordinary refusal or any other failure', () => {
    expect(shouldRefreshMe(apiError('FORBIDDEN', 403))).toBe(false);
    expect(shouldRefreshMe(apiError('NO_ACTIVE_BRANCH', 400))).toBe(false);
    expect(shouldRefreshMe(new Error('boom'))).toBe(false);
  });
});

describe('shouldRetry', () => {
  it('retries once when the server could not be reached or failed', () => {
    expect(shouldRetry(0, apiError('NETWORK_ERROR', 0))).toBe(true);
    expect(shouldRetry(0, apiError('INTERNAL_ERROR', 500))).toBe(true);
    expect(shouldRetry(0, apiError('BAD_RESPONSE', 502))).toBe(true);
    expect(shouldRetry(0, new TypeError('x'))).toBe(true);
  });

  it('gives up after one retry', () => {
    expect(shouldRetry(1, apiError('NETWORK_ERROR', 0))).toBe(false);
  });

  it('never retries a refusal: asking again cannot change the answer', () => {
    expect(shouldRetry(0, apiError('UNAUTHORIZED', 401))).toBe(false);
    expect(shouldRetry(0, apiError('FORBIDDEN', 403))).toBe(false);
    expect(shouldRetry(0, apiError('NOT_FOUND', 404))).toBe(false);
    expect(shouldRetry(0, apiError('VALIDATION_ERROR', 422))).toBe(false);
  });
});
