import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

const CONNECTION_VARS = ['DATABASE_URL', 'TEST_DATABASE_URL'] as const;
type ConnectionVar = (typeof CONNECTION_VARS)[number];

/** Load the repo-root `.env` (two levels up from `src/` or `dist/`); existing env vars win. */
export function loadRootEnv(): void {
  config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
}

/** Read a connection string by variable name — only `DATABASE_URL` or `TEST_DATABASE_URL`. */
export function urlFromEnv(
  varName: string = 'DATABASE_URL',
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!(CONNECTION_VARS as readonly string[]).includes(varName)) {
    throw new Error(
      `Unknown connection variable "${varName}" — use ${CONNECTION_VARS.join(' or ')}`,
    );
  }
  const url = env[varName as ConnectionVar];
  if (!url) {
    throw new Error(`${varName} is not set — add it to the .env file at the repo root`);
  }
  return url;
}

/** Print one line to stdout (CLI output, not logging). */
export function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Print an error line to stderr and exit with code 1. */
export function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}
