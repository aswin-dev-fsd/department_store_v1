import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  cookieFor,
  createBranch,
  createClientSettings,
  createUser,
  mapUser,
} from '../../../test/helpers/fixtures.js';
import { createApp } from '../../app.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const URL = '/api/v1/admin/settings';

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

async function adminCookie(): Promise<{ adminId: number; cookie: string }> {
  const adminId = await createUser(pool, { role: 'admin', username: 'boss' });
  return { adminId, cookie: await cookieFor(db, adminId) };
}

async function auditCount(): Promise<number> {
  const { rows } = await pool.query(`select count(*)::int as n from audit_logs`);
  return rows[0].n;
}

describe('access control', () => {
  it.each([['get'], ['put']] as const)('%s answers 401 without a session', async (method) => {
    expect((await request(app)[method](URL)).status).toBe(401);
  });

  it.each([['get'], ['put']] as const)('%s answers 403 FORBIDDEN to a cashier', async (method) => {
    const cashierId = await createUser(pool, { role: 'cashier' });
    const branchId = await createBranch(pool);
    await mapUser(pool, cashierId, branchId);
    const cookie = await cookieFor(db, cashierId, branchId);

    const res = await request(app)[method](URL).set('Cookie', cookie).send({ businessName: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('GET /admin/settings', () => {
  it('returns the client settings (without the GSTIN, which stays unused until PD-01)', async () => {
    await createClientSettings(pool, {
      businessName: 'Demo Stores',
      address: '1 Bazaar Street',
      phone: '0422-1',
      gstin: '33AAAAA0000A1Z5',
    });
    const { cookie } = await adminCookie();

    const res = await request(app).get(URL).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      businessName: 'Demo Stores',
      address: '1 Bazaar Street',
      phone: '0422-1',
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain('33AAAAA0000A1Z5');
  });

  it('answers 404 NOT_SET_UP if setup:client has never run on this database', async () => {
    const { cookie } = await adminCookie();
    const res = await request(app).get(URL).set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_SET_UP');
    expect(res.body.error.message).toMatch(/setup:client/);
  });
});

describe('PUT /admin/settings', () => {
  it('updates the settings and audits only what changed', async () => {
    await createClientSettings(pool, { businessName: 'Demo Stores', address: 'Old Street' });
    const { adminId, cookie } = await adminCookie();

    const res = await request(app)
      .put(URL)
      .set('Cookie', cookie)
      .send({ businessName: 'கோவை ஸ்டோர்ஸ்', address: 'Old Street', phone: '0422-9' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      businessName: 'கோவை ஸ்டோர்ஸ்',
      address: 'Old Street',
      phone: '0422-9',
    });

    const audit = await expectAudit(db, {
      action: 'client_settings.update',
      entity: 'client_settings',
      entityId: 1,
      actorId: adminId,
    });
    expect(audit.before).toEqual({ businessName: 'Demo Stores', phone: null });
    expect(audit.after).toEqual({ businessName: 'கோவை ஸ்டோர்ஸ்', phone: '0422-9' });

    // A fresh read shows the same
    const again = await request(app).get(URL).set('Cookie', cookie);
    expect(again.body.data.businessName).toBe('கோவை ஸ்டோர்ஸ்');
  });

  it('replaces the whole record: an omitted address or phone is cleared', async () => {
    await createClientSettings(pool, { address: '1 Bazaar Street', phone: '0422-1' });
    const { cookie } = await adminCookie();

    const res = await request(app)
      .put(URL)
      .set('Cookie', cookie)
      .send({ businessName: 'Demo Stores' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ address: null, phone: null });
  });

  it('does nothing — and writes no audit row — when no value changes', async () => {
    await createClientSettings(pool, { businessName: 'Demo Stores', address: 'A', phone: 'P' });
    const { cookie } = await adminCookie();
    const before = await auditCount();

    const res = await request(app)
      .put(URL)
      .set('Cookie', cookie)
      .send({ businessName: ' Demo Stores ', address: 'A', phone: 'P' });
    expect(res.status).toBe(200);
    expect(await auditCount()).toBe(before);
  });

  it('refuses a missing or blank business name with 422', async () => {
    await createClientSettings(pool);
    const { cookie } = await adminCookie();
    for (const body of [{}, { businessName: '   ' }, { businessName: 'a'.repeat(121) }]) {
      const res = await request(app).put(URL).set('Cookie', cookie).send(body);
      expect(res.status).toBe(422);
      expect(res.body.error.details[0].path).toBe('body.businessName');
    }
  });

  it('ignores a GSTIN in the request: it stays out of the API until GST is decided', async () => {
    await createClientSettings(pool, { gstin: '33AAAAA0000A1Z5' });
    const { cookie } = await adminCookie();

    const res = await request(app)
      .put(URL)
      .set('Cookie', cookie)
      .send({ businessName: 'Demo Stores', gstin: '29BBBBB1111B2Z6' });
    expect(res.status).toBe(200);
    const { rows } = await pool.query('select gstin from client_settings');
    expect(rows[0]).toEqual({ gstin: '33AAAAA0000A1Z5' });
  });

  it('answers 404 NOT_SET_UP when there is no settings row to update', async () => {
    const { cookie } = await adminCookie();
    const res = await request(app).put(URL).set('Cookie', cookie).send({ businessName: 'Demo' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_SET_UP');
  });
});
