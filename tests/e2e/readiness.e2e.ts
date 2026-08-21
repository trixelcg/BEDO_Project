import { expect, test } from '@playwright/test';
import { openApp, sidebar, stepBadge, stubApparatusModel } from './helpers';

/**
 * Loading baseline (BEDO-002 §9).
 *
 * Pins the three milestones later performance work will be measured against. It does not
 * assert how *fast* any of them are — `docs/11` owns the numbers, and BEDO-002 changes
 * nothing about loading.
 *
 * This is the one browser test that loads the real 26 MB apparatus model, so it is also
 * the proof that the shipped asset still parses, resolves and renders in a browser. It is
 * slow for exactly the reason `docs/11 §3.5` records, and the timeout reflects that.
 */

test.describe.configure({ timeout: 240_000 });

test('the app reports app-shell, training and scene readiness', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await openApp(page, { waitForScene: true });

  await expect(sidebar(page)).toBeVisible();
  await expect(stepBadge(page)).toHaveText('Step 1 / 11');

  // The shell and the training panel are up as soon as the bundle runs.
  const shell = await page.getAttribute('html', 'data-bedo-app-ready');
  const training = await page.getAttribute('html', 'data-bedo-training-ready');
  expect(Number(shell)).toBeGreaterThanOrEqual(0);
  expect(Number(training)).toBeGreaterThanOrEqual(0);

  // The scene marker lands only once the apparatus model is in the scene graph, which is
  // the milestone `docs/11 §3.5` measures "time to visible 3D scene" against.
  const scene = Number(await page.getAttribute('html', 'data-bedo-scene-ready'));
  expect(scene).toBeGreaterThanOrEqual(Number(shell));

  // The marks the perf harness reads.
  const marks = await page.evaluate(() =>
    performance.getEntriesByType('mark').map((m) => m.name)
  );
  expect(marks).toContain('bedo:app-ready');
  expect(marks).toContain('bedo:training-ready');
  expect(marks).toContain('bedo:scene-ready');

  expect(errors, `page errors during load:\n${errors.join('\n')}`).toEqual([]);
});

test('startup requests no configuration file and logs no errors', async ({ page }) => {
  // BEDO-003 §5. The app used to fetch `/config.json` on mount so a developer panel could
  // override the scene at runtime. On the production server that path has an extension
  // and no file behind it, so every visitor's first load carried a 404 (`BUG-24`); under
  // a dev server it returned index.html, which then failed to parse as JSON and logged
  // "Using default client-side scene configuration." on every boot. The scene
  // configuration is now a checked-in constant, so neither should ever happen again.
  await stubApparatusModel(page);

  const requested: string[] = [];
  const failed: string[] = [];
  const consoleErrors: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('blob:') && !url.startsWith('data:')) {
      requested.push(new URL(url).pathname);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await openApp(page);
  await expect(stepBadge(page)).toHaveText('Step 1 / 11');

  expect(requested.filter((path) => path.includes('config.json'))).toEqual([]);
  expect(requested.filter((path) => path.startsWith('/api'))).toEqual([]);
  expect(failed, `failed responses during startup:\n${failed.join('\n')}`).toEqual([]);
  expect(consoleErrors, `console errors during startup:\n${consoleErrors.join('\n')}`).toEqual([]);
});

test('the developer settings panel is gone from the page', async ({ page }) => {
  await stubApparatusModel(page);
  await openApp(page);

  // The toggle that opened the scene editor, and everything it opened.
  await expect(page.locator('.floating-settings-toggle')).toHaveCount(0);
  await expect(page.locator('.settings-panel-sidebar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Scene Settings/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save Config' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Capture Camera' })).toHaveCount(0);

  // ...while the learner-facing controls are untouched.
  await expect(sidebar(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'العربية' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Free Mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset simulator' })).toBeVisible();
});

test('the canvas is present and sized', async ({ page }) => {
  // This one is about the page, not the asset, so it does not pay for the real model.
  await stubApparatusModel(page);
  await openApp(page);
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(100);
  expect(box?.height ?? 0).toBeGreaterThan(100);
});
