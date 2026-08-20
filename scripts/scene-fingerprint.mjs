#!/usr/bin/env node
/**
 * Scene fingerprint — proof that a refactor did not move anything (BEDO-003).
 *
 * Reads the *live* three.js scene graph out of a running page and prints a deterministic
 * summary of everything the eye and the pointer depend on: renderer exposure, every
 * light, the apparatus transform, the world transform of every mesh the runtime drives,
 * every invisible click hotspot, the glass material on the tank cover, and the camera.
 *
 * The point is to be able to say "nothing moved" with evidence rather than confidence.
 * Capture before a change, capture after, `diff` the two files.
 *
 *   node scripts/scene-fingerprint.mjs --out before.json
 *   ...make the change...
 *   node scripts/scene-fingerprint.mjs --out after.json
 *   diff before.json after.json     # must be empty
 *
 * It reaches the scene through three.js's own `__THREE_DEVTOOLS__` hook, installed before
 * any page script runs, so the application needs no instrumentation and is unaware of it.
 *
 * Options:
 *   --url <url>   page to measure (default: starts `vite preview` on dist/)
 *   --port <n>    port for the preview server (default 4189)
 *   --out <file>  output path, relative to measurements/ (default fingerprint.json)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const PORT = Number(flag('port', 4189));
const OUT = flag('out', 'fingerprint.json');

/** Installed before page scripts: three.js hands every Scene and Renderer to this. */
const DEVTOOLS_HOOK = () => {
  window.__three = { scenes: [], renderers: [] };
  window.__THREE_DEVTOOLS__ = {
    dispatchEvent(event) {
      const object = event.detail;
      if (object?.isScene) {
        window.__three.scenes.push(object);
        return;
      }
      if (!object?.domElement) return;
      window.__three.renderers.push(object);
      // The viewing camera is not part of the scene graph, so catch the one actually
      // used to draw. ContactShadows renders with its own orthographic camera into a
      // target, so only the perspective camera is kept.
      const render = object.render.bind(object);
      object.render = (scene, camera) => {
        if (camera?.isPerspectiveCamera) window.__three.camera = camera;
        return render(scene, camera);
      };
    },
  };
};

/**
 * Runs in the page. Everything is rounded, so floating-point noise cannot make two
 * identical scenes look different.
 */
const EXTRACT = (names) => {
  const round = (n) => (typeof n === 'number' ? Number(n.toFixed(6)) : n);
  const vec = (v) => (v ? [round(v.x), round(v.y), round(v.z)] : null);
  const quat = (q) => (q ? [round(q.x), round(q.y), round(q.z), round(q.w)] : null);

  const scene = window.__three.scenes.find((s) => s.children.length > 0) ?? window.__three.scenes[0];
  const renderer = window.__three.renderers[0];
  if (!scene) throw new Error('no three.js scene observed');

  const world = (object) => {
    object.updateWorldMatrix(true, false);
    const position = new (object.position.constructor)();
    const scale = new (object.position.constructor)();
    const quaternion = new (object.quaternion.constructor)();
    object.matrixWorld.decompose(position, quaternion, scale);
    return { position: vec(position), quaternion: quat(quaternion), scale: vec(scale) };
  };

  // Lights, in traversal order.
  const lights = [];
  scene.traverse((child) => {
    if (!child.isLight) return;
    lights.push({
      type: child.type,
      name: child.name || null,
      intensity: round(child.intensity),
      color: child.color?.getHexString() ?? null,
      position: vec(child.position),
      castShadow: !!child.castShadow,
      shadowMapSize: child.shadow ? [child.shadow.mapSize.width, child.shadow.mapSize.height] : null,
      shadowBias: child.shadow ? round(child.shadow.bias) : null,
    });
  });

  // Every mesh the runtime drives, by its sanitised name.
  const tracked = {};
  const wanted = new Set(names);
  scene.traverse((child) => {
    if (!wanted.has(child.name)) return;
    tracked[child.name] = { ...world(child), visible: child.visible };
  });

  // The invisible click spheres: geometry radius plus where they sit in the world.
  const hotspots = [];
  scene.traverse((child) => {
    if (!child.isMesh || child.material?.visible !== false) return;
    if (child.geometry?.type !== 'SphereGeometry') return;
    hotspots.push({
      radius: round(child.geometry.parameters.radius),
      local: vec(child.position),
      world: world(child).position,
    });
  });
  hotspots.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  // The apparatus group: the ancestor that carries the model's scale.
  let apparatus = null;
  const cover = scene.getObjectByName('Tank_cover');
  for (let node = cover?.parent; node; node = node.parent) {
    if (node.scale.x !== 1) {
      apparatus = { ...world(node), local: { position: vec(node.position), quaternion: quat(node.quaternion), scale: vec(node.scale) } };
      break;
    }
  }

  // The glass the cover is made of.
  const coverMaterial = cover?.material
    ? {
        type: cover.material.type,
        roughness: round(cover.material.roughness),
        metalness: round(cover.material.metalness),
        transmission: round(cover.material.transmission),
        ior: round(cover.material.ior),
        thickness: round(cover.material.thickness),
        clearcoat: round(cover.material.clearcoat),
        clearcoatRoughness: round(cover.material.clearcoatRoughness),
        specularIntensity: round(cover.material.specularIntensity),
        envMapIntensity: round(cover.material.envMapIntensity),
        opacity: round(cover.material.opacity),
        depthWrite: cover.material.depthWrite,
      }
    : null;

  // A census of envMapIntensity across the model proves `reflection` was applied.
  const envMapIntensities = {};
  scene.traverse((child) => {
    if (!child.isMesh || !child.material || child.material.envMapIntensity === undefined) return;
    const key = String(round(child.material.envMapIntensity));
    envMapIntensities[key] = (envMapIntensities[key] ?? 0) + 1;
  });

  const camera = window.__three.renderers[0]?.__camera ?? null;

  return {
    renderer: renderer
      ? {
          toneMapping: renderer.toneMapping,
          toneMappingExposure: round(renderer.toneMappingExposure),
          outputColorSpace: renderer.outputColorSpace,
          shadowMapEnabled: renderer.shadowMap.enabled,
          shadowMapType: renderer.shadowMap.type,
        }
      : null,
    scene: {
      environmentIntensity: round(scene.environmentIntensity),
      backgroundIntensity: round(scene.backgroundIntensity),
      backgroundRotation: round(scene.background?.rotation ?? null),
      backgroundMapping: scene.background?.mapping ?? null,
      backgroundColorSpace: scene.background?.colorSpace ?? null,
      objectCount: (() => {
        let n = 0;
        scene.traverse(() => n++);
        return n;
      })(),
    },
    lights,
    apparatus,
    trackedMeshes: tracked,
    hotspots,
    coverMaterial,
    envMapIntensities,
    camera,
  };
};

