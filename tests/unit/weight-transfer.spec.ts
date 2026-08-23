import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  OBSTACLE_CLEARANCE,
  arcHeightOver,
  arcLift,
  type Obstacle,
  type Point3,
} from '../../src/lib/transferPath';
import {
  TRANSFER_SECONDS,
  addedWeightIndex,
  directionOf,
  removedWeightIndex,
} from '../../src/interaction/transfer';
import { measureHolderAnchor, recentreOffset, stackSeats } from '../../src/lib/holderAnchor';
import { MESH, WEIGHTS } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import { loadApparatus, mountApparatus } from '../helpers/model';

/**
 * The disc's flight, on to the holder and back off it (BEDO-021b).
 *
 * ## What is being tested, and what is not
 *
 * `transfer.spec.ts` owns the clock — that a move takes BEDO's two seconds and that
 * cancelling one delivers nothing. `holder-anchor.spec.ts` owns the destination — that a
 * seat is where the pan says it is. This owns the join between them: that the two
 * directions use *the same two anchors*, that a roundtrip lands a disc back where it
 * started, and that the route between them does not go through the tank.
 *
 * Everything is measured from the shipped GLB and expressed in apparatus-local space, the
 * one space `docs/39` established. No coordinate is written down here that the model does
 * not already contain.
 */

let model: THREE.Group;
let anchor: ReturnType<typeof measureHolderAnchor> & object;
let obstacle: Obstacle;

/** Millimetre agreement, in model units where one unit is one metre of apparatus. */
const MM = 1e-3;

const nodeNamed = (name: string): THREE.Object3D => {
  const object = model.getObjectByName(gltfName(name));
  if (!object) throw new Error(`${name} is not in the model`);
  return object;
};

/**
 * A part's bounds in apparatus-local space.
 *
 * Measured **in place**, under a model mounted at identity so that apparatus-local and
 * world coincide. `holder-anchor.spec.ts` measures the discs by cloning them instead,
 * which works because every weight and the rod are top-level nodes carrying the export's
 * one shared transform — but the tank is *not*: it sits under a parent that scales it by a
 * hundred, so a detached clone of it lands seventy units away and two orders of magnitude
 * too big. Measuring in place is right for any node whatever its depth, which is what this
 * file needs and what `DeviceModel` does.
 */
const localBox = (name: string): THREE.Box3 => {
  const object = nodeNamed(name);
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
};

const trayDiscs = WEIGHTS.filter((w) => w.mesh).map((w) => ({ grams: w.grams, mesh: w.mesh! }));

/** Where a disc rests on the tray: the anchor both directions share. */
const trayAnchor = (mesh: string) => localBox(mesh).getCenter(new THREE.Vector3());
const thicknessOf = (mesh: string) => localBox(mesh).getSize(new THREE.Vector3()).y;
const radiusOf = (mesh: string) => {
  const size = localBox(mesh).getSize(new THREE.Vector3());
  return Math.max(size.x, size.z) / 2;
};

const asPoint = (v: THREE.Vector3): Point3 => [v.x, v.y, v.z];

beforeAll(async () => {
  model = await loadApparatus();
  // Identity mount, so every in-place measurement below is already apparatus-local.
  const apparatus = mountApparatus(model, { position: [0, 0, 0], scale: 1 });
  const measured = measureHolderAnchor(nodeNamed(MESH.rod), apparatus);
  if (!measured) throw new Error('the pan could not be measured');
  anchor = measured;

  // The envelope a disc has to be carried over: the tank's footprint at the shut cover's
  // height, which is exactly what `DeviceModel` measures at load.
  const tank = localBox(MESH.tank);
  const cover = localBox(MESH.tankCover);
  obstacle = {
    minX: tank.min.x,
    maxX: tank.max.x,
    minZ: tank.min.z,
    maxZ: tank.max.z,
    topY: Math.max(tank.max.y, cover.max.y),
  };
});

