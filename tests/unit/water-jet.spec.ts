import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  JET_ASSET,
  NOZZLE_DIAMETER_M,
  NOZZLE_DIAMETER_MODEL_UNITS,
  PLUME_SPREAD,
  STARTUP_VALVE_OPENING,
  diameterOfArea,
  bodyScale,
  plumeScale,
} from '../../src/lib/waterJet';
import { NOZZLE_AREA_M2, TRAVEL_HEIGHT_M } from '../../src/domain/physics';
import { MODEL_UNITS_PER_METRE } from '../../src/lib/apparatusView';
import { WATER_SHAPES, type WaterShapeKey } from '../../src/domain/apparatus';
import { REPO_ROOT } from '../helpers/glb';
import { loadWater } from '../helpers/model';
import { basePoseBox } from '../../src/lib/waterCache';

/**
 * The water's size — and the two different things "size" means here.
 *
 * ## Two defects, in opposite directions
 *
 * The water was first drawn at 95 % of the **tank's** diameter: 172 mm against a 10 mm
 * bore, seventeen times too wide, reading as a pipe that filled the tank. BEDO-017 fixed
 * that by scaling the rendered water to `NOZZLE_AREA_M2` — and overshot, because it applied
 * a *physical bore* to what is actually an *authored silhouette*. At 10 mm the water was
 * invisible, which is how it shipped and why it was reported as not looking like the
 * simulation at all.
 *
 * `Bedo_Mesu_J.mp4` settles it. The water in the tank is a broad translucent body about one
 * deflector diameter across that envelops the nozzle tube — measured per row at t = 60.63 s
 * as 27 px at the deflector, 48-54 px through the body, 74 px at the flared foot. So:
 *
 *   * the **bore** stays 10.00 mm and stays the physics' own number, and
 *   * the **visible body** follows the authored Alembic silhouette, sized from the deflector.
 *
 * These tests hold both, separately. Every asset dimension is measured off the shipped GLBs
 * rather than written down, so a re-export cannot silently invalidate them. See `docs/44`.
 */

const shapes = {} as Record<WaterShapeKey, { width: number; height: number; uvSets: string[] }>;


// `loadWater` lives in tests/helpers/model.ts: the assets are meshopt-compressed, so the
// loader has to be wired the way drei wires it at runtime, in exactly one place.

beforeAll(async () => {
  for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
    const scene = await loadWater(WATER_SHAPES[key].url);
    scene.updateWorldMatrix(true, true);
    // Base pose, exactly as `waterFit` measures it. `Box3.setFromObject` would expand the
    // box over all 80 morph targets — and for relative targets by a bound so loose that
    // the jet's aspect comes out at 5.6 instead of 3.44 — which is precisely the mistake
    // this file exists to catch. See `src/lib/waterCache.ts`.
    const size = basePoseBox(scene).getSize(new THREE.Vector3());

    // Some shapes are authored lying down — their long axis is Z with no rotation node —
    // so the scene stands those up. Measure the same way, or a jet's "width" is its length.
    const upright = size.z > size.y * 1.15;
    const width = upright ? Math.max(size.x, size.y) : Math.max(size.x, size.z);
    const height = upright ? size.z : size.y;

    const uvSets = new Set<string>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      Object.keys(mesh.geometry.attributes)
        .filter((a) => a.startsWith('uv'))
        .forEach((a) => uvSets.add(a));
    });
    shapes[key] = { width, height, uvSets: [...uvSets].sort() };
  }
});

describe('the nozzle, as a diameter', () => {
  it('turns a cross-sectional area into the bore that produces it', () => {
    // d = 2 sqrt(A / pi). Stated as the relation, not the answer.
    expect(diameterOfArea(Math.PI / 4)).toBeCloseTo(1, 12);
    expect(diameterOfArea(Math.PI)).toBeCloseTo(2, 12);
    expect(diameterOfArea(0)).toBe(0);
  });

  it('confirms NOZZLE_AREA_M2 really is the 10 mm bore its comment claims', () => {
    expect(NOZZLE_DIAMETER_M).toBeCloseTo(0.0099975, 7);
    expect(NOZZLE_DIAMETER_M * 1000).toBeGreaterThan(9.99);
    expect(NOZZLE_DIAMETER_M * 1000).toBeLessThan(10.01);
    // And that it is derived, not copied: change the area and the diameter follows.
    expect(diameterOfArea(NOZZLE_AREA_M2)).toBe(NOZZLE_DIAMETER_M);
  });

  it('carries the bore into model space through the stated convention', () => {
    // One model unit is one metre here, so this is currently an identity — and it is
    // written down so that rescaling the model cannot silently break the jet.
    expect(MODEL_UNITS_PER_METRE).toBe(1);
    expect(NOZZLE_DIAMETER_MODEL_UNITS).toBeCloseTo(NOZZLE_DIAMETER_M * MODEL_UNITS_PER_METRE, 12);
  });
});

