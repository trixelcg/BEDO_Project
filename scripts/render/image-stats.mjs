/**
 * Image statistics for the render comparison, decoded through a real browser.
 *
 * Every number the material work is judged on comes from here, so that "the floor got
 * brighter" is a measurement rather than an impression. Decoding runs in Chromium because
 * the project already depends on Playwright and the alternative is a hand-rolled PNG/JPEG
 * decoder whose correctness would itself need proving.
 *
 * Luminance is Rec.709 on the **displayed** 8-bit values, deliberately. These images are
 * what a learner sees after tone mapping and the sRGB transfer, and the question Stage B
 * asks — does this surface read as steel — is a question about that displayed result, not
 * about scene-referred radiance.
 *
 * Saturation is the mean of `(max - min) / max` over non-black pixels, which is HSV
 * saturation. It is the number that answers "is this metal picking up a colour cast",
 * because a neutral conductor reflecting a neutral room lands near zero however bright it is.
 */

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/** Percentile from a 256-bin histogram, in display units. */
const percentile = (histogram, total, fraction) => {
  let seen = 0;
  const target = total * fraction;
  for (let i = 0; i < 256; i++) {
    seen += histogram[i];
    if (seen >= target) return i;
  }
  return 255;
};

/**
 * Measure a set of PNGs.
 *
 * `crop` is an optional [x, y, w, h] in normalised 0..1 coordinates, so the same crop
 * follows a 1920x1080 frame regardless of how it was captured.
 */
export async function measureImages(files, { crop = null } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const out = {};
  try {
    for (const file of files) {
      const b64 = fs.readFileSync(file).toString('base64');
      out[path.basename(file, '.png')] = await page.evaluate(
        async ({ b64, crop }) => {
          const img = new Image();
          img.src = 'data:image/png;base64,' + b64;
          await img.decode();
          const sx = crop ? Math.round(crop[0] * img.width) : 0;
          const sy = crop ? Math.round(crop[1] * img.height) : 0;
          const sw = crop ? Math.round(crop[2] * img.width) : img.width;
          const sh = crop ? Math.round(crop[3] * img.height) : img.height;
          const canvas = document.createElement('canvas');
          canvas.width = sw;
          canvas.height = sh;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          const px = ctx.getImageData(0, 0, sw, sh).data;

          const histogram = new Array(256).fill(0);
          let sum = 0;
          let sumSquares = 0;
          let saturationSum = 0;
          let saturationCount = 0;
          let rSum = 0;
          let gSum = 0;
          let bSum = 0;
          const total = px.length / 4;
          for (let i = 0; i < px.length; i += 4) {
            const r = px[i];
            const g = px[i + 1];
            const b = px[i + 2];
            const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            histogram[Math.round(l)]++;
            sum += l;
            sumSquares += l * l;
            rSum += r;
            gSum += g;
            bSum += b;
            const max = Math.max(r, g, b);
            if (max > 8) {
              saturationSum += (max - Math.min(r, g, b)) / max;
              saturationCount++;
            }
          }
          const mean = sum / total;
          // Black clipping counts pixels at 0..2, not at 0 alone: the difference between a
          // pixel at 1 and a pixel at 0 is invisible, and a surface reading 2/255 has lost
          // its form just as completely as one reading 0.
          let black = 0;
          for (let i = 0; i <= 2; i++) black += histogram[i];
          let white = 0;
          for (let i = 253; i < 256; i++) white += histogram[i];
          return {
            width: sw,
            height: sh,
            mean: +mean.toFixed(2),
            // Contrast as the standard deviation of luminance, which is the measure the
            // earlier lighting work in this project reported and is comparable to it.
            contrast: +Math.sqrt(Math.max(0, sumSquares / total - mean * mean)).toFixed(2),
            meanRGB: [+(rSum / total).toFixed(1), +(gSum / total).toFixed(1), +(bSum / total).toFixed(1)],
            saturation: +(saturationCount ? saturationSum / saturationCount : 0).toFixed(4),
            blackClipPct: +((black / total) * 100).toFixed(3),
            whiteClipPct: +((white / total) * 100).toFixed(3),
            histogram,
            total,
          };
        },
        { b64, crop }
      );
      const m = out[path.basename(file, '.png')];
      m.p05 = percentile(m.histogram, m.total, 0.05);
      m.p50 = percentile(m.histogram, m.total, 0.5);
      m.p95 = percentile(m.histogram, m.total, 0.95);
      m.p99 = percentile(m.histogram, m.total, 0.99);
      delete m.histogram;
      delete m.total;
    }
  } finally {
    await browser.close();
  }
  return out;
}

// CLI:  node scripts/render/image-stats.mjs <dir-or-files...> [--crop x,y,w,h]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const cropIndex = args.indexOf('--crop');
  const crop = cropIndex >= 0 ? args[cropIndex + 1].split(',').map(Number) : null;
  const targets = (cropIndex >= 0 ? args.slice(0, cropIndex) : args).flatMap((t) =>
    fs.statSync(t).isDirectory()
      ? fs.readdirSync(t).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(t, f))
      : [t]
  );
  console.log(JSON.stringify(await measureImages(targets, { crop }), null, 2));
}
