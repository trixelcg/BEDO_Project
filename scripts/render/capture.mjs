/**
 * Deterministic fixed-camera capture of the eight review views.
 *
 * Usage:  node scripts/render/capture.mjs <outDir> [port]
 *
 * Every capture is a pure function of the build. Three things make that true:
 *
 *   * **Time is virtual.** See `deterministic-clock.mjs`. Animation state is a fixed number
 *     of frame steps, never an elapsed wall-clock duration.
 *   * **Camera is pinned at render time.** `OrbitControls` and the lesson's own camera
 *     interpolation both write to the camera every frame, so the pin is applied inside the
 *     render call rather than by setting the camera once and hoping.
 *   * **The harness proves it can see a change.** Before it writes anything it runs a
 *     known-change control: it perturbs one obvious material parameter, re-renders, and
 *     requires the bytes to differ. A harness that silently stopped reflecting the build is
 *     exactly the failure this run exists to rule out, so it aborts rather than emit a
 *     comparison nobody should trust.
 *
 * The UI is hidden with `opacity: 0`, deliberately, not `display: none`. Display-none removes
 * elements from the accessibility tree, and `getByRole` reads the accessibility tree — so
 * hiding that way made every subsequent control press silently match nothing. The pump was
 * never actually switched on, which is why a capture named `4-water-active` contained no
 * moving water and why changes to the water material appeared to do nothing at all.
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
const PORT = Number(process.argv[3] || 4951);
if (!OUT) {
  console.error('usage: node scripts/render/capture.mjs <outDir> [port]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

/** Frames to settle after a state change. 90 = 1.5 virtual seconds. */
const SETTLE = 90;
/** Frames to settle after only moving the camera. */
const REFRAME = 30;
/** Frames after the pump is switched on, so the jet reaches its authored steady state. */
const FLOW = 240;

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

/**
 * Wait until the scene has stopped growing.
 *
 * `data-bedo-scene-ready` means the apparatus is in the graph, not that every asset has
 * arrived — the eight water caches stream in separately. A capture taken before they settle
 * sees a different scene: the first run after a fresh build, against a cold preview server,
 * reported 202 geometries and 67 programs where a warm run reported 187 and 42, and its
 * images differed from every subsequent run.
 *
 * Virtual time is frozen throughout, so waiting here costs the animation nothing.
 */
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

// Invisible, but still present in the accessibility tree so controls stay operable.
await page.addStyleTag({
  content: '.ui-container{opacity:0 !important;pointer-events:auto !important}',
});

await page.evaluate(() => {
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
});

/**
 * Let React finish reacting, without letting the scene animate.
 *
 * State updates land on real time — microtasks, effects, transitions — so the number of
 * rendered frames between a click and its consequence varies from run to run. Virtual time
 * is frozen everywhere except inside `advanceFrames`, so waiting here costs the animation
 * nothing: the scene holds exactly where it was while the application settles. This is what
 * separates "the click has been processed" from "time has passed", and mixing the two is
 * what made the three water views irreproducible.
 */
const settleReact = () => page.waitForTimeout(400);

/** Press a control, failing loudly rather than silently matching nothing. */
const press = async (name, frames = SETTLE) => {
  const target = page.getByRole('button', { name });
  const count = await target.count();
  if (count === 0) {
    failures.push(`control not found: ${name}`);
    return false;
  }
  await target.first().dispatchEvent('click');
  await settleReact();
  await advance(frames);
  return true;
};

/**
 * A fingerprint that survives the GPU and still notices the build.
 *
 * Byte equality is too strict to be a determinism criterion for rendered output: two runs of
 * an identical scene differ by one or two pixels along a polygon edge, because rasterisation
 * of a shared edge is not bit-exact between contexts. Measured here, that noise is 1-2 pixels
 * in 2,073,600 — while any real material or lighting change moves tens of thousands.
 *
 * So the signature is a 32x32 grid of mean luminance. Isolated edge pixels vanish into their
 * cell's average; anything that actually changes how a surface responds does not. The exact
 * hash is kept alongside it for reporting, but reproducibility is judged on this.
 */
const signatureOf = async (buffer) =>
  page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const G = 32;
    const canvas = document.createElement('canvas');
    canvas.width = G;
    canvas.height = G;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, G, G);
    const px = ctx.getImageData(0, 0, G, G).data;
    let out = '';
    for (let i = 0; i < px.length; i += 4) {
      const l = Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
      out += l.toString(16).padStart(2, '0');
    }
    return out;
  }, buffer.toString('base64'));

