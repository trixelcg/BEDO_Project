/**
 * Re-encode (and optionally resize) the images inside a GLB, changing nothing else.
 *
 * The apparatus GLB is 88.9% texture bytes, and its colour maps ship as lossless PNG. Most
 * of them do not need to be: a baked albedo or an emissive bake has no exact values worth
 * preserving bit-for-bit, and JPEG at high quality is visually indistinguishable at a
 * fraction of the size. What *does* need to stay lossless is anything a shader reads as
 * data rather than as colour — normal, metallic-roughness, occlusion — where JPEG's chroma
 * handling and ringing become shading errors rather than image noise.
 *
 * This only ever rewrites image bufferViews and their mime types. Nodes, hierarchy,
 * transforms, meshes, accessors, materials and texture slots are copied through untouched,
 * which is what makes it safe for an asset the application depends on structurally.
 *
 * Alpha is decided by measurement, not by the material's `alphaMode`: exporters mark
 * materials BLEND routinely, so the file is full of RGBA images whose alpha channel is a
 * constant 255. Those are converted; any image with a genuinely varying alpha is left as
 * PNG regardless of what it feeds.
 *
 * Chromium is the codec — it is already a dependency through Playwright, and its encoders
 * are the same ones that will decode the result.
 *
 * Usage:
 *   node scripts/glb/recompress.mjs <in.glb> <out.glb> [--quality 0.92] [--max 4096]
 *                                   [--data-max 4096] [--report report.json]
 */
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const [input, output] = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const QUALITY = Number(arg('quality', 0.92));
const MAX_COLOUR = Number(arg('max', 0));      // 0 = keep original dimensions
const MAX_DATA = Number(arg('data-max', 0));   // separate cap for data maps
const REPORT = arg('report', null);
/**
 * Per-image maximum dimension, as JSON: {"18": 2400, "23": 512}.
 *
 * Resolution is set per image because the measured demand differs by two orders of
 * magnitude across this file. The room bake atlas is *magnified* at the median visible
 * pixel — each wall owns only a small island of a shared 4096 sheet — while `Pitot1` is
 * over-resolved by a factor of two even in the closest view that shows it. A single global
 * cap would soften the first to buy nothing and leave the second untouched.
 */
const RULES = JSON.parse(arg('rules', '{}'));
if (!input || !output) {
  console.error('usage: recompress.mjs <in.glb> <out.glb> [--quality q] [--max px] [--data-max px]');
  process.exit(2);
}

// --- read ---------------------------------------------------------------------------------
const buf = fs.readFileSync(input);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  const body = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
  if (type === 0x004e4942) bin = Buffer.from(body);
  off += 8 + len + ((4 - (len % 4)) % 4);
}
const g = json;

// --- which slot does each image serve? ----------------------------------------------------
const texToImage = (g.textures || []).map((t) => t.source);
const COLOUR_SLOTS = new Set(['baseColor', 'emissive']);
const slotsOf = new Map();
const note = (img, slot) => {
  if (img === undefined) return;
  if (!slotsOf.has(img)) slotsOf.set(img, new Set());
  slotsOf.get(img).add(slot);
};
for (const m of g.materials || []) {
  const p = m.pbrMetallicRoughness || {};
  if (p.baseColorTexture) note(texToImage[p.baseColorTexture.index], 'baseColor');
  if (p.metallicRoughnessTexture) note(texToImage[p.metallicRoughnessTexture.index], 'metalRough');
  if (m.normalTexture) note(texToImage[m.normalTexture.index], 'normal');
  if (m.occlusionTexture) note(texToImage[m.occlusionTexture.index], 'occlusion');
  if (m.emissiveTexture) note(texToImage[m.emissiveTexture.index], 'emissive');
  for (const ext of Object.values(m.extensions || {}))
    for (const [k, v] of Object.entries(ext || {}))
      if (v && typeof v === 'object' && v.index !== undefined) note(texToImage[v.index], `ext:${k}`);
}

// --- transcode ----------------------------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

const report = [];
const replacement = new Map(); // image index -> { data: Buffer, mime: string }

