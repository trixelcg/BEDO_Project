import { FIRST_READING_VALVE, SECOND_READING_VALVE } from '../../src/domain/physics';
import { expect, test } from './fixture';
import {
  panMassG,
  button,
  confirmStep,
  currentStep,
  dismissPopup,
  expectStep,
  okButton,
  openApp,
  stubApparatusModel,
  pressCover,
  setValve,
  sidebar,
  stepBadge,
} from './helpers';

/**
 * The canonical eleven-step lesson, in a real browser.
 *
 * The goal is not pixel fidelity — it is proof that the lesson is still completable end
 * to end against the real bundle, the real DOM and the real WebGL page. Every transition
 * goes through the lesson engine: the OK button only appears when the engine says the
 * step is satisfied, and the test asserts the step number after each one.
 *
 * The only affordance driven other than by clicking the page is the tank cover, which
 * exists solely as a mesh inside the canvas; see `pressCover`.
 */

test.describe('guided walkthrough', () => {
  test.beforeEach(async ({ page }) => {
    await stubApparatusModel(page);
  });

  test('completes all eleven steps of Exp. 1 and opens the answer sheet', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await openApp(page);
    await expect(stepBadge(page)).toHaveText('Step 1 / 11');
    await expect(page.getByRole('heading', { name: 'Unscrew the upper plate' })).toBeVisible();

    // 1 — unscrew the upper plate
    await pressCover(page);
    await expectStep(page, 2);
    await expect(sidebar(page).getByText('Tank cover:')).toBeVisible();
    await expect(sidebar(page).getByText('Open', { exact: true })).toBeVisible();

    // 2 — install the deflector
    await expect(page.getByRole('heading', { name: 'Install the deflector' })).toBeVisible();
    await button(page, 'Flat surface (90°)').click();
    await confirmStep(page);
    await expectStep(page, 3);

    // 3 — screw the tank cover back on
    await pressCover(page);
    await expectStep(page, 4);
    await expect(sidebar(page).getByText('Closed', { exact: true })).toBeVisible();

    // 4 — power switch
    await button(page, 'Turn On Pump').click();
    await expectStep(page, 5);

    // The volumetric valve is no longer a step — it is an affordance, still on the panel
    // and still operable, and operating it must not move the lesson (`docs/35 §3`).
    await expect(button(page, /dump valve/i)).toBeVisible();
    await button(page, /dump valve/i).click();
    await expectStep(page, 5);

    // 5 — open the flow valve to the first reading setpoint
    await setValve(page, FIRST_READING_VALVE);
    await expect(page.getByText('54%')).toBeVisible(); // the first setpoint, 0.536
    await confirmStep(page);
    await dismissPopup(page); // "the water jet pushes the deflector upward"
    await expectStep(page, 6);

    // 6 — balance the pointer, reading 1 (83.6 g required, 80 g reachable)
    await expect(page.getByText('Unbalanced')).toBeVisible();
    await expect(page.locator('.balance-bar-figures')).toContainText('add 84 g');
    await expect(okButton(page)).toHaveCount(0);
    for (const weight of ['Add 50 g', 'Add 20 g', 'Add 10 g']) {
      await button(page, weight).click();
    }
    await expect(page.getByText('Pointer balanced')).toBeVisible();
    await confirmStep(page);
    await dismissPopup(page); // "the shape of water impinging the deflector"
    await expectStep(page, 7);

    // 7 — increase the flow to the second setpoint
    await setValve(page, SECOND_READING_VALVE);
    await expect(page.getByText('77%')).toBeVisible(); // the second setpoint, 0.770
    await confirmStep(page);
    await dismissPopup(page);
    await expectStep(page, 8);

    // 8 — balance the pointer, reading 2. The pan is cumulative: it still carries the
    // 80 g from reading 1, and 257.9 g is now needed, so 180 g goes on.
    await expect(page.locator('.balance-bar-figures')).toContainText('add 178 g');
    for (const weight of ['Add 100 g', 'Add 50 g', 'Add 20 g', 'Add 10 g']) {
      await button(page, weight).click();
    }
    await expect(page.getByText('Pointer balanced')).toBeVisible();
    await confirmStep(page);
    await expectStep(page, 9);

    // 9 — open the software monitor
    await expect(sidebar(page).getByText('2 / 2')).toBeVisible(); // both readings taken
    await button(page, 'Open Data Monitor').click();
    // Docked, not fullscreen: BEDO-UX-12C opens the board beside the apparatus so the
    // learner can keep working while reading it. Fullscreen is opt-in from `Expand`.
    await expect(page.locator('.monitor-docked')).toBeVisible();
    await expectStep(page, 10);

    // 10 — record the actual force
    // Two rows, one per recorded reading — not the four the fixed valve settings used to
    // generate whether or not anyone had taken them.
    const rows = page.locator('.data-table tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('td').nth(7)).toHaveText('—'); // F_ac not yet recorded
    await button(page, 'Calculate').click();
    await expect(button(page, 'F_ac recorded')).toBeDisabled();
    await dismissPopup(page);
    await expectStep(page, 11);

    // The table now holds both readings and their measured force.
    await expect(rows.nth(0).locator('td').nth(5)).toHaveText('80');
    await expect(rows.nth(1).locator('td').nth(5)).toHaveText('260');
    await expect(rows.nth(0).locator('td').nth(6)).toHaveText('0.8199'); // F_th, BEDO n = 0.4
    await expect(rows.nth(1).locator('td').nth(6)).toHaveText('2.5303'); // F_th, n = 0.5
    await expect(rows.nth(0).locator('td').nth(7)).toHaveText('0.7848'); // F_ac = 80 g x g
    await expect(rows.nth(1).locator('td').nth(7)).toHaveText('2.5506'); // F_ac = 260 g x g

    // The assessment is still here, and still unnumbered.
    await expect(
      page.getByText('If the flow velocity doubles, how does the force change?')
    ).toBeVisible();
    await button(page, 'It quadruples').click();
    await expect(page.getByText(/Correct\./)).toBeVisible();

    // 11 — the closing step: open the answer sheet
    await expect(stepBadge(page)).toHaveText('Step 11 / 11');
    await page.locator('.monitor-header').getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByRole('heading', { name: 'You finished!' })).toBeVisible();

    await button(page, 'Open the answer sheet').click();
    const sheet = page.getByTestId('answer-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('iframe')).toHaveAttribute('src', '/answer-sheets/flat.pdf');

    // Closable — not a dead end.
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);

    // Eleven steps, and a completion state rather than a twelfth.
    await expect(page.getByTestId('lesson-complete')).toBeVisible();
    expect(await currentStep(page)).toBe(11);

    expect(errors, `page errors during the lesson:\n${errors.join('\n')}`).toEqual([]);
  });

  test('holds the lesson until each step is actually satisfied', async ({ page }) => {
    await openApp(page);

    // Step 1 offers no confirm at all — the plate has to be pressed.
    await expect(okButton(page)).toHaveCount(0);
    await pressCover(page);
    await expectStep(page, 2);
    await expect(okButton(page)).toBeVisible();

    await confirmStep(page);
    await pressCover(page);
    await button(page, 'Turn On Pump').click();
    await expectStep(page, 5);

    // Step 5 will not confirm below the reading setpoint.
    await setValve(page, 0.15);
    await expect(okButton(page)).toHaveCount(0);
    await setValve(page, FIRST_READING_VALVE);
    await expect(okButton(page)).toBeVisible();
  });

  /**
   * BUG-04, in a real browser (BEDO-020 §28).
   *
   * The tank cover is the one affordance that exists only as a mesh, so pressing it is a
   * genuine 3D interaction — the same handler the hotspot calls, reached without guessing
   * a coordinate inside the canvas. At step 2 closing it again is mechanically fine and
   * simply not what the step is asking for, which is exactly the case that used to slip
   * through.
   */
  test('refuses a wrong-step 3D interaction, then carries on', async ({ page }) => {
    await openApp(page);

    await pressCover(page);
    await expectStep(page, 2);
    await expect(sidebar(page).getByText('Open', { exact: true })).toBeVisible();

    // Wrong step. The rig would allow it; the lesson does not.
    await pressCover(page);
    await expect(page.locator('.warning-popup')).toContainText('Follow the highlighted step first.');
    await expectStep(page, 2);
    await expect(sidebar(page).getByText('Open', { exact: true })).toBeVisible();
    await dismissPopup(page);

    // The valve is always available, so it is *not* refused here — and does not advance.
    await button(page, /dump valve/i).click();
    await expectStep(page, 2);

    // And the lesson continues normally from the step it was always on.
    await button(page, 'Flat surface (90°)').click();
    await confirmStep(page);
    await expectStep(page, 3);
    await pressCover(page);
    await expectStep(page, 4);
    await expect(sidebar(page).getByText('Closed', { exact: true })).toBeVisible();
  });

  /**
   * BUG-05, in a real browser (BEDO-022 §24).
   *
   * Exp. 1's worksheet prints F = ρAV². Installing the 180° hemisphere doubles the
   * momentum factor and every number in the table with it, while the header, the formula
   * and the answer sheet all still say Exp. 1. The tray offers all seven discs whatever
   * sheet is loaded, so refusing the wrong one is the only thing that keeps the run
   * honest.
   */
  test('refuses another experiment’s deflector, then computes the right force', async ({
    page,
  }) => {
    await openApp(page);

    await pressCover(page);
    await expectStep(page, 2);

    // The panel offers only the disc Exp. 1 is run with — and, since BEDO-022, so does
    // the gate behind the tray.
    await expect(button(page, 'Flat surface (90°)')).toBeVisible();
    await expect(button(page, 'Semi-circular (180°)')).toHaveCount(0);

    // Reach past the panel the way the 3D tray would, and be refused.
    await page.evaluate(() => window.__bedoTest!.selectDeflector(180));
    await expect(page.locator('.warning-popup')).toContainText(
      'This experiment uses a different deflector.'
    );
    await expectStep(page, 2);
    await dismissPopup(page);

    // Exp. 1's own disc is accepted and the step completes.
    await button(page, 'Flat surface (90°)').click();
    await confirmStep(page);
    await expectStep(page, 3);

    // Carry on to the table and check the force is the one F = ρAV² gives.
    await pressCover(page);
    await button(page, 'Turn On Pump').click();
    await setValve(page, FIRST_READING_VALVE);
    await confirmStep(page);
    await dismissPopup(page);
    for (const weight of ['Add 50 g', 'Add 20 g', 'Add 10 g']) await button(page, weight).click();
    await confirmStep(page);
    await dismissPopup(page);
    await setValve(page, SECOND_READING_VALVE);
    await confirmStep(page);
    await dismissPopup(page);
    for (const weight of ['Add 200 g', 'Add 50 g', 'Add 10 g']) await button(page, weight).click();
    await confirmStep(page);
    await expectStep(page, 9);
    await button(page, 'Open Data Monitor').click();

    const rows = page.locator('.data-table tbody tr');
    // k = 1.0. With the 180° disc these would read 1.6398 and 5.0606.
    await expect(rows.nth(1).locator('td').nth(6)).toHaveText('0.8199');
    await expect(rows.nth(2).locator('td').nth(6)).toHaveText('2.5303');
  });

  /**
   * Taking one disc off the holder (BEDO-022 §25).
   *
   * Storyboard sl. 32: *"Click on the weight on holder — the weight removed from the tank
   * holder in 2 sec."* Before this the only way back was clearing the whole tray.
   */
  test('removes a single weight and leaves the others on the holder', async ({ page }) => {
    await openApp(page);
    await pressCover(page);
    await button(page, 'Flat surface (90°)').click();
    await confirmStep(page);
    await pressCover(page);
    await button(page, 'Turn On Pump').click();
    await setValve(page, FIRST_READING_VALVE);
    await confirmStep(page);
    await dismissPopup(page);
    await expectStep(page, 6); // balance reading 1, target 80 g

    // Overshoot, the way a learner does.
    await button(page, 'Add 200 g').click();
    await button(page, 'Add 50 g').click();
    expect(await panMassG(page)).toBe(250);
    await expect(okButton(page)).toHaveCount(0);

    // Take off only the 200 g disc. The 50 g one stays.
    await button(page, 'Remove 200 g').click();
    expect(await panMassG(page)).toBe(50);
    await expect(button(page, 'Remove 50 g')).toBeEnabled();
    // Every denomination keeps its row: the minus is disabled, not removed, so the panel
    // never reflows under the pointer.
    await expect(button(page, 'Remove 200 g')).toBeDisabled();

    // Two identical discs are two discs: add a second 10 g and take one back off.
    await button(page, 'Add 10 g').click();
    await button(page, 'Add 10 g').click();
    expect(await panMassG(page)).toBe(70);
    await button(page, 'Remove 10 g').click();
    expect(await panMassG(page)).toBe(60);

    // Finish balancing and carry on — the derived state followed every removal.
    await button(page, 'Add 20 g').click();
    await expect(page.getByText('Pointer balanced')).toBeVisible();
    await confirmStep(page);
    await dismissPopup(page);
    await expectStep(page, 7);
  });

  test('refuses an unsafe action and says why', async ({ page }) => {
    await openApp(page);
    await pressCover(page);
    await expectStep(page, 2);

    // Free mode puts the weights on the panel while the tank is still open.
    await button(page, 'Free Mode').click();
    await button(page, 'Add 50 g').click();

    await expect(page.locator('.warning-popup')).toContainText(
      'You can’t add weights while the tank is open.'
    );
    expect(await panMassG(page)).toBe(0);
  });
});
