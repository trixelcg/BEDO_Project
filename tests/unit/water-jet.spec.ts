import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  JET_ASSET,
  NOZZLE_DIAMETER_M,
  NOZZLE_DIAMETER_MODEL_UNITS,
  WATER_MODEL_SCALE,
  diameterOfArea,
  waterShapeForFlow,
} from '../../src/lib/waterJet';
import {
  FIRST_READING_VALVE,
  NOZZLE_AREA_M2,
  ROW_VALVE_SETTINGS,
  SECOND_READING_VALVE,
  TOTAL_FLOW_L_MIN,
  TRAVEL_HEIGHT_M,
  flowRateLMin,
  jetState,
} from '../../src/domain/physics';
import { DRAIN_CAPACITY_FRACTION } from '../../src/lib/tankWater';
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

const shapes = {} as Record<
  WaterShapeKey,
  { width: number; height: number; centre: THREE.Vector3; minY: number; maxY: number; uvSets: string[] }
>;


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
    const box = basePoseBox(scene);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());

    // As loaded, through the full node chain — which is how the runtime draws them, and the
    // measurement that shows they were all authored in the rig's own space (BEDO-UX-18).
    const width = Math.max(size.x, size.z);
    const height = size.y;

    const uvSets = new Set<string>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      Object.keys(mesh.geometry.attributes)
        .filter((a) => a.startsWith('uv'))
        .forEach((a) => uvSets.add(a));
    });
    shapes[key] = { width, height, centre, minY: box.min.y, maxY: box.max.y, uvSets: [...uvSets].sort() };
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
    expect(source).toMatch(/WATER_MODEL_SCALE/);
    expect(source).not.toMatch(/jetScale\(/);
  });
});

describe('the authored low-flow / after-impact state mapping', () => {
  it('A — Water_low is reachable from the experiment\'s own first reading', () => {
    // The defect this replaces: selection keyed on `impactVelocityMS > 0`, which is zero only
    // below n = 0.0617 while the water is not drawn at all until n > 0.05 — a 1.2 % sliver of
    // the valve that no lesson state visits. The first reading is the low-flow state the
    // reference records at 55.5-65.5 s, and it must select the column.
    const fraction = flowRateLMin(FIRST_READING_VALVE) / TOTAL_FLOW_L_MIN;
    expect(fraction).toBeLessThan(DRAIN_CAPACITY_FRACTION);
    expect(waterShapeForFlow(fraction, 'd90')).toBe(JET_ASSET);
  });

  it('B — no flow selects the column rather than a spread', () => {
    // The frame loop draws nothing at all when the pump is off; this is the mapping's own
    // answer at the boundary, so a zero can never fall through to a deflector plume.
    expect(waterShapeForFlow(0, 'd90')).toBe(JET_ASSET);
    expect(waterShapeForFlow(0, 'd135')).toBe(JET_ASSET);
  });

  it('C — the whole low-flow half of the valve selects the column', () => {
    // Not just the setpoint: every opening below the crossover, so a student dragging the
    // slider sees one state rather than a flicker.
    for (const n of [0.06, 0.1, 0.2, 0.3, 0.4, 0.45]) {
      const fraction = flowRateLMin(n) / TOTAL_FLOW_L_MIN;
      expect(waterShapeForFlow(fraction, 'd90'), `n=${n}`).toBe(JET_ASSET);
    }
  });

  it('D — the second and third readings select the installed deflector cache', () => {
    for (const n of [SECOND_READING_VALVE, ROW_VALVE_SETTINGS[3], 0.8, 1.0]) {
      const fraction = flowRateLMin(n) / TOTAL_FLOW_L_MIN;
      expect(fraction).toBeGreaterThan(DRAIN_CAPACITY_FRACTION);
      expect(waterShapeForFlow(fraction, 'd135'), `n=${n}`).toBe('d135');
    }
  });

  it('E — going back down to low flow returns to the column', () => {
    // The selector is a pure function of the flow, so the return leg cannot strand the
    // high-flow shape: the same input that gave the column on the way up gives it again.
    const low = flowRateLMin(FIRST_READING_VALVE) / TOTAL_FLOW_L_MIN;
    const high = flowRateLMin(SECOND_READING_VALVE) / TOTAL_FLOW_L_MIN;
    const walk = [0, low, high, low, 0].map((f) => waterShapeForFlow(f, 'd90'));
    expect(walk).toEqual([JET_ASSET, JET_ASSET, 'd90', JET_ASSET, JET_ASSET]);
  });

  it('F — every deflector still maps to its own plume above the threshold', () => {
    const above = DRAIN_CAPACITY_FRACTION + 0.001;
    for (const key of (Object.keys(WATER_SHAPES) as WaterShapeKey[]).filter(
      (shape) => shape !== JET_ASSET
    )) {
      expect(waterShapeForFlow(above, key)).toBe(key);
    }
  });

  it('the threshold is the tank\'s, not a new one invented here', () => {
    // §4: no magic number. The crossover is `DRAIN_CAPACITY_FRACTION`, which `lib/tankWater`
    // already calibrated against the same two reference intervals — so the column shows
    // exactly while the tank stays empty, which is what the recording pairs.
    const source = readFileSync(path.join(REPO_ROOT, 'src/lib/waterJet.ts'), 'utf8');
    expect(source).toMatch(/DRAIN_CAPACITY_FRACTION/);
    // The selector must not carry a literal of its own.
    const selector = source.slice(source.indexOf('export const waterShapeForFlow'));
    expect(selector).not.toMatch(/0\.\d/);
  });

  it('the physics scalar it used to read is untouched and still reachable', () => {
    // The domain keeps its meaning: this task changed which quantity the *presentation*
    // asks for, not what any equation computes.
    const jet = jetState(FIRST_READING_VALVE, 90);
    expect(jet.impactVelocityMS).toBeGreaterThan(0);
    expect(jet.flowRateLMin).toBeCloseTo(15.71, 1);
  });

  it('does not retain a valve-opening magic threshold or render both caches', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'), 'utf8');
    expect(source).not.toMatch(/STARTUP_VALVE_OPENING/);
    expect(source).toMatch(/state\.live\.impactVelocityMS/);
    expect(source).toMatch(/gltf\.scene\.visible = key === activeWater/);
  });
});

