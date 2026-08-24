#!/usr/bin/env node
/**
 * Focused full-model validation for BEDO-044: authored water, switch spindle, camera follow.
 *
 *   node scripts/validate-044.mjs [--out measurements/bedo044.json] [--shots measurements/bedo044]
 *
 * Runs against the production build through `vite preview`, so what is measured is what
 * ships. Every check is made against the live scene graph or against projected screen
 * coordinates — never against a constant in the source, which is how a visibly broken power
 * switch passed its unit tests twice.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startPreview } from './lib/preview-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const PORT = Number(flag('port', 4372));
const OUT = flag('out', 'measurements/bedo044.json');
const SHOTS = flag('shots', 'measurements/bedo044');

/** Publishes the renderer, camera and scenes without needing the dev-only test hooks. */
const HOOK = () => {
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
};

/** Helpers installed in the page once the scene exists. */
const TOOLS = () => {
  const scene = window.__three.scenes.find((s) => s.getObjectByName('deflector_rod'));
  window.__bedo = { scene };
  const anyMesh = (() => {
    let m = null;
    scene.traverse((o) => {
      if (!m && o.isMesh) m = o;
    });
    return m;
  })();
  anyMesh.geometry.computeBoundingBox();
  const V = anyMesh.geometry.boundingBox.min.constructor;
  const B = anyMesh.geometry.boundingBox.constructor;
  window.__bedo.V = V;
  window.__bedo.B = B;

  /** Every water mesh: the ones carrying the authored cache. */
  window.__bedo.waters = () => {
    const out = [];
    scene.traverse((o) => {
      if (o.isMesh && o.morphTargetInfluences && o.morphTargetInfluences.length >= 40) out.push(o);
    });
    return out;
  };

  /** Is this object actually drawn — itself visible and every ancestor too? */
  window.__bedo.shown = (o) => {
    let n = o;
    while (n) {
      if (!n.visible) return false;
      n = n.parent;
    }
    return true;
  };

  /**
   * The frame a mesh is displaying, read back from its influences.
   * The base pose is the last frame and carries no target, so whatever weight is missing
   * from the influences belongs to it.
   */
  window.__bedo.frameOf = (mesh) => {
    const inf = mesh.morphTargetInfluences;
    const names = mesh.morphTargetDictionary || {};
    const frameOfTarget = new Array(inf.length).fill(-1);
    for (const [k, i] of Object.entries(names)) {
      const m = /^f(\d+)$/.exec(k);
      if (m) frameOfTarget[i] = Number(m[1]);
    }
    let total = 0;
    let acc = 0;
    for (let i = 0; i < inf.length; i++) {
      const f = frameOfTarget[i] >= 0 ? frameOfTarget[i] : i;
      acc += f * inf[i];
      total += inf[i];
    }
    return acc + (1 - total) * 80;
  };

  /** World bounds of a mesh with its morph targets actually applied. */
  window.__bedo.morphedBox = (mesh) => {
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    const deltas = g.morphAttributes.position || [];
    const inf = mesh.morphTargetInfluences || [];
    const active = [];
    for (let i = 0; i < inf.length; i++) if (inf[i] !== 0) active.push(i);
    mesh.updateWorldMatrix(true, false);
    const box = new B();
    box.makeEmpty();
    const v = new V();
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      for (const t of active) {
        const d = deltas[t];
        if (!d) continue;
        x += d.getX(i) * inf[t];
        y += d.getY(i) * inf[t];
        z += d.getZ(i) * inf[t];
      }
      box.expandByPoint(v.set(x, y, z).applyMatrix4(mesh.matrixWorld));
    }
    return box;
  };

  /** Screen position of a world point, in CSS pixels. */
  window.__bedo.project = (p) => {
    const cam = window.__three.camera;
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const q = p.clone().project(cam);
    return {
      x: rect.left + ((q.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - q.y) / 2) * rect.height,
    };
  };

  window.__bedo.usable = () => {
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const panels = Array.from(document.querySelectorAll('.sidebar-panel')).map((el) =>
      el.getBoundingClientRect()
    );
    let { left, top, width, height } = rect;
    for (const p of panels) {
      if (p.height >= height * 0.6) {
        const oL = p.left + p.width - left;
        const oR = left + width - p.left;
        if (oL > 0 && oL <= oR) {
          width -= oL;
          left += oL;
        } else if (oR > 0) width -= oR;
      }
    }
    return { left, top, width, height };
  };
};

async function serve() {
  // One implementation, in scripts/lib/preview-server.mjs: it owns the process
  // group and tears the server down on a throw or a Ctrl-C as well as on success.
  return startPreview({ root: ROOT, port: PORT });
}

