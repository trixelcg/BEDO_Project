/**
 * Does a candidate GLB still honour the runtime contract?
 *
 * Compares two manifests produced by `manifest.mjs`. Names, hierarchy and material
 * assignment must match exactly; numeric quantities are allowed a tolerance, because
 * quantization legitimately perturbs the last bits of a position.
 *
 * Exits non-zero on any violation, so it can gate a candidate.
 */
import fs from 'node:fs';
const [baseFile, candFile] = process.argv.slice(2);
const TOL_POS = Number(process.argv.includes('--tol') ? process.argv[process.argv.indexOf('--tol') + 1] : 1e-4);
const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
const cand = JSON.parse(fs.readFileSync(candFile, 'utf8'));

const problems = [];
const note = (kind, detail) => problems.push({ kind, detail });

const byName = (m) => new Map(m.nodes.filter((n) => n.name).map((n) => [n.name, n]));
const B = byName(base), C = byName(cand);

// --- names ---------------------------------------------------------------------------
const missing = [...B.keys()].filter((n) => !C.has(n));
const added = [...C.keys()].filter((n) => !B.has(n));
if (missing.length) note('NODE MISSING', `${missing.length}: ${missing.slice(0, 8).join(', ')}`);
if (added.length) note('NODE ADDED', `${added.length}: ${added.slice(0, 8).join(', ')}`);

// --- hierarchy, transforms, bounds ----------------------------------------------------
let worstMatrix = 0, worstCentre = 0, worstSize = 0;
let worstMatrixNode = '', worstCentreNode = '';
for (const [name, b] of B) {
  const c = C.get(name);
  if (!c) continue;
  if ((b.parent ?? null) !== (c.parent ?? null))
    note('PARENT CHANGED', `${name}: ${b.parent} -> ${c.parent}`);
  const bKids = (b.children || []).slice().sort().join('|');
  const cKids = (c.children || []).slice().sort().join('|');
  if (bKids !== cKids) note('CHILDREN CHANGED', `${name}`);

  for (let i = 0; i < 16; i++) {
    const d = Math.abs((b.worldMatrix[i] ?? 0) - (c.worldMatrix[i] ?? 0));
    if (d > worstMatrix) { worstMatrix = d; worstMatrixNode = name; }
  }
  if (b.worldBounds && c.worldBounds) {
    for (let i = 0; i < 3; i++) {
      const dc = Math.abs(b.worldBounds.centre[i] - c.worldBounds.centre[i]);
      const ds = Math.abs(b.worldBounds.size[i] - c.worldBounds.size[i]);
      if (dc > worstCentre) { worstCentre = dc; worstCentreNode = name; }
      if (ds > worstSize) worstSize = ds;
    }
  } else if (!!b.worldBounds !== !!c.worldBounds) {
    note('BOUNDS LOST', name);
  }

  const bPrims = (b.primitives || []).map((p) => p.material).sort().join('|');
  const cPrims = (c.primitives || []).map((p) => p.material).sort().join('|');
  if (bPrims !== cPrims) note('MATERIAL ASSIGNMENT', `${name}: [${bPrims}] -> [${cPrims}]`);
  const bAttr = (b.primitives || []).map((p) => p.attributes.join(',')).sort().join('|');
  const cAttr = (c.primitives || []).map((p) => p.attributes.join(',')).sort().join('|');
  if (bAttr !== cAttr) note('ATTRIBUTES CHANGED', `${name}: [${bAttr}] -> [${cAttr}]`);
}
if (worstMatrix > TOL_POS) note('WORLD MATRIX DRIFT', `${worstMatrixNode} by ${worstMatrix.toExponential(2)}`);
if (worstCentre > TOL_POS) note('BOUNDS CENTRE DRIFT', `${worstCentreNode} by ${worstCentre.toExponential(2)}`);

// --- materials -------------------------------------------------------------------------
const bm = new Map(base.materials.map((m) => [m.name, m]));
const cm = new Map(cand.materials.map((m) => [m.name, m]));
for (const [name, b] of bm) {
  const c = cm.get(name);
  if (!c) { note('MATERIAL MISSING', name); continue; }
  for (const slot of ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'occlusionTexture', 'emissiveTexture']) {
    const bHas = !!b[slot], cHas = !!c[slot];
    if (bHas !== cHas) note('TEXTURE SLOT', `${name}.${slot}: ${bHas} -> ${cHas}`);
    else if (bHas && b[slot].uv !== c[slot].uv) note('UV SET', `${name}.${slot}`);
  }
  if (b.alphaMode !== c.alphaMode) note('ALPHA MODE', `${name}: ${b.alphaMode} -> ${c.alphaMode}`);
  if (b.doubleSided !== c.doubleSided) note('DOUBLE SIDED', name);
  for (const k of ['metallicFactor', 'roughnessFactor']) {
    if (Math.abs(b[k] - c[k]) > 1e-3) note('PBR FACTOR', `${name}.${k}: ${b[k]} -> ${c[k]}`);
  }
  if ((b.extensions || []).join(',') !== (c.extensions || []).join(','))
    note('MATERIAL EXTENSIONS', `${name}: ${b.extensions} -> ${c.extensions}`);
}

// --- report ------------------------------------------------------------------------------
console.log(`baseline  ${base.file}`);
console.log(`candidate ${cand.file}`);
console.log(`  nodes            ${base.counts.nodes} -> ${cand.counts.nodes}`);
console.log(`  meshes           ${base.counts.meshes} -> ${cand.counts.meshes}`);
console.log(`  primitives       ${base.counts.primitives} -> ${cand.counts.primitives}`);
console.log(`  materials        ${base.counts.materials} -> ${cand.counts.materials}`);
console.log(`  images           ${base.counts.images} -> ${cand.counts.images}`);
console.log(`  named nodes      ${B.size} -> ${C.size}`);
console.log(`  worst world-matrix delta  ${worstMatrix.toExponential(2)}  (${worstMatrixNode || 'n/a'})`);
console.log(`  worst bounds-centre delta ${worstCentre.toExponential(2)}  (${worstCentreNode || 'n/a'})`);
console.log(`  worst bounds-size delta   ${worstSize.toExponential(2)}`);
console.log(`  extensionsRequired ${JSON.stringify(cand.extensionsRequired)}`);
if (!problems.length) { console.log('\n  CONTRACT OK — names, hierarchy, transforms, bounds and materials all preserved'); process.exit(0); }
console.log(`\n  ${problems.length} CONTRACT VIOLATION(S):`);
const grouped = new Map();
for (const p of problems) grouped.set(p.kind, (grouped.get(p.kind) || []).concat(p.detail));
for (const [kind, list] of grouped)
  console.log(`   ${kind} (${list.length})\n${list.slice(0, 6).map((d) => '      ' + d).join('\n')}`);
process.exit(1);
