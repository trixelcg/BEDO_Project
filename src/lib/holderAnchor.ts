// Where the weight pan is, and where each disc loaded onto it sits (BEDO-016).
//
// Scene-coordinate knowledge, not domain knowledge. The runtime knows *which* discs are
// loaded and what they weigh (`src/simulation`); this knows the one thing it must never
// know — where they physically are. `src/domain` may not import three.js at all, which is
// exactly why this module lives here and not there (`tests/unit/domain-boundary.spec.ts`).
//
// ## The bug this exists to end (BUG-02)
//
// Loaded discs used to be placed by mixing two different coordinate spaces inside a single
// vector:
//
//     offset = [ pan.x - proto.position.x,          // node-local translation
//                pan.y + cum + h/2 - centre.y,      // measured bounding-box centre
//                pan.z - proto.position.z ]         // node-local translation
//
// `proto.position` is a node's translation *relative to its parent*. In `Bedo_baked_v2.glb`
// every top-level object carries the identical translation `(0, 1.238958, -1.231891)` — it
// is the Blender Z-up to glTF Y-up conversion the exporter stamped onto all of them, and
// the real geometry is baked into the vertices. So `proto.position` is not where a weight
// is; it is the same meaningless constant for the rod, for all five discs, for everything.
// Subtracting it put every loaded disc 1.22 m from the pan along Z (2.196 units at the
// apparatus's 1.8 scale). See `docs/39`.
//
// This module replaces that with one measurement in one space.
//
// ## The space
//
// Everything here is **apparatus-local**: the coordinate space of the group the whole rig
// hangs from, the space `DeviceModel`'s anchors, drop regions and hotspots already use. It
// is not world space, so a showroom transform on the apparatus moves the pan and the discs
// together for free, and it is not node-local, so no exporter artefact leaks in.

import * as THREE from 'three';
import { mmToModelUnits } from './apparatusView';

/**
 * How much of the rod's widest radius a vertex must reach to count as part of the pan.
 *
 * The rod is a shaft with one wide flat plate part-way up — the weight pan — and a thin
 * retaining post above it. In the shipped model the plate's rim is at radius 0.0408 and
 * the next widest feature, the collar beneath it, is at 0.0171: a factor of 2.4 apart. Any
 * threshold in that gap picks out the plate and nothing else, so this is a wide margin
 * rather than a tuned one.
 */
export const PAN_RIM_FRACTION = 0.9;

/**
 * Seating clearance between a disc and whatever it rests on, in millimetres.
 *
 * Not a fudge factor standing in for a coordinate error — those are what BEDO-016 removed.
 * Two solid faces set exactly coplanar have equal depth and z-fight, and real discs do not
 * lie in perfect contact either. One millimetre at the model's true scale (one model unit
 * is one metre, `apparatusView.MODEL_UNITS_PER_METRE`) is below the alignment tolerance
 * `docs/39 §9` sets, and is what keeps the stack from shimmering.
 */
export const SEATING_CLEARANCE_MM = 1;

export const SEATING_CLEARANCE = mmToModelUnits(SEATING_CLEARANCE_MM);

/**
 * The one authoritative description of the weight pan, in apparatus-local space.
 *
 * `docs/39 §4`: pan geometry is the source of truth, and everything the learner sees on
 * the holder — the rendered discs, the click proxies, where a removal flight begins —
 * resolves through this single value. Nothing infers the pan's position from a weight.
 */
export interface HolderAnchor {
  /**
   * Centre of the pan's **top face** — the surface a disc rests on.
   *
   * Deliberately the surface and not the plate's centre: the stack is built upwards from
   * something a disc can sit on, and a centre would bury the first disc half-way into the
   * plate.
   */
  readonly surface: readonly [number, number, number];
  /** Outer radius of the pan plate. A disc wider than this would visibly overhang. */
  readonly radius: number;
  /**
   * How far the retaining post rises above the surface.
   *
   * The discs are annular and slide down this post — in the shipped model the post's
   * radius is 0.00515 and every disc's bore is 0.006353 — so it is also the physical
   * ceiling on how tall a stack the apparatus can actually hold.
   */
  readonly postHeight: number;
}

/**
 * Measure the pan off the rod's real geometry.
 *
 * Vertices are read once, at load, and taken straight into apparatus-local space by a
 * single composed matrix — never via world space and back, and never by reading a node's
 * `position`. That is the whole point: one space, one source, no axis borrowed from
 * anywhere else.
 *
 * The pan is found rather than named because the model has no node for it: the plate is
 * part of `deflector_rod`. It is identified the way a person would point at it — the
 * widest thing on the rod — and its top face is the highest point of that rim.
 *
 * Returns null when the rod has no geometry to measure, so a caller can decline to draw a
 * stack rather than draw one somewhere invented.
 */
