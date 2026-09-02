/**
 * Does the water move? (BEDO-WATER-04)
 *
 * Usage:  node scripts/render/water-motion.mjs <outDir> [port]
 *
 * `water-review.mjs` answers "what does one settled frame look like". This answers a
 * question a still cannot: whether the thing is alive. Two motions have to be working at
 * once, and they are separable, so this separates them.
 *
 *   **growth strip**   t = 0.00 .. 1.00 s from the instant the flow starts. The authored
 *                      Alembic cache is playing (81 frames over `WATER_STARTUP_SECONDS`),
 *                      so the morph influences, the bounds and a tracked vertex all move.
 *                      This is the proof of *geometry* motion.
 *
 *   **settled strip**  six more frames at 0.20 s, taken after t = 3.0 s. The cache has held
 *                      at frame 80 since 1.15 s, so the influence vector is frozen and every
 *                      vertex is stationary. Anything that still changes between these
 *                      frames is the *material*, and nothing else. Measured as mean absolute
 *                      pixel difference inside the water's own projected box, against a
 *                      control patch of static background sampled the same way.
 *
 * That control patch is what makes the number mean something: an encoder or a rasteriser
 * that jittered by a level or two would move both, and only a difference between them is
 * evidence of a moving surface.
 *
 * Camera, virtual clock and self-check are inherited from the review harness. Every strip is
 * shot from ONE pinned camera, per the brief — a sequence that also moves the camera cannot
 * separate motion from parallax.
 */

import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../lib/preview-server.mjs';
import { installDeterministicClock, STEP_MS } from './deterministic-clock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.argv[2];
const PORT = Number(process.argv[3] || 4961);
if (!OUT) {
  console.error('usage: node scripts/render/water-motion.mjs <outDir> [port]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

/** The sample times the brief asks for, in seconds. */
const SAMPLE_S = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
const framesFor = (seconds) => Math.round((seconds * 1000) / STEP_MS);
/** Where the settled strip starts: well past the 1.15 s the cache takes to establish. */
const SETTLE_S = 3.0;
/** Frames to let the tank drain between states. */
const DRAIN = 400;

const HOOK = () => {
  window.__three = { scenes: [] };
  window.__pin = null;
  window.__THREE_DEVTOOLS__ = {
    dispatchEvent(e) {
      const o = e.detail;
      if (o?.domElement && o.render) {
        window.__three.renderer = o;
        const render = o.render.bind(o);
        o.render = (scene, camera) => {
          if (camera?.isPerspectiveCamera) {
            window.__three.camera = camera;
            const p = window.__pin;
            if (p) {
              camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
              camera.up.set(0, 1, 0);
              camera.lookAt(p.at[0], p.at[1], p.at[2]);
              if (p.fov) camera.fov = p.fov;
              camera.updateProjectionMatrix();
              camera.updateMatrixWorld();
            }
          }
          return render(scene, camera);
        };
        return;
      }
      if (o?.isScene) window.__three.scenes.push(o);
    },
  };
};

const { url, stop } = await startPreview({ root: ROOT, port: PORT });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const failures = [];
page.on('pageerror', (e) => failures.push('pageerror: ' + e.message.slice(0, 200)));

await page.addInitScript(installDeterministicClock);
await page.addInitScript(HOOK);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-bedo-scene-ready]', { timeout: 180000 });

const advance = (frames) => page.evaluate((n) => window.__advanceFrames(n), frames);
const settleReact = () => page.waitForTimeout(400);

const waitForStableScene = async () => {
  let last = null;
  let stable = 0;
  for (let i = 0; i < 120 && stable < 5; i++) {
    const counts = await page.evaluate(() => {
      const info = window.__three.renderer?.info;
      return info ? `${info.memory.geometries}/${info.memory.textures}` : 'none';
    });
    stable = counts === last ? stable + 1 : 0;
    last = counts;
    await page.waitForTimeout(250);
  }
  if (stable < 5) failures.push(`scene never settled — last counts ${last}`);
  return last;
};
console.error('scene settled at', await waitForStableScene(), '(geometries/textures)');

await page.addStyleTag({
  content: '.ui-container{opacity:0 !important;pointer-events:auto !important}',
});

const installProbes = () =>
  page.evaluate(() => {
  const scene = window.__three.scenes.find((s) => s.getObjectByName('deflector_rod'));
  window.__b = { scene };
  let mesh = null;
  scene.traverse((o) => {
    if (!mesh && o.isMesh) {
      o.geometry.computeBoundingBox();
      mesh = o;
    }
  });
  window.__b.V = mesh.geometry.boundingBox.min.constructor;
  window.__b.B = mesh.geometry.boundingBox.constructor;
  window.__b.centre = (name) => {
    const o = window.__b.scene.getObjectByName(name);
    if (!o) return null;
    const box = new window.__b.B().setFromObject(o);
    return box.isEmpty() ? null : box.getCenter(new window.__b.V()).toArray();
  };
  /** Every visible authored water mesh, with its whole ancestor chain checked. */
  window.__b.waterMeshes = () => {
    const out = [];
    window.__b.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m || Array.isArray(m) || !m.isMeshPhysicalMaterial) return;
      if ((m.onBeforeCompile?.toString().length ?? 0) < 200) return;
      if (o.geometry?.type === 'CylinderGeometry') return;
      let node = o;
      let shown = true;
      while (node && shown) {
        shown = node.visible;
        node = node.parent;
      }
      if (shown) out.push(o);
    });
    return out;
  };
});

