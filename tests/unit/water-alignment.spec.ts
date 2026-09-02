import { describe, expect, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import { loadApparatus, loadWater } from '../helpers/model';
import { measureTankInterior, WALL_CLEARANCE } from '../../src/lib/tankWater';
import { MESH, WATER_SHAPES, DEFLECTORS, type WaterShapeKey } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import { WATER_MODEL_SCALE, JET_ASSET } from '../../src/lib/waterJet';
import { basePoseBox } from '../../src/lib/waterCache';

/**
 * Where the water sits, against the apparatus it sits in (BEDO-WATER-01).
 *
 * `water-jet.spec.ts` checks the authored assets against each other and against the scale.
 * This checks them against the **real geometry** — the bore of the glass, the plate that
 * closes it, the tube the jet sheathes and the deflector it strikes — so a re-export that
 * moved any of those turns this red rather than shipping water in the wrong place.
 *
 * Every figure below was measured off `Bedo_baked_v2.glb`, not chosen:
 *
 *   tank glass       inner wall 85.57 mm, outer 90.5 mm, y 1.05808..1.37491
 *   tank floor plate 161 mm disc across the bore, top y 1.08096
 *   nozzle tube      `Cylinder012`, 30.0 mm outer, y 1.08551..1.26176
 *   deflectors       32.4-32.5 mm, undersides y 1.28455..1.28891
 *   common axis      x 0.01010, z -0.22930
 */
const AXIS = { x: 0.01010, z: -0.22930 };
const TANK = { innerRadius: 0.08557, floorY: 1.08096, glassTopY: 1.37491 };
const NOZZLE_TUBE = { node: 'Cylinder012', mouthY: 1.26176, outerDia: 0.030 };

let app: THREE.Group;
const find = (n: string) => {
  const target = gltfName(n);
  let hit: THREE.Object3D | null = null;
  app.traverse((o) => { if (o.name === target) hit = o; });
  return hit as THREE.Object3D | null;
};
const vertsOf = (o: THREE.Object3D) => {
  const pts: THREE.Vector3[] = []; const v = new THREE.Vector3();
  o.updateWorldMatrix(true, true);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry?.getAttribute('position'); if (!p) return;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p as THREE.BufferAttribute, i); pts.push(v.clone().applyMatrix4(m.matrixWorld)); }
  });
  return pts;
};
const shapes = {} as Record<WaterShapeKey, { box: THREE.Box3; width: number }>;

beforeAll(async () => {
  app = await loadApparatus();
  app.updateWorldMatrix(true, true);
  for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
    const scene = await loadWater(WATER_SHAPES[key].url);
    scene.updateWorldMatrix(true, true);
    const box = basePoseBox(scene);
    const size = box.getSize(new THREE.Vector3());
    shapes[key] = { box, width: Math.max(size.x, size.z) };
  }
}, 180000);

describe('the water is on the apparatus axis', () => {
  it('A/B — every authored shape shares the nozzle-tank-deflector axis', () => {
    // The whole basis for WATER_MODEL_SCALE: authored x/z, scaled, must land on the axis
    // the rig actually has. 0.5 mm is a tenth of the glass wall.
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      const c = shapes[key].box.getCenter(new THREE.Vector3());
      expect(c.x * WATER_MODEL_SCALE, `${key} x`).toBeCloseTo(AXIS.x, 3);
      expect(c.z * WATER_MODEL_SCALE, `${key} z`).toBeCloseTo(AXIS.z, 3);
    }
  });

  it('C — the authored scale is the one the apparatus implies, from geometry alone', () => {
    // Derive it rather than assert the constant: authored z over apparatus z, per shape.
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      const c = shapes[key].box.getCenter(new THREE.Vector3());
      expect(AXIS.z / c.z, `${key}`).toBeCloseTo(WATER_MODEL_SCALE, 4);
    }
  });
});

describe('the jet against the real nozzle tube', () => {
  it('A — the tube is where the measurement says, so the rest of this file means something', () => {
    const tube = find(NOZZLE_TUBE.node);
    expect(tube, `${NOZZLE_TUBE.node} is missing from the model`).not.toBeNull();
    const b = new THREE.Box3().setFromPoints(vertsOf(tube!));
    expect(b.max.y).toBeCloseTo(NOZZLE_TUBE.mouthY, 4);
    expect(Math.max(b.max.x - b.min.x, b.max.z - b.min.z)).toBeCloseTo(NOZZLE_TUBE.outerDia, 3);
  });

  it('B — the jet sheathes the tube: it reaches the mouth and is wider than it', () => {
    const jet = shapes[JET_ASSET];
    const top = jet.box.max.y * WATER_MODEL_SCALE;
    // The visible column must not stop short of the mouth — a gap reads as a floating jet.
    expect(top).toBeGreaterThanOrEqual(NOZZLE_TUBE.mouthY);
    // ...and must envelop the 30 mm tube rather than hide behind it.
    expect(jet.width * WATER_MODEL_SCALE).toBeGreaterThan(NOZZLE_TUBE.outerDia);
  });

  it('B2 — and it starts at or above the tank floor, not inside the base plate', () => {
    expect(shapes[JET_ASSET].box.min.y * WATER_MODEL_SCALE).toBeGreaterThanOrEqual(TANK.floorY - 0.001);
  });
});

