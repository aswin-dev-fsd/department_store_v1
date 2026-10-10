// Runs in every test worker before test files are imported (vitest `setupFiles`).
// Points the app's DATABASE_URL at the test database, so env.ts, db.ts and every
// service talk to TEST_DATABASE_URL during tests.
import { loadRootEnv, resolveTestDatabaseUrl } from './helpers/test-env.js';

loadRootEnv();

// Remember the real dev URL once: this file can run again in the same worker after
// DATABASE_URL has already been switched, and the guard must keep comparing against dev.
process.env.DS_ORIGINAL_DATABASE_URL ??= process.env.DATABASE_URL;

process.env.DATABASE_URL = resolveTestDatabaseUrl({
  DATABASE_URL: process.env.DS_ORIGINAL_DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
});
