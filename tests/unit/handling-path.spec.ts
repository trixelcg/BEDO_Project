import { describe, expect, it } from 'vitest';
import {
  easeInOutSine,
  liftShare,
  phaseShares,
  planHandling,
  sampleHandling,
  travelHeightOver,
  type Point3,
} from '../../src/lib/handlingPath';
import { fitRigid, rotate, type Vec3 } from '../../src/lib/rigidFit';
import {
  DEFLECTOR_REMOVAL_SECONDS,
  TRANSFER_SECONDS,
  createTransferSet,
  durationOf,
} from '../../src/interaction/transfer';
import type { Obstacle } from '../../src/lib/transferPath';

/**
 * F03 — deflector and weight install/remove/snap credibility.
 *
 * Numbers are the shipped model's, measured in the browser in apparatus-local units (one
 * unit is one metre): the post and nozzle axis at x = 0.0101, z = −0.2293; a disc tray slot
 * at (0.0542, 1.0655, −0.0213); the tank footprint ±0.09 around the axis with its closed
 * cover's top at 1.3859; the pan's first seat at 1.4378 and the post tip at 1.4910.
 */

const AXIS_X = 0.0101;
const AXIS_Z = -0.2293;
const offAxis = (p: Point3) => Math.hypot(p[0] - AXIS_X, p[2] - AXIS_Z);

const TANK: Obstacle = {
  minX: AXIS_X - 0.0905,
  maxX: AXIS_X + 0.0905,
  minZ: AXIS_Z - 0.0897,
  maxZ: AXIS_Z + 0.0897,
  topY: 1.3859,
};

const TRAY_SLOT: Point3 = [0.0542, 1.0655, -0.0213];
const SEAT: Point3 = [AXIS_X, 1.4378, AXIS_Z];
const POST_TIP = 1.491;
const DISC_HALF = 0.0089 / 2;
const DISC_RADIUS = 0.0287;
/** Hover height a disc must reach before it may come down the post. */
const HOVER = POST_TIP + DISC_HALF + 0.008;

const samples = (n = 400) => Array.from({ length: n + 1 }, (_, i) => i / n);

/** What `DeviceModel` carries a disc at: 50 mm above the higher end of its route. */
const DISC_TRAVEL_RISE = 0.05;

/** The pan plate's rim radius and top face, and the post above it. */
const PAN_RADIUS = 0.0408;
const PAN_TOP = SEAT[1] - 0.001 - 0.0055 / 2 - 0.001 - 0.0055; // under a 50 g disc already there
const POST_RADIUS = 0.00515;

/** The column the holder occupies: pan, post and discs — what a carried disc must go over. */
const HOLDER: Obstacle = {
  minX: AXIS_X - PAN_RADIUS,
  maxX: AXIS_X + PAN_RADIUS,
  minZ: AXIS_Z - PAN_RADIUS,
  maxZ: AXIS_Z + PAN_RADIUS,
  topY: POST_TIP,
};

/**
 * Does a disc centred at `p` collide with the holder? The holder is modelled as the post (a
 * thin cylinder up to its tip) standing on the pan plate, with whatever is stacked on it
 * filling the pan's radius up to the seat below the one being filled.
 */
function hitsHolder(p: Point3, halfHeight: number, radius: number, stackTop: number): boolean {
  const d = offAxis(p);
  const bottom = p[1] - halfHeight;
  const top = p[1] + halfHeight;
  // The post: a disc's bore is 6.35 mm across, so centred on the axis it slides over.
  if (bottom < POST_TIP && top > PAN_TOP && d > 0.00635 - POST_RADIUS && d < radius + POST_RADIUS) {
    return true;
  }
  // The pan and the discs already on it.
  if (bottom < stackTop && d < radius + PAN_RADIUS) return true;
  return false;
}