describe('the water is drawn where and how BEDO authored it', () => {
  it('is one unit conversion, not a fit — centimetres to metres', () => {
    // BEDO-UX-18. Not a tuning knob: the caches are authored in the rig's own space, in
    // centimetres, and the model is in metres.
    expect(WATER_MODEL_SCALE).toBe(0.01);
  });

  it('puts all eight shapes on the apparatus axis, which is what makes 0.01 correct', () => {
    // Read from the shipped GLBs through the full node transform chain. Every shape shares
    // one centre in x/z; the apparatus puts the nozzle, tank and deflector on (0.0101,
    // -0.2293). That ratio is the scale, and it agrees on all eight to five decimals.
    const AXIS_Z = -0.2293;
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      const { centre } = shapes[key];
      expect(centre.x, `${key} x`).toBeCloseTo(1.01, 1);
      expect(centre.z, `${key} z`).toBeCloseTo(-22.93, 1);
      // The implied scale, per shape, from the axis the apparatus actually has.
      expect(AXIS_Z / centre.z, `${key} implied scale`).toBeCloseTo(WATER_MODEL_SCALE, 4);
    }
  });

  it('lands every shape inside the tank, on the floor, reaching the deflector', () => {
    // The apparatus, measured from Bedo_baked_v2.glb.
    const TANK_FLOOR = 1.05808, TANK_TOP = 1.37490, TANK_DIA = 0.1810, DEFLECTOR = 1.28890;
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      const s = shapes[key];
      const width = s.width * WATER_MODEL_SCALE;
      const y0 = s.minY * WATER_MODEL_SCALE, y1 = s.maxY * WATER_MODEL_SCALE;
      expect(width, `${key} must fit the bore`).toBeLessThan(TANK_DIA);
      expect(y0, `${key} must not start below the tank floor by more than a hair`)
        .toBeGreaterThan(TANK_FLOOR - 0.01);
      expect(y1, `${key} must not overflow the tank`).toBeLessThan(TANK_TOP);
      expect(y1, `${key} must reach the deflector region`).toBeGreaterThan(DEFLECTOR - 0.05);
    }
  });

  it('draws the jet narrow and the plumes wide, as authored', () => {
    // 51 mm column; 109-170 mm sprays. The ratio is the artwork's, not a chosen spread.
    expect(shapes[JET_ASSET].width * WATER_MODEL_SCALE).toBeCloseTo(0.051, 3);
    for (const key of (Object.keys(WATER_SHAPES) as WaterShapeKey[]).filter((k) => k !== JET_ASSET)) {
      const w = shapes[key].width * WATER_MODEL_SCALE;
      expect(w, `${key}`).toBeGreaterThan(0.10);
      expect(w, `${key}`).toBeLessThan(0.181);
    }
  });

  it('nothing measures, rotates or re-centres the shapes any more', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'), 'utf8');
    expect(source).not.toMatch(/waterFit/);
    expect(source).not.toMatch(/bodyScale|plumeScale/);
    expect(source).toMatch(/WATER_MODEL_SCALE/);
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
    // The rule is about *size*, not about the word. Since BEDO-WATER-05 this module reads
    // one thing from `tankWater` — `DRAIN_CAPACITY_FRACTION`, the flow at which the tank
    // starts to accumulate — because that is the boundary the reference recording draws
    // between its low-flow and high-flow intervals, and the same boundary has to decide
    // which authored shape is showing. A flow fraction is not a dimension: what stays
    // forbidden is taking any *measurement* of the vessel.
    expect(code).not.toMatch(/tankBounds|tankInterior|tankRadius|tankWidth|tankDiameter/i);
    for (const line of code.split('\n')) {
      if (!/tank/i.test(line)) continue;
      expect(line, `waterJet reads something other than the drain threshold: ${line.trim()}`)
        .toMatch(/DRAIN_CAPACITY_FRACTION|from '\.\/tankWater'/);
    }
    expect(code).not.toMatch(/viewport|innerWidth|clientWidth/);
  });

  it('leaves the verified physics alone', () => {
    // §4. The mapping reads the area; it may never redefine it.
    expect(NOZZLE_AREA_M2).toBe(0.0000785);
    expect(TRAVEL_HEIGHT_M).toBe(0.035);
  });
});
