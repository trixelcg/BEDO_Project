import { expect, test } from '@playwright/test';
import {
  FULL_MODEL,
  button,
  distance,
  openApp,
  sidebar,
  transfersIdle,
  weightProbe,
  type Vec3,
} from './helpers';

/**
 * The disc going *on* to the holder, in a real browser (BEDO-021b §37).
 *
 * ## What is being proved
 *
 * `Jetforce_Storyboard.pptx` says four times over that clicking a weight *moves* it to the
 * tank holder, and sl. 16 and the state machine both put two seconds on it. Until now the
 * application obeyed the state change and skipped the movement: the disc appeared on the
 * pan instantly. `BEDO-021` had built the return leg only.
 *
 * So this asserts the pair. A disc flies on over two seconds and lands on the seat
 * `BEDO-016` measured; the same disc flies off over two seconds and is aimed at the tray
 * slot it came from; and at no point is one disc drawn in two places.
 *
 * ## Why it needs the real model
 *
 * Every coordinate here is measured from the shipped apparatus at runtime — there is no
 * geometry in the stub to fly between. Runs under `BEDO_E2E_FULL_MODEL=1`, like the drag
 * suite and `readiness.e2e.ts`.
 *
 * ## No sleeps, and no races either
 *
 * Durations are measured against the scene's own `data-bedo-transfer` marker. The
 * mid-flight facts come from `probe.record`, which installs a per-frame recorder in the
 * page before the gesture and hands back every frame in which a disc was airborne. Polling
 * from Node would be a race: two seconds is one or two frames when a 26 MB apparatus is
 * rendered in software, which is fewer frames than a round trip.
 */

