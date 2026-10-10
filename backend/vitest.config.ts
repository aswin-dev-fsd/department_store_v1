import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Keep test output readable; set before env.ts loads (.env never overrides it)
    env: { LOG_LEVEL: 'silent' },
    // Once, before any worker: guard, wake Neon, apply migrations to the test database
    globalSetup: ['test/global-setup.ts'],
    // In every worker, before test files load: point DATABASE_URL at the test database
    setupFiles: ['test/setup-env.ts'],
    // Database test files share one database, so run files one at a time
    fileParallelism: false,
    // Every query crosses the internet to Neon Singapore
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
