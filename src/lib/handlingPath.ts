// How a part is carried from one resting place to another (F03).
//
// `transferPath.ts` answers one question — how high must a flight arc to clear the tank —
// and the flights used to be a single eased straight line with that arc added. A straight
// line is what produced every defect F03 records:
//
//   * a disc flying to the pan arrived **sideways**, so for the last third of its flight
//     the retaining post was passing through its solid face (measured: 20–60 mm off the
//     post axis while already below the post's tip);
//   * a disc taken off the pan left sideways too, through the post and through any disc
//     stacked above it;
//   * a deflector converged on the rod along a diagonal and only reached the nozzle axis
//     in the final frames, so it read as drifting off-axis and landing from the side.
//
// A hand does not move a part like that. It lifts the part clear of whatever it is
// resting in, carries it, and then makes the final approach **along the axis of the thing
// it is going onto** — down the post for a disc, up the rod for a deflector. This module
// describes exactly that, and nothing more:
//
//     start ──depart──▶ departTop ──carry──▶ approachTop ──approach──▶ end
//
// `depart` and `approach` are purely vertical. The carry is a cubic Bézier whose end legs are
// vertical too, so the part leaves the lift still rising and arrives over its destination
// already moving along that destination's axis — never sideways onto it. On top of that
// curve goes the smallest half-sine lift that keeps the part's underside over everything in
// the way: the tank, the column of discs on the pan, and the pointer post and arm that stand
// between the tray and the rod. Each phase starts and ends at rest, so the part visibly
// *stops* where it is lifted clear and where it is lined up, which is what makes the
// placement read as deliberate.
//
// Pure arithmetic — no three.js, no scene — so the shape of a flight can be asserted in a
// unit test without rendering anything (`tests/unit/handling-path.spec.ts`).

import { arcLift, type Obstacle, type Point3 } from './transferPath';

export type { Point3 } from './transferPath';

export type HandlingPhase = 'depart' | 'carry' | 'approach';

/** One planned flight. Built once when the flight starts; sampled every frame. */
export interface HandlingPlan {
  readonly start: Point3;
  /** `start` moved vertically by the departure distance. */
  readonly departTop: Point3;
  /** `end` moved vertically by the approach distance — lined up on the destination's axis. */
  readonly approachTop: Point3;
  readonly end: Point3;
  /**
   * The carry's two inner control points. The carry is a cubic Bézier from `departTop` to
   * `approachTop` whose first and last legs are vertical, so it leaves the departure still
   * moving the way the departure was going and arrives over the destination already moving
   * the way the approach will continue — never sideways onto an axis.
   */
  readonly carryControls: readonly [Point3, Point3];
  /** Extra height added over the middle of the carry, so the part passes over everything. */
  readonly carryArc: number;
  /** Share of the flight each phase takes, in order depart, carry, approach. Sums to 1. */
  readonly phases: readonly [number, number, number];
}

/**
 * Something the carried part must pass **over**: a footprint, and the height its underside
 * must stay above while any of the part is over that footprint.
 */
export type HandlingObstacle = Obstacle;

export interface HandlingOptions {
  readonly start: Point3;
  readonly end: Point3;
  /**
   * Vertical distance travelled before the part is carried anywhere. Positive lifts it (a
   * disc out of its tray slot, a disc up off the post); negative lowers it (a deflector
   * unscrewed down off the bottom of the rod). Zero for a part that is already free — one
   * the learner let go of in mid-air.
   */
  readonly depart: number;
  /**
   * Where the final, purely vertical approach begins, relative to `end`. Positive means the
   * part comes **down** onto its destination (a disc onto the pan, a disc into its tray
   * slot); negative means it comes **up** into it (a deflector onto the bottom of the rod).
   */
  readonly approach: number;
  /** What the carry must pass over — the tank, the column of discs on the pan. */
  readonly obstacles?: readonly (HandlingObstacle | null | undefined)[];
  /** The part's own horizontal radius, so all of it clears an obstacle and not just its centre. */
  readonly radius?: number;
  /** Half the part's height, so it is the part's underside that clears, not its centre. */
  readonly halfHeight?: number;
  /** Air left between the part's underside and an obstacle's top. */
  readonly clearance?: number;
  /**
   * The height the carry travels at. When given, both inner control points sit at this
   * height, directly above (or below) the carry's two ends, so the part rises or sinks
   * almost straight to it, travels across at it, and meets the far end moving vertically.
   * That is the shape QA drew for a disc — straight up out of the tray to above the post,
   * over, and straight down (F03, 2026-09-28) — and, at the height of the point under the
   * rod, the level approach a deflector needs. Omitted, the legs are a third of the span.
   */
  readonly travelHeight?: number;
}

