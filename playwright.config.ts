import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level baseline (BEDO-002 §7, §8).
 *
 * Runs against the Vite dev server, which is where the dev-only test adapter in
 * `src/App.tsx` exists. `vite build` compiles `import.meta.env.DEV` to `false`, so the
 * adapter is absent from production bundles — `tests/unit/bundle.spec.ts` asserts that.
 *
 * The suite is deterministic by construction: every wait is an assertion on application
 * state (a readiness marker, a step badge, a balance indicator), never a sleep.
 */
const PORT = Number(process.env.BEDO_E2E_PORT ?? 5179);

export default defineConfig({
  testDir: './tests/e2e',
  // Playwright empties its output directory at the start of every run, so it gets a
  // subfolder of its own. Measurement artefacts live in measurements/ and must survive.
  outputDir: './test-results/playwright',
  testMatch: /.*\.e2e\.ts/,
  // The lesson is a single stateful walkthrough; one worker keeps the dev server's
  // module graph and the 26 MB model cache warm and the run reproducible.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // The real 26 MB model makes every interaction slow under software rendering
  // (docs/25 §6.2), so the opt-in full-model run gets a much longer budget.
  timeout: process.env.BEDO_E2E_FULL_MODEL === '1' ? 900_000 : 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: 'test-results/e2e-junit.xml' }]]
    : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    video: 'off',
    // The scene is a WebGL canvas; a real GPU-less runner still needs a stable viewport
    // for the canvas backing store.
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Frontend only. The lesson never calls the API; `/config.json` 404s and the app
    // falls back to its built-in scene config, which is the shipped behaviour.
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
