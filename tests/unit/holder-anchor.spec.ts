import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PAN_RIM_FRACTION,
  SEATING_CLEARANCE,
  measureHolderAnchor,
  recentreOffset,
  stackSeats,
  type HolderAnchor,
} from '../../src/lib/holderAnchor';
import { MESH, WEIGHTS } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import { APPARATUS_SCALE, loadApparatus, mountApparatus } from '../helpers/model';

/**
 * Where the weight pan is, and where the discs on it sit (BEDO-016).
 *
 * ## The defect these tests exist to keep out
 *
 * BUG-02: loaded discs rendered 2.1965 world units — 1.2203 at the model's own scale, so
 * about 1.22 m of apparatus — from the pan they were supposed to be resting on. The cause
 * was not a wrong number but a wrong *kind* of number. One vector took X and Z from a
 * node's translation and Y from a measured bounding box, mixing two coordinate spaces that
 * have nothing to do with one another; and in `Bedo_baked_v2.glb` every top-level node
 * carries the *same* translation — the exporter's Z-up conversion — so those axes were not
 * the disc's position at all, they were a constant.
 *
 * These tests therefore check the *space* a value lives in and not only its magnitude. The
 * one that matters most is "takes no axis from a node translation": it moves a node's
 * translation without moving one vertex of geometry and demands the anchor not budge. That
 * is exactly the mistake the old code made, and the one a well-meaning future edit is most
 * likely to make again.
 *
 * Everything is measured against the shipped GLB rather than a synthetic rod, and the
 * world position asserted below is the number `scripts/weight-anchor.mjs` read independently
 * out of the running browser (`docs/39 §8`).
 *
 * ## The one space
 *
 * Apparatus-local throughout, which for this model is the GLB's own space: `DeviceModel`
 * mounts the model as a `<primitive>` child of the apparatus group, so the two coincide.
 * `detachedBox` below measures a part the way the component measures a disc it is about to
 * draw — cloned, with no ancestors — which keeps every number here in that one space
 * instead of the world space `setFromObject` would otherwise report.
 */

let model: THREE.Group;
let apparatus: THREE.Group;
let anchor: HolderAnchor;

/** Millimetre agreement, in model units where one unit is one metre. */
const MM = 1e-3;

const nodeNamed = (name: string): THREE.Object3D => {
  const object = model.getObjectByName(gltfName(name));
  if (!object) throw new Error(`${name} is not in the model`);
  return object;
};

/**
 * A part's bounds in apparatus-local space.
 *
 * Cloned first, exactly as `DeviceModel` does: a clone has no ancestors, so its bounding
 * box is where it would draw itself parented at the origin — which under an identity GLB
 * root is the apparatus's own space. Measuring the original in place would report world
 * space instead, and mixing the two is the very bug on trial here.
 */
const detachedBox = (name: string): THREE.Box3 => {
  const clone = nodeNamed(name).clone(true);
  clone.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(clone);
};

const thicknessOf = (mesh: string) => detachedBox(mesh).getSize(new THREE.Vector3()).y;
const radiusOf = (mesh: string) => {
  const size = detachedBox(mesh).getSize(new THREE.Vector3());
  return Math.max(size.x, size.z) / 2;
};

const trayDiscs = WEIGHTS.filter((w) => w.mesh).map((w) => ({ grams: w.grams, mesh: w.mesh! }));

/** A detached copy of the rod, for tests that move it without disturbing the shared model. */
const loneRod = () => nodeNamed(MESH.rod).clone(true);

beforeAll(async () => {
  model = await loadApparatus();
  apparatus = mountApparatus(model);
  const measured = measureHolderAnchor(nodeNamed(MESH.rod), apparatus);
  if (!measured) throw new Error('the pan could not be measured');
  anchor = measured;
});

