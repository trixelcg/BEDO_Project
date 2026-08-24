#!/usr/bin/env node
/**
 * Spring behaviour capture (BEDO-007 §3, §15).
 *
 * Drives the running app into the states that exercise the spring, and for each one
 * records the numbers that decide where it sits — jet force, weight force, the resulting
 * deflection — together with the world transforms of every part the deflection moves, and
 * a screenshot in fixed framing.
 *
 * Run it before a change and after; the two files are the evidence that what moved is what
 * the specification says should move, and nothing else.
 *
 *   node scripts/spring-states.mjs --out before.json --shots measurements/spring/before
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
const PORT = Number(flag('port', 4249));
const OUT = flag('out', 'spring-states.json');
const SHOTS = flag('shots', 'measurements/spring/shots');

/** The parts the spring deflection moves, plus the spring itself. */
const TRACKED = ['deflector_spring', 'Pointer', 'deflector_rod', 'JET_Force_2_212'];

const READ_SCENE = (tracked) => {
  const scene = window.__three.scenes.find((s) => s.children.length) ?? window.__three.scenes[0];
  const r = (n) => Number(n.toFixed(6));
  const read = (name) => {
    const o = scene.getObjectByName(name);
    if (!o) return null;
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements;
    return {
      localY: r(o.position.y),
      worldY: r(e[13]),
      scaleY: r(o.scale.y),
      parentScaleY: o.parent ? r(o.parent.scale.y) : null,
      parentLocalY: o.parent ? r(o.parent.position.y) : null,
    };
  };
  return Object.fromEntries(tracked.map((n) => [n, read(n)]));
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
        if (e.detail?.isScene) window.__three.scenes.push(e.detail);
      },
    };
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bedo-scene-ready]', { timeout: 300_000 });
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });

  const click = async (name) => {
    await page.getByRole('button', { name }).click({ timeout: 60_000 });
  };
  const setValve = async (v) => {
    await page.locator('.valve-slider-container input[type="range"]').fill(String(v));
  };

  fs.mkdirSync(path.join(ROOT, SHOTS), { recursive: true });
  const results = [];

  const capture = async (id, description) => {
    // Settle: the scene damps toward the target, so give it real frames to arrive.
    await page.waitForTimeout(2500);
    const scene = await page.evaluate(READ_SCENE, TRACKED);
    const shot = path.join(ROOT, SHOTS, `${id}.png`);
    // Fixed framing for every state — the tank, where the spring lives.
    await page.screenshot({ path: shot, clip: { x: 430, y: 40, width: 560, height: 560 } });
    results.push({ id, description, scene });
    console.log(`  ${id.padEnd(26)} spring scaleY ${scene.deflector_spring?.parentScaleY ?? scene.deflector_spring?.scaleY}`);
  };

  // Free mode reaches every control without the guided sequence.
  await click('Free Mode');
  await capture('A-rest', 'Rest: pump off, tank shut, tray empty');

  await click(/Turn On Pump/);
  await setValve(0.4);
  await capture('B-jet-only', 'Jet at n=0.4, no weights — spring extended by h_F alone');

  for (const w of ['+50g', '+20g', '+10g']) await click(w);
  await capture('C-balanced-80g', 'Jet at n=0.4 balanced by 80 g — h_F approx h_w');

  await click('+200g');
  await click('+100g');
  await capture('D-overloaded-380g', 'Overloaded: 380 g against n=0.4 — h_w exceeds h_F');

  await click(/Turn Off Pump/);
  await capture('E-weights-no-jet', 'Weights loaded, pump off — no jet force at all');

  await browser.close();
  server.kill('SIGTERM');

  const outPath = path.join(ROOT, 'measurements', OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ url, states: results }, null, 2)}\n`);
  console.log(`\nwritten to ${path.relative(ROOT, outPath)} and ${SHOTS}/\n`);
}

main().catch((e) => {
  console.error(`\nspring-states failed: ${e.message}\n`);
  process.exit(1);
});
