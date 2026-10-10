import { createDb, type Db, type DbHandle } from '@ds/database';
import { sql } from 'drizzle-orm';
import { env } from '../../src/config/env.js';
import { databaseIdentity } from './test-env.js';

// Concurrency tests need several connections at once; Neon's smallest compute allows ~100
const TEST_POOL_SIZE = 20;

/** Throw unless the app is pointed at TEST_DATABASE_URL (i.e. test/setup-env.ts has run). */
function assertTestDatabase(): void {
  if (
    !env.TEST_DATABASE_URL ||
    databaseIdentity(env.DATABASE_URL) !== databaseIdentity(env.TEST_DATABASE_URL)
  ) {
    throw new Error('Test database helpers must only run inside the test harness');
  }
}

/** A connection pool to the test database. Call `pool.end()` in afterAll. */
export function createTestDb(): DbHandle {
  assertTestDatabase();
  return createDb(env.DATABASE_URL, { max: TEST_POOL_SIZE });
}

/**
 * Empty every table in the public schema and restart their id sequences. Drizzle's
 * migration journal lives in the separate "drizzle" schema, so it is kept.
 */
export async function resetDb(db: Db): Promise<void> {
  assertTestDatabase();
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`);
  await db.execute(sql.raw(`truncate table ${tables.join(', ')} restart identity cascade`));
}
