#!/usr/bin/env node
/**
 * GLB analyser — the measurement tool behind docs/11_PERFORMANCE_BASELINE.md.
 *
 * Parses a .glb binary directly (no three.js, no dependencies) and reports the
 * numbers the rendering budget is enforced against:
 *
 *   - geometry:  nodes, meshes, primitives, triangles, vertices
 *   - materials: count, doubleSided census, alphaMode census, extensions
 *   - textures:  true pixel dimensions from PNG/JPEG headers, and the resulting
 *                VRAM cost as RGBA8 + full mip chain (w*h*4*4/3)
 *
 * The VRAM figure is the one that matters: 23 MB of compressed PNG in the file
 * becomes ~764 MB on the GPU, which is what makes the scene unrunnable on the
 * target hardware. File size alone hides that completely.
 *
 * Usage:
 *   node scripts/analyze-glb.mjs public/Bedo_baked_v2.glb
 *   node scripts/analyze-glb.mjs public/Bedo_baked_v2.glb --nodes
 *   node scripts/analyze-glb.mjs public/Bedo_baked_v2.glb --json
 *
 * --nodes prints every node name alongside the name three.js will actually
 * expose it as, after PropertyBinding.sanitizeNodeName. Look meshes up by the
 * sanitised name or getObjectByName silently returns undefined; see
 * src/lib/apparatus.ts.
 */

import fs from 'node:fs';

const MIB = 1048576;

/** three.js PropertyBinding.sanitizeNodeName — must stay in sync with src/lib/apparatus.ts gltfName(). */
const sanitize = (authored) => authored.replace(/\s/g, '_').replace(/[[\]./:]/g, '');

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a binary glTF (bad magic)');
  let offset = 12;
  let json = null;
  let binOffset = 0;
  let binLength = 0;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    if (type === 0x004e4942) { binOffset = offset + 8; binLength = length; }
    offset += 8 + length;
  }
  if (!json) throw new Error('no JSON chunk');
  return { json, binOffset, binLength };
}

const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];

function jpegSize(b) {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return [0, 0];
}

function analyse(file) {
  const buf = fs.readFileSync(file);
  const { json: g, binOffset, binLength } = parseGlb(buf);
  const accessors = g.accessors ?? [];
  const bufferViews = g.bufferViews ?? [];

  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  for (const mesh of g.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      primitives++;
      if (prim.indices !== undefined) triangles += accessors[prim.indices].count / 3;
      if (prim.attributes?.POSITION !== undefined) vertices += accessors[prim.attributes.POSITION].count;
    }
  }

  let vram = 0;
  let imageBytes = 0;
  const images = (g.images ?? []).map((img, i) => {
    const view = img.bufferView !== undefined ? bufferViews[img.bufferView] : null;
    if (!view) return { index: i, name: img.name ?? '', mime: img.mimeType ?? '', width: 0, height: 0, fileBytes: 0, vramBytes: 0 };
    const start = binOffset + (view.byteOffset ?? 0);
    const bytes = buf.subarray(start, start + view.byteLength);
    const [width, height] = img.mimeType === 'image/png' ? pngSize(bytes) : jpegSize(bytes);
    const vramBytes = width * height * 4 * (4 / 3); // RGBA8 + full mip chain
    vram += vramBytes;
    imageBytes += view.byteLength;
    return { index: i, name: img.name ?? '', mime: img.mimeType ?? '', width, height, fileBytes: view.byteLength, vramBytes };
  });

  const materials = g.materials ?? [];
  const doubleSided = materials.filter((m) => m.doubleSided).length;
  const alphaModes = {};
  for (const m of materials) {
    const mode = m.alphaMode ?? 'OPAQUE';
    alphaModes[mode] = (alphaModes[mode] ?? 0) + 1;
  }

  const attributes = {};
  for (const mesh of g.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      for (const key of Object.keys(prim.attributes ?? {})) attributes[key] = (attributes[key] ?? 0) + 1;
    }
  }

  return {
    file,
    fileBytes: buf.length,
    binBytes: binLength,
    generator: g.asset?.generator ?? '',
    counts: {
      nodes: (g.nodes ?? []).length,
      meshes: (g.meshes ?? []).length,
      primitives,
      triangles,
      vertices,
      materials: materials.length,
      textures: (g.textures ?? []).length,
      images: images.length,
      samplers: (g.samplers ?? []).length,
      animations: (g.animations ?? []).length,
      skins: (g.skins ?? []).length,
      cameras: (g.cameras ?? []).length,
    },
    materials: { doubleSided, total: materials.length, alphaModes },
    attributes,
    extensionsUsed: g.extensionsUsed ?? [],
    compression: {
      draco: (g.extensionsUsed ?? []).includes('KHR_draco_mesh_compression'),
      meshopt: (g.extensionsUsed ?? []).includes('EXT_meshopt_compression'),
      ktx2: (g.extensionsUsed ?? []).includes('KHR_texture_basisu'),
    },
    imageBytes,
    vramBytes: vram,
    images,
    nodeNames: (g.nodes ?? []).map((n) => n.name ?? ''),
  };
}

