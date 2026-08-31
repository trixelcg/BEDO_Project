import { expect, test } from './fixture';
import { button, openApp, popup, pressCover, sidebar, stepBadge, stubApparatusModel } from './helpers';

/**
 * Language smoke test (BEDO-002 §8).
 *
 * Not a localisation audit — that is out of scope here. This proves both languages load,
 * that switching one flips the content and the direction flag, and that the training UI
 * stays usable in either.
 *
 * The language is also reflected on the document root. That is the contract assistive
 * technology and browser-native bidi handling consume; a component class alone is not
 * sufficient.
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
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
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
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

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
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('a lesson refusal is bilingual too, and is not the safety banner', async ({ page }) => {
  // BEDO-020 §10: the two refusals must stay distinguishable in both languages. This one
  // is a notice — nothing unsafe happened, the learner is simply off the current step.
  await openApp(page);
  await button(page, 'العربية').click();
  await pressCover(page); // step 1's own action, in Arabic
  await pressCover(page); // and again, which step 2 is not asking for

  const arabicPopup = popup(page);
  await expect(arabicPopup).toContainText('يرجى اتباع الخطوة الحالية أولاً.');
  await expect(arabicPopup).toHaveClass(/rtl/);
  await expect(arabicPopup).toHaveCSS('direction', 'rtl');

  await button(page, 'English').click();
  await expect(popup(page)).toContainText('Follow the highlighted step first.');
});

test('the deflector-scope refusal and the remove control are bilingual', async ({ page }) => {
  // BEDO-022 §26. Both surfaces BEDO-022 adds carry learner-facing text, so both have to
  // exist in Arabic and lay out right-to-left.
  await openApp(page);
  await button(page, 'العربية').click();
  await pressCover(page); // step 1 → 2

  await page.evaluate(() => window.__bedoTest!.selectDeflector(180));
  const arabicPopup = popup(page);
  await expect(arabicPopup).toContainText('هذه التجربة تستخدم عاكساً مختلفاً.');
  await expect(arabicPopup).toHaveClass(/rtl/);
  await expect(arabicPopup).toHaveCSS('direction', 'rtl');

  await button(page, 'English').click();
  await expect(popup(page)).toContainText('This experiment uses a different deflector.');

  // And the remove control, at the balance step.
  await button(page, 'العربية').click();
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole('button').dispatchEvent('click');
  await button(page, 'عاكس مسطح (90 درجة)').click();
  await page.locator('.ok-confirm-btn').click();
  await pressCover(page);
  await button(page, 'تشغيل المضخة').click();
  await page.locator('.valve-slider-container input[type="range"]').fill('0.4');
  await page.locator('.ok-confirm-btn').click();
  await popup(page).getByRole('button').dispatchEvent('click');

  await button(page, '+50g').click();
  await expect(button(page, 'إزالة 50 غرام')).toBeVisible();
  await button(page, 'إزالة 50 غرام').click();
  await expect(button(page, 'إزالة 50 غرام')).toHaveCount(0);
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
