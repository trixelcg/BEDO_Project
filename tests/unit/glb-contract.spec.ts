import { beforeAll, describe, expect, it } from 'vitest';
import { DEFLECTORS, MESH, WATER_SHAPES, WEIGHTS } from '../../src/domain/apparatus';
import * as THREE from 'three';
import { gltfName } from '../../src/lib/gltfNames';
import {
  AUTHORED_APPARATUS_OFFSET,
  ORIENTATION_BAKED_PARTS,
  REASSEMBLED_PARTS,
  RENAMED_PARTS,
} from '../../src/lib/modelAdapter';
import { describeMissing, readGlb, type GlbReport } from '../helpers/glb';
import { loadApparatus } from '../helpers/model';

/**
 * The GLB naming contract (BEDO-002 §5) — the highest-value test in the project.
 *
 * Every mesh the runtime drives is found with `getObjectByName(gltfName(authored))`.
 * `getObjectByName` returns `undefined` for a name that is not there, and every call site
 * treats that as "nothing to animate", so a renamed or deleted node produces a green
 * build, a silent app, and a part that simply never moves. That failure mode is what
 * `src/lib/apparatus.ts:11-26` documents and what cost the team weeks.
 *
 * This suite reads the *shipped asset* — not a checked-in list — so a Blender re-export
 * that renames, removes or duplicates a contract node turns the build red and names the
 * node in the failure message.
 *
 * Only names that are actual application contracts are pinned. The other ~110 nodes in
 * the export are scenery the code never looks up, and are deliberately not asserted.
 */

const MODEL = 'public/Bedo_baked_v2.glb';

let report: GlbReport;
/** sanitised name -> authored name, as three.js exposes the export after the adapter. */
let exposed: Map<string, string>;
/** sanitised name -> authored name, as the file itself carries it. */
let raw: Map<string, string>;

beforeAll(() => {
  report = readGlb(MODEL);
  raw = new Map(report.nodeNames.map((name) => [gltfName(name), name]));
  // BEDO-MODEL-02: the re-authored export reaches the contract through
  // `src/lib/modelAdapter.ts`, which renames some parts and regroups others at load. The
  // names the runtime can resolve are therefore the file's, less what was renamed away,
  // plus what the adapter creates. Its inputs are pinned against the file further down.
  exposed = new Map(raw);
  for (const [from, to] of RENAMED_PARTS) {
    exposed.delete(gltfName(from));
    exposed.set(gltfName(to), to);
  }
  for (const [contract] of REASSEMBLED_PARTS) exposed.set(gltfName(contract), contract);
});

/** Every name the runtime resolves through gltfName, with the source that declares it. */
const contract = (): Array<{ label: string; authored: string }> => [
  ...Object.entries(MESH).map(([key, authored]) => ({ label: `MESH.${key}`, authored })),
  ...DEFLECTORS.flatMap((d) => [
    { label: `DEFLECTORS[${d.id}].shelf`, authored: d.shelf },
    { label: `DEFLECTORS[${d.id}].installed`, authored: d.installed },
  ]),
  ...WEIGHTS.filter((w) => w.mesh).map((w) => ({
    label: `WEIGHTS[${w.grams}g].mesh`,
    authored: w.mesh!,
  })),
];

describe('the production model resolves every name the runtime uses', () => {
  it('parses as a GLB with the geometry docs/11 §3.2 recorded', () => {
    expect(report.counts.nodes).toBeGreaterThan(0);
    expect(report.counts.meshes).toBeGreaterThan(0);
    expect(report.counts.triangles).toBeGreaterThan(0);
    expect(report.fileBytes).toBeGreaterThan(1_000_000);
  });

  it.each(contract())('$label resolves to a node in the export', ({ label, authored }) => {
    const wanted = gltfName(authored);
    expect(exposed.has(wanted), describeMissing(label, authored, wanted, exposed)).toBe(true);
  });

  it('resolves all 33 contract names, so the count itself cannot drift unnoticed', () => {
    const names = contract();
    // 14 MESH entries + 7 shelves + 7 installed + 5 weight discs.
    expect(names).toHaveLength(33);
    const missing = names.filter(({ authored }) => !exposed.has(gltfName(authored)));
    expect(missing.map((m) => `${m.label} -> ${m.authored}`)).toEqual([]);
  });
});

