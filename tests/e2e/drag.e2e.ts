import { expect, test } from './fixture';
import {
  FULL_MODEL,
  button,
  confirmStep,
  deflectorPoint,
  dismissPopup,
  dragPointer,
  expectStep,
  cameraSettled,
  okButton,
  openApp,
  popup,
  pressCover,
  dropPoint,
  setValve,
  sidebar,
  stubApparatusModel,
  transfersIdle,
} from './helpers';

/**
 * Drag-and-drop and the two-second transfer, in a real browser (BEDO-021 §31, §32).
 *
 * ## What is being proved
 *
 * Step 2 of every BEDO experiment sheet says *"Drag the 90° flat deflector to install it
 * in the rod"*, and the evaluation the rebuild was commissioned from lists the absence of
 * drag-and-drop as a defect. This is the test that the instruction and the behaviour now
 * agree — and, just as importantly, that the new input method changed no rule: a wrong
 * deflector dragged squarely onto the rod is refused exactly as a wrong deflector clicked
 * in the panel is.
 *
 * ## Why most of it needs the real model
 *
 * The rest of the browser suite swaps the 26 MB apparatus for an empty stub, because the
 * lesson is driven through the DOM and does not need geometry. A drag does: there has to
 * be a deflector on a tray and a rod to put it on. So these run under
 * `BEDO_E2E_FULL_MODEL=1`, alongside `readiness.e2e.ts`, which is already the suite's
 * home for "this one needs the real asset".
 *
 * No test here sleeps. The two-second transfer is waited on through the scene's own
 * `data-bedo-transfer` marker (`§33`), and its duration is measured rather than assumed.
 */

test.describe('transfer instrumentation', () => {
  test.beforeEach(async ({ page }) => {
    await stubApparatusModel(page);
  });

  test('reports the scene idle while nothing is in flight', async ({ page }) => {
    await openApp(page);
    // The marker ships — it is inert instrumentation like the readiness attributes — so a
    // resting scene says so, and a test can tell "not started yet" from "finished".
    await expect(page.locator('html[data-bedo-transfer="idle"]')).toHaveCount(1);
  });
});

test.describe('dragging the deflector onto the rod', () => {
  test.skip(
    !FULL_MODEL,
    'needs the real apparatus: a stub GLB has no tray and no rod to drag between. ' +
      'Run with BEDO_E2E_FULL_MODEL=1.'
  );

  /**
   * Opens the tank and leaves the lesson on step 2, where the sheets say to drag.
   *
   * Waits for the step's camera flight to land as well as for the badge: a drag is aimed
   * at projected screen points, and points read mid-flight are points from the previous
   * framing.
   */
  const reachInstallStep = async (page: Parameters<typeof openApp>[0]) => {
    await openApp(page, { waitForScene: true });
    await pressCover(page);
    await expectStep(page, 2);
    await expect(page.getByRole('heading', { name: 'Install the deflector' })).toBeVisible();
    await cameraSettled(page);
  };

  test('refuses another experiment’s deflector, then installs the right one', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await reachInstallStep(page);

    // --- the wrong deflector, dropped squarely on the target ------------------------
    //
    // Exp. 1 is run with the 90° flat disc alone. The 180° hemisphere is a real,
    // installable deflector and the rod would hold it — the lesson is what refuses, and
    // it must refuse a drag exactly as it refuses a click (`BUG-05`).
    await dragPointer(page, await deflectorPoint(page, 180), await dropPoint(page));
    await expect(popup(page)).toContainText('This experiment uses a different deflector.');
    await expectStep(page, 2);
    await dismissPopup(page);

    // Nothing was committed: the rig still carries the deflector it started with. `k` is
    // the momentum factor the results table is computed from — 1.0 for the flat disc,
    // 2 for the 180° hemisphere — so this is the runtime's own answer, not a label.
    await button(page, 'Parameters').click();
    await expect(sidebar(page).getByText('k = 1')).toBeVisible();
    await button(page, 'Steps').click();

    // The refused disc came home rather than being left hanging in the air.
    await transfersIdle(page);

    // --- the right deflector -------------------------------------------------------
    const released = Date.now();
    await dragPointer(page, await deflectorPoint(page, 90), await dropPoint(page));
    await expect(popup(page)).toHaveCount(0);

    // BEDO's two seconds: "the deflector moves to the tank to install it in the rod in 2
    // seconds" (storyboard sl. 14). Only a lower bound is asserted — a software renderer
    // makes the clock honest but the observation slow, so an upper bound would measure
    // the CI machine rather than the animation. What matters is that it is a move and not
    // a teleport.
    await transfersIdle(page);
    expect(Date.now() - released, 'the deflector teleported instead of moving').toBeGreaterThan(
      1500
    );

    // The lesson advances on the accepted action, not on the animation — the OK button is
    // the sheets' own "press to continue" and it is offered as soon as the rig is right.
    await confirmStep(page);
    await expectStep(page, 3);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a deflector dropped away from the rod changes nothing at all', async ({ page }) => {
    await reachInstallStep(page);

    // Let go over empty bench, well clear of the tank. The gate is never asked: a missed
    // drop is not a refused interaction, so there is no notice and nothing to undo.
    const tray = await deflectorPoint(page, 90);
    await dragPointer(page, tray, { x: tray.x, y: tray.y + 320 });

    await expect(popup(page)).toHaveCount(0);
    await expectStep(page, 2);
    await transfersIdle(page);

    // ...and the tray disc is back where it was, so the same drag can simply be repeated.
    await dragPointer(page, await deflectorPoint(page, 90), await dropPoint(page));
    await transfersIdle(page);
    await confirmStep(page);
    await expectStep(page, 3);
  });

  test('free mode lets any mechanically valid deflector be dragged in', async ({ page }) => {
    await openApp(page, { waitForScene: true });
    await pressCover(page);
    await expectStep(page, 2);
    await cameraSettled(page);
    await button(page, 'Free Mode').click();

    // The conical 135° disc belongs to Exp. 3 and guided Exp. 1 refuses it. Free mode is
    // apparatus exploration, so the rod takes it — and the runtime's force law follows.
    await dragPointer(page, await deflectorPoint(page, 135), await dropPoint(page));
    await expect(popup(page)).toHaveCount(0);
    await transfersIdle(page);

    await button(page, 'Parameters').click();
    await expect(sidebar(page).getByText('k = 1.707')).toBeVisible();
  });

  test('dragging does not swing the camera, and navigation survives the drag', async ({ page }) => {
    await reachInstallStep(page);

    // Where the tray projects to on screen is a direct read-out of the camera. Let the
    // step's own camera flight land first — it is 1.25 s of `CameraRig`, and reading
    // mid-flight would measure that rather than the drag.
    const before = await cameraSettled(page);

    // Carry a deflector right across the view and drop it on nothing. Suspending
    // navigation for the gesture is what stops this from also orbiting the bench.
    const tray = await deflectorPoint(page, 90);
    await dragPointer(page, tray, { x: tray.x + 280, y: tray.y - 160 });
    await transfersIdle(page);

    const after = await cameraSettled(page);
    const swungByDrag = Math.hypot(after.x - before.x, after.y - before.y);
    expect(swungByDrag, 'the drag swung the camera').toBeLessThan(25);

    // ...and navigation is suspended, not switched off: a drag on empty canvas still
    // orbits. The corner is deliberately clear of the apparatus, so this press lands on
    // the background and not on a part.
    const canvas = await page.locator('canvas').boundingBox();
    const empty = { x: canvas!.x + canvas!.width - 60, y: canvas!.y + canvas!.height - 60 };
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(empty.x - i * 20, empty.y);
    await page.mouse.up();

    // The comparison is the assertion. An unsuspended object drag would orbit the bench
    // exactly as this does — hundreds of pixels for a movement of this size — so the gap
    // between the two numbers is what proves navigation was held off for the gesture and
    // handed straight back afterwards. Neither bound is a tolerance on stillness: they are
    // two orders of magnitude apart.
    const orbited = await cameraSettled(page);
    const swungByCanvas = Math.hypot(orbited.x - after.x, orbited.y - after.y);
    expect(swungByCanvas, 'the camera stayed locked after a drag ended').toBeGreaterThan(100);
    expect(swungByDrag).toBeLessThan(swungByCanvas / 4);
  });
});

