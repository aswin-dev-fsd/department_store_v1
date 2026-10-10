import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import { AuthError } from '../../lib/errors.js';
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  hashPassword,
  verifyPassword,
  verifySession,
} from './auth.service.js';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

async function insertUser(overrides: { isActive?: boolean } = {}): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (username, password_hash, full_name, role, is_active)
     values ('ravi', 'not-a-real-hash', 'Ravi Kumar', 'cashier', $1) returning id`,
    [overrides.isActive ?? true],
  );
  return Number(rows[0]!.id);
}

async function insertBranch(): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into branches (code, name, address) values ('TPR', 'Tiruppur', 'Main Road') returning id`,
  );
  return Number(rows[0]!.id);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('passwords', () => {
  it('hash with bcrypt cost 12 and verify only the right password', async () => {
    const hash = await hashPassword('Correct-Horse-1');
    expect(hash).toMatch(/^\$2b\$12\$/);
    expect(hash).not.toContain('Correct-Horse-1');
    await expect(verifyPassword('Correct-Horse-1', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('refuse passwords over 72 bytes — bcrypt would silently ignore the rest', async () => {
    await expect(hashPassword('a'.repeat(73))).rejects.toThrow(/72 bytes/);
    // Counted in bytes, not characters: 25 Tamil letters × 3 bytes = 75 bytes
    await expect(hashPassword('த'.repeat(25))).rejects.toThrow(/72 bytes/);
  });

  it('never verify an over-long password, even if its first 72 bytes match', async () => {
    const hash = await hashPassword('a'.repeat(72));
    await expect(verifyPassword('a'.repeat(72) + 'extra', hash)).resolves.toBe(false);
  });
});

describe('createSession', () => {
  it('returns a random token and stores only its SHA-256 hash', async () => {
    const userId = await insertUser();
    const { token, expiresAt } = await createSession(db, { userId });

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    const { rows } = await pool.query('select * from sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(sha256(token));
    expect(JSON.stringify(rows[0])).not.toContain(token);

    const hoursAhead = (expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hoursAhead).toBeGreaterThan(11.9); // SESSION_TTL_HOURS default 12
    expect(hoursAhead).toBeLessThanOrEqual(12);
  });

  it('gives every session a different token', async () => {
    const userId = await insertUser();
    const a = await createSession(db, { userId });
    const b = await createSession(db, { userId });
    expect(a.token).not.toBe(b.token);
  });
});

describe('verifySession', () => {
  it('returns the user and active branch for a valid token', async () => {
    const userId = await insertUser();
    const branchId = await insertBranch();
    const { token } = await createSession(db, { userId, activeBranchId: branchId });

    const session = await verifySession(db, token);
    expect(session).toMatchObject({
      activeBranchId: branchId,
      user: {
        id: userId,
        username: 'ravi',
        fullName: 'Ravi Kumar',
        role: 'cashier',
        mustChangePassword: false,
      },
    });
    expect(session.user).not.toHaveProperty('passwordHash');
  });

  it('rejects an unknown token', async () => {
    const error = await verifySession(db, 'no-such-token').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects an expired session and deletes it', async () => {
    const userId = await insertUser();
    const { token } = await createSession(db, { userId });
    // A full minute in the past, so a small PC-vs-database clock difference can't flip it
    await pool.query(`update sessions set expires_at = now() - interval '1 minute'`);

    await expect(verifySession(db, token)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    const { rows } = await pool.query('select count(*)::int as n from sessions');
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('rejects a deactivated user and ends all their sessions', async () => {
    const userId = await insertUser();
    const { token } = await createSession(db, { userId });
    await createSession(db, { userId });
    await pool.query('update users set is_active = false where id = $1', [userId]);

    await expect(verifySession(db, token)).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
    const { rows } = await pool.query('select count(*)::int as n from sessions');
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('refreshes last_seen_at, at most once a minute', async () => {
    const userId = await insertUser();
    const { token } = await createSession(db, { userId });
    await pool.query(`update sessions set last_seen_at = now() - interval '5 minutes'`);

    await verifySession(db, token);
    const first = await pool.query<{ age: number }>(
      `select extract(epoch from now() - last_seen_at)::float as age from sessions`,
    );
    expect(first.rows[0]!.age).toBeLessThan(10);

    // A second check straight away must not write again
    await pool.query(`update sessions set last_seen_at = now() - interval '30 seconds'`);
    await verifySession(db, token);
    const second = await pool.query<{ age: number }>(
      `select extract(epoch from now() - last_seen_at)::float as age from sessions`,
    );
    expect(second.rows[0]!.age).toBeGreaterThanOrEqual(29);
  });
});

describe('ending sessions', () => {
  it('deleteSession ends only that session', async () => {
    const userId = await insertUser();
    const kept = await createSession(db, { userId });
    const ended = await createSession(db, { userId });

    await deleteSession(db, ended.token);

    await expect(verifySession(db, ended.token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(verifySession(db, kept.token)).resolves.toBeDefined();
  });

  it('deleteUserSessions ends all of a user’s sessions, optionally keeping the current one', async () => {
    const userId = await insertUser();
    const current = await createSession(db, { userId });
    const other = await createSession(db, { userId });

    await expect(deleteUserSessions(db, userId, { except: current.token })).resolves.toBe(1);
    await expect(verifySession(db, other.token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(verifySession(db, current.token)).resolves.toBeDefined();

    await expect(deleteUserSessions(db, userId)).resolves.toBe(1);
    await expect(verifySession(db, current.token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