const shot = async (name) => {
  const buffer = await page.screenshot();
  fs.writeFileSync(path.join(OUT, `${name}.png`), buffer);
  return {
    hash: crypto.createHash('md5').update(buffer).digest('hex'),
    signature: await signatureOf(buffer),
  };
};

const frame = async (pin, frames = REFRAME) => {
  await page.evaluate((v) => {
    window.__pin = v;
  }, pin);
  await advance(frames);
};

// --- determinism self-check ------------------------------------------------------------
//
// Render the same pinned view twice with virtual time held still between them, letting real
// animation frames run in the gap. Identical bytes is the precondition for every comparison
// this harness produces; if they differ, something is still reading wall-clock time and no
// before/after is meaningful. Cross-run reproducibility is checked by running twice.
const at = (name) => page.evaluate((n) => window.__b.centre(n), name);
const tank = await at('JET_Force_2_205');
const probePin = {
  pos: [tank[0] - 4.2, tank[1] + 1.5, tank[2] + 2.2],
  at: [tank[0], tank[1] - 0.3, tank[2]],
  fov: 45,
};
await frame(probePin, SETTLE);
const repeatA = await shot('_selftest');
// Let plenty of real animation frames render while virtual time stands still. If any system
// is still reading wall-clock time, this is where it shows: the scene will have moved even
// though the clock did not.
await page.waitForTimeout(750);
const repeatB = await shot('_selftest');

// --- known-change control --------------------------------------------------------------
//
// Perturb one obvious material parameter and require the image to move. This is the check
// that would have caught two different builds rendering byte-identical output.
await page.evaluate(() => {
  const scene = window.__three.scenes.find((s) => s.getObjectByName('deflector_rod'));
  window.__controlSaved = [];
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m || seen.has(m.uuid) || !m.color) continue;
      seen.add(m.uuid);
      window.__controlSaved.push({ m, hex: m.color.getHex() });
      m.color.setHex(0xff0000);
      m.needsUpdate = true;
    }
  });
});
await advance(REFRAME);
const perturbed = await shot('_selftest');
await page.evaluate(() => {
  for (const { m, hex } of window.__controlSaved) {
    m.color.setHex(hex);
    m.needsUpdate = true;
  }
});
await advance(REFRAME);
fs.rmSync(path.join(OUT, '_selftest.png'), { force: true });

if (repeatA.signature !== repeatB.signature) {
  failures.push(
    `NON-DETERMINISTIC: two consecutive renders of one unchanged view differ ` +
      `(${repeatA.signature.slice(0, 12)} vs ${repeatB.signature.slice(0, 12)}). ` +
      `Something still reads wall-clock time.`
  );
}
if (perturbed.signature === repeatA.signature) {
  failures.push(
    'BLIND HARNESS: recolouring every material changed nothing in the capture. ' +
      'The harness is not reflecting the running scene.'
  );
}
if (failures.length) {
  console.error('\ncapture aborted:\n  ' + failures.join('\n  '));
  await browser.close();
  stop();
  process.exit(1);
}
console.error(
  `self-check passed — repeatable (${repeatA.signature.slice(0, 12)}), and sensitive to change`
);

// --- the eight views -------------------------------------------------------------------
await press('Free Mode');

const rod = await at('deflector_rod');
const panel = await at('Power_Switch');
const weights = await at('Weight_500');
// Anchors for the Stage B material crops. Each close-up is placed relative to the surface
// it is judging rather than to the tank, so a crop named `13-black-frame` keeps filling
// itself with black frame however the apparatus is transformed.
const plate = await at('BENCH_GROUND');
const posts = await at('hydrolic_bensh_posts');
const bench = await at('Bing_Sink');
const add = (c, d) => [c[0] + d[0], c[1] + d[1], c[2] + d[2]];

/**
 * Stage C's own set, selected with `--glass`.
 *
 * The tank is the subject here rather than one object among many, so it gets its own
 * sequence instead of borrowing the review set's. Two things make it a fair test of the
 * glass and only the glass: the empty shots are taken *before* the pump is ever engaged, so
 * nothing has been added to the vessel to flatter it; and the filled shots are the same two
 * cameras, so the pair differs by water and by nothing else.
 *
 * The review set above is left exactly as it is. Its fourteen signatures are the approved
 * Stage A.1 / B.1 baselines, and inserting a view anywhere in it would shift virtual time
 * for every shot after the insertion — which would move the water's ripple phase and
 * invalidate the comparison this stage is judged against.
 */