describe('a disc going onto the pan', () => {
  const plan = planHandling({
    start: TRAY_SLOT,
    end: SEAT,
    depart: 0.02,
    approach: HOVER - SEAT[1],
    obstacles: [TANK, HOLDER],
    radius: DISC_RADIUS,
    halfHeight: DISC_HALF,
    travelHeight: travelHeightOver(TRAY_SLOT[1] + 0.02, HOVER, DISC_TRAVEL_RISE),
  });

  it('rises almost straight up out of the tray before it moves across (QA route)', () => {
    // The route QA drew: up out of the tray first, then across. Over the first 100 mm of
    // rise the disc drifts sideways by less than 15 mm.
    for (const t of samples(2000)) {
      const p = sampleHandling(plan, t).position;
      if (p[1] - TRAY_SLOT[1] > 0.1) break;
      expect(Math.hypot(p[0] - TRAY_SLOT[0], p[2] - TRAY_SLOT[2])).toBeLessThan(0.015);
    }
  });

  it('never comes at the stack from the side: near the post it is always above the tip', () => {
    for (const t of samples(2000)) {
      const s = sampleHandling(plan, t);
      if (s.phase === 'approach') continue; // exactly on the axis, coming down the post
      if (offAxis(s.position) < PAN_RADIUS + DISC_RADIUS + 0.02) {
        expect(s.position[1] - DISC_HALF).toBeGreaterThan(POST_TIP);
      }
    }
  });

  it('starts in its tray slot and ends exactly on its seat', () => {
    expect(sampleHandling(plan, 0).position).toEqual(TRAY_SLOT);
    const end = sampleHandling(plan, 1).position;
    expect(end[0]).toBeCloseTo(SEAT[0], 12);
    expect(end[1]).toBeCloseTo(SEAT[1], 12);
    expect(end[2]).toBeCloseTo(SEAT[2], 12);
  });

  it('never touches the post, the pan or the disc below it on the way in', () => {
    // The defect: the disc was 20–60 mm off the axis while already below the post tip, so
    // the post passed through its face.
    const stackTop = SEAT[1] - DISC_HALF - 0.001;
    for (const t of samples(2000)) {
      const p = sampleHandling(plan, t).position;
      expect(hitsHolder(p, DISC_HALF, DISC_RADIUS, stackTop - 1e-6)).toBe(false);
    }
  });

  it('is exactly on the post axis whenever it is below the tip and within reach of the post', () => {
    for (const t of samples(2000)) {
      const p = sampleHandling(plan, t).position;
      if (p[1] - DISC_HALF < POST_TIP && offAxis(p) < DISC_RADIUS + POST_RADIUS) {
        expect(offAxis(p)).toBeLessThan(1e-9);
      }
    }
  });

  it('only descends vertically for the last part of the flight', () => {
    for (const t of samples()) {
      const s = sampleHandling(plan, t);
      if (s.phase === 'approach') expect(offAxis(s.position)).toBeLessThan(1e-9);
    }
  });

  it('is lifted straight up out of its tray slot before it goes anywhere', () => {
    for (const t of samples()) {
      const s = sampleHandling(plan, t);
      if (s.phase !== 'depart') continue;
      expect(s.position[0]).toBeCloseTo(TRAY_SLOT[0], 12);
      expect(s.position[2]).toBeCloseTo(TRAY_SLOT[2], 12);
      expect(s.position[1]).toBeGreaterThanOrEqual(TRAY_SLOT[1] - 1e-12);
    }
  });

  it('passes over the tank, not through it', () => {
    for (const t of samples()) {
      const p = sampleHandling(plan, t).position;
      const over =
        p[0] > TANK.minX - DISC_RADIUS &&
        p[0] < TANK.maxX + DISC_RADIUS &&
        p[2] > TANK.minZ - DISC_RADIUS &&
        p[2] < TANK.maxZ + DISC_RADIUS;
      if (over) expect(p[1] - DISC_HALF).toBeGreaterThan(TANK.topY);
    }
  });

  it('arrives over the post moving straight down, not sideways', () => {
    const [depart, carry] = plan.phases;
    const a = sampleHandling(plan, depart + carry - 0.002).position;
    const b = sampleHandling(plan, depart + carry - 0.0005).position;
    const dy = b[1] - a[1];
    const dh = Math.hypot(b[0] - a[0], b[2] - a[2]);
    expect(dy).toBeLessThan(0);
    expect(dh).toBeLessThan(Math.abs(dy) * 0.05);
  });

  it('moves continuously — no frame-to-frame jump anywhere in the flight', () => {
    let previous = sampleHandling(plan, 0).position;
    let worst = 0;
    for (const t of samples(2000)) {
      const p = sampleHandling(plan, t).position;
      worst = Math.max(worst, Math.hypot(p[0] - previous[0], p[1] - previous[1], p[2] - previous[2]));
      previous = p;
    }
    // 2000 steps of a two-second flight are a millisecond each: no step may imply a speed a
    // hand could not move a small disc at (1.5 m/s). A jump would show as one huge step.
    expect(worst / (TRANSFER_SECONDS / 2000)).toBeLessThan(1.5);
  });

  it('comes to rest where it is lifted clear and where it is lined up', () => {
    const [depart, carry] = plan.phases;
    const at = (t: number) => sampleHandling(plan, t).position;
    const speed = (t: number) => {
      const a = at(t - 1e-6);
      const b = at(t + 1e-6);
      return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2e-6;
    };
    expect(speed(depart)).toBeLessThan(1e-3);
    expect(speed(depart + carry)).toBeLessThan(1e-3);
  });
});

