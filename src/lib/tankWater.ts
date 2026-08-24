// The body of water that collects in the measuring tank.
//
// ## Why this is procedural
//
// The apparatus is a *volumetric* rig: you shut the drain, let the tank fill, and read the
// volume. `Bedo_Mesu_J.mp4` shows it plainly — at t = 60.63 s the tank holds only the jet
// column, and by t = 74.0 s it is filled almost to the cover with a translucent blue-grey
// body that has a flat top surface and through which the nozzle and the deflector are still
// clearly visible.
//
// None of the shipped assets can draw that:
//
//   * `LIQUID001` — the one liquid-sounding mesh — is a **four-vertex flat quad**,
//     0.3125 x 0.7874 x 0 in its own space, about 6.7 x 16.9 mm once scaled, sitting at
//     local (-0.283, 0.570, 0.148). The tank spans y 1.058..1.375 at x -0.080..0.101, so it
//     is roughly 480 mm below the tank floor and 300 mm to one side. It is a small
//     billboard, not a volume, and it is identical in `Bedo_baked_v2.glb`,
//     `assets-source/models/Bedo_M.glb` and `Bedo_model_optimized.glb` — so it is what was
//     authored, not something a bake broke. `DeviceModel` has always hidden it.
//   * The eight Alembic caches are the jet and the deflector-impact shapes. None is a tank
//     body, and none has a flat free surface.
//
// So the tank water is generated here, from the tank's own measured interior. It is
// **presentation only**: nothing in `src/domain` reads it, and it takes no part in the
// force, velocity or momentum equations.
//
// ## What drives it
//
// A fixed drain capacity — read straight off the recording, frame by frame.
//
// The obvious guess is the volumetric valve: shut the drain, the tank fills. The recording
// says otherwise. Between 66.3 s and 70.9 s the camera sits on the **red flow-control
// valve** and the student turns that; the volumetric valve is never touched. Before it, ten
// seconds of flow at the first setpoint leave the tank essentially **empty**; after it, the
// tank is visibly filling within a second of the camera returning and is near full by 74 s.
//
// So the tank behaves like what it is: a vessel with a drain of fixed size. Below the
// drain's capacity the water runs straight through and the level stays at zero; above it,
// the surplus accumulates. The two observed states bracket that capacity — expressed as a
// fraction of the pump's total flow, `flowRateLMin` puts the first reading at 0.131 and the
// second at 0.225, and the tank is empty at the first and filling at the second.
//
// The volumetric valve still empties the tank when a learner opens it. That is the one
// thing the control can sensibly do, and it is not contradicted by anything: the valve
// appears in **no** experiment sheet, is absent from the storyboard's state tables, and
// BEDO removed its lesson step from their own build (`docs/35`, `domain/experiments.ts`).
// With no source describing it, the rig's resting state is left exactly as it is.

import * as THREE from 'three';

/**
 * The tank's usable interior, measured off the glass rather than assumed.
 *
 * The glass is a tube: its vertices fall into two radial bands, an inner wall at 85.6 mm
 * and an outer at 90.5 mm. The water fills to the inner one, pulled in very slightly so it
 * cannot z-fight with the glass it sits inside.
 */
export interface TankInterior {
  /** Centre of the tank's axis, in model space. */
  axis: THREE.Vector2;
  /** Inner radius, in model units. */
  radius: number;
  /** Floor and the underside of the cover. */
  floorY: number;
  ceilingY: number;
}

/** How far inside the glass the water surface sits, as a fraction of the inner radius. */
export const WALL_CLEARANCE = 0.015;

/**
 * How much of the interior height the tank fills to.
 *
 * The reference shows the surface just below the cover, not touching it — measured off the
 * t = 74.0 s frame, where the free surface sits at roughly nine tenths of the interior.
 */
export const FULL_LEVEL = 0.90;

/**
 * How long the tank takes to fill, in seconds.
 *
 * **Bounded, not measured.** The camera leaves the tank empty at 65.5 s and returns at
 * 71.5 s to find it already filling, near full by 74 s. The flow was raised somewhere in
 * that window, so the fill takes *at most* about six seconds and could be quicker. Six is
 * the slowest value consistent with the evidence, chosen deliberately over a faster
 * invented one. Draining is never shown at all, so it reuses the same figure rather than
 * introducing a second number with nothing behind it.
 */
export const FILL_SECONDS = 6;
export const DRAIN_SECONDS = 6;

