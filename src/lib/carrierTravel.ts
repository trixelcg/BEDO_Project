// How far the weight carrier may travel, and why it stops where it does (F05).
//
// The carrier is one rigid assembly: the weight pan and its post, the rod through the
// cover, and the deflector screwed to the rod's lower end, all standing on the deflector
// spring. The jet pushes it up; the load on the pan pushes it down; the spring (k = 200 N/m,
// `domain/physics.ts`) sets how far. The pointer is **not** part of it: it is the fixed
// reference the carrier is balanced against, clamped to its own pin at the carrier's rest
// height.
//
// The workbook gives the force/height relationship — h = F / k, e.g. 0.4905 N → 2.45 mm —
// but no geometric stop. This module is where that stop is defined, from the model, with
// the two engineering choices named as constants so they can be approved or changed in
// one place. See `docs/55_BALANCE_MECHANISM_F05.md`.
//
// ## Down: the lesser of two limits
//
//   1. **Nozzle clearance.** The deflector hangs over the nozzle mouth (`Cylinder012`, top
//      at y = 1.26176, `water-alignment.spec.ts`). At rest the flat, hemispherical and 45°
//      deflectors clear it by 27.8 mm and the 30°/60° cones by 23.4 mm. The carrier may not
//      bring the deflector closer than `MIN_NOZZLE_CLEARANCE_MM`.
//   2. **Spring compression.** The spring is 56.4 mm tall at rest, ~6 turns of 3.9 mm wire
//      at a 9.5 mm pitch (measured off `deflector_spring`), so it is solid at ~27.3 mm and
//      can close by ~29.1 mm. It is worked to `SPRING_WORKING_FRACTION` of that.
//
// With the proposed values the nozzle governs for every deflector: 17.8 mm of downward
// travel (13.4 mm for the cones), against 23.3 mm of spring.
//
// ## Up
//
// Unchanged: `springTravelLimitMm` (`apparatusView.ts`), 45 % of the spring's rest height,
// the storyboard's "will not exceed the cover or holder surface".

/** The nozzle tube, whose mouth the deflector must not come near. */
export const NOZZLE_MOUTH_MESH = 'Cylinder012';

/**
 * Minimum deflector-to-nozzle clearance, in millimetres. **Proposed — for engineering
 * approval.**
 *
 * One nozzle bore (10 mm, `waterJet.NOZZLE_DIAMETER_M`): close enough that every lesson
 * reading has room, far enough that the jet is still a free jet when it meets the
 * deflector and the deflector never reaches the mouth. BEDO's sources define no value.
 */
export const MIN_NOZZLE_CLEARANCE_MM = 10;

/** Wire diameter and coil passes of `deflector_spring`, measured off the model. */
export const SPRING_WIRE_DIAMETER_MM = 3.9;
export const SPRING_COIL_PASSES = 6;

/**
 * Share of the spring's closing travel it is worked to. **Proposed — for engineering
 * approval.** 80 % keeps the coils from ever meeting.
 */
export const SPRING_WORKING_FRACTION = 0.8;

/** The spring's solid height: every coil pass, plus the ground ends, wire on wire. */
export const springSolidHeightMm = (): number =>
  (SPRING_COIL_PASSES + 1) * SPRING_WIRE_DIAMETER_MM;

/** How far the spring may be compressed from rest, in millimetres. */
export const springCompressionLimitMm = (restHeightMm: number): number =>
  Math.max(0, (restHeightMm - springSolidHeightMm()) * SPRING_WORKING_FRACTION);

export interface CarrierStop {
  /** Downward travel allowed from rest, in millimetres. */
  dropMm: number;
  /** Which limit sets it. */
  limitedBy: 'nozzle' | 'spring';
  /** Deflector-to-nozzle clearance at rest, and at the stop, in millimetres. */
  clearanceAtRestMm: number;
  clearanceAtStopMm: number;
  /** The spring's own limit, for the record. */
  springLimitMm: number;
}

/**
 * The carrier's downward stop for one fitted deflector.
 *
 * @param deflectorBottomY  Lowest point of the fitted deflector at rest, model units.
 * @param nozzleMouthY      Top of the nozzle tube, model units.
 * @param springRestMm      The spring's rest height, millimetres.
 */
export function carrierStop(
  deflectorBottomY: number,
  nozzleMouthY: number,
  springRestMm: number
): CarrierStop {
  const clearanceAtRestMm = (deflectorBottomY - nozzleMouthY) * 1000;
  const nozzleLimitMm = Math.max(0, clearanceAtRestMm - MIN_NOZZLE_CLEARANCE_MM);
  const springLimitMm = springCompressionLimitMm(springRestMm);
  const limitedBy = nozzleLimitMm <= springLimitMm ? 'nozzle' : 'spring';
  const dropMm = Math.min(nozzleLimitMm, springLimitMm);
  return {
    dropMm,
    limitedBy,
    clearanceAtRestMm,
    clearanceAtStopMm: clearanceAtRestMm - dropMm,
    springLimitMm,
  };
}

/**
 * How fast the carrier settles on a new load, per second.
 *
 * First order, so it approaches its new height without overshoot — the real carrier is
 * damped by the water it stands in, and a displacement that swung past its target would
 * read as the pan passing the pointer when it had not. 95 % of the way in 0.5 s.
 */
export const CARRIER_RESPONSE_PER_S = 6;

/** One frame of that response: the new height, from the old, the target and the step. */
export const settleToward = (current: number, target: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-CARRIER_RESPONSE_PER_S * Math.max(0, dt)));