/** Below this a phase is treated as absent rather than given a sliver of time. */
const NEGLIGIBLE = 1e-6;

/** Default air between a carried part and whatever it passes over: 8 mm at model scale. */
export const HANDLING_CLEARANCE = 0.008;

/** Samples used to size the carry's arc. Once per flight, never per frame. */
const CLEARANCE_SAMPLES = 96;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const distance = (a: Point3, b: Point3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/**
 * Rest-to-rest easing for one phase.
 *
 * Sine rather than the cubic the old single flight used: every phase now starts and stops,
 * and a cubic's long dwell at both ends turned three phases into three visible pauses.
 */
export const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2;

/**
 * How the flight's time is shared between its three phases.
 *
 * Each phase starts and ends at rest, and a move from rest to rest under a bounded
 * acceleration takes time proportional to the **square root** of its length. So a 25 mm
 * lift is not given 5 % of the flight because it is 5 % of the distance — it is given the
 * time a hand would take to do it carefully, and the long carry is quicker per millimetre.
 */
export function phaseShares(lengths: readonly [number, number, number]): [number, number, number] {
  const weights = lengths.map((length) => (length > NEGLIGIBLE ? Math.sqrt(length) : 0));
  const total = weights[0] + weights[1] + weights[2];
  if (total <= 0) return [0, 1, 0];
  return [weights[0] / total, weights[1] / total, weights[2] / total];
}

const bezier = (p0: Point3, p1: Point3, p2: Point3, p3: Point3, u: number): Point3 => {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
  ];
};

/**
 * The smallest half-sine lift that keeps every sampled point of the carry over every
 * obstacle. Zero at both ends by construction, so the carry still meets the departure and
 * the approach exactly; zero altogether when the curve is already clear.
 */
function liftToClear(
  at: (u: number) => Point3,
  obstacles: readonly HandlingObstacle[],
  radius: number,
  halfHeight: number,
  clearance: number
): number {
  let height = 0;
  for (let i = 1; i < CLEARANCE_SAMPLES; i++) {
    const u = i / CLEARANCE_SAMPLES;
    const p = at(u);
    for (const o of obstacles) {
      if (
        p[0] < o.minX - radius ||
        p[0] > o.maxX + radius ||
        p[2] < o.minZ - radius ||
        p[2] > o.maxZ + radius
      ) {
        continue;
      }
      const deficit = o.topY + clearance - (p[1] - halfHeight);
      if (deficit > 0) height = Math.max(height, deficit / Math.sin(Math.PI * u));
    }
  }
  return height;
}

/**
 * The travel height that puts the middle of a carry `rise` above the higher of its two
 * ends. A cubic Bézier with both inner points at height H passes, half-way, through
 * ⅛·(y₀ + y₃) + ¾·H — so H is solved for that.
 */
export function travelHeightOver(fromY: number, toY: number, rise: number): number {
  const peak = Math.max(fromY, toY) + rise;
  return (peak - (fromY + toY) / 8) / 0.75;
}

