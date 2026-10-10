import type { Db } from '@ds/database';
import type { HealthStatus, LivenessStatus } from '@ds/shared';
import { sql } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';

// Answer health checks promptly even when the database hangs (or a Neon free-plan
// database is still waking up)
const PING_TIMEOUT_MS = 5_000;

export interface CheckHealthOptions {
  /** How long to wait for the database before reporting it down. */
  timeoutMs?: number;
}

/** Report only that the API process is up — no database call, so Neon can sleep. */
export function checkLiveness(): LivenessStatus {
  return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
}

/** Report that the API is up, and whether the database answers in time. */
export async function checkHealth(
  db: Db,
  { timeoutMs = PING_TIMEOUT_MS }: CheckHealthOptions = {},
): Promise<HealthStatus> {
  return {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    database: (await pingDatabase(db, timeoutMs)) ? 'ok' : 'down',
  };
}

async function pingDatabase(db: Db, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      logger.warn({ timeoutMs }, 'Database ping timed out');
      resolve(false);
    }, timeoutMs);
  });
  const ping = db.execute(sql`select 1`).then(
    () => true,
    (err: unknown) => {
      logger.warn({ err }, 'Database ping failed');
      return false;
    },
  );
  try {
    return await Promise.race([ping, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