describe('a disc coming off the pan', () => {
  const plan = planHandling({
    start: SEAT,
    end: TRAY_SLOT,
    depart: HOVER - SEAT[1],
    approach: 0.02,
    obstacles: [TANK, HOLDER],
    radius: DISC_RADIUS,
    halfHeight: DISC_HALF,
    travelHeight: travelHeightOver(HOVER, TRAY_SLOT[1] + 0.02, DISC_TRAVEL_RISE),
  });

  it('rises straight up the post until it is clear of the tip, touching nothing', () => {
    const stackTop = SEAT[1] - DISC_HALF - 0.001;
    for (const t of samples(2000)) {
      const s = sampleHandling(plan, t);
      expect(hitsHolder(s.position, DISC_HALF, DISC_RADIUS, stackTop - 1e-6)).toBe(false);
      if (s.position[1] - DISC_HALF < POST_TIP && offAxis(s.position) < DISC_RADIUS + POST_RADIUS) {
        expect(offAxis(s.position)).toBeLessThan(1e-9);
      }
    }
    const top = sampleHandling(plan, plan.phases[0]).position;
    expect(top[1] - DISC_HALF).toBeGreaterThan(POST_TIP);
  });

  it('is set down into its tray slot from above', () => {
    for (const t of samples()) {
      const s = sampleHandling(plan, t);
      if (s.phase !== 'approach') continue;
      expect(s.position[0]).toBeCloseTo(TRAY_SLOT[0], 12);
      expect(s.position[2]).toBeCloseTo(TRAY_SLOT[2], 12);
    }
    expect(sampleHandling(plan, 1).position).toEqual(TRAY_SLOT);
  });
});

