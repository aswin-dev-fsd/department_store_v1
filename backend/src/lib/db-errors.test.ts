import { schema } from '@ds/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../../test/helpers/db.js';
import { isUniqueViolation, pgErrorCode } from './db-errors.js';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

const branch = { code: 'TPR', name: 'Tiruppur', address: 'Main Road' };

describe('pgErrorCode / isUniqueViolation', () => {
  it('recognises a real unique violation raised through Drizzle (which wraps the driver error)', async () => {
    await db.insert(schema.branches).values(branch);
    const error = await db
      .insert(schema.branches)
      .values(branch)
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(error).toBeDefined();
    expect(pgErrorCode(error)).toBe('23505');
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('does not mistake other database errors for a unique violation', async () => {
    const error = await db
      .insert(schema.branches)
      .values({ ...branch, code: 'toolong' }) // breaks the code-format CHECK constraint
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(pgErrorCode(error)).toBe('23514');
    expect(isUniqueViolation(error)).toBe(false);
  });

  it('is false for errors that did not come from the database', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(pgErrorCode({ cause: { cause: { code: '23505' } } })).toBe('23505');
  });
});