await installProbes();

const press = async (name, frames = 0) => {
  const target = page.getByRole('button', { name });
  if ((await target.count()) === 0) {
    failures.push(`control not found: ${name}`);
    return false;
  }
  await target.first().dispatchEvent('click');
  await settleReact();
  if (frames) await advance(frames);
  return true;
};

const shot = async (name) => {
  const buffer = await page.screenshot();
  fs.writeFileSync(path.join(OUT, `${name}.png`), buffer);
  return { buffer, hash: crypto.createHash('md5').update(buffer).digest('hex') };
};

const frame = async (pin, frames = 0) => {
  await page.evaluate((v) => {
    window.__pin = v;
  }, pin);
  if (frames) await advance(frames);
};

/**
 * The state of the authored cache and of the body it poses, this instant.
 *
 * `influences` is reported as the non-zero (index, weight) pairs, which for this playback is
 * at most two: `setCacheFrame` blends the two targets bracketing a fractional frame and
 * leaves the rest at zero. Reading the pair back is how the *authored frame* is recovered
 * without the page having to expose it.
 */
const probe = () =>
  page.evaluate(() => {
    const meshes = window.__b.waterMeshes();
    if (!meshes.length) return { visible: 0 };
    const mesh = meshes[0];
    const inf = mesh.morphTargetInfluences || [];
    const nz = [];
    for (let i = 0; i < inf.length; i++) if (inf[i] > 1e-6) nz.push([i, Number(inf[i].toFixed(4))]);
    // The morph target dictionary names targets f000..f079 for authored frames; the base
    // mesh IS frame 80, so an empty influence vector means "settled".
    const names = mesh.morphTargetDictionary
      ? Object.fromEntries(Object.entries(mesh.morphTargetDictionary).map(([k, v]) => [v, k]))
      : {};
    const authored = nz.length
      ? nz.reduce((t, [i, w]) => t + w * Number((names[i] ?? `f${String(i).padStart(3, '0')}`).slice(1)), 0) +
        (1 - nz.reduce((t, [, w]) => t + w, 0)) * 80
      : 80;

    const V = window.__b.V;
    const camera = window.__three.camera;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let wMin = null, wMax = null;
    let tracked = null;
    for (const o of meshes) {
      o.updateWorldMatrix(true, false);
      const pos = o.geometry.getAttribute('position');
      const morph = o.geometry.morphAttributes.position || [];
      const v = new V();
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        for (let t = 0; t < morph.length; t++) {
          const w = inf[t];
          if (!w) continue;
          v.x += morph[t].getX(i) * w;
          v.y += morph[t].getY(i) * w;
          v.z += morph[t].getZ(i) * w;
        }
        v.applyMatrix4(o.matrixWorld);
        // One named vertex, followed through the whole sequence: bounds can stay put while
        // the surface inside them moves, so a single tracked point is the stricter witness.
        if (o === mesh && i === 0) tracked = [v.x, v.y, v.z].map((n) => Number((n * 1000).toFixed(2)));
        if (!wMin) { wMin = v.clone(); wMax = v.clone(); }
        else { wMin.min(v); wMax.max(v); }
        const p = v.clone().project(camera);
        const sx = (p.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (0.5 - p.y * 0.5) * window.innerHeight;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
    }
    return {
      visible: meshes.length,
      asset: mesh.parent?.parent?.children?.[0]?.name ?? mesh.parent?.name ?? '?',
      influences: nz,
      authoredFrame: Number(authored.toFixed(2)),
      sizeMm: [wMax.x - wMin.x, wMax.y - wMin.y, wMax.z - wMin.z].map((n) => Number((n * 1000).toFixed(1))),
      trackedVertexMm: tracked,
      screenBox: { minX, maxX, minY, maxY },
      spanPx: Number((maxX - minX).toFixed(1)),
      heightPx: Number((maxY - minY).toFixed(1)),
      drawCalls: window.__three.renderer.info.render.calls,
      canvases: document.querySelectorAll('canvas').length,
    };
  });

/**
 * How much two frames differ, inside the water and outside it.
 *
 * Mean absolute difference per channel over the sampled region. The control patch is a fixed
 * corner of the frame that holds only static room, so it reports the floor: whatever the
 * rasteriser and the PNG encoder contribute on their own.
 */
const diffPair = async (a, b, box) =>
  page.evaluate(
    async ({ a, b, box }) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return { g, w: c.width, h: c.height };
      };
      const A = await load(a);
      const B = await load(b);
      const region = (r) => {
        const x = Math.max(0, Math.round(r.x));
        const y = Math.max(0, Math.round(r.y));
        const w = Math.min(A.w - x, Math.round(r.w));
        const h = Math.min(A.h - y, Math.round(r.h));
        if (w < 4 || h < 4) return null;
        const pa = A.g.getImageData(x, y, w, h).data;
        const pb = B.g.getImageData(x, y, w, h).data;
        let sum = 0, n = 0, max = 0, moved = 0;
        for (let i = 0; i < pa.length; i += 4) {
          const d = (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])) / 3;
          sum += d; n++;
          if (d > max) max = d;
          if (d >= 2) moved++;
        }
        return {
          meanAbsDiff: Number((sum / n).toFixed(3)),
          maxAbsDiff: Math.round(max),
          pctPixelsMoved: Number(((moved / n) * 100).toFixed(1)),
        };
      };
      const bx = Math.max(0, box.minX);
      const by = Math.max(0, box.minY);
      const bw = Math.min(A.w, box.maxX) - bx;
      const bh = Math.min(A.h, box.maxY) - by;
      return {
        water: region({ x: bx + bw * 0.15, y: by + bh * 0.1, w: bw * 0.7, h: bh * 0.7 }),
        control: region({ x: 40, y: 40, w: 300, h: 200 }),
      };
    },
    { a: a.toString('base64'), b: b.toString('base64'), box }
  );

