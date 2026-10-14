import { describe, expect, it } from 'vitest';
import { t } from '../i18n/t';
import { ApiError } from './client';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('uses the dictionary text for a known code', () => {
    expect(errorMessage(new ApiError('INVALID_CREDENTIALS', 'server words', 401))).toBe(
      t('error.INVALID_CREDENTIALS'),
    );
    expect(errorMessage(new ApiError('NETWORK_ERROR', 'Could not reach the server', 0))).toBe(
      t('error.NETWORK_ERROR'),
    );
  });

  it('shows the server wording for a refusal whose code the dictionary lacks', () => {
    expect(errorMessage(new ApiError('SOME_NEW_RULE', 'That branch is closed', 400))).toBe(
      'That branch is closed',
    );
  });

  it('never shows server wording for a server fault', () => {
    expect(errorMessage(new ApiError('SOME_NEW_FAULT', 'stack trace here', 503))).toBe(
      t('error.generic'),
    );
  });

  it('falls back to the generic text for anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe(t('error.generic'));
    expect(errorMessage('boom')).toBe(t('error.generic'));
    expect(errorMessage(undefined)).toBe(t('error.generic'));
  });

  it('has text for every code the Phase 2 auth screens can meet', () => {
    const codes = [
      'INVALID_CREDENTIALS',
      'WRONG_CURRENT_PASSWORD',
      'PASSWORD_UNCHANGED',
      'ACCOUNT_DISABLED',
      'SESSION_EXPIRED',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'BRANCH_NOT_ASSIGNED',
      'NO_ACTIVE_BRANCH',
      'PASSWORD_CHANGE_REQUIRED',
      'VALIDATION_ERROR',
      'NETWORK_ERROR',
      'BAD_RESPONSE',
      'INTERNAL_ERROR',
    ];
    for (const code of codes) {
      expect(errorMessage(new ApiError(code, 'SERVER WORDS', 400)), code).not.toBe('SERVER WORDS');
    }
  });

  it('has text for every code the Admin screens can meet', () => {
    const codes = [
      'DUPLICATE_CODE',
      'DUPLICATE_USERNAME',
      'CANNOT_DEACTIVATE_SELF',
      'CANNOT_RESET_OWN_PASSWORD',
      'NOT_A_CASHIER',
      'BRANCH_NOT_AVAILABLE',
      'NOT_SET_UP',
      'NOT_FOUND',
    ];
    for (const code of codes) {
      expect(errorMessage(new ApiError(code, 'SERVER WORDS', 400)), code).not.toBe('SERVER WORDS');
    }
  });
});
