import { expect, test } from './fixture';
import {
  FULL_MODEL,
  cameraSettled,
  confirmStep,
  deflectorPoint,
  dragPointer,
  dropPoint,
  expectStep,
  openApp,
  pressCover,
  transfersIdle,
  type PanelRect,
  type ScreenPoint,
} from './helpers';

/**
 * The camera has to travel with the deflector, and land somewhere Step 3 can start from.
 *
 * ## The defect
 *
 * Step 2 (`install-deflector`) declared no `cameraView` at all, so `CameraRig` never flew.
 * The learner dragged a deflector, the disc set off on its two-second journey, and the
 * camera stayed at the tray — the disc left frame, and it arrived at a view showing neither
 * the rod it had seated in nor the plate the next step asks them to close. Recovering the
 * view by hand was a prerequisite for continuing, which is not an instruction any sheet
 * gives.
 *
 * ## What is asserted
 *
 * Projected screen positions, never camera coordinates (`docs/44 §D10`). A camera can sit
 * at an entirely plausible position with the rod behind the 380 px instructional panel, and
 * a coordinate assertion would call that a pass. So every check here asks the same question
 * the learner does: can I see it, in the part of the screen that is not covered?
 */

const inside = (p: ScreenPoint | null, r: PanelRect, pad = 0): boolean =>
  !!p &&
  p.x >= r.left - pad &&
  p.y >= r.top - pad &&
  p.x <= r.left + r.width + pad &&
  p.y <= r.top + r.height + pad;

/** The part of the canvas no side panel covers. Mirrors `src/lib/cameraFraming.ts`. */
const usable = (canvas: PanelRect, panels: PanelRect[]): PanelRect => {
  let { left, top, width, height } = canvas;
  for (const p of panels) {
    if (p.height < height * 0.6) continue;
    const overlapLeft = p.left + p.width - left;
    const overlapRight = left + width - p.left;
    if (overlapLeft > 0 && overlapLeft <= overlapRight) {
      width -= overlapLeft;
      left += overlapLeft;
    } else if (overlapRight > 0) {
      width -= overlapRight;
    }
  }
  return { left, top, width, height };
};

