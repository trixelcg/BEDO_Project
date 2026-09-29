import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DEFLECTORS, MESH } from '../../src/domain/apparatus';
import { FIRST_READING_VALVE, GRAVITY_MS2, SECOND_READING_VALVE, jetState } from '../../src/domain/physics';
import { springDeflectionMm, springHeightMm } from '../../src/domain/spring';
import { gltfName } from '../../src/lib/gltfNames';
import { springTravelLimitMm } from '../../src/lib/apparatusView';
import {
  CARRIER_RESPONSE_PER_S,
  MIN_NOZZLE_CLEARANCE_MM,
  NOZZLE_MOUTH_MESH,
  SPRING_COIL_PASSES,
  SPRING_WIRE_DIAMETER_MM,
  carrierStop,
  settleToward,
  springCompressionLimitMm,
  type CarrierStop,
} from '../../src/lib/carrierTravel';
import { assetPath } from '../helpers/glb';
import { loadApparatus } from '../helpers/model';

/**
 * F05 acceptance criteria — pointer, weight carrier and spring — asserted against the shipped
 * model (`public/Bedo_baked_v2.glb`), with the travel limits measured the way `DeviceModel`
 * measures them.
 *
 *   AC1  The pointer/reference stays fixed throughout balancing.
 *   AC2  Carrier displacement changes monotonically with valid added load until the stop.
 *   AC3  Spring compression stops at an approved maximum travel / minimum nozzle clearance.
 *   AC4  Load beyond the limit never drives the deflector through or into the nozzle.
 *   AC5  The travel/clearance limit is defined and documented (`docs/55`).
 */

let model: THREE.Group;
let mouthY: number;
let springRestMm: number;
const stops = new Map<number, CarrierStop>();
const bottoms = new Map<number, number>();

const boxOf = (name: string): THREE.Box3 => {
  const clone = model.getObjectByName(gltfName(name))!.clone(true);
  clone.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(clone, true);
};

const newtonsOf = (grams: number) => (grams * GRAVITY_MS2) / 1000;
const RISE_MM = () => springTravelLimitMm(springRestMm / 1000);

beforeAll(async () => {
  model = await loadApparatus();
  mouthY = boxOf(NOZZLE_MOUTH_MESH).max.y;
  springRestMm = boxOf(MESH.spring).getSize(new THREE.Vector3()).y * 1000;
  for (const d of DEFLECTORS) {
    const bottom = boxOf(d.installed).min.y;
    bottoms.set(d.id, bottom);
    stops.set(d.id, carrierStop(bottom, mouthY, springRestMm));
  }
});

describe('AC1 — the pointer is a fixed reference', () => {
  const source = readFileSync(assetPath('src/components/DeviceModel.tsx'), 'utf8');

  it('the pointer pivot is set to its resting height, and nothing adds the carrier to it', () => {
    const assignments = [...source.matchAll(/pointerPivot\.position\.y\s*=\s*([^;]+);/g)].map(
      (m) => m[1]
    );
    expect(assignments.length).toBeGreaterThan(0);
    for (const rhs of assignments) {
      expect(rhs).not.toMatch(/deflection|holderLift|coverOffset/);
    }
  });

  it('the pointer pin is never written either', () => {
    expect(source).not.toMatch(/pick\(MESH\.pointerPin\)[^;]*\.position\.y\s*=/);
  });

  it('at rest the pointer marks the pan: the carrier is balanced when it is back at rest', () => {
    // The pointer arm spans the pan's top face, so "on the pointer" means displacement 0.
    const pointer = boxOf(MESH.pointer);
    const pan = boxOf('JET Force 2_209');
    expect(pan.max.y).toBeGreaterThan(pointer.min.y);
    expect(pan.max.y).toBeLessThan(pointer.max.y);
  });
});

describe('AC2 — the carrier moves monotonically with load, until the stop', () => {
  const jets = () => [
    0,
    jetState(FIRST_READING_VALVE, 90).theoreticalForceN,
    jetState(SECOND_READING_VALVE, 90).theoreticalForceN,
    jetState(SECOND_READING_VALVE, 180).theoreticalForceN,
  ];

  it('every added gram lowers it, until it reaches the stop, and then nothing does', () => {
    for (const d of DEFLECTORS) {
      const stop = stops.get(d.id)!;
      for (const jet of jets()) {
        let previous = Infinity;
        let stopped = false;
        for (let g = 0; g <= 3000; g += 5) {
          const x = springDeflectionMm(jet, newtonsOf(g), RISE_MM(), stop.dropMm);
          if (stopped) expect(x, `${d.id}° ${g} g`).toBe(-stop.dropMm);
          else if (x === -stop.dropMm) stopped = true;
          else if (x < RISE_MM()) expect(x, `${d.id}° ${g} g`).toBeLessThan(previous);
          previous = x;
        }
        expect(stopped, `${d.id}° never reached its stop`).toBe(true);
      }
    }
  });

  it('balance is the rest height, where the pointer is', () => {
    const jet = jetState(FIRST_READING_VALVE, 90).theoreticalForceN;
    const exact = (jet / GRAVITY_MS2) * 1000;
    expect(springDeflectionMm(jet, newtonsOf(exact), RISE_MM(), stops.get(90)!.dropMm)).toBeCloseTo(
      0,
      9
    );
    // Within the lesson's ±10 g balance window the carrier is within half a millimetre.
    for (const off of [-10, 10]) {
      const x = springDeflectionMm(jet, newtonsOf(exact + off), RISE_MM(), stops.get(90)!.dropMm);
      expect(Math.abs(x)).toBeLessThan(0.5);
    }
  });

  it('an overloaded pan sits visibly below the pointer — it no longer reads as balanced', () => {
    // Reading 1 wants 80 g. 580 g on the pan used to sit exactly at rest.
    const jet = jetState(FIRST_READING_VALVE, 90).theoreticalForceN;
    const x = springDeflectionMm(jet, newtonsOf(580), RISE_MM(), stops.get(90)!.dropMm);
    expect(x).toBeLessThan(-10);
  });

  it('settles on a new load progressively and never overshoots it', () => {
    for (const [from, to] of [[4.1, -5.7], [-17.8, 0], [0, 12.6]]) {
      let x = from;
      let last = from;
      for (let frame = 0; frame < 120; frame++) {
        x = settleToward(x, to, 1 / 60);
        // Always between where it was and where it is going.
        expect((x - last) * (to - from)).toBeGreaterThanOrEqual(0);
        expect(Math.abs(to - x)).toBeLessThanOrEqual(Math.abs(to - from));
        last = x;
      }
      // And there within a second.
      expect(Math.abs(to - x)).toBeLessThan(Math.abs(to - from) * 0.01);
    }
    expect(CARRIER_RESPONSE_PER_S).toBeGreaterThan(0);
  });
});

