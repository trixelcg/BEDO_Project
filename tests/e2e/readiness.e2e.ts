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
  await expect(stepBadge(page)).toHaveText('Step 1 / 12');

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
