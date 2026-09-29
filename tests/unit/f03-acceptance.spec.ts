import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SEATING_CLEARANCE,
  measureHolderAnchor,
  stackSeats,
  type HolderAnchor,
} from '../../src/lib/holderAnchor';
import { DEFLECTORS, MESH, WEIGHTS } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import {
  HANDLING_CLEARANCE,
  planHandling,
  sampleHandling,
  travelHeightOver,
  type Point3,
} from '../../src/lib/handlingPath';
import { fitRigid, type Vec3 } from '../../src/lib/rigidFit';
import { loadApparatus, mountApparatus } from '../helpers/model';

/**
 * F03 acceptance criteria, asserted against the shipped model (`public/Bedo_baked_v2.glb`).
 *
 *   AC1  Deflector centreline aligns with the nozzle/jet after installation.
 *   AC2  Weights cannot hover between stack locations.
 *   AC3  Repeated weights seat on the previous weight with consistent spacing.
 *   AC4  Removal returns the weight to storage or a defined removed state.
 *
 * Measured in apparatus-local space, the space `DeviceModel` draws in, exactly as
 * `holder-anchor.spec.ts` does: parts are cloned and measured detached. The routes are the
 * ones `DeviceModel` plans (`lib/handlingPath.ts`) with the same constants; the running app
 * was also traced frame by frame in the browser (`docs/53 §4`).
 */

let model: THREE.Group;
let apparatus: THREE.Group;
let anchor: HolderAnchor;

/** Half a millimetre, in model units (one unit is one metre). */
const HALF_MM = 0.0005;

// The constants `DeviceModel` uses for these routes.
const TRAY_LIFT = 0.02;
const DEFLECTOR_TRAY_LIFT = 0.025;
const DEFLECTOR_ROD_APPROACH = 0.06;
const MIN_DISC_APPROACH = 0.012;
const DISC_TRAVEL_RISE = 0.05;

const nodeNamed = (name: string): THREE.Object3D => {
  const object = model.getObjectByName(gltfName(name));
  if (!object) throw new Error(`${name} is not in the model`);
  return object;
};

const detachedBox = (name: string): THREE.Box3 => {
  const clone = nodeNamed(name).clone(true);
  clone.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(clone, true);
};

const vertices = (name: string): Vec3[] => {
  const clone = nodeNamed(name).clone(true);
  clone.updateWorldMatrix(true, true);
  const out: Vec3[] = [];
  const v = new THREE.Vector3();
  clone.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const position = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined;
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      out.push([v.x, v.y, v.z]);
    }
  });
  return out;
};

const centre = (box: THREE.Box3) => box.getCenter(new THREE.Vector3());
const horizontal = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

const trayDiscs = WEIGHTS.filter((w) => w.mesh).map((w) => ({ grams: w.grams, mesh: w.mesh! }));

beforeAll(async () => {
  model = await loadApparatus();
  apparatus = mountApparatus(model);
  const measured = measureHolderAnchor(nodeNamed(MESH.rod), apparatus);
  if (!measured) throw new Error('the pan could not be measured');
  anchor = measured;
});

