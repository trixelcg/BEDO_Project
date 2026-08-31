/**
 * Publish this build's static assets to the shared, revision-independent origin.
 *
 * Cloud Run routes each request independently, so during a traffic split an asset request
 * can land on a revision that was never built with that asset. The shared bucket is what
 * makes that survivable: every generation's assets live there simultaneously, and any
 * revision can serve any generation's asset out of it (see the GCS fallback in server.ts).
 *
 * Everything published here is immutable — content-hashed by Vite (`/assets/*`) or
 * content-addressed by scripts/release/asset-manifest.mjs (`/runtime/<hash>/*`). An object
 * that already exists is therefore never rewritten; it is verified and skipped. Assets
 * that keep a stable name and are identical across generations (the video, the answer
 * sheets, the favicon) are published too, so that a revision which does not carry them
 * locally still cannot 404.
 *
 * Bucket keys mirror URL paths 1:1, which is what lets server.ts translate a miss straight
 * into a bucket lookup.
 *
 * Usage: node scripts/release/publish-assets.mjs [--bucket NAME] [--dry-run]
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { listAll, upload } from './gcs.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIST = path.join(ROOT, 'dist');
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BUCKET = arg('--bucket', process.env.GCS_BUCKET_NAME || 'bedo-project-assets-2026');
const DRY = process.argv.includes('--dry-run');

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.bin': 'application/octet-stream',
};
const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT_LIVED = 'public, max-age=300';

/** Every object currently in the bucket, so existence checks cost one call, not N. */
let existing;
try {
  existing = await listAll(BUCKET);
} catch (e) {
  console.error(`Cannot list gs://${BUCKET} — refusing to publish blind.\n${e.message}`);
  process.exit(1);
}

const walk = (dir, base = '') =>
  readdirSync(dir).flatMap((name) => {
    const abs = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    return statSync(abs).isDirectory() ? walk(abs, rel) : [{ abs, rel }];
  });

const targets = [];

// 1. Vite content-hashed build assets: dist/assets/* -> assets/*
if (existsSync(path.join(DIST, 'assets'))) {
  for (const { abs, rel } of walk(path.join(DIST, 'assets')))
    targets.push({ abs, key: `assets/${rel}`, cache: IMMUTABLE });
}

// 2. Content-addressed runtime assets, from the generated manifest.
const manifestPath = path.join(DIST, 'runtime-manifest.json');
if (!existsSync(manifestPath)) {
  console.error('dist/runtime-manifest.json missing — run `npm run build` first.');
  process.exit(1);
}
const { uploads } = JSON.parse(readFileSync(manifestPath, 'utf8'));
for (const u of uploads)
  targets.push({ abs: path.join(ROOT, u.source), key: u.key, cache: IMMUTABLE, sha256: u.sha256 });

// 3. Stable-name assets that stay on their plain URL.
//
//    These exist in the bucket purely as a compatibility shim for generations that were
//    ALREADY DEPLOYED before content-addressing (revision 00052-72v's bundle asks for
//    `/Bedo_baked_v2.glb` by its plain name). Publishing them means a newer revision can
//    still answer that older bundle's request during a split instead of 404ing.
//
//    They are never overwritten once present — see the skip below. That is deliberate: the
//    plain name is pinned to the bytes the legacy generation expects, and every generation
//    built from here on asks for a content-addressed URL instead, so nothing new depends
//    on it. Do not "fix" this into an overwrite; that would serve one generation another
//    generation's bytes, which is the exact silent failure content-addressing prevents.
const versionedSources = new Set(uploads.map((u) => path.join(ROOT, u.source)));
for (const { abs, rel } of walk(DIST)) {
  if (rel.startsWith('assets/') || rel === 'index.html' || rel === 'runtime-manifest.json') continue;
  if (versionedSources.has(abs)) continue;
  targets.push({ abs, key: rel, cache: SHORT_LIVED });
}

let uploaded = 0, skipped = 0, failed = 0, mismatched = 0;
const md5 = (buf) => createHash('md5').update(buf).digest('base64');

for (const t of targets) {
  const ext = path.extname(t.abs).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const body = readFileSync(t.abs);

  const already = existing.get(t.key);
  if (already) {
    // An immutable key must never be rewritten. Verify rather than assume: if the bytes at
    // a content-addressed key differ from the bytes we hold, something is badly wrong and
    // the release must stop rather than silently serve one generation another's assets.
    if (already.md5 && already.md5 !== md5(body)) {
      console.error(`  CONTENT MISMATCH ${t.key} — bucket bytes differ from this build's bytes`);
      mismatched++;
    } else {
      skipped++;
    }
    continue;
  }

  if (DRY) { console.log(`  would upload ${t.key} (${type})`); uploaded++; continue; }
  try {
    await upload(BUCKET, t.key, body, {
      contentType: type, cacheControl: t.cache, predefinedAcl: 'publicRead',
    });
    // Content-addressed keys carry their own hash; confirm what we published matches it.
    if (t.sha256) {
      const local = createHash('sha256').update(body).digest('hex');
      if (local !== t.sha256) throw new Error(`hash drift for ${t.key}`);
    }
    uploaded++;
  } catch (e) {
    console.error(`  FAILED ${t.key}: ${String(e.message).slice(0, 200)}`);
    failed++;
  }
}

console.log(`publish-assets: ${uploaded} uploaded, ${skipped} already present, ${failed} failed, ` +
  `${mismatched} content mismatches (bucket gs://${BUCKET})`);
// Fail closed: a release must never proceed with an asset missing from the shared origin,
// nor with a key whose existing bytes disagree with this build's.
process.exit(failed > 0 || mismatched > 0 ? 1 : 0);