describe('the plumes against the real deflectors', () => {
  const lowestDeflectorUnderside = () =>
    Math.min(...DEFLECTORS.map((d) => new THREE.Box3().setFromPoints(vertsOf(find(d.installed)!)).min.y));

  it('D/E — every plume reaches its deflector rather than floating below it', () => {
    const underside = lowestDeflectorUnderside();
    for (const d of DEFLECTORS) {
      const top = shapes[d.water].box.max.y * WATER_MODEL_SCALE;
      expect(top, `${d.id}° plume top`).toBeGreaterThan(underside - 0.03);
    }
  });

  it('F — only the 45 deg oblique spray exceeds the bore, and it is a SOURCE GAP', () => {
    // Measured, not chosen. Seven of the eight authored shapes fit the 171.1 mm bore with
    // room to spare; `Water45_Oblique` is authored 180.1 mm across and therefore passes
    // through the glass by about 4.5 mm a side.
    //
    // That is a property of the Alembic BEDO supplied, not of the runtime: an oblique jet
    // does throw its sheet sideways, so a spray wider than the vessel is a plausible thing
    // to have simulated. Narrowing it here would be inventing authored behaviour, and
    // per-shape fitting is exactly what BEDO-UX-18 removed. So the gap is recorded rather
    // than papered over — if a re-export fixes it, or another shape starts to exceed the
    // bore, this test says so.
    const bore = TANK.innerRadius * 2;
    const over = DEFLECTORS.filter((d) => shapes[d.water].width * WATER_MODEL_SCALE > bore);
    expect(over.map((d) => d.id)).toEqual([45]);
    expect(shapes.d45.width * WATER_MODEL_SCALE).toBeCloseTo(0.1801, 3);
    // Nothing else may drift into the glass.
    for (const d of DEFLECTORS.filter((x) => x.id !== 45)) {
      expect(shapes[d.water].width * WATER_MODEL_SCALE, `${d.id}° plume width`).toBeLessThanOrEqual(bore);
    }
  });
});

describe('the tank water fits the tank it is drawn in', () => {
  const interior = () =>
    measureTankInterior(find(MESH.tank)!, (v) => v, { floor: find(MESH.nozzle), ceiling: find(MESH.tankCover) })!;

  it('F — the cylinder sits inside the glass, with clearance', () => {
    const t = interior();
    expect(t.radius).toBeLessThan(TANK.innerRadius);
    expect(t.radius).toBeCloseTo(TANK.innerRadius * (1 - WALL_CLEARANCE), 5);
  });

  it('G — the floor is the plate that closes the tank, not the sunk glass rim', () => {
    // The defect: the glass runs 22.9 mm below the plate, so a bbox floor put the water
    // base inside an opaque casting and overstated the fill height with it.
    const t = interior();
    expect(t.floorY).toBeCloseTo(TANK.floorY, 4);
    expect(t.floorY).toBeGreaterThan(TANK.glassTopY - 0.31683 + 0.02);
  });

  it('G2 — the ceiling is under the cover, and the interior is shorter than the glass', () => {
    const t = interior();
    expect(t.ceilingY).toBeLessThan(TANK.glassTopY);
    expect(t.ceilingY - t.floorY).toBeLessThan(0.31683);
    expect(t.ceilingY - t.floorY).toBeGreaterThan(0.2);
  });

  it('H — falls back to the glass when the closing parts are not supplied', () => {
    // A re-export that renames the base must degrade to the old behaviour, not to null.
    const bare = measureTankInterior(find(MESH.tank)!, (v) => v)!;
    expect(bare.floorY).toBeLessThan(TANK.floorY);
    expect(bare.axis.x).toBeCloseTo(AXIS.x, 4);
  });
});

describe('state to asset mapping', () => {
  it('I — each deflector names its own authored shape, and all eight are distinct', () => {
    const used = DEFLECTORS.map((d) => d.water);
    expect(new Set(used).size).toBe(DEFLECTORS.length);
    expect(used).not.toContain(JET_ASSET);
    expect(new Set([...used, JET_ASSET]).size).toBe(Object.keys(WATER_SHAPES).length);
  });
});