describe('AC1 — a fitted deflector sits on the nozzle/jet axis, mounted on the rod', () => {
  it('every fitted deflector is centred on the nozzle axis within 0.5 mm', () => {
    const nozzle = centre(detachedBox(MESH.nozzle));
    for (const d of DEFLECTORS) {
      const fitted = centre(detachedBox(d.installed));
      expect(horizontal(fitted, nozzle), `${d.id}° off the nozzle axis`).toBeLessThan(HALF_MM);
    }
  });

  it('the nozzle, the rod and the pan share one vertical axis', () => {
    const nozzle = centre(detachedBox(MESH.nozzle));
    const rod = centre(detachedBox(MESH.rod));
    expect(horizontal(nozzle, rod)).toBeLessThan(HALF_MM);
    expect(Math.hypot(anchor.surface[0] - nozzle.x, anchor.surface[2] - nozzle.z)).toBeLessThan(
      HALF_MM
    );
  });

  it('every fitted deflector is on the rod: the rod end is inside the deflector', () => {
    const rodEnd = detachedBox(MESH.rod).min.y;
    for (const d of DEFLECTORS) {
      const fitted = detachedBox(d.installed);
      expect(rodEnd, `${d.id}° is not on the rod`).toBeGreaterThan(fitted.min.y);
      expect(rodEnd, `${d.id}° is not on the rod`).toBeLessThan(fitted.max.y);
    }
  });

  it('a deflector arrives in its fitted pose, not in its tray pose', () => {
    // The flight turns the tray copy into the fitted copy. Where the two share a vertex
    // order the exact rigid transform is recovered; elsewhere they differ by a translation
    // only, which their identical bounds confirm.
    for (const d of DEFLECTORS) {
      const fit = fitRigid(vertices(d.shelf), vertices(d.installed));
      if (fit) {
        expect(fit.maxResidual, `${d.id}° tray → fitted`).toBeLessThan(HALF_MM);
      } else {
        const a = detachedBox(d.shelf).getSize(new THREE.Vector3());
        const b = detachedBox(d.installed).getSize(new THREE.Vector3());
        expect(a.distanceTo(b), `${d.id}° tray and fitted copies differ in shape`).toBeLessThan(
          HALF_MM
        );
      }
    }
  });

  it('the install route is on the axis for its whole final approach, and ends on the fitted centre', () => {
    const nozzle = centre(detachedBox(MESH.nozzle));
    const tank = detachedBox(MESH.tank);
    for (const d of DEFLECTORS) {
      const shelf = centre(detachedBox(d.shelf));
      const fitted = centre(detachedBox(d.installed));
      const plan = planHandling({
        start: [shelf.x, shelf.y, shelf.z],
        end: [fitted.x, fitted.y, fitted.z],
        depart: DEFLECTOR_TRAY_LIFT,
        approach: -DEFLECTOR_ROD_APPROACH,
        travelHeight: fitted.y - DEFLECTOR_ROD_APPROACH,
        obstacles: [
          { minX: tank.min.x, maxX: tank.max.x, minZ: tank.min.z, maxZ: tank.max.z, topY: tank.max.y },
        ],
      });
      for (let i = 0; i <= 400; i++) {
        const s = sampleHandling(plan, i / 400);
        if (s.phase !== 'approach') continue;
        const p = new THREE.Vector3(...s.position);
        expect(horizontal(p, nozzle), `${d.id}° drifts off the axis while threading on`).toBeLessThan(
          HALF_MM
        );
      }
      const end = new THREE.Vector3(...sampleHandling(plan, 1).position);
      expect(end.distanceTo(fitted)).toBeLessThan(1e-9);
    }
  });
});