async function servePreview() {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/ has no index.html — run `npm run build` first, or pass --url.');
  }
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = `http://localhost:${PORT}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (Date.now() > deadline) {
      server.kill('SIGTERM');
      throw new Error('vite preview did not come up within 30 s');
    }
    try {
      if ((await fetch(url)).ok) return { url, server };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  const { MESH, DEFLECTORS, WEIGHTS, gltfName } = await loadApparatus();
  const names = [
    ...Object.values(MESH),
    ...DEFLECTORS.flatMap((d) => [d.shelf, d.installed]),
    ...WEIGHTS.filter((w) => w.mesh).map((w) => w.mesh),
  ].map(gltfName);

  let server = null;
  let url = flag('url');
  if (!url) ({ url, server } = await servePreview());

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(DEVTOOLS_HOOK);

  const requests = [];
  page.on('request', (request) => {
    const url = request.url();
    // GLTFLoader mints a blob: URL per embedded texture; those carry a fresh UUID every
    // run and say nothing about what the app fetched.
    if (url.startsWith('blob:') || url.startsWith('data:')) return;
    requests.push(new URL(url).pathname);
  });
  const failures = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bedo-scene-ready]', { timeout: 300_000 });
  // One more frame so the material/visibility effects have all run.
  await page.waitForFunction(() => window.__three?.scenes?.length > 0);
  await page.waitForTimeout(1500);

  const fingerprint = await page.evaluate(EXTRACT, names);
  const camera = await page.evaluate(() => {
    const round = (n) => (typeof n === 'number' ? Number(n.toFixed(6)) : n);
    const cam = window.__three.camera;
    if (!cam) return null;
    return {
      type: cam.type,
      position: [round(cam.position.x), round(cam.position.y), round(cam.position.z)],
      quaternion: [
        round(cam.quaternion.x),
        round(cam.quaternion.y),
        round(cam.quaternion.z),
        round(cam.quaternion.w),
      ],
      fov: round(cam.fov),
      aspect: round(cam.aspect),
      near: round(cam.near),
      far: round(cam.far),
      zoom: round(cam.zoom),
    };
  });

  await browser.close();
  server?.kill('SIGTERM');

  const result = {
    url,
    ...fingerprint,
    camera,
    network: {
      requestedPaths: [...new Set(requests)].sort(),
      failedResponses: [...new Set(failures)].sort(),
      consoleErrors: [...new Set(consoleErrors)].sort(),
    },
  };

  const outPath = path.join(ROOT, 'measurements', OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`fingerprint written to ${path.relative(ROOT, outPath)}`);
  console.log(`  objects ${result.scene.objectCount}  lights ${result.lights.length}  ` +
    `tracked ${Object.keys(result.trackedMeshes).length}  hotspots ${result.hotspots.length}`);
  console.log(`  requests ${result.network.requestedPaths.length}  ` +
    `failed ${result.network.failedResponses.length}  console errors ${result.network.consoleErrors.length}`);
  if (result.network.failedResponses.length) {
    console.log(`  failing: ${result.network.failedResponses.join(', ')}`);
  }
}

/** Reads the apparatus name tables straight from source, without a TS build step. */
async function loadApparatus() {
  // Identity lives in the domain (BEDO-005); the three.js name mapping lives in src/lib.
  const source = fs.readFileSync(path.join(ROOT, 'src', 'domain', 'apparatus.ts'), 'utf8');
  const mesh = Object.fromEntries(
    [...source.matchAll(/^\s{2}(\w+):\s*'([^']+)',$/gm)].map((m) => [m[1], m[2]])
  );
  const deflectors = [...source.matchAll(/shelf: '([^']+)',\s*\n\s*installed: '([^']+)'/g)].map(
    (m) => ({ shelf: m[1], installed: m[2] })
  );
  const weights = [...source.matchAll(/\{ grams: \d+, mesh: '([^']+)' \}/g)].map((m) => ({
    mesh: m[1],
  }));
  return {
    MESH: mesh,
    DEFLECTORS: deflectors,
    WEIGHTS: weights,
    gltfName: (authored) => authored.replace(/\s/g, '_').replace(/[[\]./:]/g, ''),
  };
}

main().catch((error) => {
  console.error(`\nscene-fingerprint failed: ${error.message}\n`);
  process.exit(1);
});
