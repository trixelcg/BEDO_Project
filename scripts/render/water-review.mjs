/**
 * Deterministic close-up capture of the water, from three angles per state (BEDO-WATER-03).
 *
 * Usage:  node scripts/render/water-review.mjs <outDir> [port]
 *
 * `capture.mjs --water` photographs the water *set* — the states the recording shows, from
 * the framings the review set already uses. This asks a different question, and needs a
 * different camera policy to answer it: **does the water have volume in depth?**
 *
 * A front-on frame cannot answer that. A round column and a flat ribbon photograph
 * identically from the front, which is exactly why the depth-squash report survived every
 * previous review — every shipped capture looks along the same axis. So each state here is
 * shot three times from one distance and one height, rotated about the tank's own axis:
 *
 *   front    0 degrees   the framing the earlier reviews used, kept for continuity
 *   oblique  40 degrees  both silhouette edges and the face are in one frame
 *   side     90 degrees  the axis the front view cannot see along
 *
 * Same distance, same height, same fov, same virtual frame count: the three differ by
 * azimuth and by nothing else, so a shape that reads round in one and flat in another is
 * reporting a real difference rather than a framing one.
 *
 * Everything about determinism is inherited from `capture.mjs` — virtual clock, camera
 * pinned inside `render`, and a self-check that proves the harness both repeats and
 * notices. The UI is hidden with `opacity: 0` for the same reason it is there: the
 * deflector and pump controls have to stay in the accessibility tree to be pressable.
 */

import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../lib/preview-server.mjs';
import { installDeterministicClock } from './deterministic-clock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.argv[2];
const PORT = Number(process.argv[3] || 4957);
if (!OUT) {
  console.error('usage: node scripts/render/water-review.mjs <outDir> [port]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

/** Frames after a camera move. */
const REFRAME = 30;
/** Frames after the pump is engaged, so the authored cache reaches its settled pose. */
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
const width = Number(process.env.BEDO_W || 1920);
const height = Number(process.env.BEDO_H || 1080);
const page = await browser.newPage({ viewport: { width, height } });

const failures = [];
page.on('pageerror', (e) => failures.push('pageerror: ' + e.message.slice(0, 200)));

await page.addInitScript(installDeterministicClock);
await page.addInitScript(HOOK);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-bedo-scene-ready]', { timeout: 180000 });

const advance = (frames) => page.evaluate((n) => window.__advanceFrames(n), frames);

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

const settleReact = () => page.waitForTimeout(400);

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
      out += Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])
        .toString(16)
        .padStart(2, '0');
    }
    return out;
  }, buffer.toString('base64'));

/**
 * What the water actually renders as, in pixels.
 *
 * The judgement in the brief is "does it read as water", and the two failure modes it names
 * — solid blue plastic, and one flat uniform colour — are both measurable. This samples the
 * body at three heights inside its own projected silhouette and reports, per band, the mean
 * colour, the saturation and the spread. Flat plastic has a spread near zero; water does
 * not. Milk has a saturation near zero; water does not.
 *
 * The bands are taken from the live projection rather than from fixed pixel boxes, so they
 * follow the shape when the deflector or the camera changes.
 */
