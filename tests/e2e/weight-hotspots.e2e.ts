import type { Page } from '@playwright/test';
import { expect, test } from './fixture';
import {
  FULL_MODEL,
  button,
  confirmStep,
  deflectorPoint,
  dismissPopup,
  dragPointer,
  dropPoint,
  okButton,
  openApp,
  pressCover,
  setValve,
} from './helpers';
import { MESH, WEIGHTS } from '../../src/domain/apparatus';

/**
 * Clicking a disc installs *that* disc, and the learner can see it go (BEDO-UX-10).
 *
 * ## The defect this pins
 *
 * Every tray hotspot used to be an invisible sphere sized from the part's longest side —
 * around a disc 57.6 mm across and 5.5 mm thick, a ball of radius 34.6 mm. The five discs
 * sit in a row whose centres are 84.7 mm apart along the apparatus's x axis, and that row
 * recedes almost straight away from the camera: on screen the four stacked discs are only
 * ~11 px apart. The spheres never overlapped each other — measured — but the *view ray*
 * aimed at a far disc passed well inside the nearer discs' spheres, and a raycaster
 * returns the nearest hit.
 *
 * So the front disc answered for the whole row. Measured before the fix, at 1920x1080:
 * clicking 50 g added 200 g, 100 g added 500 g, 200 g added 500 g, and no pixel anywhere
 * on the tray could add 50 g at all. Three of the five masses were unreachable.
 *
 * The proxies for the discs are now measured boxes that hug the part, thin along the axis
 * that separates them, so one cannot stand in front of another.
 *
 * ## Why it needs the real model
 *
 * The bug is entirely a fact about the shipped apparatus's geometry and how the camera
 * sees it. There are no discs in the stub. Runs under `BEDO_E2E_FULL_MODEL=1`.
 */