describe('the pan, measured off the shipped rod', () => {
  it('finds the plate the discs rest on, not the tip of the retaining post', () => {
    // The rod's bounding box reaches the top of the thin post the annular discs slide down.
    // Taking that as "the pan" — which is what the code did — floats the stack 57 mm of
    // model above the plate.
    const crown = detachedBox(MESH.rod).max.y;
    expect(anchor.surface[1]).toBeLessThan(crown);
    expect(crown - anchor.surface[1]).toBeCloseTo(anchor.postHeight, 6);
    expect(anchor.postHeight).toBeCloseTo(0.057014, 4);
  });

  it('is the measured plate: top face at 1.43334, outer radius 40.8 mm', () => {
    expect(anchor.surface[0]).toBeCloseTo(0.010096, 5);
    expect(anchor.surface[1]).toBeCloseTo(1.433344, 5);
    expect(anchor.surface[2]).toBeCloseTo(-0.228963, 5);
    expect(anchor.radius).toBeCloseTo(0.040774, 5);
  });

  it('sits on the rod axis, so the stack is centred rather than leaning', () => {
    // The shaft is concentric with the plate, so the plate's centre and the rod's overall
    // horizontal centre are the same point. If they ever part, the stack is on the lip.
    const rod = detachedBox(MESH.rod);
    expect(anchor.surface[0]).toBeCloseTo((rod.min.x + rod.max.x) / 2, 4);
    expect(anchor.surface[2]).toBeCloseTo((rod.min.z + rod.max.z) / 2, 4);
  });

  it('is wide enough for every disc the apparatus ships with', () => {
    for (const { grams, mesh } of trayDiscs) {
      expect(radiusOf(mesh), `${grams} g overhangs the pan`).toBeLessThan(anchor.radius);
    }
  });

  it('picks the plate out by a wide margin, not a tuned threshold', () => {
    // How far the rim really is from the next widest thing on the rod. The plate's rim is
    // at 0.0408 and the collar beneath it at 0.0171, so any fraction from about 0.42 to 1
    // selects the plate alone: PAN_RIM_FRACTION is nowhere near a cliff.
    const rod = nodeNamed(MESH.rod).clone(true);
    rod.updateWorldMatrix(true, true);
    const radii: number[] = [];
    const point = new THREE.Vector3();
    rod.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        radii.push(Math.hypot(point.x - anchor.surface[0], point.z - anchor.surface[2]));
      }
    });

    const rim = Math.max(...radii);
    const nextWidest = Math.max(...radii.filter((r) => r < rim * PAN_RIM_FRACTION));
    expect(rim).toBeCloseTo(anchor.radius, 4);
    expect(nextWidest / rim).toBeLessThan(0.5);
    expect(PAN_RIM_FRACTION).toBeGreaterThan(nextWidest / rim);
  });

  it('declines rather than inventing a pan when there is no geometry', () => {
    expect(measureHolderAnchor(new THREE.Group(), apparatus)).toBeNull();
  });
});

