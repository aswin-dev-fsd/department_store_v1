import type { Db } from '@ds/database';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';

describe('GET /api/v1/health/live', () => {
  it('answers instantly without touching the database', async () => {
    const execute = vi.fn(() => new Promise(() => {})); // would hang forever if called
    const app = createApp({ db: { execute } as unknown as Db });

    const started = Date.now();
    const res = await request(app).get('/api/v1/health/live');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { status: 'ok', uptimeSeconds: expect.any(Number) },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('trust proxy setting', () => {
  const db = {} as Db;

  it('trusts no proxies by default', () => {
    expect(createApp({ db }).get('trust proxy')).toBe(0);
  });

  it('applies the configured number of proxy hops (Vercel + Render = 2)', () => {
    expect(createApp({ db }, { trustProxy: 2 }).get('trust proxy')).toBe(2);
  });
});
