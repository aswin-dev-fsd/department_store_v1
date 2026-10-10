// Database-level rules for the access tables (Task 2.1). Raw SQL on purpose: these prove
// PostgreSQL itself enforces the rules, whatever the application code does.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../helpers/db.js';

const { db, pool } = createTestDb();

// PostgreSQL error codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
// ON DELETE RESTRICT reports restrict_violation, not the general foreign_key_violation (23503)
const RESTRICT_VIOLATION = '23001';
const INVALID_ENUM_VALUE = '22P02';

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

async function insertUser(username: string, role = 'cashier'): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `insert into users (username, password_hash, full_name, role)
     values ($1, 'hash', 'Test User', $2) returning id`,
    [username, role],
  );
  return Number(rows[0]!.id);
}

async function insertBranch(code: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `insert into branches (code, name, address) values ($1, 'Branch', 'Address') returning id`,
    [code],
  );
  return Number(rows[0]!.id);
}

describe('access tables exist', () => {
  it('has every access and audit table in the public schema', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const table of [
      'client_settings',
      'branches',
      'users',
      'user_branches',
      'sessions',
      'audit_logs',
    ]) {
      expect(tables).toContain(table);
    }
  });
});

describe('client_settings', () => {
  it('holds exactly one row', async () => {
    await pool.query(`insert into client_settings (business_name) values ('Demo Stores')`);
    await expect(
      pool.query(`insert into client_settings (business_name) values ('Second')`),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });
});

describe('branches', () => {
  it('accepts a code of 1–3 capital letters', async () => {
    await insertBranch('TPR');
    await insertBranch('C');
  });

  it.each(['tpr', 'TPRX', 'T1', ''])('rejects the code %j', async (code) => {
    await expect(insertBranch(code)).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('keeps codes unique', async () => {
    await insertBranch('TPR');
    await expect(insertBranch('TPR')).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('starts active with timestamps', async () => {
    const id = await insertBranch('CBE');
    const { rows } = await pool.query(
      'select is_active, created_at, updated_at from branches where id = $1',
      [id],
    );
    expect(rows[0]).toMatchObject({
      is_active: true,
      created_at: expect.any(Date),
      updated_at: expect.any(Date),
    });
  });
});

describe('users', () => {
  it('starts active, without a forced password change', async () => {
    const id = await insertUser('ravi');
    const { rows } = await pool.query(
      'select is_active, must_change_password, last_login_at from users where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ is_active: true, must_change_password: false, last_login_at: null });
  });

  it('treats usernames as unique regardless of case', async () => {
    await insertUser('ravi');
    await expect(insertUser('RAVI')).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('allows only the admin and cashier roles', async () => {
    await insertUser('admin1', 'admin');
    await expect(insertUser('owner1', 'owner')).rejects.toMatchObject({
      code: INVALID_ENUM_VALUE,
    });
  });
});

describe('user_branches', () => {
  it('maps a user to a branch once', async () => {
    const userId = await insertUser('ravi');
    const branchId = await insertBranch('TPR');
    await pool.query('insert into user_branches (user_id, branch_id) values ($1, $2)', [
      userId,
      branchId,
    ]);
    await expect(
      pool.query('insert into user_branches (user_id, branch_id) values ($1, $2)', [
        userId,
        branchId,
      ]),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('refuses to delete a branch that still has users mapped', async () => {
    const userId = await insertUser('ravi');
    const branchId = await insertBranch('TPR');
    await pool.query('insert into user_branches (user_id, branch_id) values ($1, $2)', [
      userId,
      branchId,
    ]);
    await expect(
      pool.query('delete from branches where id = $1', [branchId]),
    ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    const { rows } = await pool.query('select count(*)::int as n from branches where id = $1', [
      branchId,
    ]);
    expect(rows[0]).toEqual({ n: 1 });
  });
});

describe('sessions', () => {
  it('keeps token hashes unique and disappears with its user', async () => {
    const userId = await insertUser('ravi');
    const insert = () =>
      pool.query(
        `insert into sessions (token_hash, user_id, expires_at)
         values ('abc123', $1, now() + interval '12 hours')`,
        [userId],
      );
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: UNIQUE_VIOLATION });

    await pool.query('delete from users where id = $1', [userId]);
    const { rows } = await pool.query('select count(*)::int as n from sessions');
    expect(rows[0]).toEqual({ n: 0 });
  });
});

describe('audit_logs', () => {
  it('records an event without an actor (e.g. a failed login) with JSON before/after', async () => {
    await pool.query(
      `insert into audit_logs (action, entity, entity_id, before, after, ip)
       values ('auth.login_failed', 'user', null, null, $1, '203.0.113.7')`,
      [JSON.stringify({ username: 'ravi' })],
    );
    const { rows } = await pool.query(
      'select actor_id, branch_id, after, created_at from audit_logs',
    );
    expect(rows[0]).toMatchObject({
      actor_id: null,
      branch_id: null,
      after: { username: 'ravi' },
      created_at: expect.any(Date),
    });
  });
});
