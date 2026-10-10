import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Pure logic only (labels, API client) — no browser DOM needed
    environment: 'node',
  },
});
