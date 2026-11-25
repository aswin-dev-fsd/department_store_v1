import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetDb } from '../../test/helpers/db.js';
import { createUser } from '../../test/helpers/fixtures.js';
import { createApp } from '../app.js';
import { hashPassword } from '../modules/auth/auth.service.js';
import { LOGIN_LIMITS } from './rateLimit.js';

const { db, pool } = createTestDb();
const PASSWORD = 'Counter#2026';
const WRONG = 'not-the-password';
let passwordHash = '';
let app: Express;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD); // once: bcrypt cost 12 is deliberately slow
});

beforeEach(async () => {
  await resetDb(db);
  // A new app per test: the counts live in memory, per app
  app = createApp({ db }, { trustProxy: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await pool.end();
});

/** A user who can really log in (the fixture's dummy hash can't). */
async function userWithPassword(username: string): Promise<number> {
  const id = await createUser(pool, { username });
  await pool.query('update users set password_hash = $1 where id = $2', [passwordHash, id]);
  return id;
}

function login(username: string, password: string, ip = '203.0.113.10') {
  return request(app)
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ username, password });
}

/** `count` failed logins at once (bcrypt runs on the thread pool, so in parallel is faster). */
async function failLogins(count: number, username: string, ip?: (i: number) => string) {
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) => login(username, WRONG, ip?.(i))),
  );
  expect(results.map((r) => r.status)).toEqual(Array.from({ length: count }, () => 401));
}

async function failedLoginRows(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*) as n from audit_logs where action = 'auth.login_failed'`,
  );
  return Number(rows[0]!.n);
}

describe('LOGIN_LIMITS', () => {
  it('holds the proposed values: 10 per IP + username in 15 minutes, 30 per username in an hour', () => {
    expect(LOGIN_LIMITS).toEqual({
      perIpAndUsername: { limit: 10, windowMs: 15 * 60_000 },
      perUsername: { limit: 30, windowMs: 60 * 60_000 },
    });
    expect(Object.isFrozen(LOGIN_LIMITS)).toBe(true);
    expect(Object.isFrozen(LOGIN_LIMITS.perIpAndUsername)).toBe(true);
  });
});

describe('login rate limit: per IP + username', () => {
  it('refuses the 11th attempt after 10 failures with 429 TOO_MANY_ATTEMPTS, even with the right password', async () => {
    await userWithPassword('ravi');
    await failLogins(10, 'ravi');

    const res = await login('ravi', PASSWORD);
    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toEqual({
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many failed logins. Try again in 15 minutes.',
      details: { retryAfterSeconds: expect.any(Number) },
    });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(14 * 60);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(res.body.error.details.retryAfterSeconds).toBe(retryAfter);
    expect(res.headers['set-cookie']).toBeUndefined();
    // No count of remaining tries is published
    expect(res.headers['ratelimit']).toBeUndefined();
    expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
  });

  it('never lets a refused attempt reach the password check (no new login_failed audit row)', async () => {
    await userWithPassword('ravi');
    await failLogins(10, 'ravi');
    expect(await failedLoginRows()).toBe(10);

    expect((await login('ravi', WRONG)).status).toBe(429);
    expect((await login('ravi', PASSWORD)).status).toBe(429);
    expect(await failedLoginRows()).toBe(10);
  });

  it('does not count a successful login', async () => {
    await userWithPassword('ravi');
    await failLogins(9, 'ravi');
    expect((await login('ravi', PASSWORD)).status).toBe(200);

    // The 10th failure is still a plain 401: the success above did not use up an attempt
    expect((await login('ravi', WRONG)).status).toBe(401);
    expect((await login('ravi', WRONG)).status).toBe(429);
  });

  it('does not affect other users from the same IP, or the same user from another IP', async () => {
    await userWithPassword('ravi');
    await userWithPassword('meena');
    await failLogins(10, 'ravi', () => '203.0.113.10');
    expect((await login('ravi', PASSWORD, '203.0.113.10')).status).toBe(429);

    expect((await login('meena', PASSWORD, '203.0.113.10')).status).toBe(200);
    expect((await login('meena', WRONG, '203.0.113.10')).status).toBe(401);
    expect((await login('ravi', PASSWORD, '198.51.100.7')).status).toBe(200);
  });

  it('matches the username as login does: trimmed and in any letter case', async () => {
    await userWithPassword('ravi');
    await failLogins(5, 'ravi');
    await failLogins(5, '  RAVI ');
    expect((await login('Ravi', PASSWORD)).status).toBe(429);
  });

  it('counts unknown usernames too, so guessing which accounts exist is limited as well', async () => {
    await failLogins(10, 'nobody');
    expect((await login('nobody', WRONG)).status).toBe(429);
  });

  it('counts only refused logins (401): invalid requests (422) use up no attempts', async () => {
    await userWithPassword('ravi');
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ username: 'ravi' });
      expect(res.status).toBe(422);
    }
    const noUsername = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ password: WRONG });
    expect(noUsername.status).toBe(422);

    expect((await login('ravi', PASSWORD)).status).toBe(200);
  });

  it('lets the user try again once the 15-minute window has passed', async () => {
    await userWithPassword('ravi');
    await failLogins(10, 'ravi');
    expect((await login('ravi', PASSWORD)).status).toBe(429);

    // Move only the clock (timers stay real, so the requests still run)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 15 * 60_000 + 1_000 });
    expect((await login('ravi', PASSWORD)).status).toBe(200);
  });

  it('groups an IPv6 address by its /56, so rotating addresses inside one network does not help', async () => {
    await userWithPassword('ravi');
    await failLogins(10, 'ravi', (i) => `2001:db8:0:1::${i + 1}`);
    expect((await login('ravi', PASSWORD, '2001:db8:0:1::ff')).status).toBe(429);
  });
});

describe('login rate limit: per username, from any IP', () => {
  it('refuses the account after 30 failures spread over many IPs, while other accounts still log in', async () => {
    await userWithPassword('ravi');
    await userWithPassword('meena');
    // 3 failures each from 10 IPs: no single IP reaches its limit of 10
    await failLogins(30, 'ravi', (i) => `198.51.100.${(i % 10) + 1}`);

    const res = await login('ravi', PASSWORD, '192.0.2.99');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(res.body.error.message).toBe('Too many failed logins. Try again in 60 minutes.');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(59 * 60);

    expect((await login('meena', PASSWORD, '192.0.2.99')).status).toBe(200);
  });

  it('lets the account in again once the hour has passed', async () => {
    await userWithPassword('ravi');
    await failLogins(30, 'ravi', (i) => `198.51.100.${(i % 10) + 1}`);
    expect((await login('ravi', PASSWORD, '192.0.2.99')).status).toBe(429);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 60 * 60_000 + 1_000 });
    expect((await login('ravi', PASSWORD, '192.0.2.99')).status).toBe(200);
  });
});
