import { beforeAll, describe, expect, it } from 'vitest';
import { DEFLECTORS, MESH, WATER_SHAPES, WEIGHTS } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import { describeMissing, readGlb, type GlbReport } from '../helpers/glb';

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
/** sanitised name -> authored name, as three.js would expose the export. */
let exposed: Map<string, string>;

beforeAll(() => {
  report = readGlb(MODEL);
  exposed = new Map(report.nodeNames.map((name) => [gltfName(name), name]));
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

  it('resolves all 36 contract names, so the count itself cannot drift unnoticed', () => {
    const names = contract();
    // 17 MESH entries + 7 shelves + 7 installed + 5 weight discs. The three added by
    // BEDO-WATER-16 are the sight gauge's two plates and the bench sink.
    expect(names).toHaveLength(36);
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
