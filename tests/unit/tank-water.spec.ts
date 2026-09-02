import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DRAIN_CAPACITY_FRACTION,
  DRAIN_SECONDS,
  FILL_SECONDS,
  FULL_LEVEL,
  TANK_WATER_SEGMENTS,
  WALL_CLEARANCE,
  advanceLevel,
  createTankWaterGeometry,
  measureTankInterior,
  targetLevel,
} from '../../src/lib/tankWater';
import { MESH } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import { loadApparatus, APPARATUS_POSITION, APPARATUS_SCALE } from '../helpers/model';
import { REPO_ROOT } from '../helpers/glb';

/**
 * The water that collects in the measuring tank.
 *
 * The apparatus is volumetric: shut the drain, let the tank fill, read the volume. The
 * reference shows both states — only the jet column at t = 60.63 s, and the tank filled to
 * just under the cover at t = 74.0 s. No shipped asset can draw the second one, so it is
 * generated from the tank's own measured interior.
 *
 * These tests hold two things: that the geometry really is derived from the model rather
 * than written down, and that the level is driven by the drain rather than by the flow rate.
 */

let model: THREE.Group;
let group: THREE.Group;

beforeAll(async () => {
  model = await loadApparatus();
  group = new THREE.Group();
  group.position.set(...APPARATUS_POSITION);
  group.scale.setScalar(APPARATUS_SCALE);
  group.add(model);
  group.updateWorldMatrix(true, true);
});

const interior = () => {
  const tank = model.getObjectByName(gltfName(MESH.tank));
  expect(tank, 'the tank is not in the model').toBeTruthy();
  return measureTankInterior(tank!, (v) => group.worldToLocal(v));
};

describe('the interior is measured from the glass', () => {
  it('finds the inner wall, not the outer one', () => {
    // The glass is a tube: its vertices fall into two radial bands, 85.6 mm and 90.5 mm.
    // Filling to the outer one would put the water inside the glass.
    const it0 = interior();
    expect(it0).not.toBeNull();
    expect(it0!.radius * 1000).toBeGreaterThan(78);
    expect(it0!.radius * 1000).toBeLessThan(87);
  });

  it('sits inside the glass rather than coincident with it', () => {
    // Coincident surfaces z-fight, and the tank is the one place in the scene where two
    // transparent surfaces are guaranteed to overlap.
    expect(WALL_CLEARANCE).toBeGreaterThan(0);
    expect(WALL_CLEARANCE).toBeLessThan(0.05);
  });

  it('spans the tank floor to the underside of the cover', () => {
    const it0 = interior()!;
    // Measured: floor 1.058, top 1.375 in model space — about 298 mm of usable interior.
    expect(it0.floorY).toBeCloseTo(1.058, 2);
    expect(it0.ceilingY).toBeCloseTo(1.375, 2);
    expect((it0.ceilingY - it0.floorY) * 1000).toBeGreaterThan(280);
  });

  it('finds the tank axis, which is not the model origin', () => {
    const it0 = interior()!;
    expect(it0.axis.x).toBeCloseTo(0.0101, 2);
    expect(it0.axis.y).toBeCloseTo(-0.2293, 2);
  });

  it('returns null for something that is not a tank, rather than a wrong answer', () => {
    const empty = new THREE.Group();
    expect(measureTankInterior(empty, (v) => v)).toBeNull();
  });
});

describe('the geometry it builds', () => {
  it('is a unit-scalable cylinder standing on the tank floor', () => {
    const it0 = interior()!;
    const g = createTankWaterGeometry(it0);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    // Origin at the base: scaling y raises the surface instead of growing both ways.
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(it0.ceilingY - it0.floorY, 6);
    expect(box.max.x).toBeCloseTo(it0.radius, 4);
  });

  it('is cheap: one draw, a couple of hundred triangles', () => {
    const g = createTankWaterGeometry(interior()!);
    const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    expect(TANK_WATER_SEGMENTS).toBeLessThanOrEqual(64);
    expect(tris).toBeLessThan(400);
  });
});

