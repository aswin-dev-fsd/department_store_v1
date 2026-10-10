import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { createTestDb, resetDb } from './helpers/db.js';
import { databaseIdentity } from './helpers/test-env.js';

const { db, pool } = createTestDb();

afterAll(async () => {
  await db.execute(sql`drop table if exists harness_probe`);
  await pool.end();
});

describe('test database harness', () => {
  it('points the app at TEST_DATABASE_URL, never the dev database', () => {
    expect(env.TEST_DATABASE_URL).toBeDefined();
    expect(databaseIdentity(env.DATABASE_URL)).toBe(databaseIdentity(env.TEST_DATABASE_URL!));
    const originalDev = process.env.DS_ORIGINAL_DATABASE_URL;
    expect(originalDev).toBeDefined();
    expect(databaseIdentity(env.DATABASE_URL)).not.toBe(databaseIdentity(originalDev!));
  });

  it('resetDb empties every table and restarts ids', async () => {
    await db.execute(
      sql`create table if not exists harness_probe (id serial primary key, note text)`,
    );
    await db.execute(sql`insert into harness_probe (note) values ('a'), ('b')`);

    await resetDb(db);

    const { rows: counted } = await pool.query<{ n: string }>(
      'select count(*) as n from harness_probe',
    );
    expect(counted[0]?.n).toBe('0');
    const { rows: inserted } = await pool.query<{ id: number }>(
      "insert into harness_probe (note) values ('c') returning id",
    );
    expect(inserted[0]?.id).toBe(1);
  });
});
