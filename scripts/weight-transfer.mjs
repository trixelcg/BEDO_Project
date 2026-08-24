#!/usr/bin/env node
/**
 * The weight's two-second flight, sampled from the running application (BEDO-021b).
 *
 * `weight-anchor.mjs` answers "where does a settled disc sit". This answers "how did it get
 * there": it clicks a weight on, samples the scene every few frames for the whole flight,
 * then takes the same disc off and samples that too.
 *
 * What it records, per sample:
 *   - where the flying disc is, in world space,
 *   - whether the seat it is heading for is being drawn (it must not be),
 *   - whether the tray slot it came from is being drawn (it must not be),
 *   - the `data-bedo-transfer` marker the browser suite waits on,
 *   - the visual spring's height, so the storyboard's *"moves downward when the weights are
 *     placed on the holder"* can be checked against the moment the disc lands.
 *
 * The point is evidence rather than pass/fail — `tests/e2e/weight-transfer.e2e.ts` makes the
 * assertions. Run it before and after a change to see what actually moved.
 *
 *   node scripts/weight-transfer.mjs --out transfer-021b.json
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

const PORT = Number(flag('port', 4327));
const OUT = flag('out', 'weight-transfer.json');
const SHOTS = flag('shots', 'measurements/weights/flight');

/** One sample of the scene, read out of the live graph. */
const SAMPLE = () => {
  const r = (n) => Number(n.toFixed(6));
  const v3 = (v) => [r(v.x), r(v.y), r(v.z)];
  const T = window.__THREE;

  const scene =
    window.__three.scenes.find((s) => s.getObjectByName('deflector_rod')) ?? window.__three.scenes[0];
  const rod = scene.getObjectByName('deflector_rod');
  const glbRoot = rod.parent;
  const apparatus = glbRoot.parent;
  scene.updateWorldMatrix(true, true);

  const carriesWeight = (o) => {
    let hit = false;
    o.traverse((c) => {
      if (/^Weight_/.test(c.name)) hit = true;
    });
    return hit;
  };

  // The stack group is the one under the apparatus that holds seats; the ghosts are the
  // loose wrappers beside it. Told apart structurally, never by a name the app sets: the
  // stack rides the pan's *vertical* lift and so sits on the apparatus axis, while a ghost
  // wrapper is parked at wherever its disc currently is, which is never x = z = 0.
  const weightGroups = apparatus.children.filter((c) => c !== glbRoot && carriesWeight(c));
  const stackGroup = weightGroups.find((g) => g.position.x === 0 && g.position.z === 0);
  const flying = weightGroups.filter((g) => g !== stackGroup);

  const boxOf = (o) => {
    const box = new T.Box3().setFromObject(o);
    return box.isEmpty() ? null : box;
  };

  const seats = (stackGroup?.children ?? []).map((slot, index) => {
    const disc = slot.children.find((c) => !(c.isMesh && c.material?.visible === false));
    const box = disc ? boxOf(disc) : null;
    return {
      index,
      visible: slot.visible,
      centre: box ? v3(box.getCenter(new T.Vector3())) : null,
      /** The click proxy is in the tree only while the disc is really there (§18). */
      hasProxy: slot.children.some((c) => c.isMesh && c.material?.visible === false),
    };
  });

  const ghosts = flying.map((g) => {
    const box = boxOf(g);
    return { centre: box ? v3(box.getCenter(new T.Vector3())) : null, visible: g.visible };
  });

  // Every tray disc that is currently drawn, so a disc can never be in two places.
  const tray = {};
  for (const name of ['Weight_Custom', 'Weight_50', 'Weight_100', 'Weight_200', 'Weight_500']) {
    const o = scene.getObjectByName(name);
    if (o) tray[name] = o.visible;
  }

  return {
    t: r(performance.now()),
    marker: document.documentElement.dataset.bedoTransfer ?? null,
    ghosts,
    seats,
    tray,
    /** Where the pan is now — it rides the spring, so this moves when the disc lands. */
    rodY: r(new T.Box3().setFromObject(rod).max.y),
    total: document.body.innerText.match(/(\d+)\s*g\b/)?.[1] ?? null,
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
          window.__three.renderer = o;
          const render = o.render.bind(o);
          o.render = (sc, cam) => {
            if (cam?.isPerspectiveCamera) window.__three.camera = cam;
            return render(sc, cam);
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
    const scene = window.__three.scenes.find((s) => s.getObjectByName('deflector_rod'));
    let box = null;
    scene.traverse((o) => {
      if (box || !o.isMesh) return;
      o.geometry.computeBoundingBox();
      box = o.geometry.boundingBox;
    });
    window.__THREE = { Vector3: box.min.constructor, Box3: box.constructor };
  });

  const click = (name) => page.getByRole('button', { name }).click({ timeout: 60_000 });

  fs.mkdirSync(path.join(ROOT, SHOTS), { recursive: true });

  /**
   * Click something, then watch the scene for the whole of the flight it starts.
   *
   * The window is bounded by the application's own `data-bedo-transfer` marker rather than
   * by a stopwatch. Playwright's actionability wait on a heavy WebGL canvas can itself
   * outlast the two seconds being measured, so a fixed window starting at the call would
   * often miss the flight entirely — and the marker is what the browser suite waits on in
   * any case (`BEDO-021b §37`).
   */
  const watch = async (label, action) => {
    const samples = [];
    const pending = action();

    const marker = () =>
      page.evaluate(() => document.documentElement.dataset.bedoTransfer ?? null);

    // Wait for the flight to actually begin.
    const armed = Date.now();
    while (Date.now() - armed < 60_000 && (await marker()) !== 'active');
    const startedAt = Date.now();

    // ...then sample it until the application says it has landed.
    while (Date.now() - startedAt < 20_000) {
      const sample = await page.evaluate(SAMPLE);
      samples.push(sample);
      if (sample.marker === 'idle' && samples.length > 1) break;
      await page.waitForTimeout(40);
    }
    const flightMs = Date.now() - startedAt;
    await pending;

    const flying = samples.filter((s) => s.ghosts.length > 0);
    console.log(
      `  ${label.padEnd(18)} samples=${samples.length}  in-flight=${flying.length}` +
        `  observed=${(flightMs / 1000).toFixed(2)}s`
    );
    return { label, flightMs, samples };
  };

  await click('Free Mode');
  await page.waitForTimeout(1200);

  const phases = [];
  phases.push(await watch('add 50 g', () => click('+50g')));
  await page.screenshot({
    path: path.join(ROOT, SHOTS, 'settled-after-add.png'),
    clip: { x: 330, y: 40, width: 700, height: 620 },
  });
  phases.push(await watch('remove 50 g', () => click(/^Remove 50 g$/)));
  await page.screenshot({
    path: path.join(ROOT, SHOTS, 'settled-after-remove.png'),
    clip: { x: 330, y: 40, width: 700, height: 620 },
  });

  await browser.close();
  server.kill('SIGTERM');

  const outPath = path.join(ROOT, 'measurements', OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ url, phases }, null, 2)}\n`);
  console.log(`\nwritten to ${path.relative(ROOT, outPath)} and ${SHOTS}/\n`);
}

main().catch((e) => {
  console.error(`\nweight-transfer failed: ${e.message}\n`);
  process.exit(1);
});
