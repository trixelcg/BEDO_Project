import { expect, test } from '@playwright/test';
import { button, openApp, popup, pressCover, sidebar, stepBadge, stubApparatusModel } from './helpers';

/**
 * Language smoke test (BEDO-002 §8).
 *
 * Not a localisation audit — that is out of scope here. This proves both languages load,
 * that switching one flips the content and the direction flag, and that the training UI
 * stays usable in either.
 *
 * A limitation of today's app is asserted honestly rather than wished away: the only
 * element that actually receives `direction: rtl` is the popup. The `rtl` class is set on
 * the overlay and the monitor as well, but no stylesheet rule matches it, and neither
 * `<html dir>` nor `<html lang>` changes with the language. That gap is recorded in
 * `docs/25` and remains the audit's BUG-09.
 */

const AR_STEP_1 = 'فك اللوحة العلوية';
const EN_STEP_1 = 'Unscrew the upper plate';

test.beforeEach(async ({ page }) => {
  await stubApparatusModel(page);
});

test('English is the language the lesson opens in', async ({ page }) => {
  await openApp(page);

  await expect(page.getByRole('heading', { name: EN_STEP_1 })).toBeVisible();
  await expect(stepBadge(page)).toHaveText('Step 1 / 11');
  await expect(sidebar(page).getByText('Measurement of Jet Forces')).toBeVisible();
  await expect(page.locator('.ui-container')).not.toHaveClass(/rtl/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('Arabic loads, flips the direction flag, and keeps the training UI usable', async ({
  page,
}) => {
  await openApp(page);

  await button(page, 'العربية').click();

  // Content is Arabic...
  await expect(page.getByRole('heading', { name: AR_STEP_1 })).toBeVisible();
  await expect(stepBadge(page)).toHaveText('الخطوة 1 / 11');
  await expect(sidebar(page).getByText('قياس قوة نفث الماء')).toBeVisible();

  // ...and the overlay is marked right-to-left.
  await expect(page.locator('.ui-container')).toHaveClass(/rtl/);

  // The lesson still runs: step 1 completes and step 2 is announced in Arabic.
  await pressCover(page);
  await expect(stepBadge(page)).toHaveText('الخطوة 2 / 11');
  await expect(page.getByRole('heading', { name: 'تثبيت العاكس' })).toBeVisible();
  await expect(page.locator('.ok-confirm-btn')).toHaveText('موافق');
});

test('a guard message renders right-to-left in Arabic and left-to-right in English', async ({
  page,
}) => {
  await openApp(page);
  await button(page, 'العربية').click();
  await button(page, 'الوضع الحر').click(); // Free mode
  await pressCover(page);
  await button(page, '+50g').click();

  const arabicPopup = popup(page);
  await expect(arabicPopup).toContainText('لا يمكن إضافة الأوزان أثناء فتح الخزان.');
  await expect(arabicPopup).toHaveClass(/rtl/);
  await expect(arabicPopup).toHaveCSS('direction', 'rtl');

  // Switching back restores English text and left-to-right flow.
  await button(page, 'English').click();
  const englishPopup = popup(page);
  await expect(englishPopup).toContainText('You can’t add weights while the tank is open.');
  await expect(englishPopup).not.toHaveClass(/rtl/);
  await expect(englishPopup).toHaveCSS('direction', 'ltr');
  await expect(page.locator('.ui-container')).not.toHaveClass(/rtl/);
});

test('the software monitor opens in Arabic', async ({ page }) => {
  await openApp(page);
  await button(page, 'العربية').click();
  await button(page, 'الوضع الحر').click(); // Free mode exposes the monitor immediately

  await button(page, 'فتح شاشة البيانات').click();

  const monitor = page.locator('.monitor-fullscreen');
  await expect(monitor).toBeVisible();
  await expect(monitor).toHaveClass(/rtl/);
  await expect(page.getByRole('heading', { name: 'شاشة برنامج المراقبة' })).toBeVisible();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(4);
});