/** Plans one flight. Returns the same plan however often it is called with the same input. */
export function planHandling(options: HandlingOptions): HandlingPlan {
  const {
    start,
    end,
    depart,
    approach,
    obstacles = [],
    radius = 0,
    halfHeight = 0,
    clearance = HANDLING_CLEARANCE,
  } = options;
  const departTop: Point3 = [start[0], start[1] + depart, start[2]];
  const approachTop: Point3 = [end[0], end[1] + approach, end[2]];

  // The control legs: a third of the carry's span, pointing the way each vertical phase
  // moves — up out of a lift, down into a descent, up into a deflector's rise onto the rod.
  const span = distance(departTop, approachTop);
  const leg = span / 3;
  const outward = depart === 0 ? 1 : Math.sign(depart);
  const inward = approach === 0 ? 1 : Math.sign(approach);
  const { travelHeight } = options;
  const c1: Point3 =
    travelHeight === undefined
      ? [departTop[0], departTop[1] + outward * leg, departTop[2]]
      : [departTop[0], travelHeight, departTop[2]];
  const c2: Point3 =
    travelHeight === undefined
      ? [approachTop[0], approachTop[1] + inward * leg, approachTop[2]]
      : [approachTop[0], travelHeight, approachTop[2]];

  const present = obstacles.filter((o): o is HandlingObstacle => !!o);
  const carryArc = present.length
    ? liftToClear((u) => bezier(departTop, c1, c2, approachTop, u), present, radius, halfHeight, clearance)
    : 0;

  return {
    start,
    departTop,
    approachTop,
    end,
    carryControls: [c1, c2],
    carryArc,
    phases: phaseShares([Math.abs(depart), span, Math.abs(approach)]),
  };
}

/** Where a flight is at one moment. */
export interface HandlingSample {
  readonly position: Point3;
  readonly phase: HandlingPhase;
  /** Eased progress through the current phase, 0 → 1. */
  readonly phaseProgress: number;
}

/**
 * The part's position at linear time `t` through the flight (0 = start, 1 = end).
 *
 * `t` is the plain fraction of the flight's duration; the easing is applied here, per
 * phase, so that the part is at rest at every waypoint.
 */
export function sampleHandling(plan: HandlingPlan, t: number): HandlingSample {
  const clamped = Math.min(1, Math.max(0, t));
  const [departShare, carryShare] = plan.phases;

  if (departShare > 0 && clamped < departShare) {
    const u = easeInOutSine(clamped / departShare);
    return { position: along(plan.start, plan.departTop, u), phase: 'depart', phaseProgress: u };
  }

  const carryEnd = departShare + carryShare;
  if (clamped < carryEnd || plan.phases[2] <= 0) {
    const raw = carryShare > 0 ? (clamped - departShare) / carryShare : 1;
    const u = easeInOutSine(Math.min(1, Math.max(0, raw)));
    const [c1, c2] = plan.carryControls;
    const p = bezier(plan.departTop, c1, c2, plan.approachTop, u);
    return {
      position: [p[0], p[1] + arcLift(plan.carryArc, u), p[2]],
      phase: 'carry',
      phaseProgress: u,
    };
  }

  const u = easeInOutSine((clamped - carryEnd) / plan.phases[2]);
  return { position: along(plan.approachTop, plan.end, u), phase: 'approach', phaseProgress: u };
}

const along = (a: Point3, b: Point3, u: number): Point3 => [
  lerp(a[0], b[0], u),
  lerp(a[1], b[1], u),
  lerp(a[2], b[2], u),
];

/**
 * How much of the destination's live lift applies at this moment.
 *
 * The pan and the rod ride the tank cover and the spring (`holderLift`), so a part being
 * put onto them must ride that lift for the whole of its final approach — otherwise it
 * would descend onto where the pan *was*. A part leaving them rides it while it is still
 * on the post or the rod. In between, the carry hands over smoothly.
 *
 * `atStart` and `atEnd` are 1 for an end that rides the lift and 0 for one that does not.
 */
export function liftShare(sample: HandlingSample, atStart: number, atEnd: number): number {
  if (sample.phase === 'depart') return atStart;
  if (sample.phase === 'approach') return atEnd;
  return lerp(atStart, atEnd, sample.phaseProgress);
}
