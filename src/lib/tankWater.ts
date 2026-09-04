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
  toLocal: (v: THREE.Vector3) => THREE.Vector3,
  /**
   * What actually closes the tank, top and bottom (BEDO-WATER-01).
   *
   * The glass alone cannot say where the water sits. Measured on the shipped apparatus, the
   * tube runs y 1.05808..1.37491 — but its lower 23 mm is sunk into the base assembly and
   * its top 19 mm disappears into the cover. Taking the floor and ceiling from the glass's
   * own bbox therefore put the water's base **22.9 mm below the visible floor**, inside an
   * opaque plate, and overstated the interior height by 42.1 mm (15.3 %). Every fill level
   * was scaled from that wrong height.
   *
   * So the two closing surfaces are measured from the parts that actually close it: the
   * base plate presents a 161 mm disc across the bore topping out at y = 1.08096, and the
   * cover's underside sits at y = 1.35565. Both are read here, inside the bore, rather than
   * assumed — pass them and the interior is the real one; omit them and this falls back to
   * the glass, which is what it did before.
   */
  closures?: { floor?: THREE.Object3D | null; ceiling?: THREE.Object3D | null }
): TankInterior | null {
  const gather = (root: THREE.Object3D): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    const vertex = new THREE.Vector3();
    root.updateWorldMatrix(true, true);
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry?.getAttribute('position');
      if (!position) return;
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position as THREE.BufferAttribute, i);
        out.push(toLocal(vertex.applyMatrix4(mesh.matrixWorld)).clone());
      }
    });
    return out;
  };

  const points = gather(tank);
  if (points.length < 8) return null;

  const box = new THREE.Box3().setFromPoints(points);
  const axis = new THREE.Vector2(
    (box.min.x + box.max.x) / 2,
    (box.min.z + box.max.z) / 2
  );
  const radii = points.map((p) => Math.hypot(p.x - axis.x, p.z - axis.y)).sort((a, b) => a - b);
  const inner = radii[Math.floor(0.25 * (radii.length - 1))];
  if (!(inner > 0)) return null;

  /** Points of `part` that lie inside the bore and within the glass's own height. */
  const inBore = (part: THREE.Object3D | null | undefined) =>
    part
      ? gather(part).filter(
          (p) =>
            Math.hypot(p.x - axis.x, p.z - axis.y) < inner &&
            p.y >= box.min.y - 1e-6 &&
            p.y <= box.max.y + 1e-6
        )
      : [];

  // The floor is the highest thing the base presents across the bore; the ceiling is the
  // lowest thing the cover presents. Anything narrow — the nozzle tube, a deflector — is
  // furniture standing in the water, not a surface that bounds it, so only parts that span
  // a real fraction of the bore are allowed to set a level.
  const SPANS_BORE = 0.5;
  const spanning = (pts: THREE.Vector3[]) =>
    pts.filter((p) => Math.hypot(p.x - axis.x, p.z - axis.y) > inner * SPANS_BORE);

  const floorPts = spanning(inBore(closures?.floor));
  const ceilPts = spanning(inBore(closures?.ceiling));

  return {
    axis,
    radius: inner * (1 - WALL_CLEARANCE),
    floorY: floorPts.length ? Math.max(...floorPts.map((p) => p.y)) : box.min.y,
    ceilingY: ceilPts.length ? Math.min(...ceilPts.map((p) => p.y)) : box.max.y,
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
 * setpoint and filling at the second. Those are 15.71 and 27.02 L/min, so the observed
 * behaviour brackets the threshold and this is the midpoint — the only number in this file
 * the recording does not pin exactly.
 *
 * **In litres per minute, not as a fraction of the pump's rating.** It was 0.178 of a
 * 120 L/min pump, which is the same 21.4 L/min; but a fraction is only the same threshold
 * while the rating never moves, and re-rating the pump to 40 L/min turned the first
 * reading's 15.71 L/min from 0.131 into 0.393 of delivery. The tank would then have filled
 * at the reading the recording shows it empty at. What the recording bracketed is a flow.
 */
export const DRAIN_CAPACITY_L_MIN = 21.36;

/**
 * Where the water surface should be heading, as a fraction of the interior height.
 *
 * `inflowLMin` is the flow the domain already computed; this module reads it and writes
 * nothing back, so no equation can be perturbed by it.
 *
 * Two rules, both from the recording: water accumulates only while more arrives than the
 * drain can carry, and opening the volumetric valve empties the tank.
 */
export const targetLevel = (inflowLMin: number, volumetricValveOpen: boolean): number =>
  !volumetricValveOpen && inflowLMin > DRAIN_CAPACITY_L_MIN ? FULL_LEVEL : 0;

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
 * No procedural body is built for the tank any more (BEDO-WATER-14).
 *
 * There used to be a `CylinderGeometry` here representing the standing water. It read as
 * exactly what it was — a blue cylinder with its own walls, standing inside the glass and
 * narrower than the bore it was meant to fill — and hiding it at runtime produced the wanted
 * frame outright. The authored Alembic plume is the water in the tank; this module keeps the
 * *level*, which is state, and no longer owns a picture of it.
 *
 * `measureTankInterior`, `targetLevel` and `advanceLevel` below are all still live: the fill
 * is simulated exactly as before, and only its visualisation is gone.
 */
