// The shape of a weight's two-second flight (BEDO-021b §24).
//
// Scene geometry, and only the part BEDO does not specify. The storyboard says *what*
// happens and *how long* it takes — *"the weight moves to the tank holder in 2 seconds"* —
// and says nothing at all about the route. `src/interaction/transfer.ts` owns the timing
// that BEDO does fix; this owns the one thing it does not, and owns it as little as
// possible.
//
// ## Why a straight line will not do
//
// A weight may only be added while the tank cover is **shut** — the state machine rejects
// `ADD_WEIGHT` with the cover open, which is BEDO's Error 4, *"Can't add weight because
// tank cover is open"*. The weight pan is on the rod **above** that shut cover, and the
// discs are on the bench beside the tank. So the straight line between them dives through
// the closed glass tank: measured on the shipped model, a 50 g disc flying from its tray
// slot to the first seat is inside the tank's bounding box for the middle third of its
// flight. The same is true of the holder → tray removal `BEDO-021` shipped, which has been
// passing a disc through the glass since it landed.
//
// So the disc goes *over* the tank, the way a hand would carry it. That is the whole of
// this module.
//
// ## What is not here
//
// No aesthetics. No overshoot, no spin, no swoop. The arc is the **smallest** one that
// clears the obstacle by a stated margin, computed from the tank's measured bounds, and it
// is zero whenever the direct path is already clear.

/** A point in apparatus-local space. */
export type Point3 = readonly [number, number, number];

/** An axis-aligned obstacle in apparatus-local space, as measured from the model. */
export interface Obstacle {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** The height the disc has to stay above while it is over this footprint. */
  readonly topY: number;
}

/**
 * How far above the obstacle the disc's underside should pass, in model units.
 *
 * One centimetre at the model's true scale, where the tank cover is 3 cm thick and the
 * discs are 5.5–16.5 mm. Big enough to read as "over the lid" rather than "grazing it",
 * small enough that the disc never leaves the frame the step is composed in.
 */
export const OBSTACLE_CLEARANCE = 0.01;

/** How many points along the flight are tested when sizing the arc. */
const SAMPLES = 48;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The extra height, at the top of the arc, needed to carry the disc over the obstacle.
 *
 * Returns 0 when the straight line is already clear, so a route that never crosses the
 * tank is left exactly as it was.
 *
 * The arc is a half sine: zero at both ends, so the disc still leaves its tray slot and
 * arrives at its seat at precisely the measured anchors — `BEDO-021b §25`, no
 * transfer-specific offset survives the landing. The height is found by sampling rather
 * than solved in closed form because the binding moment is wherever the path first crosses
 * the tank's footprint, which depends on which tray slot the disc came from; sampling is a
 * few dozen multiplications, once per flight, and cannot be wrong about a shape it is
 * measuring directly.
 *
 * `radius` widens the footprint by the disc's own size, so a disc is clear when *all* of it
 * is clear rather than just its centre.
 */
export function arcHeightOver(
  from: Point3,
  to: Point3,
  obstacle: Obstacle,
  radius = 0,
  clearance = OBSTACLE_CLEARANCE
): number {
  const needed = obstacle.topY + clearance;
  const minX = obstacle.minX - radius;
  const maxX = obstacle.maxX + radius;
  const minZ = obstacle.minZ - radius;
  const maxZ = obstacle.maxZ + radius;

  let height = 0;
  for (let i = 1; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    const x = lerp(from[0], to[0], t);
    const z = lerp(from[2], to[2], t);
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;

    const deficit = needed - lerp(from[1], to[1], t);
    if (deficit <= 0) continue;
    // How tall the whole arc must be for its value *at this t* to cover the deficit.
    height = Math.max(height, deficit / Math.sin(Math.PI * t));
  }
  return height;
}

/**
 * The vertical bump at progress `t`, for an arc of the given height.
 *
 * Added to the straight interpolation the caller is already doing. Zero at t = 0 and
 * t = 1 by construction.
 */
export const arcLift = (height: number, t: number): number =>
  height <= 0 ? 0 : height * Math.sin(Math.PI * t);
