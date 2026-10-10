import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../test/helpers/db.js';
import { cookieFor, createUser } from '../../test/helpers/fixtures.js';
import { AppError } from '../lib/errors.js';
import { verifySession, verifyPassword } from '../modules/auth/auth.service.js';
import { resetPasswordForUsername } from './reset-password.js';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

async function storedHash(userId: number): Promise<string> {
  const { rows } = await pool.query('select password_hash from users where id = $1', [userId]);
  return rows[0].password_hash;
}

describe('resetPasswordForUsername', () => {
  it('sets a new temporary password the user must change, and ends all their sessions', async () => {
    const userId = await createUser(pool, { username: 'admin', role: 'admin' });
    const cookie = await cookieFor(db, userId);
    const token = cookie.split('=')[1]!;
    await verifySession(db, token); // the session works

    const result = await resetPasswordForUsername(db, { username: 'admin' });

    expect(result).toMatchObject({
      username: 'admin',
      isActive: true,
      temporaryPassword: expect.stringMatching(/^[A-Za-z0-9]{16}$/),
    });
    expect(await verifyPassword(result.temporaryPassword, await storedHash(userId))).toBe(true);
    const { rows } = await pool.query('select must_change_password from users where id = $1', [
      userId,
    ]);
    expect(rows[0]).toEqual({ must_change_password: true });
    await expect(verifySession(db, token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('writes an audit row with no actor and no password', async () => {
    const userId = await createUser(pool, { username: 'admin', role: 'admin' });
    const result = await resetPasswordForUsername(db, { username: 'admin' });

    const row = await expectAudit(db, {
      action: 'user.reset_password',
      entity: 'user',
      entityId: userId,
      actorId: null,
    });
    expect(row.before).toEqual({ mustChangePassword: false });
    expect(row.after).toEqual({ mustChangePassword: true, sessionsEnded: 0 });
    expect(JSON.stringify(row)).not.toContain(result.temporaryPassword);
  });

  it('finds the user whatever letter case is typed', async () => {
    await createUser(pool, { username: 'ravi.k' });
    const result = await resetPasswordForUsername(db, { username: 'RAVI.K' });
    expect(result.username).toBe('ravi.k');
  });

  it('works for a deactivated user too, and says so, without reactivating them', async () => {
    const userId = await createUser(pool, { username: 'gone', isActive: false });
    const result = await resetPasswordForUsername(db, { username: 'gone' });

    expect(result.isActive).toBe(false);
    const { rows } = await pool.query('select is_active from users where id = $1', [userId]);
    expect(rows[0]).toEqual({ is_active: false });
  });

  it('refuses an unknown username with a clear message, and changes nothing', async () => {
    await createUser(pool, { username: 'admin' });
    const before = await pool.query('select count(*)::int as n from audit_logs');

    const error = await resetPasswordForUsername(db, { username: 'nobody' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'USER_NOT_FOUND' });
    expect((error as AppError).message).toMatch(/nobody/);
    const after = await pool.query('select count(*)::int as n from audit_logs');
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('gives each reset a different password', async () => {
    await createUser(pool, { username: 'admin' });
    const first = await resetPasswordForUsername(db, { username: 'admin' });
    const second = await resetPasswordForUsername(db, { username: 'admin' });
    expect(second.temporaryPassword).not.toBe(first.temporaryPassword);
  });
});