for (let i = 0; i < (g.images || []).length; i++) {
  const image = g.images[i];
  const view = g.bufferViews[image.bufferView];
  const start = view.byteOffset || 0;
  const source = bin.subarray(start, start + view.byteLength);
  const slots = [...(slotsOf.get(i) || [])];
  const isColour = slots.length > 0 && slots.every((s) => COLOUR_SLOTS.has(s));
  const cap = RULES[String(i)] ?? (isColour ? MAX_COLOUR : MAX_DATA);

  const result = await page.evaluate(
    async ({ b64, mime, quality, cap, isColour }) => {
      const img = new Image();
      img.src = `data:${mime};base64,${b64}`;
      await img.decode();
      const scale = cap > 0 && Math.max(img.width, img.height) > cap
        ? cap / Math.max(img.width, img.height) : 1;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);

      // Does the alpha channel carry anything? Measured at full source resolution.
      const probe = document.createElement('canvas');
      probe.width = img.width; probe.height = img.height;
      const pctx = probe.getContext('2d', { willReadFrequently: true });
      pctx.drawImage(img, 0, 0);
      const px = pctx.getImageData(0, 0, img.width, img.height).data;
      let minAlpha = 255;
      for (let k = 3; k < px.length; k += 4) if (px[k] < minAlpha) { minAlpha = px[k]; if (!minAlpha) break; }

      const opaque = minAlpha === 255;
      const asJpeg = isColour && opaque;
      const out = asJpeg ? canvas.toDataURL('image/jpeg', quality) : canvas.toDataURL('image/png');
      return { data: out.split(',')[1], mime: asJpeg ? 'image/jpeg' : 'image/png',
               w, h, srcW: img.width, srcH: img.height, minAlpha, opaque };
    },
    { b64: source.toString('base64'), mime: image.mimeType || 'image/png',
      quality: QUALITY, cap, isColour }
  );

  const encoded = Buffer.from(result.data, 'base64');
  // Never accept a "re-encode" that made the image bigger.
  const keepOriginal = encoded.length >= source.length && result.w === result.srcW;
  replacement.set(i, keepOriginal
    ? { data: source, mime: image.mimeType || 'image/png' }
    : { data: encoded, mime: result.mime });

  report.push({
    index: i, name: image.name || '', slots,
    from: `${result.srcW}x${result.srcH}`, to: `${result.w}x${result.h}`,
    mimeFrom: image.mimeType || 'image/png', mimeTo: keepOriginal ? (image.mimeType || 'image/png') : result.mime,
    bytesFrom: source.length, bytesTo: keepOriginal ? source.length : encoded.length,
    opaque: result.opaque, minAlpha: result.minAlpha, kept: keepOriginal,
  });
  process.stderr.write(`  [${String(i).padStart(2)}] ${result.srcW}x${result.srcH} -> ${result.w}x${result.h}  ` +
    `${(source.length/1024).toFixed(0)}K -> ${((keepOriginal?source.length:encoded.length)/1024).toFixed(0)}K  ` +
    `${keepOriginal ? 'kept' : result.mime.replace('image/','')}  ${slots.join('+')||'(unused)'}\n`);
}
await browser.close();

// --- repack -------------------------------------------------------------------------------
// Every bufferView is copied into a fresh binary chunk in its existing order; only image
// views change length. Offsets are recomputed and 4-byte alignment preserved.
const chunks = [];
let cursor = 0;
const newViews = g.bufferViews.map((view, index) => {
  const image = (g.images || []).findIndex((im) => im.bufferView === index);
  const data = image >= 0
    ? replacement.get(image).data
    : bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  const pad = (4 - (cursor % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); cursor += pad; }
  const out = { ...view, byteOffset: cursor, byteLength: data.length };
  chunks.push(data);
  cursor += data.length;
  return out;
});
g.bufferViews = newViews;
(g.images || []).forEach((im, i) => { if (replacement.has(i)) im.mimeType = replacement.get(i).mime; });
g.buffers = [{ byteLength: cursor }];

let binChunk = Buffer.concat(chunks);
if (binChunk.length % 4) binChunk = Buffer.concat([binChunk, Buffer.alloc(4 - (binChunk.length % 4))]);
let jsonChunk = Buffer.from(JSON.stringify(g), 'utf8');
if (jsonChunk.length % 4) jsonChunk = Buffer.concat([jsonChunk, Buffer.alloc(4 - (jsonChunk.length % 4), 0x20)]);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(output, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));

if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
const before = buf.length, after = fs.statSync(output).size;
console.error(`\n  ${input} ${(before/1048576).toFixed(2)} MB -> ${output} ${(after/1048576).toFixed(2)} MB  ` +
  `(${(100*(1-after/before)).toFixed(1)}% smaller)`);