if (!(await press(/Start/i))) failures.push('the experiment intro Start control is missing');
await advance(30);

const at = (name) => page.evaluate((n) => window.__b.centre(n), name);
const tank = await at('JET_Force_2_205');
const RADIUS = 0.75;
const LIFT = 0.18;
const AIM_LIFT = 0.06;
const cameraAt = (deg) => {
  const r = (deg * Math.PI) / 180;
  return [tank[0] - RADIUS * Math.cos(r), tank[1] + LIFT, tank[2] + RADIUS * Math.sin(r)];
};
const AIM = [tank[0], tank[1] + AIM_LIFT, tank[2]];
const pinAt = (deg) => ({ pos: cameraAt(deg), at: AIM, fov: 30 });

await press('Free Mode');

const setValve = async (opening) => {
  const ok = await page.evaluate((v) => {
    const input = document.querySelector('.valve-slider-container input[type="range"]');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, opening);
  if (!ok) failures.push(`valve control not found when setting ${opening}`);
  await settleReact();
};

let pumpOn = false;
const setPump = async (on) => {
  if (on === pumpOn) return;
  if (!(await press(on ? /Turn On Pump/i : /Turn Off Pump/i))) {
    failures.push(`pump control missing when turning ${on ? 'on' : 'off'}`);
    return;
  }
  pumpOn = on;
};

/**
 * The pre-impact column is unreachable through the controls.
 *
 * `waterShapeForImpact` shows `Water_low` only while the computed impact velocity is
 * non-positive, and that velocity is `sqrt(...)` of a flow-derived quantity — so it is
 * positive the moment anything is flowing, and the storyboard's "water shape before impact"
 * never renders in normal operation. That is a finding, not something to fix from a capture
 * script: the fix would be a domain question about when the column has not yet reached the
 * plate. To photograph the asset's motion anyway, this shows the jet group and hides the
 * plume group directly — a capture-time override, touching no application source.
 */
const installJetOverride = () =>
  page.evaluate(() => {
    // Find the two water groups by what hangs under them: the jet group holds one authored
    // scene whose node is `Water_low`; the plume group holds the other seven.
    let jet = null;
    let plume = null;
    window.__b.scene.traverse((o) => {
      const names = (o.children || []).map((c) => c.children?.[0]?.name || '');
      if (!names.length || !names.every((n) => n.startsWith('Water'))) return;
      if (names.length === 1 && names[0] === 'Water_low') jet = o;
      else if (names.length > 1) plume = o;
    });
    if (!jet || !plume) return { ok: false, jet: !!jet, plume: !!plume };

    // `visible` and `morphTargetInfluences` are both rewritten by the scene's own frame loop
    // every tick, so a one-shot assignment is overwritten before anything renders. These are
    // accessors and a proxy that ignore the loop's writes — capture-time only, in the page,
    // touching no application source.
    const lock = (obj, value) =>
      Object.defineProperty(obj, 'visible', { get: () => value, set() {}, configurable: true });
    lock(jet, true);
    lock(plume, false);
    jet.traverse((o) => { if (o !== jet) lock(o, true); });

    const mesh = window.__b.waterMeshes()[0];
    if (!mesh || !mesh.morphTargetInfluences) return { ok: false, mesh: false };
    const backing = Array.from(mesh.morphTargetInfluences, () => 0);
    mesh.morphTargetInfluences = new Proxy(backing, {
      set(target, prop, v) {
        // Reads pass through to whatever `setJetFrame` last wrote; the loop's writes are
        // swallowed, and `length` still has to be settable for the proxy to behave as an array.
        if (prop === 'length') target.length = v;
        return true;
      },
    });

    // The same two-target blend `setCacheFrame` performs, reimplemented against the asset's
    // own `morphTargetDictionary` so the authored frame is addressed by name, not by order.
    const dict = mesh.morphTargetDictionary || {};
    const indexOfFrame = (f) => (f === 80 ? -1 : dict[`f${String(f).padStart(3, '0')}`] ?? -1);
    window.__b.setJetFrame = (f) => {
      backing.fill(0);
      const c = Math.min(80, Math.max(0, f));
      const lo = Math.floor(c);
      const hi = Math.min(lo + 1, 80);
      const t = c - lo;
      const li = indexOfFrame(lo);
      const hiIdx = indexOfFrame(hi);
      if (li >= 0) backing[li] += 1 - t;
      if (hi !== lo && hiIdx >= 0) backing[hiIdx] += t;
      return { frame: Number(c.toFixed(2)), nonZero: backing.filter((v) => v > 1e-6).length };
    };
    return { ok: true, targets: backing.length };
  });

const setJetFrame = (f) => page.evaluate((v) => window.__b.setJetFrame(v), f);

/** The authored frame the cache would be showing `seconds` after the flow starts. */
const WATER_STARTUP_SECONDS = 1.15;
const cacheFrameAt = (seconds) => Math.min(80, Math.max(0, (seconds / WATER_STARTUP_SECONDS) * 80));

const STATES = [
  { id: 'A-straight-jet', deflector: 'Flat surface (90°)', valve: 0.45, azimuth: 40, forceJet: true },
  { id: 'B-flat90', deflector: 'Flat surface (90°)', valve: 0.45, azimuth: 40, depth: true },
  { id: 'C-conical135', deflector: 'Conical surface (135°)', valve: 0.45, azimuth: 40, depth: true },
  { id: 'D-oblique45', deflector: 'Oblique surface (45°)', valve: 0.45, azimuth: 40 },
  // The tank needs `FILL_SECONDS` = 6 to reach its level, so this one settles at 9 s rather
  // than 3: its growth strip is the plume forming into an empty vessel and its settled strip
  // is the same plume standing in a full one, which is the pair the brief asks about.
  { id: 'E-tankfill', deflector: 'Flat surface (90°)', valve: 0.62, azimuth: 40, settleS: 9.0 },
];

const report = {};

for (const st of STATES) {
  await setPump(false);
  await advance(DRAIN);
  if (!(await press(/Open tank cover/i))) failures.push(`${st.id}: cover would not open`);
  if (!(await press(st.deflector))) failures.push(`${st.id}: deflector "${st.deflector}" refused`);
  if (!(await press(/Close tank cover/i))) failures.push(`${st.id}: cover would not close`);

  await frame(pinAt(st.azimuth));
  // Engage with the clock frozen, so t = 0 is the frame the flow actually starts on.
  await setPump(true);
  await setValve(st.valve);
  if (st.forceJet) {
    const installed = await installJetOverride();
    if (!installed.ok) failures.push(`${st.id}: jet override failed ${JSON.stringify(installed)}`);
  }

  const growth = [];
  let last = 0;
  for (const t of SAMPLE_S) {
    const want = framesFor(t);
    if (want > last) await advance(want - last);
    last = want;
    // The jet's own cache clock is parked whenever the plume is the active shape, so under
    // the override the authored frame has to be driven here — at exactly the rate
    // `cacheFrameAt` would have produced.
    if (st.forceJet) await setJetFrame(cacheFrameAt(t));
    const { buffer } = await shot(`${st.id}-growth-t${t.toFixed(2)}`);
    growth.push({ t, ...(await probe()), buffer });
  }

  // Settle past the cache's 1.15 s, then repeat with the geometry provably frozen.
  const settleS = st.settleS ?? SETTLE_S;
  await advance(framesFor(settleS) - last);
  if (st.forceJet) await setJetFrame(80);
  const settled = [];
  for (const [i, t] of SAMPLE_S.entries()) {
    if (i > 0) await advance(framesFor(0.2));
    const { buffer } = await shot(`${st.id}-settled-t${t.toFixed(2)}`);
    settled.push({ t: settleS + t, ...(await probe()), buffer });
  }

  const diffs = [];
  for (let i = 1; i < settled.length; i++) {
    diffs.push({
      from: settled[i - 1].t.toFixed(2),
      to: settled[i].t.toFixed(2),
      ...(await diffPair(settled[i - 1].buffer, settled[i].buffer, settled[i].screenBox)),
    });
  }

  const depth = {};
  if (st.depth) {
    for (const [name, deg] of [['front', 0], ['oblique', 35], ['side', 88]]) {
      await frame(pinAt(deg), 6);
      await shot(`${st.id}-depth-${name}`);
      depth[name] = await probe();
    }
    await frame(pinAt(st.azimuth), 6);
  }

  const strip = (rows) =>
    rows.map((r) => ({
      t: Number(r.t.toFixed(2)),
      asset: r.asset,
      authoredFrame: r.authoredFrame,
      influences: r.influences,
      sizeMm: r.sizeMm,
      trackedVertexMm: r.trackedVertexMm,
      spanPx: r.spanPx,
      heightPx: r.heightPx,
      drawCalls: r.drawCalls,
      canvases: r.canvases,
    }));

  report[st.id] = { growth: strip(growth), settled: strip(settled), settledDiffs: diffs, depth };
  const g = report[st.id].growth;
  console.error(
    `  ${st.id}: asset=${g[5].asset} frames ${g.map((r) => r.authoredFrame).join('→')}  ` +
      `heightPx ${g.map((r) => r.heightPx).join('→')}  ` +
      `settled diff mean ${diffs.map((d) => d.water?.meanAbsDiff).join('/')} ` +
      `(control ${diffs.map((d) => d.control?.meanAbsDiff).join('/')})`
  );
  if (st.forceJet) {
    // Nothing to restore: the override is torn down by reloading the page, which the next
    // state does not need — it is the last thing this state does, and the accessors are
    // reinstalled from scratch if a future run re-enters it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-bedo-scene-ready]', { timeout: 180000 });
    await waitForStableScene();
    await page.addStyleTag({
      content: '.ui-container{opacity:0 !important;pointer-events:auto !important}',
    });
    await installProbes();
    await press(/Start/i);
    await advance(30);
    await press('Free Mode');
    pumpOn = false;
  }
}

fs.writeFileSync(path.join(OUT, 'motion.json'), JSON.stringify(report, null, 2));
console.error(failures.length ? '\nFAILURES:\n  ' + failures.join('\n  ') : '\nall sequences captured');
await browser.close();
stop();
process.exit(failures.length ? 1 : 0);