test.describe('the camera follows the deflector into the rod', () => {
  test.skip(
    !FULL_MODEL,
    'needs the real apparatus: a stub GLB has no tray, rod or plate to frame. ' +
      'Run with BEDO_E2E_FULL_MODEL=1.'
  );

  const reachInstallStep = async (page: Parameters<typeof openApp>[0]) => {
    await openApp(page, { waitForScene: true });
    await pressCover(page);
    await expectStep(page, 2);
    await expect(page.getByRole('heading', { name: 'Install the deflector' })).toBeVisible();
    await cameraSettled(page);
  };

  const probe = async (page: Parameters<typeof openApp>[0]) => {
    await page.waitForFunction(() => typeof window.__bedoTest?.cameraProbe?.head === 'function', {
      timeout: 120_000,
    });
  };

  test('moves while the disc is in flight, and lands on the head', async ({ page }) => {
    await reachInstallStep(page);
    await probe(page);

    const before = await page.evaluate(() => window.__bedoTest!.cameraProbe!.camera());

    // Arm the recorder **before** the drag. Two reasons it has to be here and not after:
    // waiting on `data-bedo-transfer="active"` can itself consume the whole two seconds at
    // the ~1.3 fps the full apparatus renders at under software rendering, and the disc
    // exists from the moment it is grabbed — so this also captures the carry, which is
    // part of what the learner has to be able to follow.
    await page.evaluate((origin) => {
      const w = window as unknown as Record<string, any>;
      w.__camTrace = [];
      const p = window.__bedoTest!.cameraProbe!;
      const tick = () => {
        const cam = p.camera();
        w.__camTrace.push({
          moved: Math.hypot(cam[0] - origin[0], cam[1] - origin[1], cam[2] - origin[2]),
          disc: p.flyingDeflector(),
          rod: p.head().rod,
          region: p.region(),
          active: document.documentElement.dataset.bedoTransfer === 'active',
        });
        if (w.__camTrace.length < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, before);

    // A genuine drag: capture, threshold, drop test and gate all run.
    await dragPointer(page, await deflectorPoint(page, 90), await dropPoint(page));

    await transfersIdle(page);

    const trace: {
      moved: number;
      rod: ScreenPoint | null;
      disc: ScreenPoint | null;
      region: { canvas: PanelRect; panels: PanelRect[] } | null;
      active: boolean;
    }[] = await page.evaluate(() => (window as unknown as Record<string, any>).__camTrace);

    // 4. The transfer really ran, witnessed from inside the page rather than by polling.
    expect(trace.some((s) => s.active), 'no transfer was ever observed as active').toBe(true);

    const withDisc = trace.filter((s) => s.disc && s.region);
    expect(withDisc.length, 'never observed the disc in flight').toBeGreaterThan(2);

    // The camera started moving during the transfer rather than after it.
    const movedDuring = Math.max(...trace.filter((s) => s.active).map((s) => s.moved), 0);
    expect(movedDuring, 'the camera never moved while the disc was travelling').toBeGreaterThan(
      0.05
    );

    // 6. The disc stayed followable through the transfer.
    //
    // Scoped to samples where a transfer is actually running. The recorder is armed before
    // the drag, so it also sees the **carry** — and during the carry the disc is wherever
    // the learner's own pointer has taken it, which is not something the camera is
    // responsible for and not what §D10 asks about. Both fractions are reported either
    // way, so a future failure says which phase went wrong instead of just a number.
    const followFraction = (rows: typeof withDisc) =>
      rows.length
        ? rows.filter((r) => inside(r.disc, usable(r.region!.canvas, r.region!.panels), 120))
            .length / rows.length
        : Number.NaN;
    const duringTransfer = withDisc.filter((r) => r.active);
    const duringCarry = withDisc.filter((r) => !r.active);
    const transferFollow = followFraction(duringTransfer);
    const carryFollow = followFraction(duringCarry);

    expect(
      duringTransfer.length,
      'the disc was never sampled while a transfer was running'
    ).toBeGreaterThan(2);
    // Split by flight progress. "Followable" is about the learner keeping their eye on the
    // disc as it arrives — a miss in the opening moments, while the disc is still at the
    // tray and the camera has only begun to swing, reads very differently from a miss on
    // approach. Reported per third so the shape of any failure is visible.
    const third = Math.ceil(duringTransfer.length / 3) || 1;
    const thirds = [
      duringTransfer.slice(0, third),
      duringTransfer.slice(third, third * 2),
      duringTransfer.slice(third * 2),
    ].map(followFraction);

    const flightSeen = await page.evaluate(
      () => window.__bedoTest!.cameraProbe!.lastFlight()
    );

    // The whole trajectory, evenly sampled, so the shape of the path is visible rather
    // than just the count of misses.
    const step = Math.max(1, Math.floor(duringTransfer.length / 11));
    const path = duringTransfer
      .filter((_, i) => i % step === 0)
      .map((r, i) => {
        const f = usable(r.region!.canvas, r.region!.panels);
        const ok = inside(r.disc, f, 120) ? '' : '!';
        // Distance from the disc to the rod it is flying to: if the transfer is really
        // carrying it there this must shrink toward zero, whatever the camera is doing.
        const gap = r.rod
          ? Math.round(Math.hypot(r.disc!.x - r.rod.x, r.disc!.y - r.rod.y))
          : -1;
        return `${(((i * step) / duringTransfer.length) * 100).toFixed(0)}%:` +
          `${Math.round(r.disc!.x)},${Math.round(r.disc!.y)}${ok}->rod${gap}`;
      })
      .join(' ');
    const r0 = duringTransfer[0]
      ? usable(duringTransfer[0].region!.canvas, duringTransfer[0].region!.panels)
      : null;
    const regionText = r0
      ? `region x[${Math.round(r0.left)}..${Math.round(r0.left + r0.width)}] ` +
        `y[${Math.round(r0.top)}..${Math.round(r0.top + r0.height)}] pad120 -> x>=${Math.round(r0.left - 120)}`
      : 'region?';

    expect(
      transferFollow,
      `FLIGHT ${JSON.stringify(flightSeen)} | PATH ${path} | ${regionText} | ` +
        `disc followable during transfer ${(transferFollow * 100).toFixed(0)}% ` +
        `(${duringTransfer.length} samples) — by third: ` +
        thirds.map((t) => `${(t * 100).toFixed(0)}%`).join(' / ') +
        `; during carry ${(carryFollow * 100).toFixed(0)}% (${duringCarry.length} samples)`
    ).toBeGreaterThan(0.8);

    await cameraSettled(page);

    // 7/8/9. The destination view exposes everything Step 3 needs, in the part of the
    // canvas the instructional panel leaves free.
    const landed = await page.evaluate(() => {
      const p = window.__bedoTest!.cameraProbe!;
      return {
        head: p.head(),
        region: p.region()!,
        framing: p.framing(),
        cam: p.camera(),
        flight: p.lastFlight(),
      };
    });
    const free = usable(landed.region.canvas, landed.region.panels);

    // Reported as coordinates, not just a boolean: a bare `false` here says nothing about
    // whether the framing missed by two pixels or by half a screen.
    const where = (name: string, p: ScreenPoint | null) =>
      p ? `${name}(${Math.round(p.x)},${Math.round(p.y)})` : `${name}=offscreen`;
    const layout =
      `free region x[${Math.round(free.left)}..${Math.round(free.left + free.width)}] ` +
      `y[${Math.round(free.top)}..${Math.round(free.top + free.height)}]  ` +
      where('framingCentre', landed.framing?.centre ?? null) +
      ' ' +
      where('plateTop', landed.framing?.plateTop ?? null) +
      ` r=${landed.framing?.radius.toFixed(3)} cam[${landed.cam.map((v) => v.toFixed(2)).join(',')}]  ` +
      [
        where('deflector', landed.head.deflector),
        where('rod', landed.head.rod),
        where('plate', landed.head.cover),
      ].join(' ');

    expect(inside(landed.head.deflector, free), `installed deflector not visible — ${layout}`)
      .toBe(true);
    expect(inside(landed.head.rod, free), `rod/head not visible — ${layout}`).toBe(true);
    expect(inside(landed.head.cover, free), `top plate not visible — ${layout}`).toBe(true);

    // Not merely on the canvas — clear of the panel. This is the assertion a
    // camera-coordinate test cannot make, and the one the defect would fail.
    for (const panel of landed.region.panels) {
      for (const [name, point] of Object.entries(landed.head)) {
        expect(inside(point, panel), `${name} is behind the instructional panel`).toBe(false);
      }
    }
  });

  test('lets Step 3 be completed with a real click, no camera recovery', async ({ page }) => {
    await reachInstallStep(page);
    await probe(page);
    await dragPointer(page, await deflectorPoint(page, 90), await dropPoint(page));
    await transfersIdle(page);
    await cameraSettled(page);
    await confirmStep(page);
    await expectStep(page, 3);

    // 10. A **real pointer click** at the plate's own projected position — not
    // `__bedoTest.coverClick()`. The dev hook calls the handler directly, so it would pass
    // just as happily with the plate off screen, which is exactly the claim this test is
    // supposed to be making. Clicking where the plate actually is proves a learner could.
    const { cover, region } = await page.evaluate(() => {
      const p = window.__bedoTest!.cameraProbe!;
      return { cover: p.head().cover, region: p.region()! };
    });
    const free = usable(region.canvas, region.panels);
    expect(cover, 'the top plate does not project at all').not.toBeNull();
    expect(
      inside(cover, free),
      `top plate at (${Math.round(cover!.x)},${Math.round(cover!.y)}) is outside the usable ` +
        `region x[${Math.round(free.left)}..${Math.round(free.left + free.width)}] ` +
        `y[${Math.round(free.top)}..${Math.round(free.top + free.height)}]`
    ).toBe(true);

    await page.mouse.click(cover!.x, cover!.y);

    // The cover closed and the lesson moved on. `mount-cover` advances on the action, so
    // reaching step 4 is the completion signal.
    await expectStep(page, 4);
    await expect(page.getByRole('heading', { name: 'Power switch' })).toBeVisible();
  });

  test('gives the view straight back once it has settled', async ({ page }) => {
    await reachInstallStep(page);
    await probe(page);
    await dragPointer(page, await deflectorPoint(page, 90), await dropPoint(page));
    await transfersIdle(page);
    await cameraSettled(page);

    // §D8: the guided move switches OrbitControls off for its duration. Once it settles the
    // student owns the view again — a drag must move the camera.
    const before = await page.evaluate(() => window.__bedoTest!.cameraProbe!.camera());
    const canvas = (await page.locator('canvas').boundingBox())!;
    const cx = canvas.x + canvas.width * 0.7;
    const cy = canvas.y + canvas.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 12, cy);
    await page.mouse.up();

    await expect
      .poll(async () => {
        const now = await page.evaluate(() => window.__bedoTest!.cameraProbe!.camera());
        return Math.hypot(now[0] - before[0], now[1] - before[1], now[2] - before[2]);
      })
      .toBeGreaterThan(0.02);
  });
});

/**
 * The same destination framing, at every desktop size the project supports.
 *
 * Framing is aspect-dependent and the instructional panel is a fixed 380 px, so it eats a
 * very different share of a 1366-wide viewport than of a 2560-wide one. `§D7` asks that the
 * head stay in the *usable* region at each of them, which is what these check — the primary
 * 1440x900 is already covered by the tests above.
 *
 * Deliberately lean: reach the step, install, settle, look. No trace recorder, no orbit
 * checks. Running the whole suite four times over would cost half an hour for nothing.
 */
test.describe('destination framing across supported desktop sizes', () => {
  test.skip(!FULL_MODEL, 'needs the real apparatus. Run with BEDO_E2E_FULL_MODEL=1.');

  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ]) {
    test(`keeps the head in the usable viewport at ${size.width}x${size.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await openApp(page, { waitForScene: true });
      await pressCover(page);
      await expectStep(page, 2);
      await cameraSettled(page);
      await page.waitForFunction(
        () => typeof window.__bedoTest?.cameraProbe?.head === 'function',
        { timeout: 120_000 }
      );

      await dragPointer(page, await deflectorPoint(page, 90), await dropPoint(page));
      await transfersIdle(page);
      await cameraSettled(page);

      const landed = await page.evaluate(() => {
        const p = window.__bedoTest!.cameraProbe!;
        return { head: p.head(), region: p.region()! };
      });
      const free = usable(landed.region.canvas, landed.region.panels);
      const at = (n: string, q: ScreenPoint | null) =>
        q ? `${n}(${Math.round(q.x)},${Math.round(q.y)})` : `${n}=offscreen`;
      const layout =
        `${size.width}x${size.height} free x[${Math.round(free.left)}..` +
        `${Math.round(free.left + free.width)}] y[${Math.round(free.top)}..` +
        `${Math.round(free.top + free.height)}]  ` +
        [
          at('deflector', landed.head.deflector),
          at('rod', landed.head.rod),
          at('plate', landed.head.cover),
        ].join(' ');

      expect(inside(landed.head.deflector, free), `deflector — ${layout}`).toBe(true);
      expect(inside(landed.head.rod, free), `rod — ${layout}`).toBe(true);
      expect(inside(landed.head.cover, free), `plate — ${layout}`).toBe(true);
    });
  }
});
