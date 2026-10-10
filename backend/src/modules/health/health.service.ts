import type { Db } from '@ds/database';
import type { HealthStatus } from '@ds/shared';
import { sql } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';

// Answer health checks promptly even when the database hangs
const PING_TIMEOUT_MS = 5_000;

/** Report that the API is up, and whether the database answers in time. */
export async function checkHealth(db: Db): Promise<HealthStatus> {
  return {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    database: (await pingDatabase(db)) ? 'ok' : 'down',
  };
}

async function pingDatabase(db: Db): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
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