describe('the tank fills only when more arrives than the drain can carry', () => {
  it('treats the threshold as presentation, never as a physical constant', () => {
    // It is calibrated from the recording, not from any BEDO document, and it must stay out
    // of the verified physics. If a real drain capacity is ever documented it replaces this.
    const tank = readFileSync(path.join(REPO_ROOT, 'src/lib/tankWater.ts'), 'utf8');
    expect(tank).toMatch(/NOT[\s*]+a verified BEDO physical constant/i);
    for (const f of ['physics.ts', 'stateMachine.ts', 'experiments.ts']) {
      const domain = readFileSync(path.join(REPO_ROOT, 'src/domain', f), 'utf8');
      expect(domain, `${f} must not read the drain threshold`).not.toMatch(
        /DRAIN_CAPACITY_FRACTION/
      );
    }
  });

  it('stays empty at the first reading and fills at the second', () => {
    // The two states the recording actually shows. `flowRateLMin` puts the first reading
    // (n = 0.4) at 0.131 of pump capacity and the second (n = 0.5) at 0.225; the tank is
    // empty through ten seconds of the first and filling within a second of the second.
    expect(targetLevel(0.131, false)).toBe(0);
    expect(targetLevel(0.225, false)).toBe(FULL_LEVEL);
    expect(DRAIN_CAPACITY_FRACTION).toBeGreaterThan(0.131);
    expect(DRAIN_CAPACITY_FRACTION).toBeLessThan(0.225);
  });

  it('never accumulates with no flow, whatever the valve is doing', () => {
    expect(targetLevel(0, false)).toBe(0);
    expect(targetLevel(0, true)).toBe(0);
  });

  it('empties when a learner opens the volumetric valve', () => {
    expect(targetLevel(0.225, true)).toBe(0);
  });

  it('stops short of the cover, where the reference does', () => {
    expect(FULL_LEVEL).toBeGreaterThan(0.8);
    expect(FULL_LEVEL).toBeLessThan(1);
  });

  it('fills and drains at the measured-bound rate, monotonically', () => {
    let level = 0;
    for (let i = 0; i < FILL_SECONDS * 10; i++) {
      const next = advanceLevel(level, FULL_LEVEL, 0.1);
      expect(next).toBeGreaterThanOrEqual(level);
      level = next;
    }
    expect(level).toBeCloseTo(FULL_LEVEL, 6);

    for (let i = 0; i < DRAIN_SECONDS * 10; i++) level = advanceLevel(level, 0, 0.1);
    expect(level).toBeCloseTo(0, 6);
  });

  it('never overshoots its target in a single large step', () => {
    expect(advanceLevel(0, FULL_LEVEL, 999)).toBe(FULL_LEVEL);
    expect(advanceLevel(FULL_LEVEL, 0, 999)).toBe(0);
  });

  it('is presentation only — no equation can see it', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'src/lib/tankWater.ts'), 'utf8');
    // Comments stripped first: this file's own prose says it takes no part in the force,
    // velocity or momentum equations, and a naive match would trip on saying so.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/NOZZLE_AREA|impactVelocity|theoreticalForce|momentum/);
    // It reaches into no domain module at all.
    expect(code).not.toMatch(/from '\.\.\/domain/);
    // And nothing in the domain reaches for it.
    for (const f of ['physics.ts', 'stateMachine.ts', 'experiments.ts']) {
      const domain = readFileSync(path.join(REPO_ROOT, 'src/domain', f), 'utf8');
      expect(domain, `${f} must not know about the tank water`).not.toMatch(/tankWater|TankInterior/);
    }
  });

  it('reads the inflow from the rig, and honours the volumetric valve', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'),
      'utf8'
    );
    const block = source
      .slice(source.indexOf('The tank fills once more arrives'))
      .slice(0, 1200);
    // Flow-driven, because that is what the recording shows changing — and read from the
    // domain's own figure rather than recomputed here, so the fill and the shape selection
    // above it can never straddle `DRAIN_CAPACITY_FRACTION` differently (BEDO-WATER-05).
    expect(block).toMatch(/state\.live\.flowRateLMin/);
    // ...normalised against the pump capacity actually in force, including a customised one,
    // so `tankWater` never sees a unit it would have to know about...
    expect(block).toMatch(/state\.params\.pumpFlowLMin/);
    // ...and the drain still empties it.
    expect(block).toMatch(/state\.isVolumetricValveOpen/);
  });
});
