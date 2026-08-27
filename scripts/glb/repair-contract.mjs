/**
 * Restore material flags an optimizer changed on its own initiative.
 *
 * gltfpack notices that a material marked BLEND has a fully opaque texture and promotes it
 * to OPAQUE. That is a defensible optimization — it moves the mesh out of the transparent
 * pass — but it is still a change to the runtime contract, and the point of this task is an
 * asset that is interchangeable with the one in production. With a fully opaque texture and
 * a baseColorFactor alpha of 1, BLEND and OPAQUE produce identical pixels, so restoring the
 * authored value costs nothing and keeps the contract exact.
 *
 * Copies `alphaMode`, `alphaCutoff` and `doubleSided` from the baseline, matched by material
 * name. Everything else in the candidate is left exactly as the optimizer produced it.
 *
 * Usage: node scripts/glb/repair-contract.mjs <baseline.glb> <candidate.glb> <out.glb>
 */
import fs from 'node:fs';

const [baselineFile, candidateFile, outFile] = process.argv.slice(2);
const read = (file) => {
  const buf = fs.readFileSync(file);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    if (type === 0x004e4942) bin = Buffer.from(body);
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return { json, bin };
};

const base = read(baselineFile);
const cand = read(candidateFile);
const authored = new Map((base.json.materials || []).map((m) => [m.name, m]));

let repaired = 0;
for (const m of cand.json.materials || []) {
  const a = authored.get(m.name);
  if (!a) continue;
  const wanted = a.alphaMode ?? 'OPAQUE';
  const current = m.alphaMode ?? 'OPAQUE';
  if (wanted !== current) {
    if (wanted === 'OPAQUE') delete m.alphaMode; else m.alphaMode = wanted;
    repaired++;
    console.error(`  ${m.name}: alphaMode ${current} -> ${wanted}`);
  }
  if ((a.alphaCutoff ?? 0.5) !== (m.alphaCutoff ?? 0.5)) {
    if (a.alphaCutoff === undefined) delete m.alphaCutoff; else m.alphaCutoff = a.alphaCutoff;
    repaired++;
  }
  if (!!a.doubleSided !== !!m.doubleSided) {
    if (a.doubleSided) m.doubleSided = true; else delete m.doubleSided;
    repaired++;
    console.error(`  ${m.name}: doubleSided -> ${!!a.doubleSided}`);
  }
}

let jsonChunk = Buffer.from(JSON.stringify(cand.json), 'utf8');
if (jsonChunk.length % 4) jsonChunk = Buffer.concat([jsonChunk, Buffer.alloc(4 - (jsonChunk.length % 4), 0x20)]);
let binChunk = cand.bin;
if (binChunk.length % 4) binChunk = Buffer.concat([binChunk, Buffer.alloc(4 - (binChunk.length % 4))]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonChunk.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binChunk.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(outFile, Buffer.concat([header, jh, jsonChunk, bh, binChunk]));
console.error(`  repaired ${repaired} material flag(s) -> ${outFile}`);
