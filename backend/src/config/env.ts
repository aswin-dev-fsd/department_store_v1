import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { parseEnv } from './env.schema.js';

// Local development reads the repo-root .env; deployed servers set variables in their dashboard.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

/** Validated settings — the only place the backend reads `process.env` (DreamLand §11). */
export const env = parseEnv(process.env);

export type { Env } from './env.schema.js';
