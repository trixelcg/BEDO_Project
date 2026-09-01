import { expect, test } from './fixture';
import { stubApparatusModel } from './helpers';

/**
 * The loading screen, asserted in a real browser (BEDO-UX-04).
 *
 * jsdom can prove the overlay is in the DOM, and that is exactly the evidence that let a
 * defect ship: the previous version was mounted, correct, and effectively invisible to the
 * user. So the assertion here is about PAINT — the overlay must reach at least one frame
 * that a person could actually see, and it must still be opaque while the scene is
 * unfinished.
 */

test.beforeEach(async ({ page }) => {
  await stubApparatusModel(page);
  // Hold the loading state open long enough to assert against it. The stubbed model
  // resolves almost instantly, so without this the scene is ready before the first
  // assertion runs and the test races the reveal. The delay is in the test's network
  // layer only — no production timing is involved.
  await page.route('**/Bedo_baked_v2.glb', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fallback();
  });
});

test('the loading screen reaches a painted frame before the experience is revealed', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'commit' });

  /**
   * One atomic snapshot of the loading state.
   *
   * Everything is read in a single evaluate, polled until the overlay is painted. Asserting
   * these as a sequence of separate locator expectations raced the reveal: each assertion
   * has its own timeout, and by the third the scene had loaded and the overlay was gone.
   */
  const snapshot = () =>
    page.evaluate(() => {
      const el = document.querySelector('.loading-screen');
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const centre = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return {
        area: box.width * box.height,
        opacity: Number(getComputedStyle(el).opacity),
        coversCentre: !!centre?.closest('.loading-screen'),
        // The mark is an image now, so "is it painted" is `complete` plus a non-zero
        // intrinsic width — an <img> whose src 404s is still in the DOM and still has an
        // alt, and that must not read as branded.
        mark: (() => {
          const img = el.querySelector('.loading-mark') as HTMLImageElement | null;
          if (!img) return null;
          return `${img.alt}:${img.complete && img.naturalWidth > 0 ? 'loaded' : 'broken'}`;
        })(),
        hasTitle: !!el.querySelector('.loading-title')?.textContent,
        segments: el.querySelectorAll('.loading-seg').length,
        showsPercent: /\d+%/.test(el.textContent ?? ''),
      };
    });

  await expect
    .poll(snapshot, { message: 'the overlay must reach a painted, branded frame' })
    .toEqual({
      area: expect.any(Number),
      // Fully opaque: the unfinished scene must never show through.
      opacity: 1,
      coversCentre: true,
      // The branding is what makes this read as a loading state rather than a blank page.
      mark: 'BEDO:loaded',
      hasTitle: true,
      // Progress is by phase, and no percentage is ever claimed.
      segments: 2,
      showsPercent: false,
    });

  const { area } = (await snapshot())!;
  expect(area, 'the overlay must cover a real area').toBeGreaterThan(100_000);

  // It goes away on its own, and only once the scene is genuinely ready.
  await expect(page.locator('[data-bedo-scene-ready]')).toHaveCount(1, { timeout: 120_000 });
  await expect(page.locator('.loading-screen')).toHaveCount(0, { timeout: 15_000 });
});

test('the interface behind the overlay cannot be reached while it is loading', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('.loading-screen')).toBeVisible();

  const shellInert = await page.evaluate(
    () => document.querySelector('.app-container > div[style*="contents"]')?.hasAttribute('inert') ?? null
  );
  expect(shellInert, 'the shell is inert until the reveal').toBe(true);

  await expect(page.locator('[data-bedo-scene-ready]')).toHaveCount(1, { timeout: 120_000 });
  await expect(page.locator('.loading-screen')).toHaveCount(0, { timeout: 15_000 });
  expect(
    await page.evaluate(
      () => document.querySelector('.app-container > div[style*="contents"]')?.hasAttribute('inert')
    ),
    'and interactive immediately afterwards'
  ).toBe(false);
});
