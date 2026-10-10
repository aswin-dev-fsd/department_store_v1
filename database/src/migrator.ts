import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { createDb } from './client.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Apply pending migrations to the database at `url` and return how many were new
 * (0 = already up to date). Returns null, touching nothing, while none have been generated.
 */
export async function runMigrations(url: string): Promise<number | null> {
  if (!existsSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'))) {
    return null;
  }
  const { db, pool } = createDb(url, { max: 1 });
  try {
    const before = await countApplied(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return (await countApplied(pool)) - before;
  } finally {
    await pool.end();
  }
}

/** Rows in Drizzle's journal table, which doesn't exist before the first migration. */
async function countApplied(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  );
  if (!rows[0]?.exists) return 0;
  const counted = await pool.query<{ n: number }>(
    'select count(*)::int as n from drizzle.__drizzle_migrations',
  );
  return counted.rows[0]?.n ?? 0;
}
