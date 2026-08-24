#!/usr/bin/env node
/**
 * Performance measurement harness (BEDO-002 §10).
 *
 * Captures, in one reproducible run, the numbers `docs/11` tracks:
 *
 *   - draw calls / frame          WebGL prototype counters (docs/11 §1.2)
 *   - triangles / frame           same
 *   - framebuffer binds / frame   same
 *   - shader programs             same
 *   - frame time p50/p95/max      rAF sampling
 *   - texture VRAM estimate       scripts/analyze-glb.mjs (docs/11 §1.3)
 *   - initial transferred bytes   PerformanceResourceTiming (docs/11 §1.4)
 *   - time to visible scene       the `bedo:scene-ready` mark (BEDO-002 §9)
 *   - time to training-ready      the `bedo:training-ready` mark
 *
 * It measures. It does not change anything and it does not assert a target: BEDO-002 is
 * measurement infrastructure only, and the frozen baseline in `docs/11 §2` stays frozen.
 *
 * Usage:
 *   npm run build                                   # measure the production build
 *   npm run perf:baseline                           # serves dist/ and measures it
 *   node scripts/perf-baseline.mjs --url http://localhost:5179   # measure a running server
 *   node scripts/perf-baseline.mjs --headed --channel chrome     # closest to docs/11
 *   node scripts/perf-baseline.mjs --seconds 8 --out my-run.json
 *
 * ⚠️  Comparability. `docs/11`'s baseline was taken in real Chrome, foreground, on a GPU.
 * Headless Playwright falls back to SwiftShader, where draw counts are identical but
 * every timing is far slower. Compare like with like: the run records `browser`,
 * `renderer` and `headless` in its output so a row can never be misread later.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startPreview } from './lib/preview-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const SETTLE_SECONDS = Number(flag('seconds', 4));
const PORT = Number(flag('port', 4179));
const HEADED = has('headed');
const CHANNEL = flag('channel');
const OUT = flag('out');

/** docs/11 §1.2, verbatim in behaviour: patch the WebGL2 prototype in the main world. */
const COUNTER_HARNESS = `
(function(){
  const P = WebGL2RenderingContext.prototype;
  const g = {draws:0,tris:0,frames:0,progs:0,fbBinds:0,samples:[]};
  window.__mw = g;
  const seen = new Set();
  const de=P.drawElements, da=P.drawArrays, dei=P.drawElementsInstanced,
        up=P.useProgram, bf=P.bindFramebuffer;
  P.drawElements=function(m,c,t,o){g.draws++;g.tris+=c/3;return de.apply(this,arguments)};
  P.drawArrays=function(m,f,c){g.draws++;g.tris+=c/3;return da.apply(this,arguments)};
  P.drawElementsInstanced=function(m,c,t,o,n){g.draws++;g.tris+=(c/3)*n;return dei.apply(this,arguments)};
  P.useProgram=function(p){if(p){seen.add(p);g.progs=seen.size}return up.apply(this,arguments)};
  P.bindFramebuffer=function(t,fb){g.fbBinds++;return bf.apply(this,arguments)};
  let last=performance.now();
  (function tick(){const n=performance.now();g.samples.push(n-last);last=n;g.frames++;
    if(g.samples.length>600)g.samples.shift();requestAnimationFrame(tick)})();
})();`;

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const MIB = 1048576;
const mb = (bytes) => Number((bytes / MIB).toFixed(2));

function glbVram(relative) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) return null;
  const analyser = path.join(ROOT, 'scripts', 'analyze-glb.mjs');
  const json = execFileSync(process.execPath, [analyser, file, '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const report = JSON.parse(json);
  return {
    file: relative,
    fileBytes: report.fileBytes,
    triangles: report.counts.triangles,
    primitives: report.counts.primitives,
    images: report.counts.images,
    textureVramBytes: report.vramBytes,
  };
}

async function serveDist() {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/ has no index.html — run `npm run build` first, or pass --url.');
  }
  // One implementation, in scripts/lib/preview-server.mjs: it owns the process group
  // and tears the server down on a throw or a Ctrl-C as well as on success.
  return startPreview({ root: ROOT, port: PORT });
}

