import { createDb } from '@ds/database';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';

// Task 1.7 points this at TEST_DATABASE_URL through the test harness
const live = createDb(env.DATABASE_URL, { max: 2 });
// Nothing listens on port 1, so every query fails fast
const unreachable = createDb('postgresql://nobody:nothing@127.0.0.1:1/none', { max: 1 });

afterAll(async () => {
  await Promise.all([live.pool.end(), unreachable.pool.end()]);
});

describe('GET /api/v1/health', () => {
  it('reports ok with a reachable database', async () => {
    const res = await request(createApp({ db: live.db })).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { status: 'ok', database: 'ok', uptimeSeconds: expect.any(Number) },
      meta: { timestamp: expect.any(String), version: expect.any(String) },
    });
  }, 20_000);

  it('still answers 200, with database "down", when the database is unreachable', async () => {
    const res = await request(createApp({ db: unreachable.db })).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'down' });
  }, 20_000);
});

describe('app-wide behaviour', () => {
  const app = createApp({ db: unreachable.db });

  it('answers unknown routes with a 404 envelope', async () => {
    const res = await request(app).get('/api/v1/no-such-thing');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('answers malformed JSON with 400, not 500', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('rejects bodies over 1 MB with 413', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('sends security headers and hides the framework', async () => {
    const res = await request(app).get('/api/v1/no-such-thing');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows the configured origin with credentials, and no other', async () => {
    const allowed = await request(app)
      .get('/api/v1/no-such-thing')
      .set('Origin', env.CORS_ORIGIN[0]!);
    expect(allowed.headers['access-control-allow-origin']).toBe(env.CORS_ORIGIN[0]);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const other = await request(app)
      .get('/api/v1/no-such-thing')
      .set('Origin', 'https://evil.example.com');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});