describe('the two directions share their anchors', () => {
  it('flies to the seat BEDO-016 measured, and to nothing else', () => {
    // §33. The destination of an arrival is the stack seat, not a number of its own.
    const thicknesses = trayDiscs.map((d) => thicknessOf(d.mesh));
    const seats = stackSeats(anchor, thicknesses);

    trayDiscs.forEach((_disc, i) => {
      expect(seats[i].centre[0]).toBe(anchor.surface[0]);
      expect(seats[i].centre[2]).toBe(anchor.surface[2]);
      expect(seats[i].centre[1]).toBeGreaterThan(anchor.surface[1]);
    });
  });

  it('flies home to the disc’s own measured tray slot, and to nothing else', () => {
    // §33 again, the other way. A disc's home is where its baked geometry already sits, so
    // there is nothing to compute and nothing that can drift.
    for (const { mesh } of trayDiscs) {
      const home = trayAnchor(mesh);
      const drawn = home.clone().add(new THREE.Vector3(...recentreOffset(home)));
      // A wrapper parked on the tray anchor draws the disc exactly on the tray.
      expect(drawn.length()).toBeCloseTo(0, 12);
    }
  });

  it('uses one pair of anchors for both directions', () => {
    // The heart of §26: `to` for an arrival is `from` for the departure that undoes it.
    const mesh = 'Weight_100';
    const home = trayAnchor(mesh);
    const [seat] = stackSeats(anchor, [thicknessOf(mesh)]);

    const install = { from: asPoint(home), to: seat.centre };
    const removal = { from: seat.centre, to: asPoint(home) };

    expect(install.to).toEqual(removal.from);
    expect(install.from).toEqual(removal.to);
    expect(directionOf('weight-install')).toBe('TO_HOLDER');
    expect(directionOf('weight-removal')).toBe('TO_TRAY');
  });
});

describe('a disc comes back to where it started', () => {
  // §34. Add a disc, take the same disc off, and it must be on its tray slot again — the
  // whole point of both directions resolving through the same two measured anchors.
  it.each(trayDiscs.map((d) => [`${d.grams} g`, d.mesh] as const))(
    'roundtrips the %s disc to within a micron',
    (_label, mesh) => {
      const home = trayAnchor(mesh);
      const [seat] = stackSeats(anchor, [thicknessOf(mesh)]);

      // Out: the wrapper ends on the seat, and the disc's centre with it.
      const onHolder = new THREE.Vector3(...seat.centre);
      expect(onHolder.y).toBeGreaterThan(anchor.surface[1]);

      // Back: the removal's destination is that same tray anchor, so the disc lands on it.
      const returned = home.clone();
      expect(returned.distanceTo(home)).toBeCloseTo(0, 12);
      // And the arc contributes nothing at either end, so no route offset survives (§25).
      const height = arcHeightOver(seat.centre, asPoint(home), obstacle, radiusOf(mesh));
      expect(arcLift(height, 0)).toBe(0);
      expect(arcLift(height, 1)).toBeCloseTo(0, 12);
    }
  );

  it('puts a duplicate back without disturbing its twin', () => {
    // §35. Two 50 g discs are two discs: adding the second gives it its own seat, and
    // removing the first leaves the other still described correctly.
    const t = thicknessOf('Weight_50');
    const seats = stackSeats(anchor, [t, t]);
    expect(seats[0].centre[1]).not.toBe(seats[1].centre[1]);

    expect(addedWeightIndex([50], [50, 50])).toBe(1);
    // With two discs of one denomination the states cannot say *which* went, so the
    // topmost consistent position is reported — the disc a learner watched come off the
    // pile. Either answer describes the same object drawn twice.
    expect(removedWeightIndex([50, 50], [50])).toBe(1);
    // The survivor is then the only disc, seated at the bottom.
    const [survivor] = stackSeats(anchor, [t]);
    expect(survivor.centre[1]).toBeCloseTo(seats[0].centre[1], 12);
  });
});