const GLASS_VIEWS = [
  // Face-on. The question this frame answers is whether the *front* wall reads as a
  // surface at all: face-on is where Fresnel is weakest and a glass that relies on
  // reflection alone disappears.
  ['C1-glass-empty-front', add(tank, [-1.15, 0.05, 0]), tank, 30],
  // Three-quarter, which is where a cylinder shows what it is: both silhouette edges are
  // at grazing incidence in the same frame as the face-on centre, so curvature, rim and
  // wall thickness are all legible at once.
  ['C2-glass-empty-3q', add(tank, [-0.8, 0.28, 0.8]), tank, 30],
  ['C3-glass-water-front', add(tank, [-1.15, 0.05, 0]), tank, 30, true],
  ['C4-glass-water-3q', add(tank, [-0.8, 0.28, 0.8]), tank, 30],
  // The tank at working distance, to check that none of this reads as a trick up close and
  // a smear at the distance a learner actually sits.
  ['C5-hero', add(tank, [-1.15, 0.5, 0.8]), add(tank, [0, -0.18, 0]), 38],
];

/**
 * Stage D's water set, selected with `--water`.
 *
 * The two flow states are the lesson's own setpoints, not invented ones: `ROW_VALVE_SETTINGS`
 * puts the first reading at n = 0.40 and the second at n = 0.50, and `flowRateLMin` turns
 * those into 0.131 and 0.225 of pump capacity — which straddle the 0.178 the tank needs
 * before it accumulates anything. So low flow leaves the tank empty and high flow fills it,
 * exactly as `Bedo_Mesu_J.mp4` shows across 55.5-65.5 s and 72.0-78.4 s.
 *
 * The tank's own fill takes `FILL_SECONDS` = 6, so the partial and full states are reached
 * by advancing virtual time rather than by writing a level: nothing here sets the water
 * level, the flow, or any physics value. The sequence only presses the controls a learner
 * would press and then waits.
 */
const WATER_VIEWS = [
  // Low flow, tank empty — the state at t = 60.63 s in the recording.
  ['W1-jet-lowflow', add(tank, [-0.62, 0.16, 0.42]), add(tank, [0, 0.02, 0]), 30, { valve: 0.4, hold: 240 }],
  // The impact region, where the column meets the deflector face.
  // Aim inside the glass at the underside of the deflector. The rod's bounding-box centre
  // is up in the exposed spring mechanism, which previously produced an "impact" frame
  // containing no water at all and therefore could not verify the contact geometry.
  ['W2-impact', add(tank, [-0.44, 0.24, 0.25]), add(tank, [0, 0.18, 0]), 28],
  // High flow. Same framing as W1 so the pair differs by flow and nothing else.
  ['W3-jet-highflow', add(tank, [-0.62, 0.16, 0.42]), add(tank, [0, 0.02, 0]), 30, { valve: 0.5, hold: 120 }],
  // Genuinely part-filled. W3 already leaves the level near 0.42, and the 150 frames this
  // used to hold carried it all the way to 0.90 — so the "partial" view was full, and the
  // set had no picture of a surface anywhere but at the top of the tank. 45 frames lands
  // it around two thirds, which is where the level has to be readable at a glance.
  ['W4-tank-partial', add(tank, [-0.8, 0.28, 0.8]), tank, 30, { hold: 45 }],
  // Full — the state at t = 74.0 s, surface just under the cover.
  ['W5-tank-full', add(tank, [-0.8, 0.28, 0.8]), tank, 30, { hold: 270 }],
  // The free surface itself, which is what makes the level readable at a glance.
  ['W6-free-surface', add(tank, [-0.5, 0.30, 0.34]), add(tank, [0, 0.17, 0]), 26],
  ['W7-hero', add(tank, [-1.15, 0.5, 0.8]), add(tank, [0, -0.18, 0]), 38],
  // Draining. The volumetric valve is the one the tank empties through, and the level has
  // to fall for the same reason it had to rise — so the set covers the down leg too, and
  // the free surface gets checked at a level it was not tuned at.
  ['W8-tank-draining', add(tank, [-0.8, 0.28, 0.8]), tank, 30, { drain: true, hold: 210 }],
];