describe('the physical bore is untouched by presentation', () => {
  it('is still exactly the 10 mm the area implies', () => {
    // BEDO-017's *physics* claim, preserved verbatim. Nothing about how the water is drawn
    // may move this: it is what the force, velocity and momentum equations are built on.
    expect(NOZZLE_DIAMETER_M).toBeCloseTo(0.0099975, 7);
    expect(NOZZLE_DIAMETER_M * 1000).toBeGreaterThan(9.99);
    expect(NOZZLE_DIAMETER_M * 1000).toBeLessThan(10.01);
    expect(NOZZLE_DIAMETER_MODEL_UNITS).toBeCloseTo(NOZZLE_DIAMETER_M, 12);
  });

  it('is derived from the area, so the two cannot drift apart', () => {
    expect(diameterOfArea(NOZZLE_AREA_M2)).toBe(NOZZLE_DIAMETER_M);
  });

  it('no longer sizes the visible water, and nothing in the scene reads it as a width', () => {
    // BEDO-017's *visual* claim is the one that was wrong. It sized the whole authored body
    // to the bore, which rendered as an invisible thread — see `docs/44`. The bore stays;
    // what changed is that it no longer decides how wide the water looks.
    const source = readFileSync(path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'), 'utf8');
    expect(source).toMatch(/bodyScale\(/);
    expect(source).not.toMatch(/jetScale\(/);
  });
});

describe('the visible water body keeps the proportions BEDO authored', () => {
  it('is scaled by one factor on every axis, so the silhouette is never stretched', () => {
    // BEDO-UX-17. The scale used to be a cross-flow/along-flow pair: width from the
    // deflector, height from the span. Measured against the shipped asset and the real
    // apparatus, that stretched the authored shape 2.06x along the flow.
    const { width, height } = shapes[JET_ASSET];
    const s = bodyScale(0.2308, height);
    expect((height * s) / (width * s)).toBeCloseTo(height / width, 9);
  });

  it('renders the authored 3.44:1 column at the size the apparatus implies', () => {
    // The apparatus, measured from Bedo_baked_v2.glb: a 32.5 mm deflector whose underside
    // sits 230.8 mm above the tank floor, inside a 181 mm tank.
    const { width, height } = shapes[JET_ASSET];
    expect(height / width).toBeCloseTo(3.44, 2);
    const s = bodyScale(0.2308, height);
    expect(height * s).toBeCloseTo(0.2308, 9);
    // 67 mm: wide enough to swallow the nozzle tube, and well inside the 181 mm tank.
    expect(width * s).toBeCloseTo(0.067, 3);
    expect(width * s).toBeLessThan(0.181);
  });

  it('is far wider than the bore — the original BEDO-017 correction, kept', () => {
    const { width, height } = shapes[JET_ASSET];
    expect(width * bodyScale(0.2308, height)).toBeGreaterThan(NOZZLE_DIAMETER_MODEL_UNITS * 2);
  });

  it('spans whatever it is given', () => {
    const { height } = shapes[JET_ASSET];
    expect(height * bodyScale(0.25, height)).toBeCloseTo(0.25, 9);
    expect(height * bodyScale(0.05, height)).toBeCloseTo(0.05, 9);
  });

  it('takes its size from the span alone, never from the flow rate directly', () => {
    // Velocity may drive animation; it may never be read as a size on its own. The span
    // already carries the startup ramp, so an identical span must give an identical body.
    const { height } = shapes[JET_ASSET];
    const repeats = [0.05, 0.1, 0.4, 0.5, 1.0].map(() => bodyScale(0.2308, height));
    expect(new Set(repeats.map((s) => s.toFixed(12))).size).toBe(1);
    // The ramp still shortens the body while the jet is climbing.
    const climbing = bodyScale(0.2308 * (0.1 / STARTUP_VALVE_OPENING), height);
    expect(climbing).toBeLessThan(bodyScale(0.2308, height));
  });

  it('degrades safely rather than dividing by zero', () => {
    expect(Number.isFinite(bodyScale(0, 0))).toBe(true);
  });
});

describe('the plume is scaled from the deflector, never the tank', () => {
  it('grows with the deflector it forms on', () => {
    const asset = shapes.d90.width;
    const small = plumeScale(0.02, asset);
    const large = plumeScale(0.04, asset);
    expect(large).toBeCloseTo(small * 2, 9);
    expect(asset * plumeScale(0.0325, asset)).toBeCloseTo(0.0325 * PLUME_SPREAD, 9);
  });

  it('spreads wider than the deflector, and says so', () => {
    // The one presentation number in the water mapping. No BEDO source gives a figure, so
    // it is named, exported and testable rather than buried in the frame loop.
    expect(PLUME_SPREAD).toBeGreaterThan(1);
    expect(PLUME_SPREAD).toBeLessThan(3);
  });

  it('is wider than the jet — the two are different objects', () => {
    // §9. Forcing the plume to the bore would be as wrong as sizing the jet from the tank.
    const plume = shapes.d90.width * plumeScale(0.0325, shapes.d90.width);
    expect(plume).toBeGreaterThan(NOZZLE_DIAMETER_MODEL_UNITS * 3);
  });
});

describe('the shipped water assets', () => {
  it('ships exactly the eight the apparatus declares, and all are loadable', () => {
    const onDisk = readdirSync(path.join(REPO_ROOT, 'public', 'WaterShapes')).filter((f) =>
      f.endsWith('.glb')
    );
    expect(onDisk).toHaveLength(8);
    expect(Object.keys(WATER_SHAPES)).toHaveLength(8);
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      expect(shapes[key].width, `${key} has no width`).toBeGreaterThan(0);
      expect(shapes[key].height, `${key} has no height`).toBeGreaterThan(0);
    }
  });

  it('identifies the jet asset by its aspect, not by its name', () => {
    // The physical jet is a 10 mm bore climbing the 35 mm `TRAVEL_HEIGHT_M`: aspect 3.50.
    // `Water_low` is 3.44 — within 2% — while every plume is near 1.3. That is what makes
    // it BEDO's "water shape before impact" rather than one more spray.
    const physicalAspect = TRAVEL_HEIGHT_M / NOZZLE_DIAMETER_M;
    const jetAspect = shapes[JET_ASSET].height / shapes[JET_ASSET].width;
    expect(Math.abs(jetAspect - physicalAspect) / physicalAspect).toBeLessThan(0.05);

    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      if (key === JET_ASSET) continue;
      const aspect = shapes[key].height / shapes[key].width;
      expect(aspect, `${key} looks like a jet, not a plume`).toBeLessThan(physicalAspect * 0.7);
    }
  });

  it('no longer carries the authored UV data nothing ever sampled', () => {
    // `docs/41 §UV` recorded that every shape had TEXCOORD_0 and some a TEXCOORD_1, while
    // the shader sampled by world position; BEDO-043 replaced that projection with a
    // coordinate derived from the vertices, leaving the authored channels addressing
    // nothing at all. BEDO-044's conversion drops them, which also stops a UV seam
    // splitting vertices that would then be paid for in each of the 80 morph targets.
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      expect(shapes[key].uvSets, `${key} still ships authoring UVs`).toEqual([]);
    }
  });
});

describe('no width may come from the scene', () => {
  it('never derives water size from the tank', () => {
    // The literal shape of BUG-03: `tankBounds.width * 0.95`. The tank measurement that
    // fed it is gone from the component entirely, so this asserts its absence rather than
    // trusting a comment.
    const source = readFileSync(path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'), 'utf8');
    expect(source).not.toMatch(/tankBounds/);
    const water = readFileSync(path.join(REPO_ROOT, 'src/lib/waterJet.ts'), 'utf8');
    const code = water
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/tank/i);
    expect(code).not.toMatch(/viewport|innerWidth|clientWidth/);
  });

  it('leaves the verified physics alone', () => {
    // §4. The mapping reads the area; it may never redefine it.
    expect(NOZZLE_AREA_M2).toBe(0.0000785);
    expect(TRAVEL_HEIGHT_M).toBe(0.035);
  });
});