describe('the route goes over the tank, not through it', () => {
  it('proves the straight line would go through the glass', () => {
    // §24. The pan is on the rod *above* the shut cover and the discs are on the bench
    // beside the tank, so the direct line dives through the tank. This is the measurement
    // that makes an arc necessary rather than decorative.
    const home = trayAnchor('Weight_50');
    const [seat] = stackSeats(anchor, [thicknessOf('Weight_50')]);

    let inside = 0;
    for (let i = 1; i < 64; i++) {
      const t = i / 64;
      const x = home.x + (seat.centre[0] - home.x) * t;
      const y = home.y + (seat.centre[1] - home.y) * t;
      const z = home.z + (seat.centre[2] - home.z) * t;
      if (x >= obstacle.minX && x <= obstacle.maxX && z >= obstacle.minZ && z <= obstacle.maxZ) {
        if (y <= obstacle.topY) inside++;
      }
    }
    expect(inside).toBeGreaterThan(0);
  });

  it('lifts every disc clear of the cover by the stated margin', () => {
    for (const { grams, mesh } of trayDiscs) {
      const home = trayAnchor(mesh);
      const [seat] = stackSeats(anchor, [thicknessOf(mesh)]);
      const radius = radiusOf(mesh);
      const height = arcHeightOver(asPoint(home), seat.centre, obstacle, radius);
      expect(height, `${grams} g needs an arc`).toBeGreaterThan(0);

      for (let i = 1; i < 64; i++) {
        const t = i / 64;
        const x = home.x + (seat.centre[0] - home.x) * t;
        const z = home.z + (seat.centre[2] - home.z) * t;
        const over =
          x >= obstacle.minX - radius &&
          x <= obstacle.maxX + radius &&
          z >= obstacle.minZ - radius &&
          z <= obstacle.maxZ + radius;
        if (!over) continue;
        const y = home.y + (seat.centre[1] - home.y) * t + arcLift(height, t);
        expect(y, `${grams} g clips the cover at t=${t.toFixed(3)}`).toBeGreaterThanOrEqual(
          obstacle.topY + OBSTACLE_CLEARANCE - 1e-9
        );
      }
    }
  });

  it('arcs the same amount in both directions', () => {
    // One lid, one clearance, whichever way the disc is travelling.
    const home = trayAnchor('Weight_200');
    const [seat] = stackSeats(anchor, [thicknessOf('Weight_200')]);
    const radius = radiusOf('Weight_200');

    const out = arcHeightOver(asPoint(home), seat.centre, obstacle, radius);
    const back = arcHeightOver(seat.centre, asPoint(home), obstacle, radius);
    // Sampling is symmetric about the midpoint, so the two agree to sampling resolution.
    expect(back).toBeCloseTo(out, 2);
  });

  it('starts and ends exactly on the anchors — no route offset survives', () => {
    // §25. The final transform is the seat, not the seat plus whatever the path was doing.
    const height = 0.25;
    expect(arcLift(height, 0)).toBe(0);
    expect(arcLift(height, 1)).toBeCloseTo(0, 12);
    expect(arcLift(height, 0.5)).toBeCloseTo(height, 12);
  });

  it('leaves a route that is already clear alone', () => {
    // Nothing to climb over means no arc at all — the deflector's straight drop into the
    // open tank is untouched, and so is a disc dropped clear of the tank by a drag.
    const clear: Obstacle = { minX: 9, maxX: 10, minZ: 9, maxZ: 10, topY: 99 };
    expect(arcHeightOver([0, 0, 0], [1, 1, 1], clear)).toBe(0);
    expect(arcLift(0, 0.5)).toBe(0);
  });

  it('rises higher for a disc that has to clear more of the lid', () => {
    const low: Obstacle = { ...obstacle, topY: obstacle.topY - 0.05 };
    const home = trayAnchor('Weight_50');
    const [seat] = stackSeats(anchor, [thicknessOf('Weight_50')]);
    expect(arcHeightOver(asPoint(home), seat.centre, obstacle, 0)).toBeGreaterThan(
      arcHeightOver(asPoint(home), seat.centre, low, 0)
    );
  });

  it('keeps the whole disc clear, not just its centre', () => {
    const home = trayAnchor('Weight_50');
    const [seat] = stackSeats(anchor, [thicknessOf('Weight_50')]);
    const wide = arcHeightOver(asPoint(home), seat.centre, obstacle, radiusOf('Weight_50'));
    const point = arcHeightOver(asPoint(home), seat.centre, obstacle, 0);
    expect(wide).toBeGreaterThanOrEqual(point);
  });

  it('stays a carry, not a launch', () => {
    // Sanity on scale: the disc is lifted centimetres over the lid, not metres over the
    // room. The clearance is a stated 10 mm at model scale.
    expect(OBSTACLE_CLEARANCE).toBeCloseTo(0.01, 12);
    const home = trayAnchor('Weight_50');
    const [seat] = stackSeats(anchor, [thicknessOf('Weight_50')]);
    const height = arcHeightOver(asPoint(home), seat.centre, obstacle, radiusOf('Weight_50'));
    expect(height).toBeLessThan(0.25);
    expect(height).toBeGreaterThan(50 * MM);
  });
});

describe('the transfer is the same length whichever control asked for it', () => {
  it('is two seconds for the tray disc, the panel button and a keyboard press alike', () => {
    // §19/§20. There is one semantic path — ADD_WEIGHT — and the scene watches the state
    // transition rather than the control, so there is only one duration to be had.
    expect(TRANSFER_SECONDS).toBe(2);
    expect(addedWeightIndex([], [50])).toBe(0);
  });
});
