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

/**
 * Where a tray deflector is on screen, and where the rod is (BEDO-021 §31).
 *
 * A real pointer drag needs two real screen points, and a 3D view that reframes itself
 * between steps has no fixed ones. Rather than guess at coordinates — which is how a
 * browser test becomes a flaky test — the application projects its own geometry through
 * the dev-only probe in `DeviceModel`, and the mouse is driven between the answers. The
 * drag itself is genuine: capture, threshold, drop test and gate all run.
 */
export interface ScreenPoint {
  x: number;
  y: number;
}

const probe = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => typeof window.__bedoTest?.dragProbe?.dropPoint === 'function',
    undefined,
    { timeout: 120_000 }
  );
};

export async function deflectorPoint(page: Page, id: number): Promise<ScreenPoint> {
  await probe(page);
  const point = await page.evaluate((angle) => window.__bedoTest!.dragProbe!.deflectorPoint(angle), id);
  if (!point) throw new Error(`the ${id}° deflector is not on screen`);
  return point;
}

/**
 * Where to aim a deflector drag.
 *
 * The application's own answer, not the test's: the storyboard's destination is *"the tank
 * … to install it in the rod"*, and while the plate is unscrewed the rod is out of frame,
 * so the app reports whichever of its two drop regions the camera can see.
 */
export async function dropPoint(page: Page): Promise<ScreenPoint> {
  await probe(page);
  const point = await page.evaluate(() => window.__bedoTest!.dragProbe!.dropPoint());
  if (!point) throw new Error('no drop region is on screen');
  const view = page.viewportSize();
  if (view && (point.x < 0 || point.y < 0 || point.x > view.width || point.y > view.height)) {
    throw new Error(
      `the drop target is off screen at (${Math.round(point.x)}, ${Math.round(point.y)}) — ` +
        'a learner could not aim at it either'
    );
  }
  return point;
}

/** A stable projected point for reading the camera off. Always in frame at every step. */
export async function trayPoint(page: Page): Promise<ScreenPoint> {
  await probe(page);
  const point = await page.evaluate(() => window.__bedoTest!.dragProbe!.deflectorPoint(90));
  if (!point) throw new Error('the tray is not on screen');
  return point;
}

/**
 * A real mouse drag, in steps, so the movement threshold is crossed and every
 * `pointermove` in between is dispatched exactly as a hand would produce it.
 */
export async function dragPointer(
  page: Page,
  from: ScreenPoint,
  to: ScreenPoint,
  steps = 16
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps
    );
  }
  await page.mouse.up();
}

/**
 * Waits for the camera to come to rest, and reports where the rod ends up.
 *
 * `CameraRig` flies to the part each step is about over 1.25 s, so anything reading a
 * projected screen position has to let it land first. An assertion on application state
 * like every other wait here — successive samples of where the rod projects to, until two
 * agree — never a sleep.
 *
 * `CAMERA_REST_PX` is not zero because OrbitControls damps: each frame closes 5 % of the
 * remaining distance, and under the headless software renderer the real apparatus runs at
 * ~1.3 fps (`docs/11 §2`), so the last pixel of a large movement can take a very long time
 * in wall-clock terms. Three pixels is comfortably below anything a caller distinguishes.
 */
export const CAMERA_REST_PX = 3;

/**
 * Four consecutive still samples, not one.
 *
 * A single pair can agree *before the flight has begun* — the step badge changes and the
 * camera starts moving a frame or two later, and at ~1.3 fps that is a long time. Insisting
 * on a run of them means the camera has genuinely stopped rather than not yet started.
 */
const CAMERA_STILL_SAMPLES = 4;

export async function cameraSettled(page: Page): Promise<ScreenPoint> {
  let previous: ScreenPoint | null = null;
  let still = 0;
  await expect
    .poll(
      async () => {
        const next = await trayPoint(page);
        still =
          previous && Math.hypot(next.x - previous.x, next.y - previous.y) < CAMERA_REST_PX
            ? still + 1
            : 0;
        previous = next;
        return still;
      },
      { timeout: 120_000, intervals: [500] }
    )
    .toBeGreaterThanOrEqual(CAMERA_STILL_SAMPLES);
  return previous!;
}