async function main() {
  let server = null;
  let url = flag('url');
  if (!url) ({ url, server } = await serveDist());

  const browser = await chromium.launch({ headless: !HEADED, channel: CHANNEL });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(COUNTER_HARNESS);

  console.log(`\nmeasuring ${url} — settle ${SETTLE_SECONDS}s\n`);
  const navigationStart = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // docs/11 §1.5: a backgrounded tab throttles rAF to zero and invalidates everything.
  const hidden = await page.evaluate(() => document.hidden);
  if (hidden) throw new Error('document.hidden === true — the measurement would be void');

  await page.waitForSelector('[data-bedo-training-ready]', { timeout: 120_000 });
  await page.waitForSelector('[data-bedo-scene-ready]', { timeout: 300_000 });
  const wallClockToSceneMs = Date.now() - navigationStart;

  // Reset the counters, then let an idle scene run.
  await page.evaluate(() => {
    const g = window.__mw;
    g.draws = 0;
    g.tris = 0;
    g.frames = 0;
    g.fbBinds = 0;
    g.samples.length = 0;
  });
  await page.waitForTimeout(SETTLE_SECONDS * 1000);

  const gpu = await page.evaluate(() => {
    const g = window.__mw;
    return {
      draws: g.draws,
      tris: g.tris,
      frames: g.frames,
      fbBinds: g.fbBinds,
      programs: g.progs,
      samples: [...g.samples],
    };
  });

  const timing = await page.evaluate(() => {
    const mark = (name) => performance.getEntriesByName(name, 'mark')[0]?.startTime ?? null;
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const paint = performance.getEntriesByType('paint');
    return {
      appReadyMs: mark('bedo:app-ready'),
      trainingReadyMs: mark('bedo:training-ready'),
      sceneReadyMs: mark('bedo:scene-ready'),
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      firstContentfulPaintMs:
        paint.find((p) => p.name === 'first-contentful-paint')?.startTime ?? null,
      resourceCount: resources.length,
      transferredBytes: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
      decodedBytes: resources.reduce((sum, r) => sum + (r.decodedBodySize || 0), 0),
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      dpr: window.devicePixelRatio,
      canvas: (() => {
        const c = document.querySelector('canvas');
        return c ? { width: c.width, height: c.height } : null;
      })(),
    };
  });

  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });

  const result = {
    measuredAt: new Date().toISOString(),
    url,
    browser: { name: 'chromium', channel: CHANNEL ?? 'bundled', headless: !HEADED, renderer },
    viewport: { width: 1440, height: 900, dpr: timing.dpr, canvas: timing.canvas },
    settleSeconds: SETTLE_SECONDS,
    gpu: {
      framesSampled: gpu.frames,
      drawCallsPerFrame: gpu.frames ? Number((gpu.draws / gpu.frames).toFixed(1)) : null,
      trianglesPerFrame: gpu.frames ? Math.round(gpu.tris / gpu.frames) : null,
      framebufferBindsPerFrame: gpu.frames ? Number((gpu.fbBinds / gpu.frames).toFixed(1)) : null,
      shaderPrograms: gpu.programs,
      frameTimeMs: {
        p50: percentile(gpu.samples, 50),
        p95: percentile(gpu.samples, 95),
        max: gpu.samples.length ? Math.max(...gpu.samples) : null,
      },
      fps: gpu.frames ? Number((gpu.frames / SETTLE_SECONDS).toFixed(1)) : null,
    },
    loading: {
      appReadyMs: timing.appReadyMs,
      trainingReadyMs: timing.trainingReadyMs,
      sceneReadyMs: timing.sceneReadyMs,
      domContentLoadedMs: timing.domContentLoadedMs,
      firstContentfulPaintMs: timing.firstContentfulPaintMs,
      wallClockToSceneMs,
    },
    transfer: {
      resourceCount: timing.resourceCount,
      transferredMb: mb(timing.transferredBytes),
      decodedMb: mb(timing.decodedBytes),
      jsHeapMb: timing.jsHeapBytes === null ? null : mb(timing.jsHeapBytes),
    },
    assets: {
      apparatus: glbVram('public/Bedo_baked_v2.glb'),
      distBytes: fs.existsSync(path.join(ROOT, 'dist'))
        ? directorySize(path.join(ROOT, 'dist'))
        : null,
    },
  };

  await browser.close();
  server?.kill('SIGTERM');

  const outPath = path.join(ROOT, 'measurements', OUT ?? `perf-${result.measuredAt.replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  report(result, outPath);
}

function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
  }
  return total;
}

function report(r, outPath) {
  const ms = (v) => (v === null ? '—' : `${Math.round(v)} ms`);
  console.log('GPU (idle scene)');
  console.log(`      draw calls / frame     ${r.gpu.drawCallsPerFrame}`);
  console.log(`      triangles / frame      ${r.gpu.trianglesPerFrame?.toLocaleString()}`);
  console.log(`      framebuffer binds/frame ${r.gpu.framebufferBindsPerFrame}`);
  console.log(`      shader programs        ${r.gpu.shaderPrograms}`);
  console.log(`      fps                    ${r.gpu.fps}  (p50 ${ms(r.gpu.frameTimeMs.p50)}, p95 ${ms(r.gpu.frameTimeMs.p95)})`);
  console.log(`      renderer               ${r.browser.renderer}`);
  console.log('\nLOADING');
  console.log(`      app shell ready        ${ms(r.loading.appReadyMs)}`);
  console.log(`      training ready         ${ms(r.loading.trainingReadyMs)}`);
  console.log(`      scene ready            ${ms(r.loading.sceneReadyMs)}`);
  console.log(`      first contentful paint ${ms(r.loading.firstContentfulPaintMs)}`);
  console.log('\nTRANSFER');
  console.log(`      resources              ${r.transfer.resourceCount}`);
  console.log(`      transferred            ${r.transfer.transferredMb} MB`);
  console.log(`      decoded                ${r.transfer.decodedMb} MB`);
  if (r.assets.apparatus) {
    console.log(`      apparatus GLB          ${mb(r.assets.apparatus.fileBytes)} MB on disk`);
    console.log(`      texture VRAM estimate  ${mb(r.assets.apparatus.textureVramBytes)} MB`);
  }
  if (r.assets.distBytes) console.log(`      dist/                  ${mb(r.assets.distBytes)} MB`);

  console.log('\ndocs/11 §5 row (append, never edit the baseline):');
  console.log(
    `| ${r.measuredAt.slice(0, 10)} | \`<commit>\` | <task> | ${r.gpu.drawCallsPerFrame} | ` +
      `${r.gpu.trianglesPerFrame} | ${r.gpu.framebufferBindsPerFrame} | ` +
      `${r.assets.apparatus ? mb(r.assets.apparatus.textureVramBytes) + ' MB' : '—'} | ` +
      `${r.assets.apparatus ? mb(r.assets.apparatus.fileBytes) + ' MB' : '—'} | ` +
      `${r.assets.distBytes ? mb(r.assets.distBytes) + ' MB' : '—'} | ` +
      `${r.loading.sceneReadyMs === null ? '—' : (r.loading.sceneReadyMs / 1000).toFixed(1) + ' s'} | ` +
      `${r.browser.headless ? 'headless/' + r.browser.renderer : r.browser.channel} |`
  );
  console.log(`\nwritten to ${path.relative(ROOT, outPath)}\n`);
}

main().catch((error) => {
  console.error(`\nperf-baseline failed: ${error.message}\n`);
  process.exit(1);
});