test.describe('taking a weight off the holder', () => {
  test.skip(
    !FULL_MODEL,
    'needs the real apparatus: the discs on the holder are clones of tray meshes. ' +
      'Run with BEDO_E2E_FULL_MODEL=1.'
  );

  /**
   * Storyboard sl. 32, state D: *"Click on the weight on holder — the weight removed from
   * the tank holder in 2 sec."* The semantics landed in `BEDO-022`; this is the move.
   */
  test('removes one disc over two seconds and leaves the rest balanced', async ({ page }) => {
    await openApp(page, { waitForScene: true });
    await pressCover(page);
    await expectStep(page, 2);
    await cameraSettled(page);
    await dragPointer(page, await deflectorPoint(page, 90), await dropPoint(page));
    await transfersIdle(page);
    await confirmStep(page);
    await pressCover(page);
    await button(page, 'Turn On Pump').click();
    await setValve(page, 0.4);
    await confirmStep(page);
    await dismissPopup(page);
    await expectStep(page, 6); // balance reading 1, target 80 g

    // Two discs on, deliberately overshooting the target.
    await button(page, '+200g').click();
    await button(page, '+50g').click();
    await expect(sidebar(page).getByText('250 g')).toBeVisible();
    await expect(okButton(page)).toHaveCount(0);
    await transfersIdle(page);

    // Take the top one off from the panel — the same semantic action the disc in the tank
    // sends — and watch it fly home.
    const released = Date.now();
    await button(page, 'Remove 50 g').click();
    await expect(sidebar(page).getByText('200 g')).toBeVisible();
    await transfersIdle(page);
    expect(Date.now() - released, 'the disc vanished instead of moving').toBeGreaterThan(1500);

    // Exactly one instance left, and the lesson carries on from there.
    await expect(button(page, 'Remove 200 g')).toBeVisible();
    await expect(button(page, 'Remove 50 g')).toHaveCount(0);
    await button(page, 'Remove 200 g').click();
    await transfersIdle(page);
    for (const weight of ['+50g', '+20g', '+10g']) await button(page, weight).click();
    await expect(page.getByText('Pointer balanced!')).toBeVisible();
    await confirmStep(page);
    await dismissPopup(page);
    await expectStep(page, 7);
  });
});
