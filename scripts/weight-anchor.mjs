#!/usr/bin/env node
/**
 * Loaded-weight / pan alignment capture (BEDO-016 §1, §15, §16).
 *
 * BUG-02 says loaded weights render about two metres away from the holder they are
 * supposed to be sitting on. This measures that claim against the running application
 * rather than against the source, and it does so without trusting the production code:
 * the pan's position is re-derived here, from the rod's own vertices, by an algorithm
 * written independently of `src/lib/holderAnchor.ts`. If the two ever disagree, one of
 * them is wrong and the number below says by how much.
 *
 * For each state it records
 *   - the pan plate's world position, radius and top surface, measured from geometry,
 *   - the world bounding box of every disc actually drawn on the stack,
 *   - the vector from where each disc is drawn to where the pan says it belongs,
 * and takes a screenshot in fixed framing.
 *
 * Run it before a change and after; the two files are the before/after evidence.
 *
 *   node scripts/weight-anchor.mjs --out before-bedo016.json --shots measurements/weights/before
 *
 * Options:
 *   --url <url>   page to measure (default: starts `vite preview` on dist/)
 *   --port <n>    port for the preview server (default 4319)
 *   --out <file>  output path, relative to measurements/
 *   --shots <dir> screenshot directory, relative to the repo root
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

const PORT = Number(flag('port', 4319));
const OUT = flag('out', 'weight-anchor.json');
const SHOTS = flag('shots', 'measurements/weights/shots');

/**
 * Read the pan and the loaded discs out of the live scene graph.
 *
 * Runs in the page. Deliberately self-contained and independent of the application's own
 * anchor code — see the file header.
 */
