import { expect, type Locator, type Page } from '@playwright/test';
import { buildStubGlb } from './stub-model';

/**
 * Page helpers for the browser suite (BEDO-002 §7, §8, §12).
 *
 * Every wait here is an assertion about application state — a readiness marker, a step
 * badge, an enabled control. There are no sleeps and no screen coordinates, so a slow
 * machine makes the suite slower, never flakier.
 */

export const sidebar = (page: Page) => page.locator('.sidebar-panel');
export const stepBadge = (page: Page) => page.locator('.step-badge');
export const okButton = (page: Page) => page.locator('.ok-confirm-btn');
export const popup = (page: Page) => page.locator('.warning-popup');
export const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name });

/** Set BEDO_E2E_FULL_MODEL=1 to run every test against the real 26 MB asset. */
export const FULL_MODEL = process.env.BEDO_E2E_FULL_MODEL === '1';

/**
 * Serves an empty model in place of the apparatus GLB. See `stub-model.ts` for why, and
 * for what still covers the real asset.
 */
export async function stubApparatusModel(page: Page): Promise<void> {
  if (FULL_MODEL) return;
  const body = buildStubGlb();
  await page.route('**/Bedo_baked_v2.glb', (route) =>
    route.fulfill({ status: 200, contentType: 'model/gltf-binary', body })
  );
}

/**
 * Loads the app and waits for the training panel to be usable.
 *
 * `waitForScene` additionally waits for the model to be in the scene graph. With the real
 * asset that is slow, so only the tests that are about the scene pay for it.
 */
export async function openApp(page: Page, options: { waitForScene?: boolean } = {}): Promise<void> {
  // `domcontentloaded`, not `load`: the load event waits on the 26 MB apparatus model,
  // and the training panel is usable long before that. Tests that need the model wait on
  // the scene-ready marker instead.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-bedo-app-ready]')).toHaveCount(1);
  await expect(sidebar(page)).toBeVisible();
  await expect(page.locator('[data-bedo-training-ready]')).toHaveCount(1);

  // Freeze CSS animations. The popups slide in over 300 ms, and Playwright will not act
  // on a moving element; with the render loop competing for the main thread that wait is
  // unbounded. This changes nothing about behaviour — only about how long a thing takes
  // to stop moving.
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });

  if (options.waitForScene) {
    await expect(page.locator('[data-bedo-scene-ready]')).toHaveCount(1, { timeout: 120_000 });
  }
}

/** Reads the "Step n / 12" badge. */
export async function currentStep(page: Page): Promise<number> {
  const text = (await stepBadge(page).textContent()) ?? '';
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) throw new Error(`unreadable step badge: "${text}"`);
  return Number(match[1]);
}

export async function expectStep(page: Page, step: number): Promise<void> {
  await expect(stepBadge(page), `expected the lesson to be on step ${step}`).toHaveText(
    new RegExp(`\\b${step}\\s*/\\s*11`)
  );
}

/**
 * Presses the tank cover.
 *
 * The plate is a mesh inside the WebGL canvas with no DOM equivalent, and the camera
 * reframes between steps, so a coordinate click would be guessing. This calls the same
 * handler the mesh calls, through the dev-only adapter in `src/App.tsx` — the guards and
 * the guided transition both still run.
 */
export async function pressCover(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof window.__bedoTest?.coverClick === 'function');
  await page.evaluate(() => window.__bedoTest!.coverClick());
}

/** Drags the flow valve to an opening. */
export async function setValve(page: Page, value: number): Promise<void> {
  const slider = page.locator('.valve-slider-container input[type="range"]');
  await expect(slider).toBeVisible();
  await slider.fill(String(value));
}

/**
 * Dismisses the guard/observation popup if one is showing.
 *
 * The click is dispatched rather than performed with the mouse because of a defect this
 * suite found: `.warning-popup` and `.monitor-fullscreen` share `z-index: 100`, and the
 * monitor is later in the DOM, so from step 10 onwards every popup is painted underneath
 * the monitor and its OK button cannot be clicked at all. Dispatching still runs the real
 * React handler, so the lesson is driven exactly as it would be. See `docs/25` — the
 * stacking itself is left alone, as BEDO-002 changes no behaviour.
 */
export async function dismissPopup(page: Page): Promise<void> {
  const open = popup(page);
  if (await open.count()) {
    await open.getByRole('button').dispatchEvent('click');
    await expect(open).toHaveCount(0);
  }
}

export async function confirmStep(page: Page): Promise<void> {
  await expect(okButton(page)).toBeVisible();
  await okButton(page).click();
}

declare global {
  interface Window {
    /** Dev-only; see src/App.tsx. */
    __bedoTest?: { coverClick: () => void; selectDeflector: (id: number) => boolean };
  }
}