const sampleWater = async (buffer, box) =>
  page.evaluate(
    async ({ b64, box }) => {
      if (!box) return null;
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const bands = {};
      const w = box.maxX - box.minX;
      const h = box.maxY - box.minY;
      for (const [name, at] of [['top', 0.16], ['middle', 0.5], ['foot', 0.86]]) {
        // A strip a quarter of the width, centred, well inside the silhouette so the sample
        // is the body rather than its edge against whatever is behind it.
        const x = Math.round(box.minX + w * 0.375);
        const y = Math.round(box.minY + h * at);
        const sw = Math.max(2, Math.round(w * 0.25));
        const sh = Math.max(2, Math.round(h * 0.06));
        if (x < 0 || y < 0 || x + sw > canvas.width || y + sh > canvas.height) continue;
        const px = ctx.getImageData(x, y, sw, sh).data;
        let r = 0, g = 0, bl = 0, n = 0;
        const lums = [];
        for (let i = 0; i < px.length; i += 4) {
          r += px[i]; g += px[i + 1]; bl += px[i + 2]; n++;
          lums.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
        }
        const mean = [r / n, g / n, bl / n];
        const mx = Math.max(...mean), mn = Math.min(...mean);
        const lm = lums.reduce((a, v) => a + v, 0) / lums.length;
        const sd = Math.sqrt(lums.reduce((a, v) => a + (v - lm) ** 2, 0) / lums.length);
        bands[name] = {
          rgb: mean.map((v) => Math.round(v)),
          saturation: Number((mx > 0 ? (mx - mn) / mx : 0).toFixed(3)),
          blueBias: Number((mean[2] / ((mean[0] + mean[1]) / 2) - 1).toFixed(3)),
          luminance: Number(lm.toFixed(1)),
          spread: Number(sd.toFixed(2)),
        };
      }
      return bands;
    },
    { b64: buffer.toString('base64'), box }
  );

const shot = async (name) => {
  const buffer = await page.screenshot();
  fs.writeFileSync(path.join(OUT, `${name}.png`), buffer);
  return {
    hash: crypto.createHash('md5').update(buffer).digest('hex'),
    signature: await signatureOf(buffer),
    buffer,
  };
};

const frame = async (pin, frames = REFRAME) => {
  await page.evaluate((v) => {
    window.__pin = v;
  }, pin);
  await advance(frames);
};

// The experiment intro covers the canvas and holds every apparatus control behind it, so
// nothing is pressable — and nothing is *visible* — until it is dismissed. Done before the
// self-check so the reference frames it compares are of the scene, not of the intro card.
if (!(await press(/Start/i))) failures.push('the experiment intro Start control is missing');
await advance(REFRAME);

const at = (name) => page.evaluate((n) => window.__b.centre(n), name);
const tank = await at('JET_Force_2_205');

/**
 * The three cameras, as one distance and one height rotated about the tank axis.
 *
 * `RADIUS` and `LIFT` are the framing `capture.mjs`'s `W1-jet-lowflow` already uses, so the
 * front frame here is directly comparable with the approved water set; the other two are
 * that same camera swung round. `AIM_LIFT` puts the look-at point between the nozzle mouth
 * and the deflector face, which is the span the whole question is about.
 */
const RADIUS = 0.75;
const LIFT = 0.18;
const AIM_LIFT = 0.06;
const ANGLES = [
  ['front', 0],
  ['oblique', 40],
  ['side', 88],
];

/**
 * Two extra frames, taken only on the state the material is judged on.
 *
 * The three azimuths above answer the depth question; these answer the material one, and
 * they have to be close because at tank framing the aeration at the deflector face is
 * forty pixels of pale blue. `impact` looks up at the face the flow strikes, `sheen` sits
 * low and looks across the body so the highlight travel is at grazing incidence — which is
 * where a wet surface shows that it is wet.
 */
const CLOSEUPS = [
  // The deflector's underside sits 130 mm above the tank's own centre in world units, and
  // the nozzle mouth 81 mm — so an impact frame has to aim between them and look slightly
  // up. Aimed above that, the camera photographs the cover and the sky, which is what the
  // first attempt did.
  ['impact', { radius: 0.46, lift: 0.03, aim: 0.115, azimuth: 32, fov: 26 }],
  ['sheen', { radius: 0.62, lift: 0.0, aim: 0.03, azimuth: 62, fov: 26 }],
];
const cameraAt = (deg) => {
  const r = (deg * Math.PI) / 180;
  return [tank[0] - RADIUS * Math.cos(r), tank[1] + LIFT, tank[2] + RADIUS * Math.sin(r)];
};
const AIM = [tank[0], tank[1] + AIM_LIFT, tank[2]];