describe('names stay unambiguous after three.js sanitises them', () => {
  it('no two nodes in the export collapse onto the same exposed name', () => {
    // getObjectByName returns the first match in traversal order, so a collision means
    // some part of the rig is unreachable no matter what the code asks for.
    const collisions = new Map<string, string[]>();
    for (const name of report.nodeNames) {
      const key = gltfName(name);
      collisions.set(key, [...(collisions.get(key) ?? []), name]);
    }
    const duplicated = [...collisions.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([key, names]) => `${key} <- ${names.join(' , ')}`);
    expect(duplicated).toEqual([]);
  });

  it('every contract name is unique among the contract names', () => {
    const names = contract().map(({ authored }) => gltfName(authored));
    const duplicated = names.filter((n, i) => names.indexOf(n) !== i);
    expect([...new Set(duplicated)]).toEqual([]);
  });
});

describe('the naming patterns the code assumes', () => {
  it('mounted deflectors keep the .001 suffix that separates them from the tray copies', () => {
    // The tray copy and the mounted copy differ only by this suffix; if an export drops
    // it, the code hides the wrong one and all seven deflectors appear inside the tank.
    for (const deflector of DEFLECTORS) {
      expect(deflector.installed, `deflector ${deflector.id}`).toMatch(/\.001$/);
      expect(deflector.shelf).toMatch(/_base$/);
      expect(gltfName(deflector.installed)).toBe(`${deflector.installed.slice(0, -4)}001`);
      expect(exposed.has(gltfName(deflector.installed))).toBe(true);
      expect(exposed.has(gltfName(deflector.shelf))).toBe(true);
    }
  });

  it('the nozzle and pointer pin still carry the authored "JET Force 2_" prefix', () => {
    // These two are the ones whitespace sanitisation bites: "JET Force 2_214" is exposed
    // as "JET_Force_2_214", so the authored name never matches at runtime.
    for (const authored of [MESH.nozzle, MESH.pointerPin, MESH.tank]) {
      expect(authored).toMatch(/^JET Force 2_\d+$/);
      expect(gltfName(authored)).toMatch(/^JET_Force_2_\d+$/);
      expect(exposed.get(gltfName(authored))).toBe(authored);
    }
  });

  it('the volumetric valve is the bench lever, not the flow valve', () => {
    expect(MESH.volumetricValve).toBe('hydrolic bensh 1_087');
    expect(MESH.flowValve).toBe('Valve');
    expect(MESH.volumetricValve).not.toBe(MESH.flowValve);
    expect(exposed.has(gltfName(MESH.volumetricValve))).toBe(true);
  });

  it('the analyser and gltfName sanitise all 159 real node names identically', () => {
    // scripts/analyze-glb.mjs carries its own copy of the sanitiser for the --nodes
    // report. If the two drift, the tooling stops describing what the app sees.
    const analyserSanitise = (authored: string) =>
      authored.replace(/\s/g, '_').replace(/[[\]./:]/g, '');
    for (const name of report.nodeNames) {
      expect(gltfName(name), `diverged on "${name}"`).toBe(analyserSanitise(name));
    }
  });
});

