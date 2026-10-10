import { createDb, type Db, type DbHandle } from '@ds/database';
import { env } from './config/env.js';

const handle: DbHandle = createDb(env.DATABASE_URL);

/** The process-wide Drizzle database, created once from DATABASE_URL. */
export const db: Db = handle.db;

/** Its connection pool — server.ts closes it on shutdown. */
export const pool: DbHandle['pool'] = handle.pool;