describe('a deflector going onto the rod', () => {
  // The deflector screws onto the bottom of the rod, so it arrives from below.
  const SHELF: Point3 = [0.0154, 1.0729, 0.0749];
  const FITTED: Point3 = [AXIS_X, 1.5874, AXIS_Z];
  const plan = planHandling({
    start: SHELF,
    end: FITTED,
    depart: 0.025,
    approach: -0.06,
    obstacles: [{ ...TANK, topY: 1.3749 }],
    radius: 0.0162,
    halfHeight: 0.0119,
    travelHeight: FITTED[1] - 0.06,
  });

  it('passes over the open tank', () => {
    for (const t of samples(2000)) {
      const p = sampleHandling(plan, t).position;
      const over =
        p[0] > TANK.minX - 0.0162 && p[0] < TANK.maxX + 0.0162 &&
        p[2] > TANK.minZ - 0.0162 && p[2] < TANK.maxZ + 0.0162;
      if (over) expect(p[1] - 0.0119).toBeGreaterThan(1.3749);
    }
  });

  it('stays below the rod until it is lined up under it', () => {
    // The rod's end is at the fitted deflector's top; nothing may come near it sideways.
    const rodEnd = FITTED[1];
    for (const t of samples(2000)) {
      const s = sampleHandling(plan, t);
      if (s.phase !== 'approach') expect(s.position[1] + 0.0119).toBeLessThan(rodEnd);
    }
  });

  it('is on the nozzle axis for the whole of its final approach, coming up from below', () => {
    let previousY = -Infinity;
    for (const t of samples()) {
      const s = sampleHandling(plan, t);
      if (s.phase !== 'approach') continue;
      expect(offAxis(s.position)).toBeLessThan(1e-9);
      expect(s.position[1]).toBeGreaterThanOrEqual(previousY);
      previousY = s.position[1];
    }
    const end = sampleHandling(plan, 1).position;
    expect(offAxis(end)).toBeLessThan(1e-9);
    expect(end[1]).toBeCloseTo(FITTED[1], 12);
  });

  it('goes over the pointer post and arm, which stand between the tray and the rod', () => {
    // Measured in the browser with the cover open: the old straight route went through both.
    const post: Obstacle = { minX: 0.0081, maxX: 0.0132, minZ: -0.1683, maxZ: -0.1632, topY: 1.4537 };
    const arm: Obstacle = { minX: -0.0125, maxX: 0.0213, minZ: -0.1732, maxZ: -0.1583, topY: 1.44 };
    const R = 0.0162;
    const H = 0.0119;
    for (const shelfX of [-0.1393, -0.088, -0.0363, 0.0154, 0.0713, 0.1167, 0.1663]) {
      for (const inward of [true, false]) {
        const shelf: Point3 = [shelfX, 1.073, 0.0749];
        const routed = planHandling({
          start: inward ? shelf : FITTED,
          end: inward ? FITTED : shelf,
          depart: inward ? 0.025 : -0.06,
          approach: inward ? -0.06 : 0.025,
          travelHeight: FITTED[1] - 0.06,
          obstacles: [{ ...TANK, topY: 1.3749 }, post, arm],
          radius: R,
          halfHeight: H,
        });
        for (const t of samples(2000)) {
          const p = sampleHandling(routed, t).position;
          for (const o of [post, arm]) {
            const over =
              p[0] > o.minX - R && p[0] < o.maxX + R && p[2] > o.minZ - R && p[2] < o.maxZ + R;
            if (over) expect(p[1] - H).toBeGreaterThan(o.topY);
          }
          // And never up into the rod before it is lined up under it.
          if (Math.hypot(p[0] - AXIS_X, p[2] - AXIS_Z) < R + 0.006) {
            expect(p[1]).toBeLessThanOrEqual(FITTED[1] + 1e-9);
          }
        }
      }
    }
  });

  it('is below the rod while it is being lined up', () => {
    expect(plan.approachTop[1]).toBeLessThan(FITTED[1]);
  });
});

describe('phase timing', () => {
  it('gives short precise moves more time per millimetre than the long carry', () => {
    const [depart, carry, approach] = phaseShares([0.02, 0.45, 0.06]);
    expect(depart + carry + approach).toBeCloseTo(1, 12);
    expect(depart / 0.02).toBeGreaterThan(carry / 0.45);
    expect(approach / 0.06).toBeGreaterThan(carry / 0.45);
  });

  it('drops a phase that has no length instead of pausing on it', () => {
    expect(phaseShares([0, 0.3, 0.05])[0]).toBe(0);
    const plan = planHandling({ start: [0, 1, 0], end: [0.2, 1.2, 0], depart: 0, approach: 0.03 });
    expect(sampleHandling(plan, 0).phase).toBe('carry');
  });

  it('eases every phase from rest to rest', () => {
    expect(easeInOutSine(0)).toBeCloseTo(0, 12);
    expect(easeInOutSine(1)).toBeCloseTo(1, 12);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 12);
  });

  it('keeps BEDO’s two seconds for the install and a shorter move for the old deflector', () => {
    expect(durationOf('deflector-install')).toBe(TRANSFER_SECONDS);
    expect(durationOf('deflector-removal')).toBe(DEFLECTOR_REMOVAL_SECONDS);
    expect(DEFLECTOR_REMOVAL_SECONDS).toBeLessThan(TRANSFER_SECONDS);
  });
});