describe('the anchor is apparatus-local, and only apparatus-local', () => {
  it('lands on the pan in world space once the apparatus transform is applied', () => {
    // 0.780020 is what scripts/weight-anchor.mjs read out of the running application by an
    // entirely separate route. The unit test and the browser capture have to agree.
    const world = apparatus.localToWorld(new THREE.Vector3(...anchor.surface));
    expect(world.x).toBeCloseTo(0.018173, 5);
    expect(world.y).toBeCloseTo(0.78002, 5);
    expect(world.z).toBeCloseTo(-0.412133, 5);
  });

  it('takes no axis from a node translation', () => {
    // The exact shape of BUG-02, with no arithmetic to get wrong: push the rod's whole
    // translation up into a parent group, so `rod.position` becomes (0, 0, 0) while not
    // one vertex has moved. Reading `rod.position` for any axis fails here immediately;
    // measuring geometry cannot notice.
    const rod = loneRod();
    const carrier = new THREE.Group();
    carrier.position.copy(rod.position);
    carrier.quaternion.copy(rod.quaternion);
    rod.position.set(0, 0, 0);
    rod.quaternion.identity();
    carrier.add(rod);

    const host = mountApparatus(carrier);
    const moved = measureHolderAnchor(rod, host)!;

    expect(rod.position.lengthSq()).toBe(0);
    expect(moved.surface[0]).toBeCloseTo(anchor.surface[0], 5);
    expect(moved.surface[1]).toBeCloseTo(anchor.surface[1], 5);
    expect(moved.surface[2]).toBeCloseTo(anchor.surface[2], 5);
    expect(moved.radius).toBeCloseTo(anchor.radius, 5);
  });

  it('is unchanged by the apparatus transform it will be interpreted under', () => {
    // A showroom embedding, a different scale, a turned rig: the anchor is expressed in the
    // apparatus's own space, so none of that may alter it. This is what lets the stack be a
    // plain sibling group rather than something chasing world matrices every frame.
    for (const options of [
      { position: [0, 0, 0] as [number, number, number], scale: 1 },
      { position: [12, 3, -7] as [number, number, number], scale: 0.25 },
      {
        position: [-4, 9, 2] as [number, number, number],
        scale: 3.5,
        rotation: [0, Math.PI / 3, 0] as [number, number, number],
      },
    ]) {
      const rod = loneRod();
      const host = mountApparatus(rod, options);
      const measured = measureHolderAnchor(rod, host)!;
      expect(measured.surface[0]).toBeCloseTo(anchor.surface[0], 5);
      expect(measured.surface[1]).toBeCloseTo(anchor.surface[1], 5);
      expect(measured.surface[2]).toBeCloseTo(anchor.surface[2], 5);
      expect(measured.radius).toBeCloseTo(anchor.radius, 5);
    }
  });

  it('carries the stack with the apparatus, by exactly the apparatus transform', () => {
    // §21: the pan's world position and the discs' world positions move by one and the same
    // transform, because they are points in one space under one parent.
    const scale = 0.4;
    const host = mountApparatus(new THREE.Group(), {
      position: [5, -2, 8],
      scale,
      rotation: [0, Math.PI / 5, 0],
    });
    const seats = stackSeats(anchor, [thicknessOf('Weight_50'), thicknessOf('Weight_100')]);
    const toWorld = (p: readonly [number, number, number]) =>
      host.localToWorld(new THREE.Vector3(...p));

    const pan = toWorld(anchor.surface);
    for (const seat of seats) {
      const world = toWorld(seat.centre);
      // Horizontally the disc stays over the pan whatever the rig is doing...
      expect(Math.hypot(world.x - pan.x, world.z - pan.z)).toBeLessThan(1e-9);
      // ...and above it, by the local rise scaled by the apparatus. Never below.
      expect(world.y).toBeGreaterThan(pan.y);
      expect(world.y - pan.y).toBeCloseTo(scale * (seat.centre[1] - anchor.surface[1]), 9);
    }
  });
});

describe('the holder moves, and the stack goes with it', () => {
  // §22. The rod rides the tank cover when it is unscrewed and the spring when it is
  // loaded, and `DeviceModel` gives the weight-stack group that identical lift — one named
  // `holderLift` per frame, used by both. What has to hold here is the other half: that the
  // anchor is a faithful function of where the rod is *now*, so adding one number to both
  // keeps them together.
  it.each([
    ['at rest', 0],
    ['spring deflected', 0.0181],
    ['cover unscrewed', 0.286],
    ['cover unscrewed and deflected', 0.286 + 0.0181],
  ])('rises with the rod: %s', (_state, lift) => {
    const rod = loneRod();
    rod.position.y += lift;
    const host = mountApparatus(rod);
    const moved = measureHolderAnchor(rod, host)!;

    expect(moved.surface[1] - anchor.surface[1]).toBeCloseTo(lift, 6);
    // And only vertically — a lift must never slide the pan sideways.
    expect(moved.surface[0]).toBeCloseTo(anchor.surface[0], 6);
    expect(moved.surface[2]).toBeCloseTo(anchor.surface[2], 6);
  });

  it('keeps a loaded disc the same distance above the pan at every lift', () => {
    const seat = stackSeats(anchor, [thicknessOf('Weight_200')])[0];
    for (const lift of [0, 0.0181, 0.286]) {
      const rod = loneRod();
      rod.position.y += lift;
      const host = mountApparatus(rod);
      const moved = measureHolderAnchor(rod, host)!;
      const lifted = stackSeats(moved, [thicknessOf('Weight_200')])[0];
      expect(lifted.centre[1] - moved.surface[1]).toBeCloseTo(
        seat.centre[1] - anchor.surface[1],
        9
      );
    }
  });
});

