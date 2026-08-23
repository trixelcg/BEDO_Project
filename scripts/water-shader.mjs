#!/usr/bin/env node
/**
 * Close-up captures of the water surface, for the banding correction.
 *
 * `water-jet.mjs` measures the jet's *size* in model units. This looks at its *surface*:
 * it flies the camera in until the water fills the frame, holds one fixed framing for every
 * deflector family, and takes a high-resolution crop so that longitudinal striping is
 * visible in the image rather than a matter of opinion.
 *
 * It also samples the same frame twice from two camera positions, which is how "the ripple
 * is attached to the water" is told apart from "the ripple is attached to the world": a
 * world-locked pattern slides across the surface when the camera moves and an object-space
 * one does not.
 *
 *   node scripts/water-shader.mjs --out water-shader-before.json --shots measurements/water/shader-before
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const PORT = Number(flag('port', 4361));
const OUT = flag('out', 'water-shader.json');
const SHOTS = flag('shots', 'measurements/water/shader');

/** Where the water is on screen, and how big, so the crop frames it the same way every time. */
const FRAME = () => {
  const T = window.__THREE;
  const scene = window.__three.scenes.find((s) => s.getObjectByName('deflector_rod'));
  const rod = scene.getObjectByName('deflector_rod');
  const app = rod.parent.parent;
  scene.updateWorldMatrix(true, true);
  // Drawn geometry only. The apparatus group also holds the invisible click proxies, whose
  // objects are visible even though their materials are not — counting those put the frame
  // around the whole bench instead of the water.
  const drawn = (o) => o.isMesh && o.visible && o.material?.visible !== false;
  const carries = (o) => {
    let hit = false;
    o.traverse((c) => {
      if (drawn(c)) hit = true;
    });
    return hit;
  };
  const groups = app.children.filter((c) => {
    if (c === rod.parent) return false;
    let weights = 0;
    c.traverse((o) => {
      if (/^Weight_/.test(o.name)) weights++;
    });
    return weights === 0 && carries(c);
  });
  const box = new T.Box3();
  box.makeEmpty();
  let any = false;
  for (const g of groups) {
    if (!g.visible) continue;
    g.traverse((o) => {
      if (drawn(o)) {
        box.expandByObject(o);
        any = true;
      }
    });
  }
  if (!any || box.isEmpty()) return null;
  const cam = window.__three.camera;
  const rect = document.querySelector('canvas').getBoundingClientRect();
  const project = (v) => {
    const p = v.clone().project(cam);
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  };
  const c = project(box.getCenter(new T.Vector3()));
  const lo = project(box.min);
  const hi = project(box.max);
  return {
    centre: [Math.round(c.x), Math.round(c.y)],
    height: Math.abs(hi.y - lo.y),
    camera: [cam.position.x, cam.position.y, cam.position.z].map((n) => Number(n.toFixed(4))),
  };
};

