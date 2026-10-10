import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

/** Load the repo-root .env without overriding variables already set (backend/test → root). */
export function loadRootEnv(): void {
  config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
}

/** Identify a database by host, port and name — ignoring credentials and options. */
export function databaseIdentity(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || '5432'}/${parsed.pathname.slice(1)}`;
}

/**
 * The guard: return TEST_DATABASE_URL, or throw if it is missing or names the same database
 * as the dev DATABASE_URL. Tests wipe their database, so this must never be the dev one.
 */
export function resolveTestDatabaseUrl(source: Record<string, string | undefined>): string {
  const testUrl = source.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set — tests need their own database (see .env.example)',
    );
  }
  const devUrl = source.DATABASE_URL;
  if (devUrl && databaseIdentity(devUrl) === databaseIdentity(testUrl)) {
    throw new Error(
      'Refusing to run tests: TEST_DATABASE_URL points at the same database as DATABASE_URL. ' +
        'Tests wipe their database — give them a separate one.',
    );
  }
  return testUrl;
}