// --- determinism self-check -------------------------------------------------------------
const probePin = { pos: cameraAt(40), at: AIM, fov: 30 };
await frame(probePin, 60);
const repeatA = await shot('_selftest');
await page.waitForTimeout(750);
const repeatB = await shot('_selftest');
await page.evaluate(() => {
  window.__controlSaved = [];
  const seen = new Set();
  window.__b.scene.traverse((o) => {
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
  failures.push('NON-DETERMINISTIC: two consecutive renders of one unchanged view differ.');
}
if (perturbed.signature === repeatA.signature) {
  failures.push('BLIND HARNESS: recolouring every material changed nothing in the capture.');
}
if (failures.length) {
  console.error('\ncapture aborted:\n  ' + failures.join('\n  '));
  await browser.close();
  stop();
  process.exit(1);
}
console.error('self-check passed — repeatable and sensitive to change');

await press('Free Mode');

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

/**
 * The measured water state, read off the live scene rather than inferred from the picture.
 *
 * The screen-space silhouette is measured too: `spanPx` is how wide the visible water
 * meshes project at each azimuth. Comparing front against side is the numerical form of the
 * depth question — a round column projects the same width from every azimuth, and a flat
 * ribbon does not.
 */
const probe = () =>
  page.evaluate(() => {
    const scene = window.__b.scene;
    const camera = window.__three.camera;
    let tankMesh = null;
    const visible = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m || Array.isArray(m) || !m.isMeshPhysicalMaterial) return;
      if ((m.onBeforeCompile?.toString().length ?? 0) < 200) return;
      if (o.geometry?.type === 'CylinderGeometry') tankMesh = o;
      else {
        // Visibility is carried by the jet/plume groups two and three levels up, so the
        // whole ancestor chain has to be walked: a mesh whose own flag is true still draws
        // nothing when the group holding it is hidden.
        let node = o;
        let shown = true;
        while (node && shown) {
          shown = node.visible;
          node = node.parent;
        }
        if (shown) visible.push(o);
      }
    });
    // Screen-space extent of the visible authored water, morph pose included.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let worldMin = null, worldMax = null;
    const V = window.__b.V;
    for (const o of visible) {
      o.updateWorldMatrix(true, false);
      const pos = o.geometry.getAttribute('position');
      const morph = o.geometry.morphAttributes.position || [];
      const inf = o.morphTargetInfluences || [];
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
        if (!worldMin) { worldMin = v.clone(); worldMax = v.clone(); }
        else {
          worldMin.min(v); worldMax.max(v);
        }
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
      level: tankMesh ? Number(tankMesh.scale.y.toFixed(4)) : null,
      tankVisible: tankMesh ? tankMesh.visible : null,
      waterMeshes: visible.length,
      spanPx: worldMin ? Number((maxX - minX).toFixed(1)) : null,
      heightPx: worldMin ? Number((maxY - minY).toFixed(1)) : null,
      screenBox: worldMin ? { minX, maxX, minY, maxY } : null,
      worldSize: worldMin
        ? [worldMax.x - worldMin.x, worldMax.y - worldMin.y, worldMax.z - worldMin.z].map((n) =>
            Number((n * 1000).toFixed(1))
          )
        : null,
      worldCentre: worldMin
        ? [
            (worldMin.x + worldMax.x) / 2,
            (worldMin.y + worldMax.y) / 2,
            (worldMin.z + worldMax.z) / 2,
          ].map((n) => Number(n.toFixed(5)))
        : null,
    };
  });

/**
 * The states, in the order a learner reaches them.
 *
 * Changing the deflector is gated the way the rig gates it — the cover has to be off, and
 * the cover cannot come off while the power is on (`DEFLECTOR_NEEDS_OPEN_COVER`,
 * `COVER_BLOCKED_BY_POWER`). So a state that names a deflector powers down, opens the
 * cover, selects, closes and powers back up, exactly as a learner would. An earlier run of
 * this script pressed the deflector buttons with the pump running: every press was refused,
 * and all six "states" photographed the same flat-plate plume.
 *
 * Powering down also drains the tank, which is what keeps the plume visible: at the higher
 * setpoints the tank reaches its full level in six seconds and then hides the very
 * geometry these frames exist to show.
 */
