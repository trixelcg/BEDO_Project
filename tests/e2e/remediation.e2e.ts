import { expect, test } from './fixture';
import {
  button,
  openApp,
  panMassG,
  pressCover,
  setValve,
  sidebar,
  stepBadge,
  dismissPopup,
  confirmStep,
  expectStep,
} from './helpers';
import { FIRST_READING_VALVE, SECOND_READING_VALVE } from '../../src/domain/physics';

/**
 * The defects the QA pass reported, in a real browser (brief §7).
 *
 * The jsdom suite proves the state machine and the markup; these prove the things only a
 * browser can answer — that the chart actually paints, that a disabled control is really
 * disabled, that a stopwatch really runs, and that the Arabic build is not a different
 * application with the same logic.
 *
 * Every wait is on application state. There are no sleeps except the two that time a
 * genuinely elapsing measurement, and those wait on the displayed value rather than on a
 * clock of their own.
 */

/** Works through to the first balance step, leaving the pan empty. */
const reachBalance = async (page: import('@playwright/test').Page) => {
  await openApp(page);
  await pressCover(page); //            1 unscrew
  await confirmStep(page); //           2 install
  await pressCover(page); //            3 mount
  await button(page, /Turn On Pump/).click(); // 4 power
  await setValve(page, FIRST_READING_VALVE); //  5 flow
  await confirmStep(page);
  await dismissPopup(page);
  await expectStep(page, 6);
};

test.describe('§1.1 — a reading is recorded, never accumulated', () => {
  test('the counter does not move while the pan is being loaded', async ({ page }) => {
    await reachBalance(page);
    const counter = sidebar(page).getByText(/Recorded readings/);
    await expect(counter).toContainText('0 / 2');

    for (const disc of ['Add 50 g', 'Add 20 g']) {
      await button(page, disc).click();
      await expect(counter).toContainText('0 / 2');
    }

    // Balanced, and still not recorded — the counter used to have reached 2 / 2 by now.
    await button(page, 'Add 10 g').click();
    await expect(page.getByText('Pointer balanced')).toBeVisible();
    await expect(counter).toContainText('0 / 2');

    await button(page, 'Record reading').click();
    await expect(counter).toContainText('1 / 2');
  });

  test('Record is disabled until the pointer balances', async ({ page }) => {
    await reachBalance(page);
    const record = button(page, 'Record reading');
    await expect(record).toBeDisabled();

    await button(page, 'Add 50 g').click();
    await expect(record).toBeDisabled();

    await button(page, 'Add 20 g').click();
    await button(page, 'Add 10 g').click();
    await expect(record).toBeEnabled();
  });

  test('the balance readout says which way and by how much', async ({ page }) => {
    await reachBalance(page);
    const hint = page.locator('.balance-bar-figures');
    await expect(hint).toContainText('add 84 g');

    await button(page, 'Add 100 g').click();
    await expect(hint).toContainText('remove 16 g');
  });
});

test.describe('§1.2 — the table holds only what was recorded', () => {
  test('dragging the flow valve across its range writes no row', async ({ page }) => {
    await openApp(page);
    await button(page, 'Free Mode').click();
    await button(page, /Turn On Pump/).click();

    for (const n of [0.1, 0.3, 0.5, 0.62, 0.8, 1, 0.2]) await setValve(page, n);

    await button(page, 'Open Data Monitor').click();
    await expect(page.locator('.data-table tbody tr')).toHaveCount(1);
    // The empty-state row, and no sign of the 43.457 L/min row that used to be generated.
    await expect(page.locator('.data-table-empty')).toBeVisible();
    await expect(page.locator('.data-table')).not.toContainText('43.457');
  });
});

test.describe('§1.6 — the weights panel never moves under the pointer', () => {
  test('every button keeps its position as discs go on and come off', async ({ page }) => {
    await reachBalance(page);

    const boxOf = async (name: string) => {
      const box = await button(page, name).boundingBox();
      expect(box, `${name} is not on screen`).not.toBeNull();
      return box!;
    };

    const before = await boxOf('Add 20 g');
    await button(page, 'Add 50 g').click();
    const afterOne = await boxOf('Add 20 g');
    await button(page, 'Add 500 g').click();
    const afterTwo = await boxOf('Add 20 g');

    // The reported failure was a ~56 px jump the moment the first disc landed, which made
    // the next click land on a different denomination.
    expect(Math.abs(afterOne.y - before.y)).toBeLessThan(1);
    expect(Math.abs(afterTwo.y - before.y)).toBeLessThan(1);
    expect(Math.abs(afterOne.x - before.x)).toBeLessThan(1);
  });
});

test.describe('§1.4 / §5 — the chart draws', () => {
  test('the theoretical curve is painted as soon as the monitor opens', async ({ page }) => {
    await openApp(page);
    await button(page, 'Free Mode').click();
    await button(page, 'Open Data Monitor').click();

    // Docked, which is how it always opens — and where the plot used to be display:none.
    await expect(page.locator('.monitor-docked')).toBeVisible();
    const curve = page.locator('[data-testid="chart-theoretical"]');
    await expect(curve).toBeVisible();

    // A real path with real length, not an empty `d`.
    const length = await curve.evaluate((el) => (el as unknown as SVGPathElement).getTotalLength());
    expect(length).toBeGreaterThan(50);

    const box = await page.locator('.plot-canvas svg').boundingBox();
    expect(box!.height).toBeGreaterThan(80);
  });
});

