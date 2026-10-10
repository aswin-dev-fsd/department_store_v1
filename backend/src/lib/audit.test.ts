import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../test/helpers/db.js';
import { logAudit, redact, REDACTED } from './audit.js';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

async function insertUser(): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (username, password_hash, full_name, role)
     values ('admin', 'x', 'Admin', 'admin') returning id`,
  );
  return Number(rows[0]!.id);
}

describe('redact', () => {
  it('hides password, token, secret and hash fields at any depth, keeping the rest', () => {
    expect(
      redact({
        password: 'p1',
        user: { passwordHash: 'h', name: 'Ravi' },
        lines: [{ tokenHash: 't', quantity: 2 }],
        apiSecret: 's',
        note: 'ok',
      }),
    ).toEqual({
      password: REDACTED,
      user: { passwordHash: REDACTED, name: 'Ravi' },
      lines: [{ tokenHash: REDACTED, quantity: 2 }],
      apiSecret: REDACTED,
      note: 'ok',
    });
  });

  it('keeps true/false flags visible even when their name mentions a password or token', () => {
    // A boolean can't leak a secret, and hiding it would erase what a password change did
    expect(
      redact({
        mustChangePassword: true,
        hasPassword: false,
        tokenExpired: false,
        password: 'p1',
        user: { passwordResetRequired: true, passwordHash: 'h' },
      }),
    ).toEqual({
      mustChangePassword: true,
      hasPassword: false,
      tokenExpired: false,
      password: REDACTED,
      user: { passwordResetRequired: true, passwordHash: REDACTED },
    });
  });

  it('still hides a secret stored as a number, or as null', () => {
    expect(redact({ token: 123456, passwordHash: null })).toEqual({
      token: REDACTED,
      passwordHash: REDACTED,
    });
  });

  it('passes primitives and null through, and turns dates into ISO strings', () => {
    expect(redact(null)).toBeNull();
    expect(redact(42)).toBe(42);
    expect(redact('text')).toBe('text');
    expect(redact({ at: new Date('2026-10-10T00:00:00Z') })).toEqual({
      at: '2026-10-10T00:00:00.000Z',
    });
  });
});

describe('logAudit', () => {
  it('writes one row with who, what, where and redacted before/after', async () => {
    const actorId = await insertUser();
    await logAudit(db, {
      actorId,
      action: 'user.update',
      entity: 'user',
      entityId: 42,
      before: { fullName: 'Old', passwordHash: 'secret-hash' },
      after: { fullName: 'New' },
      ip: '203.0.113.7',
    });

    const row = await expectAudit(db, { action: 'user.update', entity: 'user', entityId: 42 });
    expect(row).toMatchObject({
      actorId,
      branchId: null,
      entityId: '42',
      before: { fullName: 'Old', passwordHash: REDACTED },
      after: { fullName: 'New' },
      ip: '203.0.113.7',
    });
    expect(JSON.stringify(row)).not.toContain('secret-hash');
  });

  it('records events without an actor (e.g. a failed login)', async () => {
    await logAudit(db, {
      actorId: null,
      action: 'auth.login_failed',
      entity: 'user',
      after: { username: 'ravi' },
    });
    const row = await expectAudit(db, { action: 'auth.login_failed' });
    expect(row).toMatchObject({ actorId: null, entityId: null, before: null });
  });

  it('commits or rolls back with the caller’s transaction', async () => {
    await expect(
      db.transaction(async (tx) => {
        await logAudit(tx, { actorId: null, action: 'test.rollback', entity: 'test' });
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');

    const { rows } = await pool.query(`select count(*)::int as n from audit_logs`);
    expect(rows[0]).toEqual({ n: 0 });
  });
});
