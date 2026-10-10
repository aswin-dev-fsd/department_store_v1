// Runs once before any test worker starts (vitest `globalSetup`).
import { createDb, runMigrations } from '@ds/database';
import { setTimeout as delay } from 'node:timers/promises';
import { loadRootEnv, resolveTestDatabaseUrl } from './helpers/test-env.js';

// Neon free-plan databases sleep after 5 idle minutes and take a few seconds to wake
const WAKE_ATTEMPTS = 3;
const WAKE_DELAY_MS = 5_000;

export default async function setup(): Promise<void> {
  loadRootEnv();
  // Fail the whole run here — before any connection — if the test URL is unsafe
  const testUrl = resolveTestDatabaseUrl(process.env);
  await waitForDatabase(testUrl);
  await runMigrations(testUrl);
}

async function waitForDatabase(url: string): Promise<void> {
  const { pool } = createDb(url, { max: 1 });
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await pool.query('select 1');
        return;
      } catch (error) {
        if (attempt >= WAKE_ATTEMPTS) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`Test database unreachable after ${WAKE_ATTEMPTS} attempts: ${reason}`, {
            cause: error,
          });
        }
        await delay(WAKE_DELAY_MS);
      }
    }
  } finally {
    await pool.end();
  }
}
