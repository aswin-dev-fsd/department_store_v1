import { changePasswordSchema, loginSchema } from '@ds/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { t } from '../i18n/t';
import { describeFailure, serverFieldErrors, validateForm } from './fieldErrors';

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

describe('describeFailure', () => {
  const codeFields = { DUPLICATE_CODE: 'code', DUPLICATE_USERNAME: 'username' };

  it('has nothing to say when nothing failed', () => {
    expect(describeFailure(null, codeFields)).toEqual({ fields: {}, message: null });
    expect(describeFailure(undefined)).toEqual({ fields: {}, message: null });
  });

  it('puts a duplicate error next to the field it is about, with the dictionary text', () => {
    const error = new ApiError('DUPLICATE_CODE', 'Another branch already uses this code', 400);
    expect(describeFailure(error, codeFields)).toEqual({
      fields: { code: t('error.DUPLICATE_CODE') },
      message: null,
    });
  });

  it('puts a server validation failure next to its fields', () => {
    const error = new ApiError('VALIDATION_ERROR', 'Invalid request data', 422, [
      { path: 'body.name', message: 'Enter the branch name' },
    ]);
    expect(describeFailure(error, codeFields)).toEqual({
      fields: { name: 'Enter the branch name' },
      message: null,
    });
  });

  it('shows anything else as one message, and leaves the fields alone', () => {
    const error = new ApiError(
      'CANNOT_DEACTIVATE_SELF',
      'You cannot deactivate your own account',
      400,
    );
    expect(describeFailure(error, codeFields)).toEqual({
      fields: {},
      message: t('error.CANNOT_DEACTIVATE_SELF'),
    });
    expect(describeFailure(new Error('boom'))).toEqual({ fields: {}, message: t('error.generic') });
  });

  it('shows a mapped code as a message when the form has no such field mapped for it', () => {
    const error = new ApiError('DUPLICATE_USERNAME', 'That username is already taken', 400);
    expect(describeFailure(error, {})).toEqual({
      fields: {},
      message: t('error.DUPLICATE_USERNAME'),
    });
  });
});
