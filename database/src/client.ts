import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

// sslmodes that pg 8 already treats as verify-full, but pg 9 will weaken to libpq semantics
const WEAK_SSL_MODES = new Set(['prefer', 'require', 'verify-ca']);

/**
 * Turn a provider connection string into pg connection settings:
 * pins TLS to `verify-full` (full certificate + host check) and honours
 * `channel_binding=require`, which pg ignores when it appears in the URL.
 */
export function connectionConfig(url: string): {
  connectionString: string;
  enableChannelBinding: boolean;
} {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode && WEAK_SSL_MODES.has(sslmode)) {
    parsed.searchParams.set('sslmode', 'verify-full');
  }
  return {
    connectionString: sslmode ? parsed.toString() : url,
    enableChannelBinding: parsed.searchParams.get('channel_binding') === 'require',
  };
}

export interface CreateDbOptions {
  /** Maximum connections in the pool (default 10). */
  max?: number;
}

/**
 * Create a pooled PostgreSQL connection wrapped in Drizzle. The caller passes the URL
 * (this package never reads env vars for the app) and must call `pool.end()` when done.
 */
export function createDb(url: string, options: CreateDbOptions = {}) {
  const pool = new pg.Pool({
    ...connectionConfig(url),
    max: options.max ?? 10,
    // Neon free-plan databases sleep when idle and take a few seconds to wake
    connectionTimeoutMillis: 15_000,
  });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>['db'];

/** Describe a connection for output: host and database name only — never the password. */
export function describeConnection(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}/${parsed.pathname.slice(1)}`;
}