const READ_SCENE = () => {
  const r = (n) => Number(n.toFixed(6));
  const v3 = (v) => [r(v.x), r(v.y), r(v.z)];

  const scene =
    window.__three.scenes.find((s) => s.getObjectByName('deflector_rod')) ?? window.__three.scenes[0];
  const rod = scene.getObjectByName('deflector_rod');
  if (!rod) return { error: 'deflector_rod not in the scene' };

  // GLB scene root, then the apparatus group the whole rig hangs from.
  const glbRoot = rod.parent;
  const apparatus = glbRoot.parent;
  scene.updateWorldMatrix(true, true);

  // --- The pan, from the rod's vertices, in world space ----------------------------
  //
  // The rod is a shaft with a wide flat plate part-way up (the weight pan) and a thin
  // retaining post above it. The plate is the widest thing on the rod, so the vertices
  // furthest from the rod's axis are its rim, and the highest of those is its top face.
  const pts = [];
  rod.updateWorldMatrix(true, true);
  rod.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const p = new window.__THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      pts.push(p);
    }
  });
  const bx = new window.__THREE.Box3().setFromObject(rod);
  const axis = { x: (bx.min.x + bx.max.x) / 2, z: (bx.min.z + bx.max.z) / 2 };
  const radius = (p) => Math.hypot(p.x - axis.x, p.z - axis.z);
  const rMax = pts.reduce((m, p) => Math.max(m, radius(p)), 0);
  const rim = pts.filter((p) => radius(p) > rMax * 0.9);
  const rimX = rim.map((p) => p.x);
  const rimZ = rim.map((p) => p.z);
  const pan = {
    surface: [
      r((Math.min(...rimX) + Math.max(...rimX)) / 2),
      r(Math.max(...rim.map((p) => p.y))),
      r((Math.min(...rimZ) + Math.max(...rimZ)) / 2),
    ],
    outerRadius: r(rMax),
    plateBottomY: r(Math.min(...rim.map((p) => p.y))),
    postTopY: r(bx.max.y),
    rodBoxMin: v3(bx.min),
    rodBoxMax: v3(bx.max),
    rodWorldPosition: v3(rod.getWorldPosition(new window.__THREE.Vector3())),
    rodLocalPosition: v3(rod.position),
  };

  // --- The discs actually drawn on the stack ---------------------------------------
  //
  // Identified structurally: the stack lives in a group under the apparatus that is not
  // the GLB itself and that contains meshes named Weight_*. The tray originals stay
  // inside the GLB, so there is no way to confuse the two.
  const named = (o) => {
    let hit = false;
    o.traverse((c) => {
      if (/^Weight_/.test(c.name)) hit = true;
    });
    return hit;
  };
  const stackGroup = apparatus.children.find((c) => c !== glbRoot && named(c));

  const discs = [];
  if (stackGroup) {
    // The hit proxy is the slot's invisible mesh, whatever geometry it is built from.
    const isProxy = (o) => o.isMesh && o.material?.visible === false;
    stackGroup.children.forEach((slot, index) => {
      // The disc only. Measuring the whole slot would fold in the invisible hit proxy,
      // and the two are not necessarily in the same place — which is the point of §13.
      const disc = slot.children.find((c) => !isProxy(c));
      if (!disc) return;
      const box = new window.__THREE.Box3().setFromObject(disc);
      if (box.isEmpty()) return;
      const centre = box.getCenter(new window.__THREE.Vector3());
      const size = box.getSize(new window.__THREE.Vector3());
      let name = null;
      disc.traverse((c) => {
        if (!name && /^Weight_/.test(c.name)) name = c.name;
      });
      // The proxy the pointer hits, so §13/§23 can be checked against the visible disc.
      let proxy = null;
      slot.traverse((c) => {
        if (isProxy(c)) proxy = v3(c.getWorldPosition(new window.__THREE.Vector3()));
      });
      discs.push({
        index,
        mesh: name,
        slotLocalOffset: v3(slot.position),
        worldCentre: v3(centre),
        worldMin: v3(box.min),
        worldMax: v3(box.max),
        thickness: r(size.y),
        proxyWorld: proxy,
      });
    });
  }

  // Where the pan is on screen, so the close-up frames itself rather than being clipped
  // at coordinates guessed from one run's camera.
  const camera = window.__three.camera;
  let panScreen = null;
  if (camera) {
    const p = new window.__THREE.Vector3(pan.surface[0], pan.surface[1], pan.surface[2]).project(
      camera
    );
    panScreen = [
      Math.round(((p.x + 1) / 2) * window.innerWidth),
      Math.round(((1 - p.y) / 2) * window.innerHeight),
    ];
  }

  // What the loaded stack costs the scene graph, for BEDO-016 §31/§32: how many objects
  // exist in total, and how many of them the stack is responsible for.
  let objectCount = 0;
  scene.traverse(() => objectCount++);
  let stackObjects = 0;
  if (stackGroup) stackGroup.traverse(() => stackObjects++);
  const renderer = window.__three.renderer;

  return {
    apparatus: {
      position: v3(apparatus.position),
      scale: r(apparatus.scale.x),
      stackGroupLocalY: stackGroup ? r(stackGroup.position.y) : null,
    },
    cost: {
      objectCount,
      stackObjects,
      drawCalls: renderer?.info?.render?.calls ?? null,
      triangles: renderer?.info?.render?.triangles ?? null,
      programs: renderer?.info?.programs?.length ?? null,
    },
    pan,
    panScreen,
    discs,
  };
};

/**
 * Where each disc *should* be, and how far from that it actually is.
 *
 * Pure arithmetic on the captured numbers, done here rather than in the page so the raw
 * measurements in the JSON stay untouched by any opinion about what is correct.
 */
