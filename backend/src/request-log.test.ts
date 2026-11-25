import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../test/helpers/db.js';
import { createBranch, createUser, mapUser } from '../test/helpers/fixtures.js';
import { createApp } from './app.js';
import { createLogger } from './lib/logger.js';
import { hashPassword } from './modules/auth/auth.service.js';

const { db, pool } = createTestDb();
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

/** An app whose request log lines land in `lines` (the app logger is silent in tests). */
function appWithLogCapture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    },
  });
  const app = createApp({ db }, { logger: createLogger('info', stream) });
  return { app, lines };
}

/** The log line of the request to `url` (path only, as logged). */
function lineFor(lines: Record<string, unknown>[], method: string, url: string) {
  const line = lines.find((l) => {
    const req = l.req as { method?: string; url?: string } | undefined;
    return req?.method === method && req.url === url;
  });
  expect(line, `${method} ${url} in ${JSON.stringify(lines)}`).toBeDefined();
  return line!;
}

async function cashierWithPassword() {
  const userId = await createUser(pool, { username: 'ravi' });
  await pool.query('update users set password_hash = $1 where id = $2', [passwordHash, userId]);
  const branchId = await createBranch(pool);
  await mapUser(pool, userId, branchId);
  return { userId, branchId };
}

describe('request log', () => {
  it('writes one compact line per request: id, method, path, status, response time, user and branch', async () => {
    const { app, lines } = appWithLogCapture();
    const { userId, branchId } = await cashierWithPassword();
    const agent = request.agent(app);
    expect(
      (await agent.post('/api/v1/auth/login').send({ username: 'ravi', password: PASSWORD }))
        .status,
    ).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);

    const me = lineFor(lines, 'GET', '/api/v1/auth/me');
    expect(Object.keys(me.req as object).sort()).toEqual(['id', 'method', 'url']);
    expect(me.res).toEqual({ statusCode: 200 });
    expect(me.responseTime).toEqual(expect.any(Number));
    expect(me.userId).toBe(userId);
    expect(me.branchId).toBe(branchId);
    expect(me.msg).toBe('request completed');

    // Before a session exists there is nobody to name
    const login = lineFor(lines, 'POST', '/api/v1/auth/login');
    expect(login.userId).toBeUndefined();
    expect(login.res).toEqual({ statusCode: 200 });
  });

  it('never logs the password, the session token, cookies, headers or a request body', async () => {
    const { app, lines } = appWithLogCapture();
    await cashierWithPassword();
    const agent = request.agent(app);
    const ok = await agent.post('/api/v1/auth/login').send({ username: 'ravi', password: PASSWORD });
    expect(ok.status).toBe(200);
    const cookie = (ok.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('ds_session='),
    )!;
    const token = cookie.slice('ds_session='.length, cookie.indexOf(';'));
    await agent.get('/api/v1/auth/me');
    await agent.post('/api/v1/auth/logout');
    const failed = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'ravi', password: 'Wrong#password-77' });
    expect(failed.status).toBe(401);

    expect(lines.length).toBeGreaterThanOrEqual(4);
    const text = JSON.stringify(lines);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('Wrong#password-77');
    expect(text).not.toContain(token);
    expect(text).not.toContain('ds_session');
    expect(text).not.toContain('"headers"');
    expect(text).not.toContain('"body"');
    expect(text).not.toContain('password');
  });

  it('leaves the query string out of the path (a customer lookup carries a phone number)', async () => {
    const { app, lines } = appWithLogCapture();
    await cashierWithPassword();
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ username: 'ravi', password: PASSWORD });
    expect((await agent.get('/api/v1/customers/lookup?phone=9876543210')).status).toBe(404);

    lineFor(lines, 'GET', '/api/v1/customers/lookup');
    expect(JSON.stringify(lines)).not.toContain('9876543210');
  });

  it('keeps health checks out of the log', async () => {
    const { app, lines } = appWithLogCapture();
    await request(app).get('/api/v1/health/live');
    expect(lines.filter((l) => String((l.req as { url?: string })?.url).includes('health'))).toEqual(
      [],
    );
  });
});