const REVIEW_VIEWS = [
  ['1-laboratory', add(tank, [-4.2, 1.5, 2.2]), add(tank, [0, -0.3, 0]), 45],
  ['2-apparatus', add(tank, [-1.5, 0.55, 0.85]), add(tank, [0, -0.05, 0]), 40],
  ['3-glass-tank', add(tank, [-0.75, 0.2, 0.42]), tank, 38],
  ['4-water-active', add(tank, [-0.7, 0.16, 0.4]), tank, 38],
  ['5-control-panel', add(panel, [-0.42, 0.16, 0.22]), panel, 35],
  ['6-weights', add(weights, [-0.42, 0.3, 0.24]), weights, 35],
  ['7-deflector', add(rod, [-0.34, 0.12, 0.2]), rod, 32],
  ['8-environment', add(tank, [-2.6, 1.1, -2.4]), add(tank, [0, 0.4, -1.6]), 50],
  // A framing matched to the approved reference render.
  //
  // Checked against the derived room geometry rather than placed by eye. The window wall's
  // inward normal is (0.766, 0, -0.643) and its plane is `n . p = -5.245`, so a camera with a
  // smaller dot product is standing *outside* the glazing — which is where the first attempt
  // at this view ended up, looking at a wall of sky. This one sits 0.75 inside the glazing at
  // eye level, which puts the window on the left and the instruction board on the right as
  // the reference has them.
  //
  // The reference's own viewpoint is not reachable: it looks from a position that falls
  // outside the +X partition at `n . p = -2.817`, so this is the closest composition the
  // room actually allows.
  ['9-reference-match', add(tank, [-4.3, 0.75, 2.3]), add(tank, [0.05, -0.8, -0.1]), 46],
  // The window beam itself, which no reference-composition camera can see.
  //
  // The sunlit patch lands 1.66 to 6.11 units from the window wall — derived from the sill at
  // y -0.72 and the head at y 2.17 with the sun at 32 degrees — and both reference-composition
  // cameras look *across* that band at a grazing angle with the bench in the way. This one
  // faces into it, so the beam, the sill shadow and the mullion bars are all measurable rather
  // than merely asserted.
  ['10-window-beam', add(tank, [1.912, 0.36, 2.713]), add(tank, [-0.018, -0.89, 0.413]), 50],

  // --- Stage B material crops ---------------------------------------------------------
  //
  // Five surfaces carry the material work, and a full-scene view cannot settle any of them:
  // at apparatus framing the checker plate is a hundred pixels of grey and the powder-coated
  // legs are a silhouette. These are the frames the material judgement is actually made on.

  // Open floor on the +Z side, away from the bench, looking down the sunlit gradient. The
  // floor is a single plane at y -1.8 spanning 37 x 24 units, so the only thing that makes
  // one patch of it worth photographing is where the window light falls: this looks into the
  // lit band rather than across it, with shaded floor in the same frame for comparison.
  ['11-floor', add(tank, [2.2, -0.5, 3.4]), add(tank, [0.4, -2.19, 1.9]), 42],

  // The bench's tread plate, from the front at a shallow angle. Shallow deliberately — a
  // checker plate seen face-on shows its pattern but almost none of its specular behaviour,
  // and the question here is whether it reads as steel, which is a question about grazing
  // reflection.
  ['12-checker-plate', add(plate, [-0.85, 0.5, 0.5]), plate, 34],

  // The powder-coated legs and frame, filling the frame top to bottom so the tonal range
  // being judged is the coating's own rather than the room's.
  ['13-black-frame', add(posts, [-1.05, -0.3, 0.62]), add(posts, [0, -0.45, 0]), 34],

  // The white bench mass and sink surround, across a large enough span to show whether the
  // paint carries a gradient or reads as one flat value.
  ['14-white-bench', add(bench, [-0.9, 0.38, 0.52]), bench, 40],
];

const VIEWS = process.argv.includes('--glass')
  ? GLASS_VIEWS
  : process.argv.includes('--water')
    ? WATER_VIEWS
    : REVIEW_VIEWS;

