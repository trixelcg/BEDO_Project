#!/usr/bin/env node
/**
 * Rebuild the runtime water assets from the authored Alembic caches.
 *
 *   node scripts/water/build-water.mjs [--out public/WaterShapes] [--keep-intermediate]
 *
 * ## The pipeline
 *
 *   assets-source/WaterShapes/*.abc          authored truth, never served (see F5)
 *     -> Blender  scripts/water/abc_to_morph_glb.py     bake 81 samples to morph targets
 *     -> gltfpack -cc                                   EXT_meshopt_compression
 *     -> public/WaterShapes/*.glb                        runtime derivative
 *
 * Deterministic: same inputs, same outputs, no hand steps. `docs/44` records why each
 * stage exists and what was measured to choose it.
 *
 * ## Why gltfpack
 *
 * Measured, not assumed. Blender's own morph export is float32 positions *and* normals per
 * target, which is 13.95 MB raw and still 5.65 MB after brotli — materially worse than the
 * budget. `gltfpack -cc` quantises and applies the meshopt vertex codec, giving 1.25 MB
 * brotli for all eight while keeping a wholly standard container:
 * `KHR_mesh_quantization` + `EXT_meshopt_compression`, both decoded by three's own
 * `GLTFLoader`, which drei's `useGLTF` already wires up by default. Bundle cost is zero —
 * `three-stdlib` imports `MeshoptDecoder` at module scope regardless.
 *
 * Requires Blender (tested 5.1.2) and gltfpack. Neither is a runtime dependency.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const SRC = path.join(ROOT, 'assets-source', 'WaterShapes');
const OUT = path.resolve(ROOT, flag('out', path.join('public', 'WaterShapes')));
const TMP = path.join(ROOT, 'node_modules', '.cache', 'bedo-water');

const BLENDER =
  process.env.BLENDER ??
  ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', 'blender'].find(
    (p) => p === 'blender' || fs.existsSync(p)
  );
const GLTFPACK = process.env.GLTFPACK ?? path.join(ROOT, 'node_modules', '.bin', 'gltfpack');

for (const [label, tool] of [
  ['Blender', BLENDER],
  ['gltfpack', GLTFPACK],
]) {
  if (!tool || (tool.includes('/') && !fs.existsSync(tool))) {
    console.error(
      `\n${label} not found. It is build tooling, not a runtime dependency.\n` +
        `  Blender:  https://www.blender.org/download/  (or set BLENDER=/path/to/Blender)\n` +
        `  gltfpack: npm install --no-save gltfpack     (or set GLTFPACK=/path/to/gltfpack)\n`
    );
    process.exit(1);
  }
}

fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const caches = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith('.abc'))
  .sort();

if (caches.length === 0) {
  console.error(`no .abc caches in ${path.relative(ROOT, SRC)}`);
  process.exit(1);
}

console.log(`\nwater: ${caches.length} caches -> ${path.relative(ROOT, OUT)}\n`);
let totalBefore = 0;
let totalAfter = 0;

for (const file of caches) {
  const name = path.basename(file, '.abc');
  const baked = path.join(TMP, `${name}.glb`);
  const packed = path.join(OUT, `${name}.glb`);
  const before = fs.existsSync(packed) ? fs.statSync(packed).size : 0;

  execFileSync(
    BLENDER,
    ['-b', '--python', path.join(ROOT, 'scripts', 'water', 'abc_to_morph_glb.py'), '--',
     path.join(SRC, file), baked],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  // -kn/-km keep node and morph-target names: playback reads `morphTargetDictionary` to
  // find which target holds which authored frame rather than trusting array order.
  execFileSync(GLTFPACK, ['-i', baked, '-o', packed, '-cc', '-kn', '-km'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const bakedSize = fs.statSync(baked).size;
  const after = fs.statSync(packed).size;
  totalBefore += before;
  totalAfter += after;
  console.log(
    `  ${name.padEnd(22)} baked ${(bakedSize / 1024).toFixed(0).padStart(6)}K` +
      ` -> packed ${(after / 1024).toFixed(0).padStart(5)}K` +
      (before ? `  (was ${(before / 1024).toFixed(0)}K)` : '')
  );

  if (!argv.includes('--keep-intermediate')) fs.rmSync(baked);
}

console.log(
  `\n  total ${(totalBefore / 1024).toFixed(0)}K -> ${(totalAfter / 1024).toFixed(0)}K` +
    ` on disk; transfer is roughly a third of that once the server compresses it.\n`
);