export function measureHolderAnchor(
  rod: THREE.Object3D,
  apparatus: THREE.Object3D
): HolderAnchor | null {
  apparatus.updateWorldMatrix(true, false);
  rod.updateWorldMatrix(true, true);

  const toApparatus = new THREE.Matrix4().copy(apparatus.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const point = new THREE.Vector3();

  // The vertices are walked three times — bounds, then widest radius, then the rim — and
  // one Vector3 is reused throughout. Keeping them instead would mean holding ~6,400
  // Vector3s to produce three numbers. This runs once, when the model loads.
  const eachVertex = (visit: (p: THREE.Vector3) => void) => {
    rod.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry?.getAttribute('position');
      if (!position) return;
      local.multiplyMatrices(toApparatus, mesh.matrixWorld);
      for (let i = 0; i < position.count; i++) {
        visit(point.fromBufferAttribute(position, i).applyMatrix4(local));
      }
    });
  };

  let count = 0;
  const bounds = new THREE.Box3().makeEmpty();
  eachVertex((p) => {
    count++;
    bounds.expandByPoint(p);
  });
  if (count === 0 || bounds.isEmpty()) return null;

  const axisX = (bounds.min.x + bounds.max.x) / 2;
  const axisZ = (bounds.min.z + bounds.max.z) / 2;
  const radiusOf = (p: THREE.Vector3) => Math.hypot(p.x - axisX, p.z - axisZ);

  let outerRadius = 0;
  eachVertex((p) => {
    const r = radiusOf(p);
    if (r > outerRadius) outerRadius = r;
  });
  if (outerRadius <= 0) return null;

  // The rim, and with it the plate's own centre and top face. Taking the centre from the
  // rim rather than from the whole rod keeps a lopsided bracket lower down from dragging
  // the stack off the plate.
  const threshold = outerRadius * PAN_RIM_FRACTION;
  const rim = new THREE.Box3().makeEmpty();
  eachVertex((p) => {
    if (radiusOf(p) >= threshold) rim.expandByPoint(p);
  });
  if (rim.isEmpty()) return null;

  return {
    surface: [(rim.min.x + rim.max.x) / 2, rim.max.y, (rim.min.z + rim.max.z) / 2],
    radius: outerRadius,
    postHeight: bounds.max.y - rim.max.y,
  };
}

/** Where one disc sits on the stack, in apparatus-local space. */
export interface Seat {
  /** The disc's centre — where its bounding box's centre must end up. */
  readonly centre: readonly [number, number, number];
  /** The disc's underside, for asserting it rests on the surface below it. */
  readonly bottom: number;
  /** The disc's own measured thickness, carried through so callers need not re-measure. */
  readonly thickness: number;
}

/**
 * Stack the loaded discs on the pan, bottom disc first.
 *
 * Every disc shares the pan's X and Z — a stack leans on nothing — and rises by its own
 * measured thickness plus the seating clearance. The denominations really are different
 * heights (5.5 mm at 50 g up to 16.5 mm at 500 g in the shipped model), so a fixed
 * increment would either embed them in one another or float them apart; `docs/39 §10`
 * tabulates them.
 *
 * Position in the stack is the only thing that distinguishes one disc from another here,
 * which is what keeps two 50 g discs two discs (`BEDO-022`): equal masses produce equal
 * thicknesses and therefore two different, adjacent seats, never one shared slot.
 *
 * Pure arithmetic — no three.js, no scene — so `tests/unit/holder-anchor.spec.ts` can state
 * what a stack should look like without building one.
 */
export function stackSeats(anchor: HolderAnchor, thicknesses: readonly number[]): Seat[] {
  const [x, surfaceY, z] = anchor.surface;
  const seats: Seat[] = [];
  let restingOn = surfaceY;
  for (const thickness of thicknesses) {
    const bottom = restingOn + SEATING_CLEARANCE;
    seats.push({ centre: [x, bottom + thickness / 2, z], bottom, thickness });
    restingOn = bottom + thickness;
  }
  return seats;
}

/**
 * Where to hang a baked clone so that its own centre lands on its parent's origin.
 *
 * The GLB is baked, so a clone of a tray disc arrives carrying the tray's coordinates in
 * its vertices: parented at the origin it draws itself back on the tray, a metre away.
 * `measured` is where its bounding box lands in exactly that situation, so negating it is
 * what brings the disc back onto the point it is supposed to be at.
 *
 * This is the **only** conversion between a disc's baked geometry and where it is drawn,
 * and it deliberately produces a *relative* correction rather than a position. Whoever
 * owns the disc — the stack slot, a ghost in flight — puts its parent at the one place
 * that disc belongs, and the disc, its click proxy and the start of its removal flight are
 * then all that same point by construction rather than by three formulas agreeing
 * (`docs/39 §7`, §13).
 */
export const recentreOffset = (measured: THREE.Vector3): [number, number, number] => [
  -measured.x,
  -measured.y,
  -measured.z,
];
