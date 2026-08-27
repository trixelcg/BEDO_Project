/**
 * The runtime-facing identity contract of the apparatus GLB.
 *
 * An optimizer may legitimately rewrite buffers, reorder accessors, recompress images and
 * renumber every index in the file. None of that is allowed to change what the application
 * reaches for: a node's name, where it sits in the hierarchy, the matrix that places it, the
 * volume it occupies, or which material paints it. Those five things are the contract, and
 * this emits them as a stable JSON document so a candidate can be diffed against the
 * baseline mechanically rather than eyeballed.
 *
 * World matrices and bounds are computed here rather than trusted from the file, because the
 * whole risk with a transform-flattening optimizer is that local and world disagree.
 *
 * Usage: node scripts/glb/manifest.mjs <file.glb> > manifest.json
 */
import fs from 'node:fs';

const file = process.argv[2];
const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);

let off = 12;
let g = null;
let bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const body = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) g = JSON.parse(new TextDecoder().decode(body));
  if (type === 0x004e4942) bin = body;
  off += 8 + len + ((4 - (len % 4)) % 4);
}

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENT_READ = {
  5120: (d, o) => d.getInt8(o), 5121: (d, o) => d.getUint8(o),
  5122: (d, o) => d.getInt16(o, true), 5123: (d, o) => d.getUint16(o, true),
  5125: (d, o) => d.getUint32(o, true), 5126: (d, o) => d.getFloat32(o, true),
};
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Read a POSITION accessor as [x,y,z] triples, honouring stride and quantization. */
function readPositions(accessorIndex) {
  const a = (g.accessors || [])[accessorIndex];
  if (!a || a.bufferView === undefined) return [];
  const view = g.bufferViews[a.bufferView];
  const compBytes = COMPONENT_BYTES[a.componentType];
  const comps = NUM_COMPONENTS[a.type];
  const stride = view.byteStride || compBytes * comps;
  const base = (view.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = COMPONENT_READ[a.componentType];
  const denom = a.normalized
    ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] || 1
    : 1;
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const o = base + i * stride;
    const v = [];
    for (let c = 0; c < comps; c++) {
      let x = read(dv, o + c * compBytes);
      if (a.normalized) x = x / denom;
      v.push(x);
    }
    out.push(v);
  }
  return out;
}

