import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],

    // The integration tests share one PostgreSQL database, so test FILES must
    // not run concurrently -- two files creating fixtures at once would make
    // failures depend on timing. Tests within a file already run in order.
    fileParallelism: false,

    // Real database round trips, and one hook seeds 45 records over HTTP.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