/**
 * Measure the interior from the tank mesh.
 *
 * Radii are taken per vertex about the tank's own axis and read at a low quantile, which
 * picks the inner wall without being thrown by the rim or the base. Returns null for a mesh
 * that is not a tube, so a re-exported model degrades to "no tank water" rather than to a
 * wrong one.
 */
export function measureTankInterior(
  tank: THREE.Object3D,
  toLocal: (v: THREE.Vector3) => THREE.Vector3
): TankInterior | null {
  const points: THREE.Vector3[] = [];
  const vertex = new THREE.Vector3();
  tank.updateWorldMatrix(true, true);
  tank.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry?.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position as THREE.BufferAttribute, i);
      points.push(toLocal(vertex.applyMatrix4(mesh.matrixWorld)).clone());
    }
  });
  if (points.length < 8) return null;

  const box = new THREE.Box3().setFromPoints(points);
  const axis = new THREE.Vector2(
    (box.min.x + box.max.x) / 2,
    (box.min.z + box.max.z) / 2
  );
  const radii = points.map((p) => Math.hypot(p.x - axis.x, p.z - axis.y)).sort((a, b) => a - b);
  const inner = radii[Math.floor(0.25 * (radii.length - 1))];
  if (!(inner > 0)) return null;

  return {
    axis,
    radius: inner * (1 - WALL_CLEARANCE),
    floorY: box.min.y,
    ceilingY: box.max.y,
  };
}

/**
 * The threshold above which the tank is drawn as accumulating water.
 *
 * **This is a presentation threshold calibrated against the reference recording. It is NOT
 * a verified BEDO physical constant, and must not be treated as one.** No BEDO document
 * describes the drain, its capacity, or any flow at which the tank begins to fill; the
 * number exists only to reproduce what the video shows. It lives here, outside
 * `src/domain`, precisely so that it cannot reach an equation: nothing in the physics reads
 * it, and `tests/unit/tank-water.spec.ts` asserts that it never will.
 *
 * If BEDO source documentation ever gives a real drain capacity, that value replaces this
 * one and this comment should say so. Until then it is a rendering cue, not engineering.
 *
 * **How it was arrived at.** The tank is empty through ten seconds at the first reading
 * setpoint and filling at the second; `flowRateLMin` puts those at 0.131 and 0.225 of the
 * pump's total. The observed behaviour therefore brackets the threshold, and this is the
 * midpoint — the only number in this file the recording does not pin exactly.
 */
export const DRAIN_CAPACITY_FRACTION = 0.178;

/**
 * Where the water surface should be heading, as a fraction of the interior height.
 *
 * `inflowFraction` is the current flow as a share of the pump's capacity, so this module
 * needs nothing from the domain and no equation can be perturbed by it.
 *
 * Two rules, both from the recording: water accumulates only while more arrives than the
 * drain can carry, and opening the volumetric valve empties the tank.
 */
export const targetLevel = (inflowFraction: number, volumetricValveOpen: boolean): number =>
  !volumetricValveOpen && inflowFraction > DRAIN_CAPACITY_FRACTION ? FULL_LEVEL : 0;

/**
 * Advance the level toward its target at the measured rate.
 *
 * Linear rather than eased: a tank fills at the rate water arrives, and an ease-out would
 * imply it slows as it approaches a level nothing is limiting.
 */
export function advanceLevel(current: number, target: number, delta: number): number {
  const seconds = target > current ? FILL_SECONDS : DRAIN_SECONDS;
  const step = delta / Math.max(seconds, 1e-6);
  if (target > current) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

/**
 * The cylinder the water is drawn with.
 *
 * Open-ended and drawn from both sides: the learner looks *into* the tank, so the far
 * inside wall has to be there. Radial segments are matched to the glass's own silhouette —
 * enough to read as round, not so many that a body which is usually invisible costs
 * anything.
 */
export const TANK_WATER_SEGMENTS = 48;

export function createTankWaterGeometry(interior: TankInterior): THREE.CylinderGeometry {
  const height = Math.max(interior.ceilingY - interior.floorY, 1e-6);
  // Unit height, scaled per frame by the level — so filling never rebuilds the geometry.
  const geometry = new THREE.CylinderGeometry(
    interior.radius,
    interior.radius,
    height,
    TANK_WATER_SEGMENTS,
    1,
    false
  );
  // Origin at the base, so scaling y raises the surface instead of growing both ways.
  geometry.translate(0, height / 2, 0);
  return geometry;
}
