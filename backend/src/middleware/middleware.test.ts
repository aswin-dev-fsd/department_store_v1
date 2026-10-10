import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestDb, resetDb } from '../../test/helpers/db.js';
import { activeBranchId } from '../lib/branch-scope.js';
import { createSession } from '../modules/auth/auth.service.js';
import { requestContext, requireAuth, SESSION_COOKIE } from './auth.js';
import { errorHandler } from './errorHandler.js';
import { requireBranch, requirePermission } from './permissions.js';
import { validate } from './validate.js';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

/** A small app using the real middleware and error handler. */
function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.get('/whoami', requireAuth(db), (req, res) => {
    const { user, activeBranchId: branch } = requestContext(req);
    res.json({ userId: user.id, role: user.role, activeBranchId: branch });
  });
  app.post('/bills', requireAuth(db), requirePermission('bill:create'), (_req, res) => {
    res.json({ ok: true });
  });
  // Programming error: permission check without requireAuth in front of it
  app.post('/unguarded', requirePermission('bill:create'), (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/branch-data', requireAuth(db), requireBranch, (req, res) => {
    res.json({ branchId: activeBranchId(req) });
  });
  app.post(
    '/items/:id',
    validate({
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
      body: z.object({ quantity: z.number().int().min(1) }),
    }),
    (req, res) => {
      res.json({ params: req.params, query: req.query, body: req.body });
    },
  );
  app.use(errorHandler);
  return app;
}

const app = buildApp();

async function insertUser(role: 'admin' | 'cashier', username = role): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (username, password_hash, full_name, role)
     values ($1, 'x', 'Test', $2) returning id`,
    [username, role],
  );
  return Number(rows[0]!.id);
}

async function insertBranch(code = 'TPR'): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into branches (code, name, address) values ($1, 'Branch', 'Road') returning id`,
    [code],
  );
  return Number(rows[0]!.id);
}

async function mapUser(userId: number, branchId: number): Promise<void> {
  await pool.query('insert into user_branches (user_id, branch_id) values ($1, $2)', [
    userId,
    branchId,
  ]);
}

/** Log a user in directly through the session service; returns the Cookie header value. */
async function cookieFor(userId: number, branchId: number | null = null): Promise<string> {
  const { token } = await createSession(db, { userId, activeBranchId: branchId });
  return `${SESSION_COOKIE}=${token}`;
}

describe('requireAuth', () => {
  it('rejects a request with no session cookie', async () => {
    const res = await request(app).get('/whoami');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unknown session token', async () => {
    const res = await request(app).get('/whoami').set('Cookie', `${SESSION_COOKIE}=forged`);
    expect(res.status).toBe(401);
  });

  it('attaches the user and active branch for a valid session', async () => {
    const userId = await insertUser('cashier');
    const branchId = await insertBranch();
    await mapUser(userId, branchId);
    const res = await request(app)
      .get('/whoami')
      .set('Cookie', await cookieFor(userId, branchId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId, role: 'cashier', activeBranchId: branchId });
  });
});

describe('requirePermission', () => {
  it('allows a role that has the permission', async () => {
    const cashier = await insertUser('cashier');
    const res = await request(app)
      .post('/bills')
      .set('Cookie', await cookieFor(cashier));
    expect(res.status).toBe(200);
  });

  it('refuses a role without it, with 403 FORBIDDEN', async () => {
    const admin = await insertUser('admin');
    const res = await request(app)
      .post('/bills')
      .set('Cookie', await cookieFor(admin));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('treats a missing requireAuth as not logged in (401), never as allowed', async () => {
    const res = await request(app).post('/unguarded');
    expect(res.status).toBe(401);
  });
});

describe('requireBranch / activeBranchId', () => {
  it('passes the active branch to branch-scoped handlers', async () => {
    const cashier = await insertUser('cashier');
    const branchId = await insertBranch();
    await mapUser(cashier, branchId);
    const res = await request(app)
      .get('/branch-data')
      .set('Cookie', await cookieFor(cashier, branchId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ branchId });
  });

  it('refuses a cashier with no active branch: 403 NO_ACTIVE_BRANCH', async () => {
    const cashier = await insertUser('cashier');
    const res = await request(app)
      .get('/branch-data')
      .set('Cookie', await cookieFor(cashier));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_ACTIVE_BRANCH');
  });

  it('refuses at once when the cashier is unmapped from the branch mid-session', async () => {
    const cashier = await insertUser('cashier');
    const branchId = await insertBranch();
    await mapUser(cashier, branchId);
    const cookie = await cookieFor(cashier, branchId);
    expect((await request(app).get('/branch-data').set('Cookie', cookie)).status).toBe(200);

    await pool.query('delete from user_branches where user_id = $1', [cashier]);
    const res = await request(app).get('/branch-data').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_ACTIVE_BRANCH');
  });
});

describe('validate', () => {
  it('rejects bad input with 422 and a reason per field', async () => {
    const res = await request(app).post('/items/abc?limit=500').send({ quantity: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(['body.quantity', 'params.id', 'query.limit']);
  });

  it('hands handlers parsed values: numbers coerced, defaults filled, unknown fields dropped', async () => {
    const res = await request(app).post('/items/42').send({ quantity: 3, unitPricePaise: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ params: { id: 42 }, query: { limit: 20 }, body: { quantity: 3 } });
  });
});
