/**
 * Re-measure two capture sets against one another, on the pixels they already contain.
 *
 * Usage:  node scripts/render/water-bands.mjs <beforeDir> <afterDir>
 *
 * `water-review.mjs` records, per view, the box the visible water projects into. The shapes
 * and the cameras are identical between two runs of it, so that box is the same in both —
 * which means a before/after comparison can be made on the saved PNGs without rendering
 * anything again, and without either set having to survive a rebuild.
 *
 * The two failure modes the brief names are both measurable here. "One flat uniform colour"
 * shows up as a luminance spread near zero; "solid blue plastic" and its opposite, milk,
 * show up in saturation. The reference is `Bedo_Mesu_J.mp4`, whose water core sampled at
 * t = 60.63 s is rgb(83, 90, 111): saturation 0.25, blue bias +26 %.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [BEFORE, AFTER] = process.argv.slice(2);
if (!BEFORE || !AFTER) {
  console.error('usage: node scripts/render/water-bands.mjs <beforeDir> <afterDir>');
  process.exit(2);
}
const boxes = JSON.parse(fs.readFileSync(path.join(AFTER, 'report.json'), 'utf8'));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('data:text/html,<title>bands</title>');

const sample = async (file, box) => {
  if (!fs.existsSync(file) || !box) return null;
  return page.evaluate(
    async ({ b64, box }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const out = {};
      // The water runs off the bottom of the frame in the close framings, so the box is
      // clipped to the image before the bands are laid out on it. Without this the foot
      // band lands below the last row and is silently dropped.
      const minX = Math.max(0, box.minX);
      const maxX = Math.min(canvas.width, box.maxX);
      const minY = Math.max(0, box.minY);
      const maxY = Math.min(canvas.height, box.maxY);
      const w = maxX - minX;
      const h = maxY - minY;
      box = { minX, maxX, minY, maxY };
      for (const [name, at] of [['top', 0.16], ['middle', 0.5], ['foot', 0.86]]) {
        const x = Math.round(box.minX + w * 0.375);
        const y = Math.round(box.minY + h * at);
        const sw = Math.max(2, Math.round(w * 0.25));
        const sh = Math.max(2, Math.round(h * 0.06));
        if (x < 0 || y < 0 || x + sw > canvas.width || y + sh > canvas.height) continue;
        if (sw < 2 || sh < 2) continue;
        const px = ctx.getImageData(x, y, sw, sh).data;
        let r = 0, g = 0, b = 0, n = 0;
        const lums = [];
        for (let i = 0; i < px.length; i += 4) {
          r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
          lums.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
        }
        const mean = [r / n, g / n, b / n];
        const mx = Math.max(...mean), mn = Math.min(...mean);
        const lm = lums.reduce((a, v) => a + v, 0) / lums.length;
        const sd = Math.sqrt(lums.reduce((a, v) => a + (v - lm) ** 2, 0) / lums.length);
        out[name] = {
          rgb: mean.map((v) => Math.round(v)),
          sat: Number((mx > 0 ? (mx - mn) / mx : 0).toFixed(3)),
          blue: Number((mean[2] / ((mean[0] + mean[1]) / 2) - 1).toFixed(3)),
          lum: Number(lm.toFixed(1)),
          spread: Number(sd.toFixed(2)),
        };
      }
      return out;
    },
    { b64: fs.readFileSync(file).toString('base64'), box }
  );
};

const rows = [];
for (const [name, entry] of Object.entries(boxes)) {
  if (name.startsWith('__') || !entry.screenBox) continue;
  const b = await sample(path.join(BEFORE, `${name}.png`), entry.screenBox);
  const a = await sample(path.join(AFTER, `${name}.png`), entry.screenBox);
  if (!b || !a) continue;
  for (const band of ['top', 'middle', 'foot']) {
    if (!b[band] || !a[band]) continue;
    rows.push({ view: name, band, before: b[band], after: a[band] });
  }
}
const fmt = (s) => `rgb(${s.rgb.join(',')}) sat ${s.sat} blue ${s.blue} lum ${s.lum} sd ${s.spread}`;
for (const r of rows) console.log(`${r.view.padEnd(24)} ${r.band.padEnd(7)} BEFORE ${fmt(r.before)}\n${''.padEnd(33)}AFTER  ${fmt(r.after)}`);
const mean = (rs, k, f) => (rs.reduce((t, r) => t + f(r[k]), 0) / rs.length).toFixed(3);
console.log('\n--- means over all sampled bands ---');
for (const k of ['before', 'after']) {
  console.log(
    `${k.padEnd(7)} sat ${mean(rows, k, (s) => s.sat)}  blue ${mean(rows, k, (s) => s.blue)}  ` +
      `lum ${mean(rows, k, (s) => s.lum)}  spread ${mean(rows, k, (s) => s.spread)}`
  );
}
fs.writeFileSync(path.join(AFTER, 'bands.json'), JSON.stringify(rows, null, 2));
await browser.close();