/**
 * Waits for every physical transfer to land.
 *
 * An assertion about application state, like every other wait in this suite: the scene
 * writes `data-bedo-transfer` when the answer changes and never per frame, so the test
 * never has to guess how long BEDO's two seconds take on a software renderer
 * (`BEDO-021 §33`).
 */
export async function transfersIdle(page: Page): Promise<void> {
  await expect(page.locator('html[data-bedo-transfer="idle"]')).toHaveCount(1, {
    timeout: 60_000,
  });
}

declare global {
  interface Window {
    /** Dev-only; see src/App.tsx and src/components/DeviceModel.tsx. */
    __bedoTest?: {
      coverClick: () => void;
      selectDeflector: (id: number) => boolean;
      dragProbe?: {
        deflectorPoint: (id: number) => ScreenPoint | null;
        meshPoint: (name: string) => ScreenPoint | null;
        dropPoint: () => ScreenPoint | null;
      };
      /** Dev-only; see BEDO-021b. World coordinates for the weights and their flights. */
      weightProbe?: {
        seats: () => { index: number; landed: boolean; world: Vec3 | null }[];
        tray: (mesh: string) => Vec3 | null;
        flying: () => {
          grams: number | undefined;
          toHolder: boolean;
          at: Vec3 | null;
          to: Vec3 | null;
        }[];
      };
    };
  }
}

/** A point in world units, as the dev probe reports it. */
export type Vec3 = [number, number, number];

export const distance = (a: Vec3 | null, b: Vec3 | null): number =>
  a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Number.POSITIVE_INFINITY;

/** One frame of the weights, captured inside the page. */
export interface WeightSnapshot {
  marker: string | null;
  flying: { grams: number | undefined; toHolder: boolean; at: Vec3 | null; to: Vec3 | null }[];
  seats: { index: number; landed: boolean; world: Vec3 | null }[];
  /** Whether the panel is currently offering to take a disc off. */
  removeEnabled: boolean;
}

/** The weights probe, or a failure that says which dev-only hook is missing. */
export async function weightProbe(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__bedoTest?.weightProbe)), {
      timeout: 30_000,
    })
    .toBe(true);
  return {
    seats: () => page.evaluate(() => window.__bedoTest!.weightProbe!.seats()),
    tray: (mesh: string) =>
      page.evaluate((m) => window.__bedoTest!.weightProbe!.tray(m), mesh),
    flying: () => page.evaluate(() => window.__bedoTest!.weightProbe!.flying()),

    /**
     * Record **every rendered frame** of the flight a gesture starts.
     *
     * A recorder is installed in the page first, on `requestAnimationFrame`, and reads the
     * probe from inside the page; the result is collected once the scene reports itself
     * idle. Nothing is polled across the wire and nothing sleeps.
     *
     * Polling from Node instead is a race the test loses about as often as it wins. The
     * browser suite renders a 26 MB apparatus in software at roughly one frame a second, so
     * BEDO's two seconds are only one or two frames — fewer than a round trip — and a poll
     * that misses them cannot tell "it never happened" from "I blinked". A frame-by-frame
     * recorder cannot miss a flight that spans a frame at all.
     */
    async record(launch: () => Promise<unknown>): Promise<WeightSnapshot[]> {
      await page.evaluate(() => {
        const w = window as unknown as { __wtLog?: unknown[]; __wtOn?: boolean };
        w.__wtLog = [];
        w.__wtOn = true;
        const tick = () => {
          const probe = window.__bedoTest?.weightProbe;
          const flying = probe?.flying() ?? [];
          if (flying.length > 0) {
            const remove = [...document.querySelectorAll('button')].find((b) =>
              /^Remove /.test(b.getAttribute('aria-label') ?? '')
            ) as HTMLButtonElement | undefined;
            w.__wtLog!.push({
              marker: document.documentElement.dataset.bedoTransfer ?? null,
              flying,
              seats: probe!.seats(),
              removeEnabled: remove ? !remove.disabled : false,
            });
          }
          if (w.__wtOn) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      await launch();
      await transfersIdle(page);

      return page.evaluate(() => {
        const w = window as unknown as { __wtLog: WeightSnapshot[]; __wtOn: boolean };
        w.__wtOn = false;
        return w.__wtLog;
      }) as Promise<WeightSnapshot[]>;
    },
  };
}
