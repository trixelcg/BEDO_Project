#!/usr/bin/env node
/**
 * What the water actually looks like, in model units (BEDO water-jet correction).
 *
 * The jet's width is a physical quantity — `NOZZLE_AREA_M2` gives a 10 mm bore — so it is
 * measured here in metres of apparatus rather than in screen pixels. A screenshot can only
 * say "that looks wide"; this says "that is 172 mm where the nozzle is 10 mm".
 *
 * Drives the running app into representative flow states and, for each one, reads the
 * water group's real world bounding box out of the live three.js scene, converts it to
 * apparatus-local units, and compares the cross-flow extent against the nozzle diameter
 * the domain constants imply.
 *
 *   node scripts/water-jet.mjs --out water-before.json --shots measurements/water/before
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startPreview } from './lib/preview-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const PORT = Number(flag('port', 4331));
const OUT = flag('out', 'water-jet.json');
const SHOTS = flag('shots', 'measurements/water/shots');

/** The physical truth, from `src/domain/physics.ts`. Not read from the bundle on purpose. */
const NOZZLE_AREA_M2 = 0.0000785;
const NOZZLE_DIAMETER_M = 2 * Math.sqrt(NOZZLE_AREA_M2 / Math.PI);

/**
 * Read the water out of the live scene.
 *
 * Everything is reported in **apparatus-local** units, which for this model are metres
 * (`apparatusView.MODEL_UNITS_PER_METRE`), so the numbers can be compared with the nozzle
 * bore directly.
 */
const READ = () => {
  const r = (n) => Number(n.toFixed(6));
  const T = window.__THREE;
  const scene = window.__three.scenes.find((s) => s.getObjectByName('deflector_rod'));
  const rod = scene.getObjectByName('deflector_rod');
  const apparatus = rod.parent.parent;
  scene.updateWorldMatrix(true, true);
  const scale = apparatus.scale.x;

  // Two water groups now, because BEDO specifies two shapes. Told apart structurally:
  // the jet holds exactly one shape (the "before impact" column) and the plume group holds
  // the rest (one per deflector). Neither is found by a name the app sets.
  const groups = apparatus.children.filter((c) => {
    if (c === rod.parent) return false;
    let meshes = 0, weights = 0;
    c.traverse((o) => { if (o.isMesh) meshes++; if (/^Weight_/.test(o.name)) weights++; });
    return meshes > 0 && weights === 0;
  });
  const jet = groups.find((g) => g.children.length === 1) ?? null;
  const plume = groups.find((g) => g.children.length > 1) ?? null;

  /** Bounds of the visible parts only, in apparatus-local units. */
  const visibleBounds = (root) => {
    if (!root || !root.visible) return null;
    const box = new T.Box3();
    box.makeEmpty();
    let found = false;
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let node = o;
      while (node && node !== root) { if (!node.visible) return; node = node.parent; }
      box.expandByObject(o);
      found = true;
    });
    if (!found || box.isEmpty()) return null;
    const size = box.getSize(new T.Vector3()).divideScalar(scale);
    const centre = box.getCenter(new T.Vector3());
    return {
      sizeLocal: [r(size.x), r(size.y), r(size.z)],
      centreWorld: [r(centre.x), r(centre.y), r(centre.z)],
      minWorldY: r(box.min.y),
      maxWorldY: r(box.max.y),
    };
  };

  const nozzle = scene.getObjectByName('JET_Force_2_214');
  const nozzleBox = nozzle ? new T.Box3().setFromObject(nozzle) : null;

  return {
    jetVisible: !!jet?.visible,
    plumeVisible: !!plume?.visible,
    jet: visibleBounds(jet),
    plume: visibleBounds(plume),
    jetScale: jet ? [r(jet.scale.x), r(jet.scale.y), r(jet.scale.z)] : null,
    nozzleLipWorldY: nozzleBox ? r(nozzleBox.max.y) : null,
    nozzleAxisWorld: nozzleBox
      ? [r((nozzleBox.min.x + nozzleBox.max.x) / 2), r((nozzleBox.min.z + nozzleBox.max.z) / 2)]
      : null,
    apparatusScale: r(scale),
  };
};

async function serve() {
  // One implementation, in scripts/lib/preview-server.mjs: it owns the process
  // group and tears the server down on a throw or a Ctrl-C as well as on success.
  return startPreview({ root: ROOT, port: PORT });
}