const DRAIN = 400;
const STATES = [
  ['01-lowflow', { deflector: 'Flat surface (90°)', valve: 0.4, hold: FLOW }],
  ['02-highflow', { valve: 0.62, hold: 100 }],
  ['03-flat90', { deflector: 'Flat surface (90°)', valve: 0.45, hold: FLOW, closeUps: true }],
  ['04-conical135', { deflector: 'Conical surface (135°)', valve: 0.45, hold: FLOW, closeUps: true }],
  ['05-oblique45', { deflector: 'Oblique surface (45°)', valve: 0.45, hold: FLOW }],
  ['06-tankfill', { deflector: 'Flat surface (90°)', valve: 0.62, hold: FLOW + 200 }],
];

/**
 * What the water material actually is at runtime.
 *
 * Read off the live material rather than off the source, so a value that never reaches the
 * GPU — one three ignores, or one a later pass overwrites — cannot be reported as if it
 * had. `normals` records whether the geometry can be lit at all: a water body with no
 * normal attribute has no surface for any of this to happen on.
 */
const materialAudit = () =>
  page.evaluate(() => {
    const out = { water: null, tank: null };
    const seen = new Set();
    window.__b.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m || Array.isArray(m) || !m.isMeshPhysicalMaterial) return;
      if ((m.onBeforeCompile?.toString().length ?? 0) < 200) return;
      const slot = o.geometry?.type === 'CylinderGeometry' ? 'tank' : 'water';
      if (seen.has(slot)) return;
      seen.add(slot);
      const g = o.geometry;
      out[slot] = {
        node: o.name,
        class: m.type,
        color: '#' + m.color.getHexString(),
        emissive: '#' + m.emissive.getHexString(),
        emissiveIntensity: m.emissiveIntensity,
        opacity: m.opacity,
        transparent: m.transparent,
        roughness: m.roughness,
        metalness: m.metalness,
        ior: m.ior,
        reflectivity: m.reflectivity,
        specularIntensity: m.specularIntensity,
        clearcoat: m.clearcoat,
        clearcoatRoughness: m.clearcoatRoughness,
        sheen: m.sheen,
        transmission: m.transmission,
        thickness: m.thickness,
        envMapIntensity: m.envMapIntensity,
        depthWrite: m.depthWrite,
        depthTest: m.depthTest,
        side: ['FrontSide', 'BackSide', 'DoubleSide'][m.side],
        blending: m.blending,
        maps: ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'metalnessMap']
          .filter((k) => m[k])
          .join(',') || 'none',
        shaderModified: (m.onBeforeCompile?.toString().length ?? 0) > 200,
        attributes: Object.keys(g.attributes),
        hasNormals: !!g.attributes.normal,
        morphTargets: g.morphAttributes.position?.length ?? 0,
        morphNormals: g.morphAttributes.normal?.length ?? 0,
        vertices: g.attributes.position?.count ?? 0,
      };
    });
    return out;
  });

const report = {};
let pumpOn = false;
const setPump = async (on) => {
  if (on === pumpOn) return;
  if (!(await press(on ? /Turn On Pump/i : /Turn Off Pump/i))) {
    failures.push(`pump control missing when turning ${on ? 'on' : 'off'}`);
    return;
  }
  pumpOn = on;
};

