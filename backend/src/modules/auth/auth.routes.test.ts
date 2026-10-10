import bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { sessionCookieOptions } from '../../middleware/auth.js';
import { hashPassword } from './auth.service.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const PASSWORD = 'Counter#2026';
let passwordHash = '';

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD); // once: bcrypt cost 12 is deliberately slow
});

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

interface UserOptions {
  role?: 'admin' | 'cashier';
  isActive?: boolean;
  mustChangePassword?: boolean;
}

async function insertUser(username: string, options: UserOptions = {}): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (username, password_hash, full_name, role, is_active, must_change_password)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      username,
      passwordHash,
      `Full ${username}`,
      options.role ?? 'cashier',
      options.isActive ?? true,
      options.mustChangePassword ?? false,
    ],
  );
  return Number(rows[0]!.id);
}

async function insertBranch(code: string, isActive = true): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into branches (code, name, address, is_active) values ($1, $2, 'Road', $3) returning id`,
    [code, `Branch ${code}`, isActive],
  );
  return Number(rows[0]!.id);
}

async function mapUser(userId: number, branchId: number): Promise<void> {
  await pool.query('insert into user_branches (user_id, branch_id) values ($1, $2)', [
    userId,
    branchId,
  ]);
}

function sessionCookie(res: request.Response): string | undefined {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  return cookies?.find((c) => c.startsWith('ds_session='));
}

/** A supertest agent keeps cookies between requests, like a browser. */
async function loggedIn(username: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ username, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { agent, res };
}

describe('POST /auth/login', () => {
  it('logs a cashier in to their only branch with a secure session cookie', async () => {
    const userId = await insertUser('ravi');
    const branchId = await insertBranch('TPR');
    await mapUser(userId, branchId);

    const { res } = await loggedIn('ravi');

    const cookie = sessionCookie(res)!;
    expect(cookie).toMatch(/^ds_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Expires=/);
    expect(res.body.data).toEqual({
      user: {
        id: userId,
        username: 'ravi',
        fullName: 'Full ravi',
        role: 'cashier',
        mustChangePassword: false,
      },
      permissions: expect.arrayContaining(['bill:create', 'stock:adjust']),
      branches: [{ id: branchId, code: 'TPR', name: 'Branch TPR' }],
      activeBranchId: branchId,
      needsBranchSelection: false,
    });

    const { rows } = await pool.query('select last_login_at from users where id = $1', [userId]);
    expect(rows[0].last_login_at).toBeInstanceOf(Date);
    await expectAudit(db, { action: 'auth.login', entityId: userId, actorId: userId });
  });

  it('accepts the username in any letter case', async () => {
    await insertUser('ravi');
    const { res } = await loggedIn('RAVI');
    expect(res.body.data.user.username).toBe('ravi');
  });

  it('asks a cashier with several branches to pick one, and lists only active branches', async () => {
    const userId = await insertUser('ravi');
    await mapUser(userId, await insertBranch('TPR'));
    await mapUser(userId, await insertBranch('CBE'));
    await mapUser(userId, await insertBranch('OLD', false));

    const { res } = await loggedIn('ravi');
    expect(res.body.data.activeBranchId).toBeNull();
    expect(res.body.data.needsBranchSelection).toBe(true);
    expect(res.body.data.branches.map((b: { code: string }) => b.code)).toEqual(['CBE', 'TPR']);
  });

  it('gives an admin no branch and no branch prompt', async () => {
    await insertUser('boss', { role: 'admin' });
    const { res } = await loggedIn('boss');
    expect(res.body.data).toMatchObject({
      activeBranchId: null,
      needsBranchSelection: false,
      branches: [],
    });
    expect(res.body.data.permissions).toContain('admin:users');
  });

  it.each([
    ['a wrong password', 'ravi', 'not-the-password', 'wrong_password'],
    ['an unknown user', 'nobody', PASSWORD, 'unknown_user'],
    ['a deactivated user', 'gone', PASSWORD, 'inactive'],
  ])(
    'answers %s with the same 401 and audits it (with the reason) without the password',
    async (_case, username, password, reason) => {
      await insertUser('ravi');
      await insertUser('gone', { isActive: false });

      const res = await request(app).post('/api/v1/auth/login').send({ username, password });
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
      expect(sessionCookie(res)).toBeUndefined();

      const row = await expectAudit(db, { action: 'auth.login_failed', actorId: null });
      expect(row.after).toEqual({ username, reason });
      expect(JSON.stringify(row)).not.toContain(password);
    },
  );

  it('rejects missing fields and over-long passwords with 422', async () => {
    const missing = await request(app).post('/api/v1/auth/login').send({ username: 'ravi' });
    expect(missing.status).toBe(422);
    const tooLong = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'ravi', password: 'a'.repeat(73) });
    expect(tooLong.status).toBe(422);
  });
});

describe('GET /auth/me', () => {
  it('returns the session’s user, and 401 without a session', async () => {
    await insertUser('ravi');
    const { agent } = await loggedIn('ravi');
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.username).toBe('ravi');

    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('asks the cashier to pick a branch again once the Admin unmaps them from the active one', async () => {
    const userId = await insertUser('ravi');
    await mapUser(userId, await insertBranch('TPR'));
    const { agent } = await loggedIn('ravi');
    expect((await agent.get('/api/v1/auth/me')).body.data.needsBranchSelection).toBe(false);

    await pool.query('delete from user_branches where user_id = $1', [userId]);
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({
      activeBranchId: null,
      needsBranchSelection: true,
      branches: [],
    });
  });
});

describe('POST /auth/select-branch', () => {
  it('switches a cashier to a mapped branch and audits it', async () => {
    const userId = await insertUser('ravi');
    const tpr = await insertBranch('TPR');
    const cbe = await insertBranch('CBE');
    await mapUser(userId, tpr);
    await mapUser(userId, cbe);
    const { agent } = await loggedIn('ravi');

    const res = await agent.post('/api/v1/auth/select-branch').send({ branchId: cbe });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ activeBranchId: cbe, needsBranchSelection: false });
    expect((await agent.get('/api/v1/auth/me')).body.data.activeBranchId).toBe(cbe);
    await expectAudit(db, { action: 'auth.select_branch', actorId: userId });
  });

  it('refuses a branch the cashier is not mapped to: 403 BRANCH_NOT_ASSIGNED', async () => {
    const userId = await insertUser('ravi');
    await mapUser(userId, await insertBranch('TPR'));
    const other = await insertBranch('CBE');
    const { agent } = await loggedIn('ravi');

    const res = await agent.post('/api/v1/auth/select-branch').send({ branchId: other });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BRANCH_NOT_ASSIGNED');
  });

  it('refuses a mapped branch that has been deactivated', async () => {
    const userId = await insertUser('ravi');
    await mapUser(userId, await insertBranch('TPR'));
    const closed = await insertBranch('OLD');
    await mapUser(userId, closed);
    const { agent } = await loggedIn('ravi');
    await pool.query('update branches set is_active = false where id = $1', [closed]);

    const res = await agent.post('/api/v1/auth/select-branch').send({ branchId: closed });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BRANCH_NOT_ASSIGNED');
  });

  it('is for cashiers only: an admin gets 403', async () => {
    await insertUser('boss', { role: 'admin' });
    const branchId = await insertBranch('TPR');
    const { agent } = await loggedIn('boss');

    const res = await agent.post('/api/v1/auth/select-branch').send({ branchId });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a branch id that is not a whole number with 422', async () => {
    await insertUser('ravi');
    const { agent } = await loggedIn('ravi');
    const res = await agent.post('/api/v1/auth/select-branch').send({ branchId: '1; drop table' });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('body.branchId');
  });
});

describe('POST /auth/change-password', () => {
  it('answers a wrong current password with 400 — not 401, which would log the user out', async () => {
    await insertUser('ravi');
    const { agent } = await loggedIn('ravi');
    const res = await agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'wrong', newPassword: 'Brand-new-1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WRONG_CURRENT_PASSWORD');
    await expectAudit(db, { action: 'auth.password_change_failed' });
  });

  it('refuses reusing the current password', async () => {
    await insertUser('ravi');
    const { agent } = await loggedIn('ravi');
    const res = await agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PASSWORD_UNCHANGED');
  });

  it('changes it, clears the forced change, ends other sessions and keeps this one', async () => {
    const userId = await insertUser('ravi', { mustChangePassword: true });
    const { agent: here } = await loggedIn('ravi');
    const { agent: elsewhere } = await loggedIn('ravi');

    const res = await here
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'Brand-new-1' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(false);

    expect((await here.get('/api/v1/auth/me')).status).toBe(200);
    expect((await elsewhere.get('/api/v1/auth/me')).status).toBe(401);

    expect(
      (await request(app).post('/api/v1/auth/login').send({ username: 'ravi', password: PASSWORD }))
        .status,
    ).toBe(401);
    await loggedIn('ravi', 'Brand-new-1');

    const row = await expectAudit(db, { action: 'auth.password_change', actorId: userId });
    // The row must show what changed — the forced change went from required to done
    expect(row.before).toEqual({ mustChangePassword: true });
    expect(row.after).toEqual({ mustChangePassword: false });
    expect(JSON.stringify(row)).not.toMatch(/Brand-new-1|Counter#2026/);
  });
});

describe('forced password change', () => {
  it('blocks everything except me / change-password / logout until the password is changed', async () => {
    const userId = await insertUser('ravi', { mustChangePassword: true });
    await mapUser(userId, await insertBranch('TPR'));
    const { agent, res } = await loggedIn('ravi');
    expect(res.body.data.user.mustChangePassword).toBe(true);

    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    const blocked = await agent.post('/api/v1/auth/select-branch').send({ branchId: 1 });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

describe('POST /auth/logout', () => {
  it('ends the session, clears the cookie and audits it', async () => {
    const userId = await insertUser('ravi');
    const { agent, res: loginRes } = await loggedIn('ravi');
    const oldCookie = sessionCookie(loginRes)!.split(';')[0]!;

    const res = await agent.post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).toMatch(/^ds_session=;.*Expires=Thu, 01 Jan 1970/);

    // The old token is dead even if someone kept a copy of it
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', oldCookie)).status).toBe(401);
    await expectAudit(db, { action: 'auth.logout', actorId: userId });
  });
});

describe('login timing protection', () => {
  it('checks an unknown username against a real cost-12 bcrypt hash, so response time reveals nothing', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    try {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'nobody', password: 'whatever' });
      expect(res.status).toBe(401);
      expect(compare).toHaveBeenCalledTimes(1);
      const hash = String(compare.mock.calls[0]?.[1]);
      expect(hash).toMatch(/^\$2b\$12\$[./A-Za-z0-9]{53}$/);
      expect(bcrypt.getRounds(hash)).toBe(12);
    } finally {
      compare.mockRestore();
    }
  });
});

describe('cross-site request protection', () => {
  it.each([
    ['text/plain', JSON.stringify({ username: 'ravi', password: PASSWORD })],
    ['application/x-www-form-urlencoded', `username=ravi&password=${encodeURIComponent(PASSWORD)}`],
  ])(
    'does not accept a %s body as a login: only JSON is read, and a foreign site cannot send JSON without a CORS preflight',
    async (contentType, body) => {
      await insertUser('ravi');
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', contentType)
        .send(body);
      expect(res.status).toBe(422);
      expect(sessionCookie(res)).toBeUndefined();
    },
  );

  it('approves the CORS preflight for our own origin and refuses a foreign one', async () => {
    const preflight = (origin: string) =>
      request(app)
        .options('/api/v1/auth/login')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type');

    const ours = await preflight(env.CORS_ORIGIN[0]!);
    expect(ours.headers['access-control-allow-origin']).toBe(env.CORS_ORIGIN[0]);
    expect(ours.headers['access-control-allow-credentials']).toBe('true');

    const foreign = await preflight('https://evil.example.com');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('sessionCookieOptions', () => {
  it('is httpOnly, SameSite=lax, site-wide, and Secure when COOKIE_SECURE is on', () => {
    const expires = new Date('2026-10-10T12:00:00Z');
    expect(sessionCookieOptions(expires, true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires,
    });
  });
});