test.describe('§3.6 — the volumetric tank measures a flow', () => {
  test('the stopwatch runs and Q = ΔV/Δt converges on the flowmeter', async ({ page }) => {
    await openApp(page);
    await button(page, 'Free Mode').click();
    await button(page, /Turn On Pump/).click();
    await setValve(page, SECOND_READING_VALVE);

    const elapsed = page.locator('.vol-cell').filter({ hasText: /Time/ }).locator('.vol-val');
    const measured = page.locator('.vol-cell-accent .vol-val');

    // The tank collects while the dump valve is shut, which is how it rests.
    await expect(page.locator('.vol-badge')).toContainText('COLLECTING');
    await expect(elapsed).not.toHaveText('0.0 s');

    // Let it settle past the point where reaction time dominates the arithmetic.
    await expect(measured).not.toHaveText('—', { timeout: 15_000 });
    const q = Number((await measured.textContent())!.replace(/[^\d.]/g, ''));
    expect(q).toBeGreaterThan(20);
    expect(q).toBeLessThan(34);

    // Opening it empties the tank and stops the clock — the control that used to do nothing.
    await button(page, /Open the dump valve/i).click();
    await expect(page.locator('.vol-badge')).toContainText('EMPTY');
    await expect(elapsed).toHaveText('0.0 s');
  });
});

test.describe('§4 — the HUD and the dialogs', () => {
  test('the toolbar stands down behind the monitor and comes back', async ({ page }) => {
    await openApp(page);
    await button(page, 'Free Mode').click();
    await expect(page.locator('.guided-footer, .sidebar-panel').first()).toBeVisible();

    await button(page, 'Open Data Monitor').click();
    await expect(page.locator('.ui-container.has-overlay')).toBeAttached();

    await button(page, /^Close$/).click();
    await expect(page.locator('.ui-container.has-overlay')).toHaveCount(0);
  });

  test('the walkthrough video closes on Escape', async ({ page }) => {
    // It could not be closed at all: it rendered inside a layer that withholds pointer
    // events, and had no key handler.
    await openApp(page);
    await button(page, /^Video$/).click();
    await expect(page.getByTestId('video-modal')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('video-modal')).toHaveCount(0);
  });

  test('clicking the printed board takes the camera to it', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.ui-container.is-board-view')).toHaveCount(0);
    await button(page, /^Board$/).click();
    await expect(page.locator('.ui-container.is-board-view')).toBeAttached();
    // Back to Step stays reachable — the one control the toolbar must never cover.
    await expect(button(page, /Back to Step/)).toBeVisible();
  });
});

test.describe('§7 — a half-finished run survives a reload', () => {
  test('offers Resume, and returns the learner to their own rig', async ({ page }) => {
    await reachBalance(page);
    await button(page, 'Add 50 g').click();
    expect(await panMassG(page)).toBe(50);

    await page.reload();

    await expect(page.getByTestId('intro-resume')).toBeVisible();
    await expect(page.getByTestId('intro-resume')).toContainText('step 6 of 11');
    await button(page, 'Resume').click();

    await expect(stepBadge(page)).toHaveText('Step 6 / 11');
    expect(await panMassG(page)).toBe(50);
  });

  test('Start again discards it', async ({ page }) => {
    await reachBalance(page);
    await button(page, 'Add 50 g').click();
    await page.reload();

    await button(page, 'Start again').click();
    await expect(stepBadge(page)).toHaveText('Step 1 / 11');

    await page.reload();
    await expect(page.getByTestId('intro-resume')).toHaveCount(0);
  });
});

test.describe('the whole procedure, in Arabic', () => {
  test('runs end to end with the interface mirrored', async ({ page }) => {
    await openApp(page);
    await button(page, /العربية/).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

    await pressCover(page); //            1
    await confirmStep(page); //           2
    await pressCover(page); //            3
    await button(page, /تشغيل المضخة/).click(); // 4
    await setValve(page, FIRST_READING_VALVE); //  5
    await confirmStep(page);
    await dismissPopup(page);

    for (const disc of [/إضافة 50 غرام/, /إضافة 20 غرام/, /إضافة 10 غرام/]) {
      await button(page, disc).click();
    }
    await expect(page.getByText('المؤشر متوازن')).toBeVisible();
    await confirmStep(page); //           6
    await dismissPopup(page);

    await setValve(page, SECOND_READING_VALVE); // 7
    await confirmStep(page);
    await dismissPopup(page);
    for (const disc of [
      /إضافة 100 غرام/,
      /إضافة 50 غرام/,
      /إضافة 20 غرام/,
      /إضافة 10 غرام/,
    ]) {
      await button(page, disc).click();
    }
    await confirmStep(page); //           8
    await dismissPopup(page);

    await button(page, /فتح شاشة البيانات/).click(); // 9
    await button(page, /احسب/).click(); //             10
    await dismissPopup(page);

    await expect(stepBadge(page)).toHaveText('الخطوة 11 / 11');
    await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
  });

  test('no Arabic label is clipped by the box it sits in', async ({ page }) => {
    // §4.8. Buttons wrap rather than clipping, and the floor is 14 px — a label whose text
    // is wider than its own box is one a learner cannot read.
    await openApp(page);
    await button(page, /العربية/).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const clipped = await page.evaluate(() => {
      const bad: string[] = [];
      document
        .querySelectorAll<HTMLElement>('.guided-footer-btn, .btn-primary, .btn-secondary')
        .forEach((el) => {
          if (el.offsetParent === null) return;
          // A couple of pixels of slack for sub-pixel layout.
          if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) {
            bad.push(el.textContent?.trim().slice(0, 40) ?? '(unnamed)');
          }
        });
      return bad;
    });
    expect(clipped).toEqual([]);
  });
});
