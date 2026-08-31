/**
 * Release gate: prove every asset this build references exists at the shared origin.
 *
 * This is the gate for the failure that took production down twice (PERF-05, PERF-05B):
 * the HTML references X, the request for X is routed by Cloud Run to a revision that does
 * not have X, and the page dies. It cannot happen if X is present in the shared bucket,
 * because any revision can serve it from there.
 *
 * So the check is deliberately literal — parse what the BUILD actually emitted, then
 * confirm each referenced URL resolves at the origin with a usable content type. It fails
 * closed: a missing object, or a bundle served as octet-stream (which a browser refuses to
 * execute as a module), stops the release.
 *
 * Usage: node scripts/release/verify-asset-closure.mjs [--bucket NAME]
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { listAll } from './gcs.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIST = path.join(ROOT, 'dist');
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BUCKET = arg('--bucket', process.env.GCS_BUCKET_NAME || 'bedo-project-assets-2026');

/** A module served as octet-stream loads with status 200 and then refuses to execute. */
const REQUIRED_TYPE = { '.js': /javascript/, '.mjs': /javascript/, '.css': /css/,
  '.wasm': /wasm/, '.glb': /gltf-binary/, '.webp': /webp/ };

const required = new Map(); // bucket key -> why it is required

const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g))
  required.set(m[1], 'referenced by dist/index.html');

/**
 * Everything Vite emitted under `assets/`, not just what index.html names directly.
 *
 * index.html references the entry chunk and the stylesheet. Code-split chunks, worker
 * bundles, and any font or image Vite emits are pulled in later by the running bundle, and
 * a request for one of those during a traffic split fails exactly the same way. Deriving
 * this from the build output means a future code-split cannot silently escape the gate.
 */
const walkAssets = (dir, base = '') =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? walkAssets(path.join(dir, e.name), rel) : [rel];
  });
if (existsSync(path.join(DIST, 'assets')))
  for (const rel of walkAssets(path.join(DIST, 'assets')))
    if (!required.has(`assets/${rel}`)) required.set(`assets/${rel}`, 'emitted by the build under assets/');

const manifestPath = path.join(DIST, 'runtime-manifest.json');
if (!existsSync(manifestPath)) {
  console.error('FAIL: dist/runtime-manifest.json missing — build did not generate the manifest.');
  process.exit(1);
}
const { manifest, uploads } = JSON.parse(readFileSync(manifestPath, 'utf8'));
for (const u of uploads) required.set(u.key, 'content-addressed runtime asset');

/**
 * Cross-check the bundle itself, not just the manifest: catch a `/runtime/...` URL that
 * the code emits but the manifest never declared (and so was never published).
 */
const bundleDir = path.join(DIST, 'assets');
const bundleText = readdirSync(bundleDir).filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(path.join(bundleDir, f), 'utf8')).join('\n');
const declared = new Set(Object.values(manifest).map((v) => v.replace(/\/$/, '')));
const emitted = new Set([...bundleText.matchAll(/runtime\/[A-Za-z0-9-]+(?:\/[A-Za-z0-9_.]+)?/g)]
  .map((m) => m[0]));
const undeclared = [...emitted].filter(
  (u) => !declared.has(u) && !declared.has(path.dirname(u)) && !uploads.some((x) => x.key === u));

/** One listing, then set membership — cheaper and less flaky than N per-object calls. */
let present;
try {
  present = await listAll(BUCKET);
} catch (e) {
  console.error(`FAIL: cannot list gs://${BUCKET}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
}

const missing = [...required.keys()].filter((k) => !present.has(k));

/**
 * Stored metadata is checked for every required object, and it is the metadata a browser
 * receives: GCS serves the object's own contentType and cacheControl.
 */
const typeProblems = [];
const cacheProblems = [];
for (const key of required.keys()) {
  if (missing.includes(key)) continue;
  const meta = present.get(key);
  const ext = path.extname(key).toLowerCase();
  const want = REQUIRED_TYPE[ext];
  if (want && !want.test(meta.contentType || '')) {
    typeProblems.push(`${key}: content-type "${meta.contentType}"`);
  }
  // Content-addressed keys carry their hash in the path and must be cached immutably.
  if (!/immutable/.test(meta.cacheControl || '')) {
    cacheProblems.push(`${key}: cache-control "${meta.cacheControl}"`);
  }
}

console.log(`asset-closure: ${required.size} referenced assets checked against gs://${BUCKET}`);
for (const k of missing) console.error(`  MISSING  ${k}  (${required.get(k)})`);
for (const p of typeProblems) console.error(`  BAD TYPE  ${p}`);
for (const p of cacheProblems) console.error(`  BAD CACHE ${p}`);
for (const u of undeclared) console.error(`  UNDECLARED ${u} — emitted by the bundle, absent from the manifest`);

if (missing.length || typeProblems.length || cacheProblems.length || undeclared.length) {
  console.error('asset-closure: FAILED — release must not proceed.');
  process.exit(1);
}
console.log('asset-closure: OK — every referenced asset is present at the shared origin.');