test.describe('the tray discs answer for themselves', () => {
  test.skip(
    !FULL_MODEL,
    'needs the real apparatus: the defect is the projected geometry of the tray row. ' +
      'Run with BEDO_E2E_FULL_MODEL=1.'
  );

  const TRAY = WEIGHTS.filter((w) => w.mesh);

  const loaded = async (page: Page): Promise<number> =>
    Number(
      await page.locator('[data-bedo-loaded-weight]').getAttribute('data-bedo-loaded-weight')
    );

  /**
   * Back to an empty holder, with the tray actually ready again.
   *
   * A disc on its way home is hidden on the tray and has no hit proxy, so "the domain says
   * zero" is not the same as "the tray can be clicked". Waiting on the transfer marker
   * alone is a race the test loses: the scene still reads `idle` the instant the click
   * lands, so the marker is satisfied before anything has begun.
   */
  async function trayReady(page: Page): Promise<void> {
    const clear = button(page, /Clear pan/i);
    if (await clear.count()) await clear.click();
    await page.waitForFunction(
      () =>
        window.__bedoTest!.weightProbe!.flying().length === 0 &&
        document
          .querySelector('[data-bedo-loaded-weight]')!
          .getAttribute('data-bedo-loaded-weight') === '0',
      undefined,
      { timeout: 30_000 }
    );
  }

  const meshPoint = (page: Page, mesh: string) =>
    page.evaluate((m: string) => window.__bedoTest!.dragProbe!.meshPoint(m), mesh);

  // --- A + B: hotspot identity, and click-to-install ---------------------------------

  test('each disc installs its own mass, and no other', async ({ page }) => {
    await openApp(page);
    await button(page, /Free Mode/i).click();

    for (const weight of TRAY) {
      await trayReady(page);
      const point = await meshPoint(page, weight.mesh!);
      expect(point, `${weight.mesh} is not on screen`).not.toBeNull();

      const before = await loaded(page);
      await page.mouse.click(point!.x, point!.y);
      // Wait for the runtime to acknowledge the click before reading the total — the
      // transfer marker is still `idle` at this instant and would let the read run early.
      await page.waitForFunction(
        (b) =>
          Number(
            document
              .querySelector('[data-bedo-loaded-weight]')!
              .getAttribute('data-bedo-loaded-weight')
          ) !== b,
        before,
        { timeout: 20_000 }
      );

      expect(
        await loaded(page),
        `clicking the ${weight.grams} g disc at its own centre installed the wrong mass`
      ).toBe(weight.grams);
    }
  });

  // --- C: the learner can see it go ---------------------------------------------------

  /**
   * The storyboard's transfer is a movement, not a number changing.
   *
   * A disc that teleports onto the pan satisfies the domain and fails the lesson, so this
   * asserts the flight itself: the disc is airborne across real frames, it covers real
   * distance, and it ends on the seat rather than wherever it happened to be.
   */
  test('the clicked disc visibly travels to the holder', async ({ page }) => {
    await openApp(page);
    await button(page, /Free Mode/i).click();
    await trayReady(page);

    const point = await meshPoint(page, 'Weight_100');
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__frames = [];
      const tick = () => {
        const flying = window.__bedoTest!.weightProbe!.flying();
        if (flying.length) {
          (
            (window as unknown as Record<string, unknown>).__frames as unknown[]
          ).push(flying.map((g) => g.at));
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.mouse.click(point!.x, point!.y);
    await page.waitForFunction(
      () =>
        window.__bedoTest!.weightProbe!.flying().length === 0 &&
        window.__bedoTest!.weightProbe!.seats().length === 1 &&
        window.__bedoTest!.weightProbe!.seats().every((s) => s.landed),
      undefined,
      { timeout: 30_000 }
    );

    const frames = (await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__frames
    )) as ([number, number, number] | null)[][];

    expect(frames.length, 'the disc was never airborne — it was placed instantly').toBeGreaterThan(1);
    const first = frames[0][0];
    const last = frames[frames.length - 1][0];
    const travelled =
      first && last ? Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) : 0;
    expect(travelled, 'the disc did not actually move on its way to the holder').toBeGreaterThan(0.2);
  });

  // --- E: removal is unchanged ---------------------------------------------------------

  test('an installed disc can still be taken off', async ({ page }) => {
    await openApp(page);
    await button(page, /Free Mode/i).click();
    await trayReady(page);

    const point = await meshPoint(page, 'Weight_500');
    await page.mouse.click(point!.x, point!.y);
    await page.waitForFunction(
      () => window.__bedoTest!.weightProbe!.seats().length === 1,
      undefined,
      { timeout: 20_000 }
    );

    const remove = button(page, /Remove 500 g/i);
    await expect(remove).toHaveCount(1);
    await remove.click();
    await page.waitForFunction(
      () =>
        window.__bedoTest!.weightProbe!.flying().length === 0 &&
        window.__bedoTest!.weightProbe!.seats().length === 0,
      undefined,
      { timeout: 30_000 }
    );
    expect(await loaded(page)).toBe(0);
  });

  // --- D + G: the labels -------------------------------------------------------------

  /**
   * Hovering a part names it, without becoming an obstacle.
   *
   * The label is drawn directly over the proxy that raised it, so `pointer-events: none`
   * is the whole reason it stays a label: without it the chip would swallow the click
   * meant for the part underneath and flicker as the pointer crossed into it.
   *
   * The nozzle earns a label without becoming a control — there is one nozzle and nothing
   * to choose about it — so its proxy takes no click and stops no event.
   */
  test('a hovered part names itself, and the nozzle consumes nothing', async ({ page }) => {
    await openApp(page);
    await button(page, /Free Mode/i).click();
    await trayReady(page);

    const tooltip = page.locator('.scene-tooltip');
    const hover = async (mesh: string) => {
      const point = await meshPoint(page, mesh);
      expect(point, `${mesh} is not on screen`).not.toBeNull();
      await page.mouse.move(point!.x - 40, point!.y - 40);
      await page.mouse.move(point!.x, point!.y);
      return point!;
    };

    for (const weight of TRAY) {
      await hover(weight.mesh!);
      await expect(tooltip).toHaveText(`${weight.grams} g`);
    }
    // Asserted while a disc is still under the pointer. Clicking anything in the DOM first
    // moves the mouse off the tray, and the label is correctly gone by then.
    await expect(tooltip).toHaveCSS('pointer-events', 'none');

    // Arabic localises the unit the way the app's own mass strings do.
    await button(page, /العربية/).first().click();
    for (const weight of TRAY) {
      await hover(weight.mesh!);
      await expect(tooltip).toHaveText(`${weight.grams} غ`);
    }
    await button(page, /English/).first().click();
    await hover('Weight_50');
    await expect(tooltip).toHaveText('50 g');

    // 10 mm, computed from NOZZLE_AREA_M2 rather than written down twice.
    const nozzle = await hover(MESH.nozzle);
    await expect(tooltip).toHaveText(/10 mm bore/);
    expect(
      await page.evaluate(() => document.body.style.cursor),
      'the nozzle is not a control and must not offer a control’s cursor'
    ).not.toBe('pointer');

    // Clicking the nozzle does nothing at all — it neither installs nor blocks.
    const before = await loaded(page);
    await page.mouse.click(nozzle.x, nozzle.y);
    await page.waitForTimeout(1200);
    expect(await loaded(page), 'the nozzle consumed a click').toBe(before);

    // Leaving the part retracts the label.
    const disc = await meshPoint(page, 'Weight_50');
    await page.mouse.move(disc!.x, disc!.y - 220);
    await expect(tooltip).toHaveCount(0);
  });

  // --- F: the guided HUD steps aside at the weight step ------------------------------

  /**
   * At the step that says "add weights", the discs must be clickable (BEDO-UX-10 §5).
   *
   * The tray projects into the bottom-centre of the frame at every supported size —
   * measured, x 0.38-0.63 and y 0.70-0.98 of the viewport at all four — which is exactly
   * where the reference-aligned dock and footer sit. Before the fix, three or four of the
   * five discs were behind `.step-card-title`, the step body or `.guided-footer-btn`.
   *
   * This walks the real lesson to step 6 and then hit-tests each disc's own projected
   * centre against `elementFromPoint`, which is the browser's own answer to "what would
   * receive this click". Four viewports, one journey: the layout is what is under test,
   * not the journey.
   */
  test('the guided HUD leaves the tray clickable at every supported size', async ({ page }) => {
    await openApp(page);

    const settle = async () => {
      // Every step reframes the camera. Aiming before it has arrived is how a browser test
      // becomes a flaky one, so wait until the projection stops moving.
      await page.waitForFunction(
        () => {
          const q = window.__bedoTest!.dragProbe!.deflectorPoint(90);
          if (!q) return false;
          const w = window as unknown as Record<string, { x: number; y: number } | undefined>;
          const prev = w.__camera;
          w.__camera = q;
          return !!prev && Math.hypot(q.x - prev.x, q.y - prev.y) < 0.5;
        },
        undefined,
        { timeout: 30_000, polling: 250 }
      );
    };
    const stepNow = async () =>
      Number(/(\d+)/.exec((await page.locator('.step-badge').innerText()) ?? '')?.[1] ?? 0);

    /*
      Driven by the badge rather than by a fixed list of actions.

      The lesson does not always advance one step per action: the deflector step is
      satisfied the moment a deflector is selected, and since `selectedDeflectorId` is
      non-nullable that can already be true on arrival — so step 1 hands straight to
      step 3. Reading what the lesson is actually asking for keeps this about the layout
      under test rather than about a memorised route.
    */
    for (let guard = 0; guard < 12 && (await stepNow()) < 6; guard += 1) {
      switch (await stepNow()) {
        case 1:
        case 3:
          await pressCover(page);
          break;
        case 2:
          await settle();
          await dragPointer(page, await deflectorPoint(page, 90), await dropPoint(page));
          break;
        case 4:
          await button(page, /Turn On Pump/i).click();
          break;
        case 5:
          await setValve(page, 0.4);
          break;
      }
      await dismissPopup(page);
      if (await okButton(page).count()) await confirmStep(page);
    }

    expect(await stepNow(), 'the lesson never reached the weight step').toBe(6);

    for (const size of [
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ]) {
      await page.setViewportSize(size);
      // The camera reframes on resize; measuring mid-flight reports positions that are
      // simply wrong, so wait until the projection stops moving.
      await page.waitForFunction(
        () => {
          const q = window.__bedoTest!.dragProbe!.meshPoint('Weight_50');
          if (!q) return false;
          const w = window as unknown as Record<string, { x: number; y: number } | undefined>;
          const prev = w.__settle;
          w.__settle = q;
          return !!prev && Math.hypot(q.x - prev.x, q.y - prev.y) < 0.5;
        },
        undefined,
        { timeout: 30_000, polling: 250 }
      );

      const blocked = await page.evaluate((meshes) => {
        const out: string[] = [];
        for (const mesh of meshes) {
          const q = window.__bedoTest!.dragProbe!.meshPoint(mesh);
          if (!q) {
            out.push(`${mesh}: off screen`);
            continue;
          }
          const el = document.elementFromPoint(q.x, q.y);
          if (!el || el.tagName.toLowerCase() !== 'canvas') {
            out.push(`${mesh}: behind ${el ? el.className || el.tagName : 'nothing'}`);
          }
        }
        return out;
      }, TRAY.map((w) => w.mesh!));

      expect(
        blocked,
        `at ${size.width}x${size.height} the guided HUD covers discs the step asks the learner to click`
      ).toEqual([]);
    }
  });
});