describe('stacking discs on the pan', () => {
  it('has nothing to place when the pan is empty', () => {
    expect(stackSeats(anchor, [])).toEqual([]);
  });

  it('shares the pan’s X and Z, disc for disc', () => {
    const seats = stackSeats(anchor, trayDiscs.map((d) => thicknessOf(d.mesh)));
    expect(seats).toHaveLength(trayDiscs.length);
    for (const seat of seats) {
      expect(seat.centre[0]).toBe(anchor.surface[0]);
      expect(seat.centre[2]).toBe(anchor.surface[2]);
    }
  });

  it('seats the bottom disc on the pan surface, not inside it', () => {
    const [seat] = stackSeats(anchor, [thicknessOf('Weight_50')]);
    expect(seat.bottom).toBeGreaterThan(anchor.surface[1]);
    expect(seat.bottom - anchor.surface[1]).toBeCloseTo(SEATING_CLEARANCE, 12);
    // A millimetre of clearance at model scale — inside the tolerance docs/39 §9 sets.
    expect(seat.bottom - anchor.surface[1]).toBeLessThan(2 * MM);
    expect(seat.centre[1] - seat.bottom).toBeCloseTo(seat.thickness / 2, 12);
  });

  it('rises by each disc’s own measured thickness', () => {
    // The denominations really are different heights, so a fixed increment would either
    // bury one disc in the next or leave them floating apart.
    const order = ['Weight_50', 'Weight_500', 'Weight_100'];
    const thicknesses = order.map(thicknessOf);
    const seats = stackSeats(anchor, thicknesses);

    expect(new Set(thicknesses).size).toBe(3);
    seats.forEach((seat, i) => {
      expect(seat.thickness).toBeCloseTo(thicknesses[i], 12);
      const below = i === 0 ? anchor.surface[1] : seats[i - 1].bottom + seats[i - 1].thickness;
      expect(seat.bottom - below).toBeCloseTo(SEATING_CLEARANCE, 12);
    });
  });

  it('stacks upwards in the order the runtime holds them', () => {
    const seats = stackSeats(anchor, trayDiscs.map((d) => thicknessOf(d.mesh)));
    const heights = seats.map((s) => s.centre[1]);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThan(heights[i - 1]);
  });

  it('gives two discs of the same mass two different slots', () => {
    // BEDO-022's identity-by-position, in geometry. Equal masses are equal thicknesses, so
    // the only thing that can separate them is the stack, and it must.
    const t = thicknessOf('Weight_50');
    const seats = stackSeats(anchor, [t, t, thicknessOf('Weight_100')]);
    const heights = seats.map((s) => s.centre[1]);

    expect(new Set(heights).size).toBe(3);
    expect(heights[1] - heights[0]).toBeCloseTo(t + SEATING_CLEARANCE, 12);
    expect(seats[1].bottom).toBeGreaterThanOrEqual(seats[0].bottom + seats[0].thickness);
  });

  it('never lets one disc reach into the disc below it', () => {
    const seats = stackSeats(anchor, trayDiscs.map((d) => thicknessOf(d.mesh)));
    for (let i = 1; i < seats.length; i++) {
      const topOfPrevious = seats[i - 1].centre[1] + seats[i - 1].thickness / 2;
      expect(seats[i].centre[1] - seats[i].thickness / 2).toBeGreaterThan(topOfPrevious);
    }
  });

  it('records that the whole disc set outgrows the retaining post', () => {
    // Not a rule the code enforces — the runtime may load any set the learner asks for —
    // but the geometry says what the real apparatus could hold, and this pins it so that a
    // change to either is noticed rather than discovered on screen. See docs/39 §21.
    const everyDisc = trayDiscs.map((d) => thicknessOf(d.mesh));
    const total = everyDisc.reduce((a, b) => a + b + SEATING_CLEARANCE, 0);
    expect(total).toBeGreaterThan(anchor.postHeight);
    // The stacks a lesson actually builds still fit.
    const threeDiscs = stackSeats(anchor, [
      thicknessOf('Weight_50'),
      thicknessOf('Weight_100'),
      thicknessOf('Weight_200'),
    ]);
    const topOfStack = threeDiscs.at(-1)!.centre[1] + threeDiscs.at(-1)!.thickness / 2;
    expect(topOfStack).toBeLessThan(anchor.surface[1] + anchor.postHeight);
  });
});