describe('AC2 — a disc cannot hover between stack locations', () => {
  const thicknessOf = (mesh: string) => detachedBox(mesh).getSize(new THREE.Vector3()).y;

  it('each seat rests on the one below it: no gap beyond the 1 mm seating clearance', () => {
    const mixed = ['Weight_500', 'Weight_50', 'Weight_200', 'Weight_100', 'Weight_Custom'];
    const seats = stackSeats(anchor, mixed.map(thicknessOf));
    expect(seats[0].bottom - anchor.surface[1]).toBeCloseTo(SEATING_CLEARANCE, 12);
    for (let i = 1; i < seats.length; i++) {
      const topBelow = seats[i - 1].bottom + seats[i - 1].thickness;
      expect(seats[i].bottom - topBelow, `seat ${i} floats`).toBeCloseTo(SEATING_CLEARANCE, 12);
    }
  });

  it('a disc only ever pauses above the post tip or on its seat — never part-way down', () => {
    // The route stops at three places: lifted out of the tray, lined up over the post, and
    // on the seat. The lined-up point is above the tip, so a disc cannot come to rest
    // between two stack positions.
    const postTip = anchor.surface[1] + anchor.postHeight;
    for (const { grams, mesh } of trayDiscs) {
      for (let below = 0; below < 4; below++) {
        const seats = stackSeats(anchor, [...Array(below).fill(thicknessOf(mesh)), thicknessOf(mesh)]);
        const seat = seats[seats.length - 1];
        const half = seat.thickness / 2;
        const hover = Math.max(postTip + half + HANDLING_CLEARANCE, seat.centre[1] + MIN_DISC_APPROACH);
        const tray = centre(detachedBox(mesh));
        const plan = planHandling({
          start: [tray.x, tray.y, tray.z],
          end: seat.centre,
          depart: TRAY_LIFT,
          approach: hover - seat.centre[1],
          travelHeight: travelHeightOver(tray.y + TRAY_LIFT, hover, DISC_TRAVEL_RISE),
        });
        expect(plan.approachTop[1] - half, `${grams} g lines up below the tip`).toBeGreaterThan(
          Math.min(postTip, seat.centre[1] - half)
        );
        const end = sampleHandling(plan, 1).position;
        expect(Math.abs(end[1] - seat.centre[1]), `${grams} g lands off its seat`).toBeLessThan(1e-9);
        // Coming down the post it is on the axis the whole way.
        for (let i = 0; i <= 200; i++) {
          const s = sampleHandling(plan, i / 200);
          if (s.phase !== 'approach') continue;
          expect(
            Math.hypot(s.position[0] - anchor.surface[0], s.position[2] - anchor.surface[2])
          ).toBeLessThan(1e-9);
        }
      }
    }
  });
});

describe('AC3 — repeated weights seat on the previous one with consistent spacing', () => {
  it.each(trayDiscs.map((d) => [d.grams, d.mesh] as const))(
    'four %s g discs stack at one constant pitch, each 1 mm above the last',
    (_grams, mesh) => {
      const t = detachedBox(mesh).getSize(new THREE.Vector3()).y;
      const seats = stackSeats(anchor, [t, t, t, t]);
      for (let i = 1; i < seats.length; i++) {
        expect(seats[i].centre[1] - seats[i - 1].centre[1]).toBeCloseTo(t + SEATING_CLEARANCE, 12);
        // One axis for the whole stack.
        expect(seats[i].centre[0]).toBe(seats[0].centre[0]);
        expect(seats[i].centre[2]).toBe(seats[0].centre[2]);
      }
    }
  );
});

describe('AC4 — a removed disc goes back to its own tray slot', () => {
  it.each(trayDiscs.map((d) => [d.grams, d.mesh] as const))(
    'the %s g disc is carried off the post and set down exactly where the tray draws it',
    (_grams, mesh) => {
      const t = detachedBox(mesh).getSize(new THREE.Vector3()).y;
      const [seat] = stackSeats(anchor, [t]);
      const postTip = anchor.surface[1] + anchor.postHeight;
      const hover = Math.max(postTip + t / 2 + HANDLING_CLEARANCE, seat.centre[1] + MIN_DISC_APPROACH);
      const slot = centre(detachedBox(mesh));
      const plan = planHandling({
        start: seat.centre,
        end: [slot.x, slot.y, slot.z],
        depart: hover - seat.centre[1],
        approach: TRAY_LIFT,
        travelHeight: travelHeightOver(hover, slot.y + TRAY_LIFT, DISC_TRAVEL_RISE),
      });
      const end: Point3 = sampleHandling(plan, 1).position;
      expect(new THREE.Vector3(...end).distanceTo(slot)).toBeLessThan(1e-9);
      // It leaves straight up the post, clear of the tip before it moves sideways.
      const top = sampleHandling(plan, plan.phases[0]).position;
      expect(top[1] - t / 2).toBeGreaterThan(postTip);
      expect(Math.hypot(top[0] - seat.centre[0], top[2] - seat.centre[2])).toBeLessThan(1e-9);
    }
  );
});