describe('the model adapter (BEDO-MODEL-02)', () => {
  it('every exported part it renames or regroups is in the shipped file', () => {
    const inputs = [
      ...RENAMED_PARTS.map(([from]) => from),
      ...REASSEMBLED_PARTS.flatMap(([, parts]) => parts),
    ];
    expect(inputs.filter((name) => !raw.has(gltfName(name)))).toEqual([]);
  });

  it('never renames or regroups onto a name the file already uses', () => {
    const created = [
      ...RENAMED_PARTS.map(([, to]) => to),
      ...REASSEMBLED_PARTS.map(([contract]) => contract),
    ];
    expect(created.filter((name) => raw.has(gltfName(name)))).toEqual([]);
  });

  it('claims each exported part at most once', () => {
    const inputs = [
      ...RENAMED_PARTS.map(([from]) => from),
      ...REASSEMBLED_PARTS.flatMap(([, parts]) => parts),
    ];
    expect(inputs.filter((n, i) => inputs.indexOf(n) !== i)).toEqual([]);
  });

  it('resolves every contract name in the loaded, adapted scene graph', async () => {
    const scene = await loadApparatus();
    const missing = contract().filter(({ authored }) => !scene.getObjectByName(gltfName(authored)));
    expect(missing.map((m) => `${m.label} -> ${m.authored}`)).toEqual([]);
  });

  it('measures the re-oriented parts by their geometry, not by a rotated local box', async () => {
    // `Box3.setFromObject` without `precise` is how the runtime sizes parts. For each part
    // the adapter re-orients it must agree with the vertex-exact box, as it did on the
    // previous export — a rotated disc otherwise measures 80 mm across instead of 57.
    const scene = await loadApparatus();
    for (const part of ORIENTATION_BAKED_PARTS) {
      const node = scene.getObjectByName(gltfName(part))!;
      const quick = new THREE.Box3().setFromObject(node).getSize(new THREE.Vector3());
      const exact = new THREE.Box3().setFromObject(node, true).getSize(new THREE.Vector3());
      expect(quick.distanceTo(exact), part).toBeLessThan(1e-6);
    }
  });

  it('puts the nozzle back on the axis the water caches are authored around', async () => {
    // `water-caches-authored-in-rig-space`: all eight caches centre on (1.01, -22.93) cm,
    // the nozzle axis at (0.0101, -0.2293). The offset is right exactly when this holds.
    const scene = await loadApparatus();
    const nozzle = scene.getObjectByName(gltfName(MESH.nozzle))!;
    const centre = new THREE.Box3().setFromObject(nozzle).getCenter(new THREE.Vector3());
    expect(centre.x).toBeCloseTo(0.0101, 4);
    expect(centre.z).toBeCloseTo(-0.2293, 4);
    expect(centre.y).toBeCloseTo(1.085, 3);
    expect(AUTHORED_APPARATUS_OFFSET[1]).toBe(0);
  });
});

describe('the failure message', () => {
  it('names the node, the lookup, and the nearest thing in the export', () => {
    // A contract test is only useful if the failure says which node broke. This asserts
    // the message an export rename would actually print.
    const message = describeMissing('MESH.tankCover', 'Tank cover', 'Tank_cover', exposed);
    expect(message).toContain('MESH.tankCover is not in the GLB');
    expect(message).toContain('"Tank cover"');
    expect(message).toContain('"Tank_cover"');
    expect(message).toContain('closest nodes in the export');
    expect(message).toContain('src/lib/apparatus.ts');
  });

  it('says so plainly when nothing in the export resembles the name', () => {
    const message = describeMissing('MESH.ghost', 'Zzz Not A Part', 'Zzz_Not_A_Part', exposed);
    expect(message).toContain('no similarly named node exists in the export');
  });
});

describe('the water plume assets', () => {
  it.each(Object.entries(WATER_SHAPES))('%s is a loadable plume with geometry', (key, shape) => {
    const plume = readGlb(`public${shape.url}`);
    expect(plume.counts.meshes, `${key} has no mesh`).toBeGreaterThan(0);
    expect(plume.counts.triangles, `${key} has no triangles`).toBeGreaterThan(0);
    expect(plume.fileBytes).toBeGreaterThan(1000);
  });
});
