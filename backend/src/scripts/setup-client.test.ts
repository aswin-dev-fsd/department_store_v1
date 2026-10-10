import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../test/helpers/db.js';
import { AppError } from '../lib/errors.js';
import { verifyPassword } from '../modules/auth/auth.service.js';
import { setupClient, type SetupClientInput } from './setup-client.js';

const { db, pool } = createTestDb();

const input: SetupClientInput = {
  businessName: 'Demo Stores',
  adminUsername: 'admin',
  adminFullName: 'Store Admin',
};

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

/** Row counts and the stored business name — to prove a refused run changed nothing. */
async function snapshot() {
  const { rows } = await pool.query(`
    select (select count(*)::int from client_settings) as settings,
           (select count(*)::int from users) as users,
           (select count(*)::int from audit_logs) as audits,
           (select business_name from client_settings limit 1) as business_name`);
  return rows[0];
}

describe('setupClient', () => {
  it('creates the client settings and a first Admin who must change the temporary password', async () => {
    const result = await setupClient(db, input);

    expect(result).toMatchObject({
      businessName: 'Demo Stores',
      admin: { username: 'admin', fullName: 'Store Admin' },
      temporaryPassword: expect.stringMatching(/^[A-Za-z0-9]{16}$/),
    });

    const settings = await pool.query('select id, business_name from client_settings');
    expect(settings.rows).toEqual([{ id: 1, business_name: 'Demo Stores' }]);

    const users = await pool.query(
      `select id, username, full_name, role, is_active, must_change_password, password_hash
       from users`,
    );
    expect(users.rows).toHaveLength(1);
    // Raw SQL returns bigint ids as strings
    expect(Number(users.rows[0].id)).toBe(result.admin.id);
    expect(users.rows[0]).toMatchObject({
      username: 'admin',
      full_name: 'Store Admin',
      role: 'admin',
      is_active: true,
      must_change_password: true,
    });
    // Only the hash is stored, and it belongs to the returned password
    expect(users.rows[0].password_hash).not.toContain(result.temporaryPassword);
    await expect(
      verifyPassword(result.temporaryPassword, users.rows[0].password_hash),
    ).resolves.toBe(true);
  });

  it('maps no branches to the Admin (admins are not tied to branches)', async () => {
    await setupClient(db, input);
    const { rows } = await pool.query('select count(*)::int as n from user_branches');
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('writes an audit row for each record, without any password', async () => {
    const result = await setupClient(db, input);

    const settingsRow = await expectAudit(db, {
      action: 'client_settings.create',
      entity: 'client_settings',
      entityId: 1,
      actorId: null,
    });
    expect(settingsRow.after).toEqual({ businessName: 'Demo Stores' });

    const userRow = await expectAudit(db, {
      action: 'user.create',
      entity: 'user',
      entityId: result.admin.id,
      actorId: null,
    });
    expect(userRow.after).toEqual({
      username: 'admin',
      fullName: 'Store Admin',
      role: 'admin',
      mustChangePassword: true,
    });
    expect(JSON.stringify([settingsRow, userRow])).not.toContain(result.temporaryPassword);
  });

  it('gives each run a different temporary password', async () => {
    const first = await setupClient(db, input);
    await resetDb(db);
    const second = await setupClient(db, input);
    expect(second.temporaryPassword).not.toBe(first.temporaryPassword);
  });

  it('refuses a second run with a clear message and changes nothing', async () => {
    await setupClient(db, input);
    const before = await snapshot();

    const error = await setupClient(db, {
      businessName: 'Another Business',
      adminUsername: 'second',
      adminFullName: 'Second Admin',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'ALREADY_SET_UP' });
    expect((error as AppError).message).toMatch(/already set up/i);
    expect(await snapshot()).toEqual(before);
    expect(before).toMatchObject({ settings: 1, users: 1, business_name: 'Demo Stores' });
  });

  it('also refuses when users already exist, and creates nothing', async () => {
    await pool.query(
      `insert into users (username, password_hash, full_name, role)
       values ('old.admin', 'x', 'Old Admin', 'admin')`,
    );

    await expect(setupClient(db, input)).rejects.toMatchObject({ code: 'ALREADY_SET_UP' });
    expect(await snapshot()).toMatchObject({ settings: 0, users: 1, audits: 0 });
  });

  it('lets exactly one of two simultaneous runs win; the other gets the same clear refusal', async () => {
    const results = await Promise.allSettled([
      setupClient(db, input),
      setupClient(db, { ...input, adminUsername: 'other', businessName: 'Other Stores' }),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]!.reason).toBeInstanceOf(AppError);
    expect(lost[0]!.reason).toMatchObject({ code: 'ALREADY_SET_UP' });
    expect(await snapshot()).toMatchObject({ settings: 1, users: 1, audits: 2 });
  });

  it('rejects invalid input before touching the database', async () => {
    await expect(setupClient(db, { ...input, adminUsername: 'a b' })).rejects.toThrow();
    await expect(setupClient(db, { ...input, businessName: '   ' })).rejects.toThrow();
    expect(await snapshot()).toMatchObject({ settings: 0, users: 0, audits: 0 });
  });
});