async function serve() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  const url = `http://localhost:${PORT}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).ok) return { url, server };
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  server.kill('SIGTERM');
  throw new Error('vite preview did not start');
}

async function main() {
  const { url, server } = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    window.__three = { scenes: [] };
    window.__THREE_DEVTOOLS__ = {
      dispatchEvent(e) {
        const o = e.detail;
        if (o?.domElement && o.render) {
          window.__three.renderer = o;
          const r = o.render.bind(o);
          o.render = (s, c) => {
            if (c?.isPerspectiveCamera) window.__three.camera = c;
            return r(s, c);
          };
          return;
        }
        if (o?.isScene) window.__three.scenes.push(o);
      },
    };
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bedo-scene-ready]', { timeout: 300_000 });
  await page.evaluate(() => {
    const s = window.__three.scenes.find((x) => x.getObjectByName('deflector_rod'));
    let b = null;
    s.traverse((o) => {
      if (!b && o.isMesh) {
        o.geometry.computeBoundingBox();
        b = o.geometry.boundingBox;
      }
    });
    window.__THREE = { Vector3: b.min.constructor, Box3: b.constructor };
  });

  // Dispatched rather than clicked: after a wheel-zoom over the canvas, OrbitControls
  // still holds the pointer capture and a real click never reaches the sidebar. The React
  // handler is the same either way.
  const btn = (n) => page.getByRole('button', { name: n });
  const press = async (n) => {
    const el = btn(n);
    if (!(await el.count())) return false;
    await el.first().dispatchEvent('click');
    await page.waitForTimeout(600);
    return true;
  };
  const setValve = (v) =>
    page.locator('.valve-slider-container input[type="range"]').fill(String(v));

  fs.mkdirSync(path.join(ROOT, SHOTS), { recursive: true });
  const states = [];

  await press('Free Mode');
  await page.waitForTimeout(1000);
  await press(/Turn On Pump/);
  await setValve(0.5);
  await page.waitForTimeout(2500);

  const canvas = await page.locator('canvas').boundingBox();
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;

  // Fly in until the water fills a useful part of the frame, checking after each step
  // rather than guessing a wheel count: too few and the jet is five pixels wide, too many
  // and the camera ends up past the tank looking at the bench. The target band is chosen so
  // the surface is large enough to judge and still wholly inside the viewport.
  const TARGET_MIN = 150;
  const TARGET_MAX = 520;
  let framed = await page.evaluate(FRAME);
  for (let i = 0; i < 40; i++) {
    if (!framed) break;
    const h = framed.height;
    const onScreen =
      framed.centre[0] > 0 && framed.centre[0] < 1280 && framed.centre[1] > 0 && framed.centre[1] < 800;
    if (h >= TARGET_MIN && h <= TARGET_MAX && onScreen) break;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, h > TARGET_MAX ? 200 : -200);
    await page.waitForTimeout(90);
    framed = await page.evaluate(FRAME);
  }
  await page.waitForTimeout(1500);
  console.log(
    `  framing: water is ${framed ? framed.height.toFixed(0) : '—'} px tall at ` +
      `${JSON.stringify(framed?.centre)}, camera ${JSON.stringify(framed?.camera)}`
  );

  const capture = async (id, description) => {
    await page.waitForTimeout(2200);
    const frame = await page.evaluate(FRAME);
    if (!frame) {
      console.log(`  ${id.padEnd(20)} (water not visible)`);
      states.push({ id, description, frame: null });
      return;
    }
    // Clamped to the viewport: a crop that runs off the page is a screenshot that never
    // returns, and after a hard zoom the water can project outside the canvas entirely.
    const VW = 1280;
    const VH = 800;
    const half = Math.max(120, Math.min(300, frame.height * 0.62));
    const x = Math.min(Math.max(0, frame.centre[0] - half), Math.max(0, VW - half * 2));
    const y = Math.min(Math.max(0, frame.centre[1] - half), Math.max(0, VH - half * 2));
    const width = Math.min(half * 2, VW - x);
    const height = Math.min(half * 2, VH - y);
    if (width < 40 || height < 40) {
      console.log(`  ${id.padEnd(20)} (water off-screen, skipped)`);
      states.push({ id, description, frame, offscreen: true });
      return;
    }
    await page.screenshot({
      path: path.join(ROOT, SHOTS, `${id}.png`),
      clip: { x, y, width, height },
      timeout: 120_000,
    });
    states.push({ id, description, frame });
    console.log(`  ${id.padEnd(20)} centre=${JSON.stringify(frame.centre)} h=${frame.height.toFixed(0)}px`);
  };

  for (const [id, label] of [
    ['A-flat-90', 'Flat surface (90°)'],
    ['B-semi-120', 'Semi-circular (120°)'],
    ['C-semi-180', 'Semi-circular (180°)'],
    ['D-conical-135', 'Conical surface (135°)'],
    ['E-oblique-30', 'Oblique surface (30°)'],
    ['F-oblique-45', 'Oblique surface (45°)'],
    ['G-oblique-60', 'Oblique surface (60°)'],
  ]) {
    if (await press(label)) {
      await capture(id, `${label} at n = 0.50`);
    } else {
      console.log(`  ${id.padEnd(20)} (control not offered)`);
    }
  }

  // The before-impact jet on its own, below the plume threshold.
  await press('Flat surface (90°)');
  await setValve(0.12);
  await capture('H-jet-only', 'Before-impact jet alone, n = 0.12');

  // Camera-independence: same water, two camera positions. A world-locked ripple slides.
  await setValve(0.5);
  await page.waitForTimeout(2000);
  await capture('I-camera-1', 'Ripple attachment: camera position 1');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 14, cy + i * 2);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  await capture('J-camera-2', 'Ripple attachment: camera orbited');

  await browser.close();
  server.kill('SIGTERM');
  const outPath = path.join(ROOT, 'measurements', OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ url, states }, null, 2)}\n`);
  console.log(`\nwritten to ${path.relative(ROOT, outPath)} and ${SHOTS}/\n`);
}

main().catch((e) => {
  console.error(`\nwater-shader failed: ${e.message}\n`);
  process.exit(1);
});
