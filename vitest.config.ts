import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Unit + integration suite (BEDO-002).
 *
 * Node is the default environment because the domain layer is pure. The two React
 * integration specs opt into jsdom with a `@vitest-environment jsdom` docblock, so a
 * browser DOM is only built where one is actually needed.
 *
 * Playwright owns `tests/e2e` and is excluded here — the two runners must never try to
 * collect each other's files.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    // The GLB contract spec parses a 26 MB asset and the server spec boots a real HTTP
    // server; both are comfortably inside this, and nothing in the suite sleeps.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    restoreMocks: true,
    // Keep the app's own console output for failures, out of the way on green runs.
    silent: 'passed-only',
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'test-results/unit-junit.xml' },
  },
});
