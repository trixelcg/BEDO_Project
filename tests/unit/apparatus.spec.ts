import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEFLECTOR_ID,
  DEFLECTORS,
  MESH,
  WATER_SHAPES,
  WEIGHTS,
  getDeflector,
  type AnchorKey,
} from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import {
  ANCHOR_VIEW,
  COVER_LIFT,
  DEFAULT_ARROW_OFFSET,
  FRONT,
  SCREW_LIFT,
} from '../../src/lib/apparatusView';
import { MOMENTUM_FACTORS } from '../fixtures/bedo-reference';

/**
 * Apparatus/domain constants (BEDO-002 §4).
 *
 * These are facts about a physical rig and about one exported GLB. The names are checked
 * against the real asset in `glb-contract.spec.ts`; this file pins the shape of the data
 * itself — what exists, what is unique, and what maps to what.
 */

describe('gltfName', () => {
  // Mirrors three.js PropertyBinding.sanitizeNodeName, which is what GLTFLoader applies
  // to every node name on load. Looking a mesh up by its authored name returns undefined
  // and fails silently, which is the failure mode this helper exists to prevent.
  it.each([
    ['JET Force 2_214', 'JET_Force_2_214'],
    ['Flat_surface_deflector_90.001', 'Flat_surface_deflector_90001'],
    ['hydrolic bensh 1_087', 'hydrolic_bensh_1_087'],
    ['a b\tc\nd', 'a_b_c_d'],
    ['name[0].sub:part/leaf', 'name0subpartleaf'],
    ['Already_Sanitised', 'Already_Sanitised'],
  ])('sanitises %s to %s', (authored, expected) => {
    expect(gltfName(authored)).toBe(expected);
  });

  it('is idempotent — sanitising twice changes nothing', () => {
    const names = [
      ...Object.values(MESH),
      ...DEFLECTORS.flatMap((d) => [d.shelf, d.installed]),
      ...WEIGHTS.map((w) => w.mesh).filter((m): m is string => !!m),
    ];
    for (const name of names) {
      expect(gltfName(gltfName(name))).toBe(gltfName(name));
    }
  });

  it('strips only whitespace and the five characters three.js removes', () => {
    expect(gltfName('keep-these_0123')).toBe('keep-these_0123');
  });
});

describe('deflectors', () => {
  it('has exactly the seven the tray holds', () => {
    expect(DEFLECTORS).toHaveLength(7);
    expect(DEFLECTORS.map((d) => d.id)).toEqual([45, 90, 135, 120, 180, 30, 60]);
  });

  it('gives each deflector a unique id, shelf mesh and installed mesh', () => {
    const unique = (values: unknown[]) => new Set(values).size === values.length;
    expect(unique(DEFLECTORS.map((d) => d.id))).toBe(true);
    expect(unique(DEFLECTORS.map((d) => d.shelf))).toBe(true);
    expect(unique(DEFLECTORS.map((d) => d.installed))).toBe(true);
    expect(unique(DEFLECTORS.map((d) => d.water))).toBe(true);
  });

  it.each(DEFLECTORS)('deflector $id is fully specified', (deflector) => {
    expect(deflector.nameEn).toMatch(/\S/);
    expect(deflector.nameAr).toMatch(/\S/);
    expect(deflector.nameEn).toContain(`${deflector.id}°`);
    expect(deflector.nameAr).toContain(String(deflector.id));
    expect(deflector.momentumFactor).toBeCloseTo(MOMENTUM_FACTORS[deflector.id], 3);
    expect(WATER_SHAPES[deflector.water]).toBeDefined();
  });

  it('assigns each family the deflectors its force law covers', () => {
    const byFamily = (family: string) =>
      DEFLECTORS.filter((d) => d.family === family).map((d) => d.id).sort((a, b) => a - b);
    expect(byFamily('flat')).toEqual([90]);
    expect(byFamily('oblique')).toEqual([30, 45, 60]);
    expect(byFamily('semi')).toEqual([120, 180]);
    expect(byFamily('conical')).toEqual([135]);
  });

  it('defaults to the flat plate, and falls back to it for unknown ids', () => {
    expect(DEFAULT_DEFLECTOR_ID).toBe(90);
    expect(getDeflector(90).id).toBe(90);
    expect(getDeflector(-1).id).toBe(90);
    expect(getDeflector(Number.NaN).id).toBe(90);
  });
});