test.describe('carrying a weight to the holder', () => {
  test.skip(
    !FULL_MODEL,
    'needs the real apparatus: the disc flies between measured tray and holder anchors. ' +
      'Run with BEDO_E2E_FULL_MODEL=1.'
  );

  /** Comfortably inside a disc's 57 mm diameter, at the apparatus's 1.8 scale. */
  const SEATED_TOLERANCE = 0.02;

  /** Free mode reaches the weights without walking the guided sequence (§21). */
  const openFreeMode = async (page: Parameters<typeof openApp>[0]) => {
    await openApp(page, { waitForScene: true });
    await button(page, 'Free Mode').click();
    await transfersIdle(page);
    return weightProbe(page);
  };

  test('flies a disc on in two seconds, and the same disc home again', async ({ page }) => {
    const probe = await openFreeMode(page);
    const trayHome = (await probe.tray('Weight_50')) as Vec3;
    expect(trayHome, 'the 50 g disc has a measured tray slot').not.toBeNull();
    expect(await probe.seats()).toHaveLength(0);

    // --- On to the holder --------------------------------------------------------
    const sent = Date.now();
    const outbound = await probe.record(() => button(page, '+50g').click());
    expect(Date.now() - sent, 'the disc appeared instead of moving').toBeGreaterThan(1500);

    // The rig changed state on the click — that is what the storyboard's Transition column
    // says — so the disc was loaded even while it was still on its way.
    await expect(sidebar(page).getByText('50 g')).toBeVisible();
    expect(outbound.length, 'no frame showed a disc in the air').toBeGreaterThan(0);

    for (const frame of outbound) {
      expect(frame.marker, 'the scene reports itself busy while a disc travels').toBe('active');
      // In exactly one place: in the air, with its seat left empty behind it.
      expect(frame.flying).toHaveLength(1);
      expect(frame.flying[0].toHolder).toBe(true);
      expect(frame.seats).toHaveLength(1);
      expect(frame.seats[0].landed, 'the seat stays empty until the disc lands').toBe(false);
      // Aimed at the seat BEDO-016 measured, not at a destination of its own (§33).
      expect(distance(frame.flying[0].to, frame.seats[0].world)).toBeLessThan(1e-6);
      // Which is a real journey, not a nudge.
      expect(distance(frame.flying[0].to, trayHome)).toBeGreaterThan(0.5);
    }

    // Landed, on that seat, and offered to the pointer again.
    const seated = await probe.seats();
    expect(seated).toHaveLength(1);
    expect(seated[0].landed).toBe(true);
    expect(distance(seated[0].world, outbound[0].seats[0].world)).toBeLessThan(SEATED_TOLERANCE);
    expect(await probe.flying()).toHaveLength(0);
    await expect(button(page, 'Remove 50 g')).toBeEnabled();

    // --- And off again -----------------------------------------------------------
    const released = Date.now();
    const inbound = await probe.record(() => button(page, 'Remove 50 g').click());
    expect(Date.now() - released, 'the disc vanished instead of moving').toBeGreaterThan(1500);
    expect(inbound.length, 'no frame showed the disc going home').toBeGreaterThan(0);

    for (const frame of inbound) {
      expect(frame.marker).toBe('active');
      expect(frame.flying).toHaveLength(1);
      expect(frame.flying[0].toHolder).toBe(false);
      // §26/§34: home is the very tray slot it left, so the roundtrip is a closed loop.
      expect(distance(frame.flying[0].to, trayHome)).toBeLessThan(1e-6);
      // The holder is empty from the moment it is lifted off, not from when it arrives.
      expect(frame.seats).toHaveLength(0);
    }
    expect(await probe.flying()).toHaveLength(0);
    await expect(button(page, 'Remove 50 g')).toHaveCount(0);
  });

  test('gives each disc of a duplicate pair its own seat', async ({ page }) => {
    // BEDO-022's identity by position, carried through the transfer: two 50 g discs are two
    // discs, and the second one flies to the seat above the first.
    const probe = await openFreeMode(page);

    await button(page, '+50g').click();
    await transfersIdle(page);
    await button(page, '+50g').click();
    await transfersIdle(page);

    const seats = await probe.seats();
    expect(seats).toHaveLength(2);
    expect(seats.every((s) => s.landed)).toBe(true);
    const [lower, upper] = seats.map((s) => s.world as Vec3);
    expect(upper[1], 'the second disc stacks on the first').toBeGreaterThan(lower[1]);
    // One axis, two heights — a stack, not two discs in one slot.
    expect(Math.hypot(upper[0] - lower[0], upper[2] - lower[2])).toBeLessThan(1e-6);

    // Taking one off leaves exactly one, still where it was.
    await button(page, 'Remove 50 g').first().click();
    await transfersIdle(page);
    const left = await probe.seats();
    expect(left).toHaveLength(1);
    expect(distance(left[0].world, lower)).toBeLessThan(1e-6);
  });

  test('keeps adding open while a disc arrives, and holds removal until it has', async ({
    page,
  }) => {
    // §14/§15. A removal renumbers the stack, and a disc still travelling to seat *n* would
    // find that seat is now somebody else's — so removal waits for a settled pan. Adding
    // stays open, because the runtime gave each disc its own seat when it was clicked and
    // balancing a reading means several discs in a row.
    const probe = await openFreeMode(page);

    await button(page, '+100g').click();
    await transfersIdle(page);

    const midFlight = await probe.record(() => button(page, '+200g').click());
    expect(midFlight.length).toBeGreaterThan(0);
    for (const frame of midFlight) {
      expect(frame.flying).toHaveLength(1);
      expect(
        frame.removeEnabled,
        'taking a disc off must not be offered while one is moving'
      ).toBe(false);
    }
    // Adding is still on the table.
    await expect(button(page, '+50g')).toBeEnabled();
    await expect(button(page, 'Remove 100 g')).toBeEnabled();
    const seats = await probe.seats();
    expect(seats).toHaveLength(2);
    expect(seats.every((s) => s.landed)).toBe(true);
  });

  test('a reset mid-flight strands nothing and delivers nothing late', async ({ page }) => {
    // §16. No cancelled flight may arrive after the rig has been put back.
    const probe = await openFreeMode(page);

    await button(page, '+200g').click();
    await transfersIdle(page);
    await expect(button(page, 'Remove 200 g')).toBeEnabled();

    // Reset on the *first frame* a disc is airborne. Arming it in the page rather than
    // racing it from Node is what makes "mid-flight" a fact rather than a hope — two
    // seconds is one or two frames here.
    await page.evaluate(() => {
      const tick = () => {
        const flying = window.__bedoTest?.weightProbe?.flying() ?? [];
        if (flying.length > 0) {
          const reset = [...document.querySelectorAll('button')].find((b) =>
            /Reset/.test(b.textContent ?? '')
          );
          (reset as HTMLButtonElement | undefined)?.click();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await button(page, '+100g').click();
    await transfersIdle(page);

    // The flight was abandoned, the rig is back to nothing, and no arrival was reported for
    // a disc that never landed.
    expect(await probe.flying()).toHaveLength(0);
    expect(await probe.seats()).toHaveLength(0);
    await expect(button(page, 'Remove 100 g')).toHaveCount(0);
    await expect(button(page, 'Remove 200 g')).toHaveCount(0);
    // Still nothing after the flight's two seconds would long since have elapsed.
    await expect(sidebar(page).getByText('0 g').first()).toBeVisible();
    expect(await probe.seats()).toHaveLength(0);
  });
});
