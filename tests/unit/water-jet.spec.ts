import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  JET_ASSET,
  JET_WIDTH_TOLERANCE,
  NOZZLE_DIAMETER_M,
  NOZZLE_DIAMETER_MODEL_UNITS,
  PLUME_SPREAD,
  STARTUP_VALVE_OPENING,
  diameterOfArea,
  jetScale,
  plumeScale,
} from '../../src/lib/waterJet';
import { NOZZLE_AREA_M2, TRAVEL_HEIGHT_M } from '../../src/domain/physics';
import { MODEL_UNITS_PER_METRE } from '../../src/lib/apparatusView';
import { WATER_SHAPES, type WaterShapeKey } from '../../src/domain/apparatus';
import { REPO_ROOT } from '../helpers/glb';
import { loadWater } from '../helpers/model';
import { basePoseBox } from '../../src/lib/waterCache';

/**
 * The water's size, against the nozzle it comes out of (BUG-03).
 *
 * ## The defect
 *
 * The jet was drawn at 95% of the **tank's** diameter. The tank is 181 mm across and the
 * bore is 10 mm, so the water left the nozzle 17.2 times too wide — measured at HEAD as
 * 139.7 mm at the first reading's setpoint and 172.0 mm at full flow. It read as a pipe
 * filling the tank rather than a jet, and it hid the rod, the spring and the deflector
 * behind it.
 *
 * These tests pin the replacement to the only thing that may decide a jet's width: the
 * area the domain says the nozzle has. Every asset dimension below is measured off the
 * shipped GLBs rather than written down, so a re-export cannot silently invalidate them.
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

describe('the jet is scaled from the nozzle', () => {
  it('renders the shipped jet asset at exactly the bore', () => {
    const { width, height } = shapes[JET_ASSET];
    const scale = jetScale(width, height, 0.184);
    expect(width * scale.crossFlow).toBeCloseTo(NOZZLE_DIAMETER_MODEL_UNITS, 9);
    // Within the stated tolerance, by a wide margin.
    const errorPct = Math.abs(width * scale.crossFlow - NOZZLE_DIAMETER_M) / NOZZLE_DIAMETER_M;
    expect(errorPct).toBeLessThan(JET_WIDTH_TOLERANCE);
    expect(errorPct).toBeLessThan(1e-9);
  });

  it('stretches along the flow to the gap it is given, and only along the flow', () => {
    const { width, height } = shapes[JET_ASSET];
    const short = jetScale(width, height, 0.05);
    const long = jetScale(width, height, 0.20);
    expect(height * long.alongFlow).toBeCloseTo(0.2, 9);
    expect(height * short.alongFlow).toBeCloseTo(0.05, 9);
    // The bore does not care how far the water has to travel.
    expect(short.crossFlow).toBe(long.crossFlow);
  });

  it('is the same width at every flow state', () => {
    // §11: velocity may drive animation, never the bore. Nothing about the valve opening
    // reaches `jetScale` at all — it takes a gap, and the gap is geometry.
    const { width, height } = shapes[JET_ASSET];
    const widths = [0.05, 0.1, 0.4, 0.5, 1.0].map(
      (n) => width * jetScale(width, height, 0.184 * Math.min(1, n / STARTUP_VALVE_OPENING)).crossFlow
    );
    expect(new Set(widths.map((w) => w.toFixed(12))).size).toBe(1);
    expect(widths[0]).toBeCloseTo(NOZZLE_DIAMETER_MODEL_UNITS, 9);
  });

  it('is the same width for every deflector family', () => {
    // §13: no experiment may quietly use a different nozzle. The jet asset is one asset.
    const { width, height } = shapes[JET_ASSET];
    const scale = jetScale(width, height, 0.184);
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      if (key === JET_ASSET) continue;
      // Choosing a plume never changes the jet — they are separate objects now.
      expect(width * scale.crossFlow).toBeCloseTo(NOZZLE_DIAMETER_MODEL_UNITS, 9);
    }
  });

  it('degrades safely rather than dividing by zero', () => {
    expect(Number.isFinite(jetScale(0, 0, 0).crossFlow)).toBe(true);
    expect(Number.isFinite(jetScale(0, 0, 0).alongFlow)).toBe(true);
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
