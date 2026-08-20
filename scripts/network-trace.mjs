#!/usr/bin/env node
/**
 * Runtime network capture (BEDO-004 §11).
 *
 * Loads the production build and exercises every path in the app that can request an
 * asset, then reports exactly what was fetched, with status and transferred bytes. It is
 * the evidence for "this file is never requested" — a claim a filename search cannot make.
 *
 * What it drives, and why that is the whole surface:
 *   - initial load                 the model, the eight plumes, the environment map
 *   - the walkthrough video modal  the 28 MB mp4, which mounts only when opened
 *   - free mode + the data monitor the last screen with its own markup
 *
 * The twelve guided steps request nothing further: every asset URL in `src/` is a string
 * literal (no template paths, no `import.meta.glob`), and the plumes are preloaded at
 * module scope by `useGLTF.preload`. `tests/unit/assets.spec.ts` enforces that closed set.
 *
 *   npm run build && node scripts/network-trace.mjs
 *   node scripts/network-trace.mjs --url http://localhost:5179 --out trace.json
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
const PORT = Number(flag('port', 4219));
const OUT = flag('out', 'network-trace.json');

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
  let server = null;
  let url = flag('url');
  if (!url) ({ url, server } = await servePreview());

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const requests = new Map();
  const failures = [];
  const consoleErrors = [];

  page.on('response', async (response) => {
    const raw = response.url();
    if (raw.startsWith('blob:') || raw.startsWith('data:')) return;
    const pathname = new URL(raw).pathname;
    const status = response.status();
    let bytes = 0;
    try {
      bytes = Number((await response.headerValue('content-length')) ?? 0);
    } catch {
      /* body already gone */
    }
    const seen = requests.get(pathname) ?? { pathname, status, count: 0, bytes: 0 };
    seen.count += 1;
    seen.status = status;
    seen.bytes = Math.max(seen.bytes, bytes);
    requests.set(pathname, seen);
    if (status >= 400) failures.push(`${status} ${pathname}`);
  });
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.startsWith('blob:') && !u.startsWith('data:')) {
      failures.push(`FAILED ${new URL(u).pathname} — ${r.failure()?.errorText}`);
    }
  });

  console.log(`\ntracing ${url}\n`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bedo-training-ready]', { timeout: 120_000 });
  await page.waitForSelector('[data-bedo-scene-ready]', { timeout: 300_000 });
  console.log('  scene ready');

  // The walkthrough video: mounted only when the modal is opened.
  await page.getByRole('button', { name: 'Video' }).click();
  await page.waitForSelector('video', { timeout: 30_000 });
  await page.waitForFunction(
    () => (document.querySelector('video')?.readyState ?? 0) >= 2,
    null,
    { timeout: 180_000 }
  );
  console.log('  walkthrough video loaded');
  // Dispatched, not clicked: the video modal is missing the `interactive` class, so it
  // inherits `pointer-events: none` from `.ui-container` and nothing in it can be
  // clicked at all — including Close. Defect recorded in `docs/28`; not fixed here,
  // because BEDO-004 changes no behaviour.
  await page.getByRole('button', { name: 'Close' }).dispatchEvent('click');

  // The data monitor, reached without the guided sequence.
  await page.getByRole('button', { name: 'Free Mode' }).click();
  await page.getByRole('button', { name: 'Open Data Monitor' }).click();
  await page.waitForSelector('.monitor-fullscreen', { timeout: 30_000 });
  console.log('  data monitor open');
  await page.waitForTimeout(1000);

  const rows = [...requests.values()].sort((a, b) => b.bytes - a.bytes);
  const totalBytes = rows.reduce((sum, r) => sum + r.bytes, 0);

  await browser.close();
  server?.kill('SIGTERM');

  const result = {
    url,
    requestCount: rows.length,
    totalContentLengthBytes: totalBytes,
    failures,
    consoleErrors,
    requests: rows,
  };
  const outPath = path.join(ROOT, 'measurements', OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);

  console.log(`\n${rows.length} distinct paths, ${(totalBytes / 1048576).toFixed(2)} MB declared\n`);
  for (const r of rows) {
    console.log(
      `  ${String(r.status).padStart(3)}  ${String((r.bytes / 1024).toFixed(0)).padStart(8)} KB  ${r.pathname}`
    );
  }
  console.log(`\nfailures: ${failures.length ? failures.join(', ') : 'none'}`);
  console.log(`console errors: ${consoleErrors.length ? consoleErrors.join(' | ') : 'none'}`);
  console.log(`\nwritten to ${path.relative(ROOT, outPath)}\n`);
}

main().catch((error) => {
  console.error(`\nnetwork-trace failed: ${error.message}\n`);
  process.exit(1);
});