function report(a) {
  const mb = (b) => (b / MIB).toFixed(2);
  console.log(`\nFILE  ${a.file}`);
  console.log(`      ${mb(a.fileBytes)} MB on disk  (bin chunk ${mb(a.binBytes)} MB)`);
  console.log(`      generator: ${a.generator}`);

  const c = a.counts;
  console.log(`\nGEOMETRY`);
  console.log(`      nodes ${c.nodes}   meshes ${c.meshes}   primitives ${c.primitives}`);
  console.log(`      triangles ${c.triangles.toLocaleString()}   vertices ${c.vertices.toLocaleString()}`);
  console.log(`      animations ${c.animations}   skins ${c.skins}   cameras ${c.cameras}`);
  console.log(`      attributes: ${Object.entries(a.attributes).map(([k, v]) => `${k}×${v}`).join('  ')}`);

  console.log(`\nMATERIALS`);
  console.log(`      ${a.materials.total} materials   ${a.textures ?? c.textures} textures   ${c.images} images   ${c.samplers} samplers`);
  console.log(`      doubleSided: ${a.materials.doubleSided}/${a.materials.total}` +
    (a.materials.doubleSided === a.materials.total && a.materials.total > 0 ? '  ⚠️  backface culling disabled everywhere' : ''));
  console.log(`      alphaMode:   ${Object.entries(a.materials.alphaModes).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`      extensions:  ${a.extensionsUsed.join(', ') || '(none)'}`);

  console.log(`\nCOMPRESSION`);
  console.log(`      Draco ${a.compression.draco ? '✅' : '❌'}   meshopt ${a.compression.meshopt ? '✅' : '❌'}   KTX2/Basis ${a.compression.ktx2 ? '✅' : '❌'}`);

  if (a.images.length) {
    console.log(`\nTEXTURES  (VRAM = w·h·4·4/3, RGBA8 + full mip chain)`);
    for (const img of [...a.images].sort((x, y) => y.vramBytes - x.vramBytes)) {
      console.log(
        `      ${mb(img.vramBytes).padStart(7)} MB   ${String(img.width + '×' + img.height).padStart(11)}   ` +
        `${String(Math.round(img.fileBytes / 1024)).padStart(5)} KB   ${(img.mime.split('/')[1] ?? '').padEnd(4)}   ${img.name}`
      );
    }
  }

  console.log(`\nTOTALS`);
  console.log(`      images on disk : ${mb(a.imageBytes)} MB  (${(100 * a.imageBytes / a.fileBytes).toFixed(0)}% of the file)`);
  console.log(`      texture VRAM   : ${(a.vramBytes / MIB).toFixed(1)} MB`);
  console.log(`      draw-call floor: ${c.primitives} (one per primitive, before shadow/transmission passes)`);
  console.log('');
}

const [, , file, ...flags] = process.argv;
if (!file) {
  console.error('usage: node scripts/analyze-glb.mjs <file.glb> [--nodes] [--json]');
  process.exit(2);
}

const result = analyse(file);

if (flags.includes('--json')) {
  const { images, nodeNames, ...summary } = result;
  console.log(JSON.stringify(flags.includes('--nodes') ? result : { ...summary, images }, null, 2));
} else if (flags.includes('--nodes')) {
  console.log(`\n${result.nodeNames.length} nodes — authored name → name three.js exposes\n`);
  result.nodeNames.forEach((n, i) => {
    const s = sanitize(n);
    console.log(`  ${String(i).padStart(3)}  ${n}${s !== n ? `\n       → ${s}` : ''}`);
  });
  console.log('');
} else {
  report(result);
}
