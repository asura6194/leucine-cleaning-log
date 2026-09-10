import { defineConfig } from 'vitest/config';

/**
 * The front-end suite covers pure logic only -- no DOM, no component
 * rendering. The UI itself is verified by driving a real browser, which is
 * recorded in NOTES.md; what lives here is the arithmetic that is easy to get
 * subtly wrong and impossible to eyeball, like the pager's page window.
 */
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