describe('AC3 — the stop is at the approved travel / clearance', () => {
  it('the nozzle mouth is where the water model says the jet leaves', () => {
    // `water-alignment.spec.ts`: Cylinder012, y 1.08551..1.26176.
    expect(mouthY).toBeCloseTo(1.26176, 4);
  });

  it('every fitted deflector clears the nozzle at rest by more than the minimum', () => {
    for (const d of DEFLECTORS) {
      expect(stops.get(d.id)!.clearanceAtRestMm, `${d.id}°`).toBeGreaterThan(MIN_NOZZLE_CLEARANCE_MM);
    }
  });

  it('stops each deflector exactly at the minimum nozzle clearance', () => {
    for (const d of DEFLECTORS) {
      const stop = stops.get(d.id)!;
      expect(stop.limitedBy, `${d.id}°`).toBe('nozzle');
      expect(stop.clearanceAtStopMm, `${d.id}°`).toBeCloseTo(MIN_NOZZLE_CLEARANCE_MM, 9);
    }
    // The flat-bottomed deflectors travel 17.8 mm, the cones 13.4 mm.
    expect(stops.get(90)!.dropMm).toBeCloseTo(17.76, 1);
    expect(stops.get(30)!.dropMm).toBeCloseTo(13.4, 1);
  });

  it('within the spring’s working compression, from the spring the model actually has', () => {
    // The constants the solid height is built from, re-measured off `deflector_spring`.
    const spring = model.getObjectByName(gltfName(MESH.spring))!;
    const points: THREE.Vector3[] = [];
    spring.updateWorldMatrix(true, true);
    spring.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const p = mesh.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
    });
    const [ax, az] = [0.0101, -0.2293];
    const radii = points.map((p) => Math.hypot(p.x - ax, p.z - az));
    const wireMm = (Math.max(...radii) - Math.min(...radii)) * 1000;
    expect(wireMm).toBeCloseTo(SPRING_WIRE_DIAMETER_MM, 0);
    const wedge = points.filter((p) => Math.abs(Math.atan2(p.z - az, p.x - ax)) < 0.05).map((p) => p.y).sort((a, b) => a - b);
    let passes = 0;
    for (let i = 0; i < wedge.length; i++) if (i === 0 || wedge[i] - wedge[i - 1] > 0.0015) passes++;
    expect(passes).toBe(SPRING_COIL_PASSES);

    const springLimit = springCompressionLimitMm(springRestMm);
    expect(springLimit).toBeGreaterThan(0);
    for (const d of DEFLECTORS) expect(stops.get(d.id)!.dropMm).toBeLessThanOrEqual(springLimit);
  });
});

describe('AC4 — no load drives the deflector into the nozzle', () => {
  it('whatever is on the pan, with or without the jet, the deflector keeps its clearance', () => {
    for (const d of DEFLECTORS) {
      const stop = stops.get(d.id)!;
      for (const kg of [0.5, 1, 2, 5, 20, 1000]) {
        for (const jet of [0, 0.82, 2.53]) {
          const x = springDeflectionMm(jet, kg * GRAVITY_MS2, RISE_MM(), stop.dropMm);
          const bottom = bottoms.get(d.id)! + x / 1000;
          expect((bottom - mouthY) * 1000, `${d.id}° ${kg} kg`).toBeGreaterThanOrEqual(
            MIN_NOZZLE_CLEARANCE_MM - 1e-9
          );
        }
      }
    }
  });

  it('the workbook’s own heights: 0.5 kg alone would compress 24.5 mm — the stop holds it at 17.8', () => {
    // `Jet force_Mathematical model.xlsx`, column X: 0.500 kg -> h_W = 25 (24.5 mm).
    expect(springHeightMm(4.905)).toBeCloseTo(24.525, 3);
    expect(springDeflectionMm(0, 4.905, RISE_MM(), stops.get(90)!.dropMm)).toBeCloseTo(-17.76, 1);
  });
});
