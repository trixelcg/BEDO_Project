import { execFileSync } from 'node:child_process';
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
const FULL_MODEL = process.env.BEDO_E2E_FULL_MODEL === '1';

/**
 * A dedicated port for the full-model run.
 *
 * The two modes get different ports so a server left over from one can never be picked up
 * by the other, and so the two can never fight over the same socket.
 */
const PORT = Number(process.env.BEDO_E2E_PORT ?? (FULL_MODEL ? 5180 : 5179));

/**
 * One id per run, shared with the workers.
 *
 * Playwright re-imports this file in every worker, so a bare `new Date()` here produces a
 * *different* directory per process and scatters one run's artefacts across several of
 * them. Stamping it into the environment in the first process that loads the config makes
 * the workers, which inherit that environment, agree.
 */
process.env.BEDO_E2E_RUN_ID ??= new Date().toISOString().replace(/[:.]/g, '-');
const RUN_ID = process.env.BEDO_E2E_RUN_ID;

/**
 * The desktop size the suite is written against. Exported so the framing tests can state
 * the others relative to it rather than repeating a magic pair of numbers.
 */
export const PRIMARY_VIEWPORT = { width: 1440, height: 900 };

/** What is listening on a port, if anything: `pid command`. */
function occupant(port: number): string | null {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pc'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pid = /^p(\d+)$/m.exec(out)?.[1];
    const command = /^c(.*)$/m.exec(out)?.[1];
    return pid ? `pid ${pid} (${command ?? 'unknown'})` : null;
  } catch {
    // Nothing listening, or no `lsof` on this platform. Either way there is nothing to
    // report, and `--strictPort` below is still a hard backstop.
    return null;
  }
}

/**
 * Fail before the run rather than 45 minutes into it.
 *
 * `reuseExistingServer` used to be on, so whatever happened to hold this port became the
 * server under test. A wedged or stale Vite — four were once left behind by measurement
 * scripts that only cleaned up on their happy path — then served every test, and the
 * symptom was a timeout on a readiness marker that actually arrives in 318 ms. The run
 * took 45 minutes and Playwright wiped its own traces at the start of the next one, so
 * there was nothing left to diagnose.
 *
 * So: never reuse, and say plainly what is in the way.
 */
// Only in the process that is about to *start* the server. Playwright re-imports this file
// in every test worker, and by then the server it started for us is legitimately listening
// on this port — so an unguarded check reports Playwright's own server as the blocker and
// fails the run it was meant to protect. `TEST_WORKER_INDEX` is set only in workers.
const blocker = process.env.TEST_WORKER_INDEX === undefined ? occupant(PORT) : null;
if (blocker) {
  throw new Error(
    `\n\nPort ${PORT} is already in use by ${blocker}.\n\n` +
      'The E2E suite starts its own server and will not reuse one it did not start, ' +
      'because a stale or wedged server silently becomes the thing under test.\n' +
      `Stop that process, or set BEDO_E2E_PORT to a free port.\n`
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  // Playwright empties its output directory at the start of every run, so it gets a
  // subfolder of its own. Measurement artefacts live in measurements/ and must survive.
  //
  // The full-model run gets a *timestamped* directory on top of that. Its failures are
  // expensive to reproduce — minutes each — and the flat directory meant the next run
  // destroyed the traces from the last one before anyone could open them. `test-results`
  // is gitignored, so these accumulate locally and nowhere else.
  outputDir: FULL_MODEL ? `./test-results/playwright/full-${RUN_ID}` : './test-results/playwright',
  preserveOutput: 'always',
  testMatch: /.*\.e2e\.ts/,
  // The lesson is a single stateful walkthrough; one worker keeps the dev server's
  // module graph and the 26 MB model cache warm and the run reproducible.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // The real 26 MB model makes every interaction slow under software rendering
  // (docs/25 §6.2), so the opt-in full-model run gets a much longer budget.
  timeout: FULL_MODEL ? 900_000 : 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: 'test-results/e2e-junit.xml' }]]
    : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Always on for the full-model run: a failure there costs minutes to reproduce, and a
    // trace that was never recorded cannot be recovered afterwards.
    trace: FULL_MODEL ? 'on' : 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // **After** the device spread, not before. `devices['Desktop Chrome']` carries its
        // own `viewport: 1280x720`, and a project's `use` overrides the top-level one — so
        // declaring 1440x900 up there had no effect and the suite had never actually run at
        // the size it claimed. The scene is a WebGL canvas and framing is aspect-dependent,
        // so the viewport is part of what is under test.
        viewport: PRIMARY_VIEWPORT,
      },
    },
  ],
  webServer: {
    // Frontend only. The lesson never calls the API; `/config.json` 404s and the app
    // falls back to its built-in scene config, which is the shipped behaviour.
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Never. See `occupant` above — this is the setting that let a stale server become
    // the system under test.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