const analyse = (scene) => {
  if (!scene?.pan || !scene.discs?.length) return null;
  const [px, py, pz] = scene.pan.surface;
  let seated = py;
  return scene.discs.map((d) => {
    const wantY = seated + d.thickness / 2;
    seated += d.thickness;
    const delta = [d.worldCentre[0] - px, d.worldCentre[1] - wantY, d.worldCentre[2] - pz];
    const round = (n) => Number(n.toFixed(6));
    return {
      index: d.index,
      mesh: d.mesh,
      drawnAt: d.worldCentre,
      belongsAt: [px, wantY, pz].map(round),
      delta: delta.map(round),
      distance: round(Math.hypot(...delta)),
      /** Gap between this disc's underside and the surface it should rest on. */
      seatGap: round(d.worldMin[1] - (wantY - d.thickness / 2)),
      /** §13/§23: the invisible click target must be on the disc, not beside it. */
      proxyOffset: d.proxyWorld
        ? round(Math.hypot(...d.proxyWorld.map((v, i) => v - d.worldCentre[i])))
        : null,
    };
  });
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
        // The viewing camera is not in the scene graph, so catch the one used to draw.
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

  // The page needs no access to the application's bundle: three.js's own classes are
  // reachable from any object it has already built, so take Vector3 and Box3 from a
  // geometry's bounding box rather than importing anything.
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

  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });

  const click = async (name) => {
    await page.getByRole('button', { name }).click({ timeout: 60_000 });
  };

  fs.mkdirSync(path.join(ROOT, SHOTS), { recursive: true });
  const states = [];

  const capture = async (id, description, { settle = 2600 } = {}) => {
    await page.waitForTimeout(settle);
    const scene = await page.evaluate(READ_SCENE);
    await page.screenshot({
      path: path.join(ROOT, SHOTS, `${id}.png`),
      // Fixed framing on the tank and the tray, so every shot is comparable.
      clip: { x: 330, y: 40, width: 700, height: 620 },
    });
    // And a close-up on the holder itself, centred on the pan's own projected position —
    // identical framing before and after, because the pan does not move.
    if (scene.panScreen) {
      const [sx, sy] = scene.panScreen;
      await page.screenshot({
        path: path.join(ROOT, SHOTS, `${id}-holder.png`),
        clip: { x: Math.max(0, sx - 130), y: Math.max(0, sy - 150), width: 260, height: 220 },
      });
    }
    const alignment = analyse(scene);
    states.push({ id, description, scene, alignment });
    const worst = alignment ? Math.max(...alignment.map((a) => a.distance)) : null;
    console.log(
      `  ${id.padEnd(24)} discs=${scene.discs?.length ?? 0}  worst offset=${worst ?? '—'}` +
        `  objects=${scene.cost?.objectCount}(+${scene.cost?.stackObjects} stack)` +
        `  draws=${scene.cost?.drawCalls}  tris=${scene.cost?.triangles}`
    );
  };

  await click('Free Mode');

  await capture('A-empty', 'Empty holder — nothing on the pan');

  await click('+50g');
  await capture('B-one-weight', 'One 50 g disc on the holder');

  await click('+100g');
  await click('+200g');
  await capture('C-multiple', 'Three discs: 50 g, 100 g, 200 g');

  await click(/^Clear all weights$/);
  await page.waitForTimeout(600);
  for (const w of ['+50g', '+50g', '+100g']) await click(w);
  await capture('D-duplicates', 'Duplicate masses: 50 g, 50 g, 100 g — three distinct slots');

  // E: one second after a fourth disc is asked for.
  //
  // Deliberately not labelled "mid-flight": there is no tray -> holder transfer to catch.
  // BEDO-021 built the removal direction only, so adding a weight commits state and the
  // disc appears at once. This shot is the evidence for that finding (`docs/39 §9`, §17).
  await click('+200g');
  await capture('E-added', 'One second after +200 g — the disc arrives with no flight', {
    settle: 1000,
  });

  // F: mid-removal, the same two seconds in the other direction.
  await page.waitForTimeout(2500);
  await click(/^Remove 100 g$/);
  await capture('F-removal', 'Mid-flight, one second into a 2 s holder -> tray removal', {
    settle: 1000,
  });

  // G: the holder is not a fixed point. The rod rides the spring, so the pan moves and the
  // discs have to move with it (BEDO-016 §11, §12). Measuring the pan and the stack in the
  // same displaced state is what shows they did.
  //
  // The spring's displacement is h_F - h_w, floored at rest, so a heavy stack cancels the
  // jet and nothing moves. One light disc against a wide-open valve is what actually lifts
  // the rod, and it is the only state in which this can be observed at all.
  await page.waitForTimeout(2500);
  await click(/^Clear all weights$/);
  await page.waitForTimeout(600);
  await click('+50g');
  await click(/Turn On Pump/);
  await page.locator('.valve-slider-container input[type="range"]').fill('0.85');
  await capture('G-spring-loaded', 'One 50 g disc, pump on at n=0.85: the spring lifts the rod and its pan');

  await browser.close();
  server.kill('SIGTERM');

  const outPath = path.join(ROOT, 'measurements', OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ url, states }, null, 2)}\n`);
  console.log(`\nwritten to ${path.relative(ROOT, outPath)} and ${SHOTS}/\n`);
}

main().catch((e) => {
  console.error(`\nweight-anchor failed: ${e.message}\n`);
  process.exit(1);
});
