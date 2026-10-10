import { describe, expect, it } from 'vitest';
import { AppError, AuthError, ForbiddenError, NotFoundError, ValidationError } from './errors.js';

describe('typed errors (DreamLand §8)', () => {
  it.each([
    [new AppError('INSUFFICIENT_STOCK', 'Not enough stock'), 400, 'INSUFFICIENT_STOCK'],
    [new ValidationError(), 422, 'VALIDATION_ERROR'],
    [new AuthError(), 401, 'UNAUTHORIZED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
  ])('%s → %i %s', (error, status, code) => {
    expect(error.statusCode).toBe(status);
    expect(error.code).toBe(code);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });

  it('keeps the class name for logs', () => {
    expect(new NotFoundError().name).toBe('NotFoundError');
  });

  it('carries details', () => {
    const details = [{ itemId: 1, available: 3, requested: 10 }];
    expect(new AppError('INSUFFICIENT_STOCK', 'Not enough stock', details).details).toBe(details);
    expect(new ValidationError('Invalid input', details).details).toBe(details);
  });

  it('allows a more specific code with the fixed status', () => {
    const error = new ForbiddenError('Choose a branch first', 'NO_ACTIVE_BRANCH');
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('NO_ACTIVE_BRANCH');
    expect(error.message).toBe('Choose a branch first');
  });
});
