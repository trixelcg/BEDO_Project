import { expect, test } from '@playwright/test';
import {
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
    await expect(button(page, 'Open volumetric valve')).toBeVisible();
    await button(page, 'Open volumetric valve').click();
    await expectStep(page, 5);

    // 5 — open the flow valve to the first reading setpoint
    await setValve(page, 0.4);
    await expect(page.getByText('40%')).toBeVisible();
    await confirmStep(page);
    await dismissPopup(page); // "the water jet pushes the deflector upward"
    await expectStep(page, 6);

    // 6 — balance the pointer, reading 1 (target 80 g)
    await expect(page.getByText(/Unbalanced \(target ≈ 80 g\)/)).toBeVisible();
    await expect(okButton(page)).toHaveCount(0);
    for (const weight of ['+50g', '+20g', '+10g']) {
      await button(page, weight).click();
    }
    await expect(page.getByText('Pointer balanced!')).toBeVisible();
    await confirmStep(page);
    await dismissPopup(page); // "the shape of water impinging the deflector"
    await expectStep(page, 7);

    // 7 — increase the flow to the second setpoint
    await setValve(page, 0.5);
    await expect(page.getByText('50%')).toBeVisible();
    await confirmStep(page);
    await dismissPopup(page);
    await expectStep(page, 8);

    // 8 — balance the pointer, reading 2 (target 260 g)
    await expect(page.getByText(/Unbalanced \(target ≈ 260 g\)/)).toBeVisible();
    for (const weight of ['+200g', '+50g', '+10g']) {
      await button(page, weight).click();
    }
    await expect(page.getByText('Pointer balanced!')).toBeVisible();
    await confirmStep(page);
    await expectStep(page, 9);

    // 9 — open the software monitor
    await expect(sidebar(page).getByText('2 / 2')).toBeVisible(); // both readings taken
    await button(page, 'Open Data Monitor').click();
    await expect(page.locator('.monitor-fullscreen')).toBeVisible();
    await expectStep(page, 10);

    // 10 — record the actual force
    const rows = page.locator('.data-table tbody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1).locator('td').nth(7)).toHaveText('—'); // F_ac not yet recorded
    await button(page, 'Calculate').click();
    await expect(button(page, 'F_ac recorded')).toBeDisabled();
    await dismissPopup(page);
    await expectStep(page, 11);

    // The table now holds both readings and their measured force.
    await expect(rows.nth(1).locator('td').nth(5)).toHaveText('80');
    await expect(rows.nth(2).locator('td').nth(5)).toHaveText('260');
    await expect(rows.nth(1).locator('td').nth(6)).toHaveText('0.8199'); // F_th, BEDO n = 0.4
    await expect(rows.nth(2).locator('td').nth(6)).toHaveText('2.5303'); // F_th, n = 0.5
    await expect(rows.nth(1).locator('td').nth(7)).toHaveText('0.7848'); // F_ac = 80 g x g
    await expect(rows.nth(2).locator('td').nth(7)).toHaveText('2.5506'); // F_ac = 260 g x g

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
    await setValve(page, 0.4);
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
    await button(page, 'Open volumetric valve').click();
    await expectStep(page, 2);

    // And the lesson continues normally from the step it was always on.
    await button(page, 'Flat surface (90°)').click();
    await confirmStep(page);
    await expectStep(page, 3);
    await pressCover(page);
    await expectStep(page, 4);
    await expect(sidebar(page).getByText('Closed', { exact: true })).toBeVisible();
  });

  test('refuses an unsafe action and says why', async ({ page }) => {
    await openApp(page);
    await pressCover(page);
    await expectStep(page, 2);

    // Free mode puts the weights on the panel while the tank is still open.
    await button(page, 'Free Mode').click();
    await button(page, '+50g').click();

    await expect(page.locator('.warning-popup')).toContainText(
      'You can’t add weights while the tank is open.'
    );
    await expect(page.getByText('0 g')).toBeVisible();
  });
});
