/**
 * What every surface in the running scene is actually made of, after classification.
 *
 * The GLB's authored values are only half the story: `DeviceModel` reclassifies each
 * material by family and `RoomLighting` hands it an environment, so the numbers that decide
 * how a surface responds exist only in the live scene. This reads them there.
 *
 * It also reports each material's world bounding box, which is what the review crops in
 * `capture.mjs` are aimed with — a close-up placed by eye drifts the moment anything moves,
 * and a crop that drifts is not a comparison.
 *
 * Usage:  node scripts/render/material-audit.mjs [outFile] [port]
 */

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../lib/preview-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.argv[2] || null;
const PORT = Number(process.argv[3] || 4957);

const { url, stop } = await startPreview({ root: ROOT, port: PORT });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  window.__three = { scenes: [] };
  window.__THREE_DEVTOOLS__ = {
    dispatchEvent(e) {
      const o = e.detail;
      if (o?.domElement && o.render) window.__three.renderer = o;
      else if (o?.isScene) window.__three.scenes.push(o);
    },
  };
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-bedo-scene-ready]', { timeout: 180000 });
// The environment probe runs two frames after the model lands and rewrites every
// material's envMap, so an audit taken too early reports a scene that never renders.
await page.waitForTimeout(4000);

const report = await page.evaluate(() => {
  const scene = window.__three.scenes.find((s) => s.getObjectByName('deflector_rod'));
  const materials = new Map();
  const round = (v) => (typeof v === 'number' ? +v.toFixed(4) : v);

  // Minimal world-space AABB, computed from geometry bounding boxes so no THREE import is
  // needed inside the page.
  const boxOf = (root) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let any = false;
    root.updateWorldMatrix(true, true);
    // Groups as well as meshes: several review targets (`deflector_rod`, `Screws`) are
    // containers in the GLB, and a null box there would silently drop the crop that aims
    // at them.
    root.traverse((object) => {
      const g = object.geometry;
      if (!object.isMesh || !g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      const m = object.matrixWorld.elements;
      any = true;
      for (let i = 0; i < 8; i++) {
        const x = i & 1 ? b.max.x : b.min.x;
        const y = i & 2 ? b.max.y : b.min.y;
        const z = i & 4 ? b.max.z : b.min.z;
        const p = [
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ];
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[k]);
          max[k] = Math.max(max[k], p[k]);
        }
      }
    });
    return any ? { min, max } : null;
  };

  scene.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of [].concat(object.material)) {
      if (!material) continue;
      let entry = materials.get(material.uuid);
      if (!entry) {
        entry = {
          name: material.name,
          type: material.type,
          meshes: [],
          visibleMeshes: 0,
          colorHexSRGB: material.color ? '#' + material.color.getHexString('srgb') : null,
          colorLinear: material.color ? material.color.toArray().map(round) : null,
          metalness: round(material.metalness),
          roughness: round(material.roughness),
          envMapIntensity: round(material.envMapIntensity),
          hasEnvMap: !!material.envMap,
          maps: {
            map: !!material.map,
            normalMap: !!material.normalMap,
            roughnessMap: !!material.roughnessMap,
            metalnessMap: !!material.metalnessMap,
            aoMap: !!material.aoMap,
            emissiveMap: !!material.emissiveMap,
          },
          emissive: material.emissive ? material.emissive.toArray().map(round) : null,
          emissiveIntensity: round(material.emissiveIntensity),
          specularIntensity: round(material.specularIntensity),
          specularColor: material.specularColor ? material.specularColor.toArray().map(round) : null,
          clearcoat: round(material.clearcoat),
          transmission: round(material.transmission),
          ior: round(material.ior),
          box: null,
        };
        materials.set(material.uuid, entry);
      }
      if (entry.meshes.length < 10) entry.meshes.push(object.name);
      if (object.visible) {
        entry.visibleMeshes++;
        const b = boxOf(object);
        if (b) {
          if (!entry.box) entry.box = b;
          else
            for (let k = 0; k < 3; k++) {
              entry.box.min[k] = Math.min(entry.box.min[k], b.min[k]);
              entry.box.max[k] = Math.max(entry.box.max[k], b.max[k]);
            }
        }
      }
    }
  });

  // Named meshes the review crops are aimed at.
  const targets = {};
  for (const name of [
    'Plane001_Baked',
    'BENCH_GROUND',
    'hydrolic_bensh_posts',
    'Weight_500',
    'Weight_200',
    'deflector_rod',
    'Screws',
    'Tank_cover',
    'JET_Force_2_205',
    'Power_Switch',
    'Bing_Sink',
    'Pitot',
    'Walls_1st_Level_Baked',
    'Object10433826_Baked',
  ]) {
    const o = scene.getObjectByName(name);
    if (!o) {
      targets[name] = null;
      continue;
    }
    const b = boxOf(o);
    targets[name] = {
      visible: o.visible,
      material: [].concat(o.material)
        .filter(Boolean)
        .map((m) => m.name),
      box: b,
      centre: b ? b.min.map((v, i) => +((v + b.max[i]) / 2).toFixed(4)) : null,
    };
  }

  const info = window.__three.renderer.info;
  return {
    runtime: {
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? null,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      exposure: window.__three.renderer.toneMappingExposure,
      hasEnvironment: !!scene.environment,
      environmentIntensity: scene.environmentIntensity,
    },
    materials: [...materials.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    targets,
  };
});

const text = JSON.stringify(report, null, 2);
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.error(`wrote ${OUT} — ${report.materials.length} materials`);
} else {
  console.log(text);
}
await browser.close();
stop();