async function main() {
  const { url, server } = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    window.__three = { scenes: [] };
    window.__THREE_DEVTOOLS__ = {
      dispatchEvent(e) {
        const o = e.detail;
        if (o?.domElement && o.render) {
          const render = o.render.bind(o);
          o.render = (s, c) => {
            if (c?.isPerspectiveCamera) window.__three.camera = c;
            return render(s, c);
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

  const btn = (n) => page.getByRole('button', { name: n });
  const setValve = async (v) =>
    page.locator('.valve-slider-container input[type="range"]').fill(String(v));

  fs.mkdirSync(path.join(ROOT, SHOTS), { recursive: true });
  const states = [];

  const capture = async (id, description) => {
    await page.waitForTimeout(2200);
    const scene = await page.evaluate(READ);
    const b = scene.jet;
    const widthLocal = b ? Math.max(b.sizeLocal[0], b.sizeLocal[2]) : null;
    const plumeWidth = scene.plume
      ? Math.max(scene.plume.sizeLocal[0], scene.plume.sizeLocal[2])
      : null;
    const ratio = widthLocal === null ? null : widthLocal / NOZZLE_DIAMETER_M;
    states.push({
      id,
      description,
      scene,
      widthLocal,
      nozzleDiameterM: NOZZLE_DIAMETER_M,
      ratio: ratio === null ? null : Number(ratio.toFixed(3)),
      errorPct:
        ratio === null ? null : Number((((widthLocal - NOZZLE_DIAMETER_M) / NOZZLE_DIAMETER_M) * 100).toFixed(2)),
      plumeWidth,
    });
    await page.screenshot({
      path: path.join(ROOT, SHOTS, `${id}.png`),
      clip: { x: 380, y: 60, width: 620, height: 560 },
    });
    console.log(
      `  ${id.padEnd(20)} jet=${scene.jetVisible ? 'on ' : 'off'} ` +
        `w=${widthLocal === null ? '  —    ' : (widthLocal * 1000).toFixed(2) + ' mm'} ` +
        `err=${ratio === null ? '  —  ' : (((widthLocal - NOZZLE_DIAMETER_M) / NOZZLE_DIAMETER_M) * 100).toFixed(2) + '%'} ` +
        `| plume=${scene.plumeVisible ? 'on ' : 'off'} ` +
        `w=${plumeWidth === null ? '  —' : (plumeWidth * 1000).toFixed(1) + ' mm'}`
    );
  };

  await btn('Free Mode').click();
  await page.waitForTimeout(1000);

  await capture('A-pump-off', 'Pump off — no jet may be visible');
  await btn(/Turn On Pump/).click();
  await setValve(0.1);
  await capture('B-low-flow', 'Low flow, n = 0.10 — startup trickle');
  await setValve(0.4);
  await capture('C-reading-1', 'Reading 1 setpoint, n = 0.40');
  await setValve(0.5);
  await capture('D-reading-2', 'Reading 2 setpoint, n = 0.50');
  await setValve(1);
  await capture('E-max-flow', 'Maximum flow, n = 1.00');

  // Every deflector family, at the reading-1 setpoint.
  await setValve(0.4);
  for (const [id, label] of [
    ['F-flat-90', 'Flat surface (90°)'],
    ['G-semi-180', 'Semi-circular (180°)'],
    ['H-conical-135', 'Conical surface (135°)'],
    ['I-oblique-45', 'Oblique surface (45°)'],
  ]) {
    const control = btn(label);
    if (await control.count()) {
      await control.click();
      await capture(id, `${label} at n = 0.40`);
    } else {
      console.log(`  ${id.padEnd(22)} (control not offered)`);
    }
  }

  await browser.close();
  server.kill('SIGTERM');
  const outPath = path.join(ROOT, 'measurements', OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    `${JSON.stringify({ url, nozzleDiameterM: NOZZLE_DIAMETER_M, states }, null, 2)}\n`
  );
  console.log(`\nnozzle diameter: ${(NOZZLE_DIAMETER_M * 1000).toFixed(4)} mm`);
  console.log(`written to ${path.relative(ROOT, outPath)} and ${SHOTS}/\n`);
}

main().catch((e) => {
  console.error(`\nwater-jet failed: ${e.message}\n`);
  process.exit(1);
});