describe('riding the pan', () => {
  const plan = planHandling({ start: TRAY_SLOT, end: SEAT, depart: 0.02, approach: 0.06 });

  it('rides the live lift for the whole approach onto the pan, and not at all in the tray', () => {
    for (const t of samples()) {
      const s = sampleHandling(plan, t);
      const share = liftShare(s, 0, 1);
      if (s.phase === 'depart') expect(share).toBe(0);
      if (s.phase === 'approach') expect(share).toBe(1);
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
  });
});

describe('delayed flights', () => {
  it('holds a delayed flight at its start, then runs its full duration', () => {
    const transfers = createTransferSet();
    transfers.start('deflector:135', 'deflector-install', DEFLECTOR_REMOVAL_SECONDS);
    transfers.advance(1);
    expect(transfers.fractionOf('deflector:135')).toBe(0);
    expect(transfers.progressOf('deflector:135')).toBe(0);
    transfers.advance(DEFLECTOR_REMOVAL_SECONDS - 1 + 1);
    expect(transfers.fractionOf('deflector:135')).toBeCloseTo(1 / TRANSFER_SECONDS, 10);
    const settled = transfers.advance(TRANSFER_SECONDS);
    expect(settled).toEqual(['deflector:135']);
  });

  it('reports the plain fraction for an undelayed flight', () => {
    const transfers = createTransferSet();
    transfers.start('weight:0', 'weight-install');
    transfers.advance(0.5);
    expect(transfers.fractionOf('weight:0')).toBeCloseTo(0.25, 12);
  });
});

describe('the shelf-to-rod rotation of a deflector', () => {
  const q45 = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)] as [number, number, number, number];
  const shape: Vec3[] = [
    [0.01, 0, 0],
    [0, 0.02, 0.003],
    [-0.012, 0.004, 0.01],
    [0.002, -0.015, -0.011],
    [0.016, 0.011, 0.007],
  ];

  it('recovers a known rotation and translation exactly', () => {
    const offset: Vec3 = [0.3, 0.5, -0.2];
    const moved = shape.map((p) => {
      const r = rotate(q45, p);
      return [r[0] + offset[0], r[1] + offset[1], r[2] + offset[2]] as Vec3;
    });
    const fit = fitRigid(shape, moved)!;
    expect(fit.maxResidual).toBeLessThan(1e-9);
    // Same rotation up to sign.
    const dot = fit.rotation.reduce((s, v, i) => s + v * q45[i], 0);
    expect(Math.abs(dot)).toBeCloseTo(1, 9);
  });

  it('returns the identity for a pure translation', () => {
    const moved = shape.map((p) => [p[0] + 0.1, p[1], p[2] - 0.3] as Vec3);
    const fit = fitRigid(shape, moved)!;
    expect(fit.rotation[3]).toBeCloseTo(1, 9);
    expect(fit.maxResidual).toBeLessThan(1e-9);
  });

  it('declines point sets that cannot correspond', () => {
    expect(fitRigid(shape, shape.slice(1))).toBeNull();
    expect(fitRigid(shape.slice(0, 2), shape.slice(0, 2))).toBeNull();
  });
});

describe('time left in a flight', () => {
  it('counts the wait still ahead of a delayed flight', () => {
    const transfers = createTransferSet();
    transfers.start('weight:1', 'weight-install', 0.5);
    expect(transfers.remainingOf('weight:1')).toBeCloseTo(TRANSFER_SECONDS + 0.5, 12);
    transfers.advance(1);
    expect(transfers.remainingOf('weight:1')).toBeCloseTo(TRANSFER_SECONDS - 0.5, 12);
    expect(transfers.remainingOf('nothing')).toBeNull();
  });
});
