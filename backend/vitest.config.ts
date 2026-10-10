import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Keep test output readable; set before env.ts loads (.env never overrides it)
    env: { LOG_LEVEL: 'silent' },
  },
});