const hashes = {};
const signatures = {};
const waterState = {};
/** Set the flow valve the way the learner does, through the control itself. */
const setValve = async (opening) => {
  const changed = await page.evaluate((v) => {
    const input = document.querySelector('.valve-slider-container input[type="range"]');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(
      input,
      String(v)
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, opening);
  if (!changed) failures.push(`valve control not found when setting ${opening}`);
  await settleReact();
};

let waterEngaged = false;
for (const [name, pos, atPoint, fov, startsWater] of VIEWS) {
  // The water set drives the pump and the valve itself, then waits — see `WATER_VIEWS`.
  if (typeof startsWater === 'object' && startsWater !== null) {
    if (!waterEngaged) {
      waterEngaged = true;
      if (!(await press(/Turn On Pump/i, 0))) failures.push('water set: pump never engaged');
    }
    if (startsWater.valve !== undefined) await setValve(startsWater.valve);
    if (startsWater.drain && !(await press(/Open volumetric valve/i, 0))) {
      failures.push('water set: volumetric valve never opened');
    }
    if (startsWater.hold) await advance(startsWater.hold);
  } else if (typeof startsWater === 'number') {
    await advance(startsWater);
  }
  if (name === '4-water-active' || (startsWater === true && !waterEngaged)) {
    waterEngaged = true;
    // Engage both controls with the clock still frozen, so the jet starts from a known
    // frame rather than from wherever React happened to land.
    const on = await press(/Turn On Pump/i, 0);
    const opened = await page.evaluate(() => {
      const input = document.querySelector('.valve-slider-container input[type="range"]');
      if (!input) return false;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(
        input,
        '0.5'
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    if (!on || !opened) failures.push('water view: pump or valve control never engaged');
    await settleReact();
    await advance(FLOW);

    // The point of this view is moving water; assert there is some rather than trusting it.
    const waterVisible = await page.evaluate(() => {
      const scene = window.__three.scenes.find((s) => s.getObjectByName('deflector_rod'));
      let visible = 0;
      scene.traverse((o) => {
        if (o.isMesh && o.visible && o.material?.transmission !== undefined) {
          const box = new window.__b.B().setFromObject(o);
          if (!box.isEmpty()) visible++;
        }
      });
      return visible;
    });
    if (waterVisible === 0) failures.push('water view: no water mesh is visible');
  }
  await frame({ pos, at: atPoint, fov });
  const captured = await shot(name);
  hashes[name] = captured.hash;
  signatures[name] = captured.signature;

  // The fill level, read off the live scene rather than inferred from the picture.
  //
  // The tank-water mesh is scaled in y by the level and by nothing else, so its scale *is*
  // the level. Recording it per view turns the water set into a behavioural check as well
  // as a visual one: a capture that looks right because the tank happens to be full is not
  // the same as one where the tank filled when it was supposed to, and only this number
  // tells the two apart.
  waterState[name] = await page.evaluate(() => {
    const scene = window.__three.scenes.find((s) => s.getObjectByName('deflector_rod'));
    let tank = null;
    let jetMeshes = 0;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m || Array.isArray(m) || !m.isMeshPhysicalMaterial) return;
      if ((m.onBeforeCompile?.toString().length ?? 0) < 200) return;
      // The tank body is the one whose geometry is a cylinder built by us; the jet shapes
      // come from the GLBs and carry morph targets.
      if (o.geometry?.type === 'CylinderGeometry') tank = o;
      else if (o.visible) jetMeshes++;
    });
    return {
      level: tank ? Number(tank.scale.y.toFixed(4)) : null,
      tankVisible: tank ? tank.visible : null,
      jetMeshesVisible: jetMeshes,
    };
  });
  console.error('  shot', name);
}

const runtime = await page.evaluate(() => {
  const scene = window.__three.scenes.find((s) => s.getObjectByName('deflector_rod'));
  const renderer = window.__three.renderer;
  const info = renderer.info;
  let roomMaterials = 0;
  let roomWithDetail = 0;
  let waterCustom = 0;
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      if ((m.name || '').toLowerCase().startsWith('mergedbake')) {
        roomMaterials++;
        if (m.normalMap && m.roughnessMap) roomWithDetail++;
      }
      if (m.transmission !== undefined && (m.onBeforeCompile?.toString().length ?? 0) > 200) {
        waterCustom++;
      }
    }
  });
  return {
    calls: info.render.calls,
    triangles: info.render.triangles,
    programs: info.programs?.length ?? null,
    textures: info.memory.textures,
    geometries: info.memory.geometries,
    exposure: renderer.toneMappingExposure,
    environment: !!scene.environment,
    roomMaterials,
    roomWithDetail,
    waterCustom,
    virtualMs: window.__virtualNow(),
  };
});

fs.writeFileSync(
  path.join(OUT, 'capture.json'),
  JSON.stringify({ stepMs: STEP_MS, hashes, signatures, waterState, runtime }, null, 2)
);
console.error('runtime:', JSON.stringify(runtime));

await browser.close();
stop();
if (failures.length) {
  console.error('\ncapture completed WITH FAILURES:\n  ' + failures.join('\n  '));
  process.exit(1);
}
process.exit(0);