describe('weights', () => {
  it('offers the six denominations, ascending', () => {
    expect(WEIGHTS.map((w) => w.grams)).toEqual([10, 20, 50, 100, 200, 500]);
  });

  it('can make every 10 g multiple up to the largest reading', () => {
    // Balancing masses always round to a multiple of 10 g, so the set has to reach them.
    const reachable = new Set<number>([0]);
    for (let i = 0; i < 60; i++) {
      for (const { grams } of WEIGHTS) {
        for (const total of [...reachable]) {
          if (total + grams <= 600) reachable.add(total + grams);
        }
      }
    }
    for (let target = 10; target <= 600; target += 10) {
      expect(reachable.has(target), `${target} g is not reachable`).toBe(true);
    }
  });

  it('gives every clickable weight a unique tray mesh', () => {
    const meshes = WEIGHTS.map((w) => w.mesh).filter((m): m is string => !!m);
    expect(meshes).toHaveLength(5);
    expect(new Set(meshes).size).toBe(meshes.length);
    // 20 g is panel-only; the tray has no disc for it.
    expect(WEIGHTS.find((w) => w.grams === 20)?.mesh).toBeUndefined();
  });
});

describe('water shapes', () => {
  it('ships one plume per deflector plus the startup trickle', () => {
    expect(Object.keys(WATER_SHAPES)).toHaveLength(DEFLECTORS.length + 1);
    expect(WATER_SHAPES.low).toBeDefined();
  });

  it('every deflector maps to a distinct plume, and every plume is used', () => {
    const used = new Set(DEFLECTORS.map((d) => d.water));
    const declared = new Set(Object.keys(WATER_SHAPES).filter((k) => k !== 'low'));
    expect([...used].sort()).toEqual([...declared].sort());
  });

  it('every plume url is under /WaterShapes and ends in .glb', () => {
    for (const [key, shape] of Object.entries(WATER_SHAPES)) {
      expect(shape.url, key).toMatch(/^\/WaterShapes\/[\w.]+\.glb$/);
    }
  });
});

describe('anchors and geometry', () => {
  const ANCHOR_KEYS: AnchorKey[] = [
    'cover',
    'tray',
    'weights',
    'pointer',
    'pan',
    'power',
    'flowValve',
    'volumetricValve',
    'overview',
    // BEDO-UX-14B: where the Board utility parks the camera. Not a step's target.
    'board',
  ];

  it('gives every anchor a camera framing', () => {
    expect(Object.keys(ANCHOR_VIEW).sort()).toEqual([...ANCHOR_KEYS].sort());
  });

  it('frames every part from in front of the bench, where the operator stands', () => {
    // The rig faces -X; a positive x offset would put the camera inside the wall.
    expect(FRONT).toEqual([-1, 0, 0]);
    for (const [key, view] of Object.entries(ANCHOR_VIEW) as [AnchorKey, (typeof ANCHOR_VIEW)[AnchorKey]][]) {
      expect(view.offset[0], `${key} is framed from behind the rig`).toBeLessThan(0);
    }
  });

  it('pushes the under-bench valve arrows out towards the viewer', () => {
    // Both valves live in the few centimetres under the bench top, so the default arrow
    // position directly above them is buried inside the cabinet.
    expect(DEFAULT_ARROW_OFFSET).toEqual([0, 0.09, 0]);
    for (const key of ['flowValve', 'volumetricValve'] as const) {
      expect(ANCHOR_VIEW[key].arrowOffset?.[0]).toBeLessThan(0);
    }
    expect(ANCHOR_VIEW.cover.arrowOffset).toBeUndefined();
  });

  it('lifts the screws clear above the cover they hold down', () => {
    expect(COVER_LIFT).toBe(0.286);
    expect(SCREW_LIFT).toBe(0.36);
    expect(SCREW_LIFT).toBeGreaterThan(COVER_LIFT);
  });
});

describe('mesh name table', () => {
  it('names every part the runtime drives', () => {
    expect(Object.keys(MESH).sort()).toEqual(
      [
        'benchSink',
        'flowValve',
        'liquid',
        'nozzle',
        'pointer',
        'pointerPin',
        'powerButtonBody',
        'powerLight',
        'powerSwitch',
        'rod',
        'roomWalls',
        'screws',
        'sightGaugePlate',
        'sightGaugeWindow',
        'spring',
        'tank',
        'tankCover',
        'volumetricValve',
      ].sort()
    );
  });

  it('has no duplicate targets', () => {
    const values = Object.values(MESH);
    expect(new Set(values).size).toBe(values.length);
  });

  it('does not collide with a deflector or weight mesh after sanitising', () => {
    const all = [
      ...Object.values(MESH),
      ...DEFLECTORS.flatMap((d) => [d.shelf, d.installed]),
      ...WEIGHTS.map((w) => w.mesh).filter((m): m is string => !!m),
    ].map(gltfName);
    expect(new Set(all).size, `duplicate sanitised name in ${all.join(', ')}`).toBe(all.length);
  });
});