const identity = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function multiply(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function fromTRS(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const applyMatrix = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

const round = (n, dp = 6) => (Object.is(n, -0) ? 0 : Number(n.toFixed(dp)));

const nodes = g.nodes || [];
const parentOf = new Map();
nodes.forEach((n, i) => (n.children || []).forEach((c) => parentOf.set(c, i)));

const entries = [];
const visit = (index, parentWorld, path) => {
  const node = nodes[index];
  const local = fromTRS(node);
  const world = multiply(parentWorld, local);

  let localBounds = null;
  let worldBounds = null;
  const primitives = [];
  if (node.mesh !== undefined) {
    const mesh = g.meshes[node.mesh];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const wlo = [Infinity, Infinity, Infinity], whi = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.primitives || []) {
      const material = p.material !== undefined ? (g.materials[p.material]?.name ?? `#${p.material}`) : null;
      primitives.push({
        material,
        attributes: Object.keys(p.attributes || {}).sort(),
        mode: p.mode ?? 4,
        indexed: p.indices !== undefined,
      });
      const a = g.accessors[p.attributes?.POSITION];
      let pmin = a?.min, pmax = a?.max;
      if (!pmin || !pmax) {
        const pts = readPositions(p.attributes?.POSITION);
        if (!pts.length) continue;
        pmin = [Infinity,Infinity,Infinity]; pmax = [-Infinity,-Infinity,-Infinity];
        for (const v of pts) for (let c = 0; c < 3; c++) {
          if (v[c] < pmin[c]) pmin[c] = v[c];
          if (v[c] > pmax[c]) pmax[c] = v[c];
        }
      }
      for (let c = 0; c < 3; c++) {
        if (pmin[c] < lo[c]) lo[c] = pmin[c];
        if (pmax[c] > hi[c]) hi[c] = pmax[c];
      }
      for (let k = 0; k < 8; k++) {
        const corner = [k & 1 ? pmax[0] : pmin[0], k & 2 ? pmax[1] : pmin[1], k & 4 ? pmax[2] : pmin[2]];
        const w = applyMatrix(world, corner);
        for (let c = 0; c < 3; c++) {
          if (w[c] < wlo[c]) wlo[c] = w[c];
          if (w[c] > whi[c]) whi[c] = w[c];
        }
      }
    }
    if (lo[0] !== Infinity) {
      localBounds = { min: lo.map((v) => round(v)), max: hi.map((v) => round(v)) };
      worldBounds = {
        min: wlo.map((v) => round(v)), max: whi.map((v) => round(v)),
        centre: wlo.map((v, c) => round((v + whi[c]) / 2)),
        size: wlo.map((v, c) => round(whi[c] - v)),
      };
    }
  }

  entries.push({
    name: node.name ?? null,
    path: path.join('/'),
    parent: parentOf.has(index) ? (nodes[parentOf.get(index)].name ?? null) : null,
    children: (node.children || []).map((c) => nodes[c].name ?? null),
    translation: (node.translation || [0, 0, 0]).map((v) => round(v)),
    rotation: (node.rotation || [0, 0, 0, 1]).map((v) => round(v)),
    scale: (node.scale || [1, 1, 1]).map((v) => round(v)),
    worldMatrix: world.map((v) => round(v)),
    localBounds,
    worldBounds,
    primitives,
  });
  for (const c of node.children || []) visit(c, world, [...path, nodes[c].name ?? `#${c}`]);
};

const scene = g.scenes?.[g.scene ?? 0];
for (const root of scene?.nodes || []) visit(root, identity(), [nodes[root].name ?? `#${root}`]);

const texToImage = (g.textures || []).map((t) => t.source);
const imageName = (i) => (i === undefined ? null : g.images?.[i]?.name ?? `#${i}`);
const slot = (t) => (t ? { image: imageName(texToImage[t.index]), uv: t.texCoord || 0 } : null);
const materials = (g.materials || []).map((m) => ({
  name: m.name ?? null,
  alphaMode: m.alphaMode ?? 'OPAQUE',
  doubleSided: !!m.doubleSided,
  baseColorFactor: (m.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1]).map((v) => round(v, 4)),
  metallicFactor: round(m.pbrMetallicRoughness?.metallicFactor ?? 1, 4),
  roughnessFactor: round(m.pbrMetallicRoughness?.roughnessFactor ?? 1, 4),
  emissiveFactor: (m.emissiveFactor || [0, 0, 0]).map((v) => round(v, 4)),
  baseColorTexture: slot(m.pbrMetallicRoughness?.baseColorTexture),
  metallicRoughnessTexture: slot(m.pbrMetallicRoughness?.metallicRoughnessTexture),
  normalTexture: slot(m.normalTexture),
  occlusionTexture: slot(m.occlusionTexture),
  emissiveTexture: slot(m.emissiveTexture),
  extensions: Object.keys(m.extensions || {}).sort(),
}));

console.log(JSON.stringify({
  file,
  bytes: buf.length,
  glbVersion: buf.readUInt32LE(4),
  counts: {
    nodes: nodes.length, meshes: (g.meshes || []).length,
    primitives: (g.meshes || []).reduce((s, m) => s + (m.primitives || []).length, 0),
    materials: (g.materials || []).length, textures: (g.textures || []).length,
    images: (g.images || []).length, accessors: (g.accessors || []).length,
    animations: (g.animations || []).length, skins: (g.skins || []).length,
    cameras: (g.cameras || []).length,
  },
  extensionsUsed: (g.extensionsUsed || []).slice().sort(),
  extensionsRequired: (g.extensionsRequired || []).slice().sort(),
  nodes: entries.sort((a, b) => String(a.name).localeCompare(String(b.name))),
  materials: materials.sort((a, b) => String(a.name).localeCompare(String(b.name))),
}, null, 1));