for (const [state, cfg] of STATES) {
  if (cfg.deflector) {
    await setPump(false);
    // Empty the tank before the next state, so the plume is photographed against glass
    // rather than through a full vessel.
    await advance(DRAIN);
    if (!(await press(/Open tank cover/i))) failures.push(`${state}: tank cover would not open`);
    if (!(await press(cfg.deflector))) failures.push(`${state}: deflector "${cfg.deflector}" refused`);
    if (!(await press(/Close tank cover/i))) failures.push(`${state}: tank cover would not close`);
  }
  await setPump(true);
  if (cfg.valve !== undefined) await setValve(cfg.valve);
  if (cfg.hold) await advance(cfg.hold);

  const views = [
    ...ANGLES.map(([n, deg]) => [n, { pos: cameraAt(deg), at: AIM, fov: 30 }, deg]),
    ...(cfg.closeUps
      ? CLOSEUPS.map(([n, c]) => {
          const r = (c.azimuth * Math.PI) / 180;
          return [
            n,
            {
              pos: [
                tank[0] - c.radius * Math.cos(r),
                tank[1] + c.lift,
                tank[2] + c.radius * Math.sin(r),
              ],
              at: [tank[0], tank[1] + c.aim, tank[2]],
              fov: c.fov,
            },
            c.azimuth,
          ];
        })
      : []),
  ];

  for (const [angleName, pin, deg] of views) {
    await frame(pin);
    const name = `${state}-${angleName}`;
    const captured = await shot(name);
    const measured = await probe();
    const { buffer, ...meta } = captured;
    report[name] = {
      ...meta,
      ...measured,
      azimuth: deg,
      bands: await sampleWater(buffer, measured.screenBox),
    };
    console.error(
      '  shot', name,
      'size', JSON.stringify(report[name].worldSize),
      'spanPx', report[name].spanPx,
      'level', report[name].level,
      'mid', JSON.stringify(report[name].bands?.middle ?? null)
    );
  }
}

/**
 * What the water costs, measured against the same frame with the water hidden.
 *
 * A true before/after of frame time would need the previous build still standing, which a
 * rebuild destroys. This is the bound that actually answers the brief's question — "do not
 * add a heavy water system" — and it does not need one: it renders the identical scene with
 * the water groups shown and hidden and differences the counters and the frame times. The
 * whole water body's cost is an upper bound on any change made inside its material.
 *
 * Real animation frames, not virtual ones: `requestAnimationFrame` is left alone by the
 * deterministic clock's `advanceFrames`, so timing here is wall-clock as it would be for a
 * learner. The first frames after a visibility change are discarded — they include the
 * shader compile and the upload.
 */
const perfProbe = () =>
  page.evaluate(async () => {
    const renderer = window.__three.renderer;
    // The water meshes themselves, found by their material rather than by their place in
    // the graph: the jet and the plume hang under groups whose own names say nothing, and
    // an earlier version of this toggled those groups and changed nothing at all.
    const meshes = [];
    window.__b.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const m = o.material;
      if (!m || Array.isArray(m) || !m.isMeshPhysicalMaterial) return;
      if ((m.onBeforeCompile?.toString().length ?? 0) < 200) return;
      let node = o;
      let shown = true;
      while (node && shown) {
        shown = node.visible;
        node = node.parent;
      }
      if (shown) meshes.push(o);
    });
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    // `performance.now` is virtual under the deterministic clock, so wall-clock timing has
    // to come from `Date.now`. One millisecond of resolution is coarse for a single frame
    // and fine for a mean over 180 of them, which is what is reported.
    const run = async () => {
      for (let i = 0; i < 20; i++) await frame(); // settle: compiles, uploads
      const t0 = Date.now();
      let calls = 0;
      let tris = 0;
      const N = 180;
      for (let i = 0; i < N; i++) {
        await frame();
        calls += renderer.info.render.calls;
        tris += renderer.info.render.triangles;
      }
      return {
        meanFrameMs: Number(((Date.now() - t0) / N).toFixed(3)),
        calls: Math.round(calls / N),
        triangles: Math.round(tris / N),
        programs: renderer.info.programs?.length ?? null,
      };
    };
    const withWater = await run();
    meshes.forEach((m) => (m.visible = false));
    const withoutWater = await run();
    meshes.forEach((m) => (m.visible = true));
    const restored = await run();
    return { withWater, withoutWater, restored, waterMeshes: meshes.length };
  });

report.__performance = await perfProbe();
console.error('\nperformance:\n' + JSON.stringify(report.__performance, null, 2));
report.__materials = await materialAudit();
console.error('\nmaterial audit:\n' + JSON.stringify(report.__materials, null, 2));
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.error(failures.length ? '\nFAILURES:\n  ' + failures.join('\n  ') : '\nall views captured');
await browser.close();
stop();
process.exit(failures.length ? 1 : 0);