describe('a baked disc is carried to its seat by one subtraction', () => {
  it('puts the clone’s own centre on its slot’s origin', () => {
    // The slot group sits on the seat and the disc is recentred into it, so the disc's
    // centre and the slot's origin — which is exactly where the click proxy sits — are one
    // point by construction. §23: there is no second formula for the proxy to disagree
    // with, because the proxy has no formula at all.
    for (const { mesh } of trayDiscs) {
      const measured = detachedBox(mesh).getCenter(new THREE.Vector3());
      const landed = measured.clone().add(new THREE.Vector3(...recentreOffset(measured)));
      expect(landed.length()).toBeCloseTo(0, 12);
    }
  });

  it('lands every disc on the pan once its slot is parked on the seat', () => {
    const thicknesses = trayDiscs.map((d) => thicknessOf(d.mesh));
    const seats = stackSeats(anchor, thicknesses);

    trayDiscs.forEach(({ mesh }, i) => {
      const measured = detachedBox(mesh).getCenter(new THREE.Vector3());
      const drawn = measured
        .clone()
        .add(new THREE.Vector3(...recentreOffset(measured)))
        .add(new THREE.Vector3(...seats[i].centre));

      expect(drawn.x).toBeCloseTo(anchor.surface[0], 12);
      expect(drawn.z).toBeCloseTo(anchor.surface[2], 12);
      expect(drawn.y).toBeCloseTo(seats[i].centre[1], 12);
    });
  });

  it('closes BUG-02: the disc is on the pan, not a metre away from it', () => {
    const measured = detachedBox('Weight_50').getCenter(new THREE.Vector3());
    const [seat] = stackSeats(anchor, [thicknessOf('Weight_50')]);
    const drawn = measured
      .clone()
      .add(new THREE.Vector3(...recentreOffset(measured)))
      .add(new THREE.Vector3(...seat.centre));

    const pan = new THREE.Vector3(anchor.surface[0], seat.centre[1], anchor.surface[2]);
    expect(drawn.distanceTo(pan)).toBeLessThan(0.5 * MM);
    // And in the units the learner's screen is in.
    expect(drawn.distanceTo(pan) * APPARATUS_SCALE).toBeLessThan(1 * MM);
  });

  it('would have failed the old way, which is the point', () => {
    // The calculation BEDO-016 removed, kept as the counter-example: X and Z from the
    // node's translation, Y from the rod's crown and a measured centre. The two numbers it
    // produces are the ones `docs/39 §1` reports and `measurements/before-bedo016.json`
    // captured out of the running application.
    const proto = nodeNamed('Weight_50');
    const crown = detachedBox(MESH.rod);
    const centre = detachedBox('Weight_50').getCenter(new THREE.Vector3());
    const thickness = thicknessOf('Weight_50');

    const legacyDrawn = centre.clone().add(
      new THREE.Vector3(
        (crown.min.x + crown.max.x) / 2 - proto.position.x,
        crown.max.y + 0.001 + thickness / 2 - centre.y,
        (crown.min.z + crown.max.z) / 2 - proto.position.z
      )
    );
    const pan = new THREE.Vector3(
      anchor.surface[0],
      anchor.surface[1] + 0.001 + thickness / 2,
      anchor.surface[2]
    );

    expect(legacyDrawn.distanceTo(pan)).toBeCloseTo(1.2203, 3);
    expect(legacyDrawn.distanceTo(pan) * APPARATUS_SCALE).toBeCloseTo(2.1965, 3);
  });
});
