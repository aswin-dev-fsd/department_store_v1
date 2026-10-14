import { changePasswordSchema, loginSchema } from '@ds/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { serverFieldErrors, validateForm } from './fieldErrors';

describe('validateForm', () => {
  it('returns the parsed data when the form is valid (trimmed by the schema)', () => {
    const result = validateForm(loginSchema, { username: '  ravi ', password: 'secret' });
    expect(result).toEqual({ ok: true, data: { username: 'ravi', password: 'secret' } });
  });

  it('returns one message per field, the first problem of each', () => {
    const result = validateForm(loginSchema, { username: '', password: '' });
    expect(result).toEqual({
      ok: false,
      errors: { username: 'Enter the username', password: 'Enter the password' },
    });
  });

  it('reports only the fields that are wrong', () => {
    const result = validateForm(changePasswordSchema, {
      currentPassword: 'old-password',
      newPassword: 'short',
    });
    expect(result).toEqual({ ok: false, errors: { newPassword: 'Use at least 8 characters' } });
  });
});

describe('serverFieldErrors', () => {
  it('maps the server\'s "body.field" paths onto form fields', () => {
    const error = new ApiError('VALIDATION_ERROR', 'Invalid request data', 422, [
      { path: 'body.newPassword', message: 'Use at least 8 characters' },
      { path: 'body.newPassword', message: 'second problem, ignored' },
      { path: 'body.username', message: 'Enter the username' },
    ]);
    expect(serverFieldErrors(error)).toEqual({
      newPassword: 'Use at least 8 characters',
      username: 'Enter the username',
    });
  });

  it('ignores errors without field details and details of the wrong shape', () => {
    expect(serverFieldErrors(new ApiError('NOT_FOUND', 'x', 404))).toEqual({});
    expect(serverFieldErrors(new ApiError('VALIDATION_ERROR', 'x', 422, 'oops'))).toEqual({});
    expect(serverFieldErrors(new ApiError('VALIDATION_ERROR', 'x', 422, [{ nope: 1 }]))).toEqual(
      {},
    );
    expect(serverFieldErrors(new Error('boom'))).toEqual({});
  });

  it('ignores problems that are not about the body (params, query)', () => {
    const error = new ApiError('VALIDATION_ERROR', 'x', 422, [
      { path: 'query.limit', message: 'bad' },
    ]);
    expect(serverFieldErrors(error)).toEqual({});
  });
});
