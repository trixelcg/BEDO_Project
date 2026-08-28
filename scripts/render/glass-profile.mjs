/**
 * A horizontal luminance profile across the tank, and the optical cues it implies.
 *
 * Fixed crops are the wrong instrument for glass. What separates a glass cylinder from a
 * flat tinted pane is *where* the light is: a cylinder concentrates grazing reflection into
 * a bright band at each silhouette edge and leaves the middle nearly clear, and that shape
 * is what the eye reads as curvature. A crop mean cannot see a shape; a profile can.
 *
 * So this averages a horizontal band down the image, walks the resulting curve, and reports
 * the two rim peaks, the face-on centre between them, and the ratio of the two — which is
 * the number that says whether the vessel reads as round.
 *
 * Usage:  node scripts/render/glass-profile.mjs <png> [yTop] [yBottom]
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

export async function profileOf(page, file, yTop = 0.30, yBottom = 0.62) {
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate(
    async ({ b64, yTop, yBottom }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const y0 = Math.round(yTop * img.height);
      const y1 = Math.round(yBottom * img.height);
      const px = x.getImageData(0, y0, img.width, y1 - y0).data;
      const w = img.width;
      const rows = y1 - y0;
      const lum = new Array(w).fill(0);
      const sat = new Array(w).fill(0);
      for (let cx = 0; cx < w; cx++) {
        let l = 0, s = 0;
        for (let r = 0; r < rows; r++) {
          const i = (r * w + cx) * 4;
          const R = px[i], G = px[i + 1], B = px[i + 2];
          l += 0.2126 * R + 0.7152 * G + 0.0722 * B;
          const mx = Math.max(R, G, B);
          s += mx > 8 ? (mx - Math.min(R, G, B)) / mx : 0;
        }
        lum[cx] = l / rows;
        sat[cx] = s / rows;
      }
      return { lum, sat, width: w };
    },
    { b64, yTop, yBottom }
  );
}

/** The two rim peaks and the face-on centre, found from the profile itself. */
export function cues(lum, from, to) {
  const band = lum.slice(from, to);
  const mid = Math.floor(band.length / 2);
  const peak = (a, b) => {
    let best = -1, at = a;
    for (let i = a; i < b; i++) if (band[i] > best) { best = band[i]; at = i; }
    return { value: +best.toFixed(2), at: at + from };
  };
  const left = peak(0, mid);
  const right = peak(mid, band.length);
  // face-on centre: the middle fifth, away from both rims
  const c0 = Math.floor(band.length * 0.4), c1 = Math.ceil(band.length * 0.6);
  const centre = band.slice(c0, c1).reduce((s, v) => s + v, 0) / (c1 - c0);
  const rim = (left.value + right.value) / 2;
  return {
    leftRim: left, rightRim: right,
    centre: +centre.toFixed(2),
    rimOverCentre: +(rim / Math.max(centre, 0.01)).toFixed(3),
    rimMinusCentre: +(rim - centre).toFixed(2),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, yT, yB] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const p = await profileOf(page, file, yT ? +yT : 0.30, yB ? +yB : 0.62);
  console.log(JSON.stringify(p.lum.map((v) => +v.toFixed(1))));
  await browser.close();
}