async function main() {
  const { url, server } = await serve();
  // Real GPU rendering. Under SwiftShader this scene renders at well under one frame per
  // second, and the water clock advances on frame delta — so a software-rendered run
  // reaches frame 7 of 80 in five wall-clock seconds and can say nothing about whether the
  // emergence completes. These flags are about measuring at a realistic frame rate, not
  // about what ships.
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=metal',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      '--enable-zero-copy',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(HOOK);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bedo-scene-ready]', { timeout: 300_000 });
  await page.evaluate(TOOLS);

  fs.mkdirSync(path.join(ROOT, SHOTS), { recursive: true });
  const report = { url, water: {}, switch: {}, camera: {} };
  const btn = (n) => page.getByRole('button', { name: n });
  const press = async (n) => {
    const el = btn(n);
    if (!(await el.count())) return false;
    await el.first().dispatchEvent('click');
    await page.waitForTimeout(400);
    return true;
  };

  // ---------------------------------------------------------------- WATER
  console.log('\n== water: authored cache playback ==');
  await press('Free Mode');
  await page.waitForTimeout(800);
  await press(/Turn On Pump/);

  // Record the displayed frame and the jet's real height for five seconds.
  //
  // Sampled on a timer rather than every animation frame, and the jet is identified once:
  // measuring a morphed bounding box costs a pass over every vertex, and doing that per
  // frame per mesh starved the app's own loop badly enough that the water clock — which
  // advances on clamped frame delta — reached frame 12 in five seconds. The measurement
  // has to be cheap enough not to change what it measures.
  const trace = await page.evaluate(async () => {
    const out = [];
    const V = window.__bedo.V;
    // The valve is opened from in here, so recording can begin on the very first frame the
    // water exists. Driving it from the test runner instead loses the first few hundred
    // milliseconds to the round trip — which is most of the emergence.
    const input = document.querySelector('.valve-slider-container input[type="range"]');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    setter.call(input, '0.6');
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const appear = async () => {
      for (let i = 0; i < 200; i++) {
        const s = window.__bedo.waters().filter(window.__bedo.shown);
        if (s.length) return s;
        await new Promise((r) => requestAnimationFrame(r));
      }
      return [];
    };
    const shown = await appear();
    if (!shown.length) return out;
    // The jet is the slender one: much longer along the flow than it is across.
    const jet = shown
      .map((m) => {
        const s = window.__bedo.morphedBox(m).getSize(new V());
        return { m, aspect: s.y / Math.max(s.x, s.z, 1e-9) };
      })
      .sort((a, b) => b.aspect - a.aspect)[0].m;
    const t0 = performance.now();
    return await new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        const size = window.__bedo.morphedBox(jet).getSize(new V());
        out.push({
          t: +t.toFixed(3),
          frame: +window.__bedo.frameOf(jet).toFixed(2),
          height: +size.y.toFixed(5),
          width: +Math.max(size.x, size.z).toFixed(5),
          shown: window.__bedo.shown(jet),
        });
        if (t > 5) resolve(out);
        else setTimeout(tick, 100);
      };
      tick();
    });
  });
  report.water.trace = trace.filter((_, i) => i % 3 === 0);
  const frames = trace.map((s) => s.frame);
  const first = trace[0];
  const settled = trace[trace.length - 1];
  report.water.summary = {
    samples: trace.length,
    firstFrame: first?.frame,
    lastFrame: settled?.frame,
    minFrame: Math.min(...frames),
    maxFrame: Math.max(...frames),
    reached80AtSeconds: trace.find((s) => s.frame >= 79.9)?.t ?? null,
    monotonic: frames.every((f, i) => i === 0 || f >= frames[i - 1] - 0.01),
    grewInHeight: settled && first ? settled.height / Math.max(first.height, 1e-9) : null,
    settledHeight: settled?.height,
  };
  console.log('  ', JSON.stringify(report.water.summary));

  // Pump off, then on: the cache must replay from the first frame, not resume or reverse.
  await press(/Turn Off Pump/);
  await page.waitForTimeout(900);
  await press(/Turn On Pump/);
  await page.locator('.valve-slider-container input[type="range"]').fill('0.6');
  await page.waitForTimeout(120);
  const restart = await page.evaluate(async () => {
    for (let i = 0; i < 240; i++) {
      const shown = window.__bedo.waters().filter(window.__bedo.shown);
      if (shown.length) return +window.__bedo.frameOf(shown[0]).toFixed(2);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return null;
  });
  report.water.restartFrame = restart;
  console.log('   restart frame after pump cycle:', restart);

  // ---------------------------------------------------------------- SWITCH
  console.log('\n== switch: spindle motion ==');
  await page.waitForTimeout(600);
  const samples = [];
  for (const label of ['off-0', 'on']) {
    if (label === 'on') {
      await press(/Turn On Pump/).catch(() => {});
    }
    samples.push(
      await page.evaluate(() => {
        const knob = window.__bedo.scene.getObjectByName('Power_Switch');
        const pivot = knob.parent;
        pivot.updateWorldMatrix(true, false);
        const p = new window.__bedo.V().setFromMatrixPosition(pivot.matrixWorld);
        const box = new window.__bedo.B().setFromObject(knob);
        const c = box.getCenter(new window.__bedo.V());
        return {
          pivotWorld: [p.x, p.y, p.z],
          knobCentre: [c.x, c.y, c.z],
          quat: pivot.quaternion.toArray(),
        };
      })
    );
    await page.waitForTimeout(900);
  }
  report.switch.samples = samples;

  // Fine-grained sweep straight off the live pivot, at controlled fractions.
  const sweep = await page.evaluate(async () => {
    const knob = window.__bedo.scene.getObjectByName('Power_Switch');
    const pivot = knob.parent;
    const V = window.__bedo.V;
    // The axis the scene derived, recovered from the pivot's own current rotation.
    const out = [];
    const axis = new V();
    let angle = 0;
    {
      const q = pivot.quaternion;
      angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      const s = Math.sqrt(1 - q.w * q.w);
      if (s > 1e-6) axis.set(q.x / s, q.y / s, q.z / s).normalize();
    }
    const pivotWorld = new V().setFromMatrixPosition(pivot.matrixWorld);
    const geom = knob.geometry.getAttribute('position');
    // Furthest vertex off the axis: the indicator tip.
    let marker = new V();
    let best = -1;
    knob.updateWorldMatrix(true, false);
    for (let i = 0; i < geom.count; i++) {
      const v = new V().fromBufferAttribute(geom, i).applyMatrix4(knob.matrixWorld);
      const r = v.clone().sub(pivotWorld);
      r.addScaledVector(axis, -r.dot(axis));
      if (r.length() > best) {
        best = r.length();
        marker = v.clone();
      }
    }
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const turn = (Math.PI / 2) * f;
      const local = marker.clone().sub(pivotWorld);
      const rotated = local.clone().applyAxisAngle(axis, turn);
      const along = rotated.dot(axis);
      const radial = rotated.clone().addScaledVector(axis, -along);
      out.push({
        f,
        radius: +radial.length().toFixed(9),
        along: +along.toFixed(9),
      });
    }
    return { axis: axis.toArray().map((v) => +v.toFixed(5)), angleDeg: +((angle * 180) / Math.PI).toFixed(3), markerRadius: +best.toFixed(6), out };
  });
  report.switch.sweep = sweep;
  const radii = sweep.out.map((s) => s.radius);
  const alongs = sweep.out.map((s) => s.along);
  report.switch.verdict = {
    axis: sweep.axis,
    restAngleDeg: sweep.angleDeg,
    radiusDrift: +(Math.max(...radii) - Math.min(...radii)).toFixed(9),
    planeDrift: +(Math.max(...alongs) - Math.min(...alongs)).toFixed(9),
  };
  console.log('  ', JSON.stringify(report.switch.verdict));

  // Visual acceptance frames.
  await page.evaluate(() => {
    const rod = window.__bedo.scene.getObjectByName('Power_Switch');
    const box = new window.__bedo.B().setFromObject(rod);
    window.__bedo.switchCentre = box.getCenter(new window.__bedo.V());
  });
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    await page.evaluate((frac) => {
      const knob = window.__bedo.scene.getObjectByName('Power_Switch');
      const pivot = knob.parent;
      const q = pivot.quaternion;
      const s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
      const axis = new window.__bedo.V(1, 0, 0);
      if (s > 1e-6) axis.set(q.x / s, q.y / s, q.z / s).normalize();
      pivot.quaternion.setFromAxisAngle(axis, (Math.PI / 2) * frac);
      pivot.updateWorldMatrix(true, true);
      window.__bedo.frozen = true;
    }, f);
    const shot = await page.evaluate(() => {
      const p = window.__bedo.project(window.__bedo.switchCentre.clone());
      return p;
    });
    const half = 150;
    await page.screenshot({
      path: path.join(ROOT, SHOTS, `switch-${Math.round(f * 100)}.png`),
      clip: {
        x: Math.max(0, Math.min(1920 - half * 2, shot.x - half)),
        y: Math.max(0, Math.min(1080 - half * 2, shot.y - half)),
        width: half * 2,
        height: half * 2,
      },
    });
  }
  console.log('   switch frames captured');

  await browser.close();
  server.kill('SIGTERM');
  const outPath = path.join(ROOT, OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwritten to ${path.relative(ROOT, outPath)} and ${SHOTS}/\n`);
}

main().catch((e) => {
  console.error(`\nvalidate-044 failed: ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
