// How big the water is, in metres of apparatus.
//
// Scene-layer mapping from the verified physics to the scene's own units. The domain owns
// `NOZZLE_AREA_M2` and every equation that uses it; this owns the one thing the domain has
// no opinion about — how wide to *draw* the water — and derives it from that area rather
// than from anything on screen.
//
// ## The defect this replaces (BUG-03)
//
// The jet's width was
//
//     scaleXZ = (tankBounds.width * 0.95 / fit.width) * flowIntensity
//
// — ninety-five per cent of the **tank's** diameter. The tank is 181 mm across and the
// nozzle bore is 10 mm, so the water left the nozzle seventeen times too wide and read as
// a pipe filling the tank rather than a jet. Measured at HEAD: 139.7 mm at the first
// reading's setpoint, 172.0 mm at full flow, against a 9.9975 mm bore.
//
// Nothing here may be tuned by eye. If a number in this file is not the nozzle's own
// geometry, it is a bug.
//
// ## Two shapes, because BEDO specifies two
//
// `Jetforce_Storyboard.pptx` sl. 18 lists them as separate game objects:
//
//   | Water shape before impact | "When the user open the valve, the water out of the
//   |                           |  nozzle forms the water shape before impact."
//   | Water shape after impact  | "When the water impacts the deflector, the water shape
//   |                           |  after impact will form according to the deflector shape."
//
// So the narrow column leaving the nozzle and the spray leaving the deflector are two
// different things with two different sizes, and only the first is the nozzle's width. The
// implementation had collapsed them into one and sized that one from the tank.

import { NOZZLE_AREA_M2 } from '../domain/physics';
import { MODEL_UNITS_PER_METRE } from './apparatusView';

/**
 * The bore a cross-sectional area implies: `d = 2 sqrt(A / pi)`.
 *
 * Pure geometry, kept as a function so a test can state the relation rather than the
 * answer. `NOZZLE_AREA_M2` is 0.0000785 m^2, which is the 10 mm bore its own comment
 * claims — this is what checks that claim instead of trusting it.
 */
export const diameterOfArea = (areaM2: number): number => 2 * Math.sqrt(areaM2 / Math.PI);

/** The apparatus's nozzle, in metres. 9.9975 mm. */
export const NOZZLE_DIAMETER_M = diameterOfArea(NOZZLE_AREA_M2);

/**
 * The same bore in the scene's own units.
 *
 * One model unit is one metre (`apparatusView.MODEL_UNITS_PER_METRE`), so this is a
 * conversion that currently changes nothing — and is written out anyway, because the
 * moment somebody rescales the model a bare `NOZZLE_DIAMETER_M` in the frame loop becomes
 * silently wrong and this does not.
 */
export const NOZZLE_DIAMETER_MODEL_UNITS = NOZZLE_DIAMETER_M * MODEL_UNITS_PER_METRE;

/**
 * How much of the jet's authored width is the water column itself.
 *
 * `Water_low.glb` is the "before impact" shape: 5.081 units across and 17.481 long, an
 * aspect of 3.44 against the physical jet's 3.50 (a 10 mm bore over the 35 mm
 * `TRAVEL_HEIGHT_M` it climbs). Within two per cent, which is what identifies it as the
 * authored jet rather than one more plume — every other shipped shape has an aspect near
 * 1.3 and is a spray, not a column.
 *
 * The asset is therefore scaled by its full width: its silhouette *is* the jet.
 */
export const JET_ASSET = 'low' as const;

/**
 * What to scale the jet asset by so it leaves the nozzle at the right bore and reaches the
 * deflector.
 *
 * `assetWidth` and `assetHeight` are the shape's own measured extents, so this works
 * whatever the GLB was authored at — and the shipped ones are authored in centimetre-scale
 * units a hundred times too big, which is exactly why measuring beats assuming.
 *
 * Cross-flow is scaled to the bore; along-flow is stretched to the gap the water actually
 * has to cross. Non-uniform on purpose: a jet is as long as its travel and as wide as its
 * nozzle, and those are independent facts.
 */
export function jetScale(
  assetWidth: number,
  assetHeight: number,
  gapModelUnits: number
): { crossFlow: number; alongFlow: number } {
  return {
    crossFlow: NOZZLE_DIAMETER_MODEL_UNITS / Math.max(assetWidth, 1e-9),
    alongFlow: Math.max(gapModelUnits, 1e-6) / Math.max(assetHeight, 1e-9),
  };
}

/**
 * What to scale an after-impact plume by.
 *
 * BEDO says the shape forms "according to the deflector shape", so it is sized from the
 * **deflector** it forms on — measured from that mesh at runtime — and never from the tank
 * it happens to sit inside. Uniform, so the authored silhouette is preserved: these shapes
 * are the deflector's signature and squashing one would be inventing fluid behaviour no
 * source describes.
 *
 * `spread` is the one presentation number here: the water leaves a deflector wider than
 * the deflector itself, and no BEDO source gives a figure. Documented as an exaggeration
 * rather than smuggled in as geometry — see `docs/41`.
 */
export const PLUME_SPREAD = 1.6;

export function plumeScale(deflectorDiameterModelUnits: number, assetWidth: number): number {
  return (deflectorDiameterModelUnits * PLUME_SPREAD) / Math.max(assetWidth, 1e-9);
}

/**
 * How near the rendered jet has to be to the physical bore to count as correct.
 *
 * Two per cent, which is tighter than the five per cent the brief allows because nothing
 * here is estimated: the bore comes from a verified constant and the asset's width is
 * measured off its own vertices, so the only error is float noise and the asset's own
 * silhouette not being perfectly circular (5.079 by 5.083 — 0.08 per cent out of round).
 */
export const JET_WIDTH_TOLERANCE = 0.02;

/**
 * The valve opening at which the jet is treated as reaching the deflector.
 *
 * **Implementation behaviour, not source truth.** BEDO says only that the water "forms"
 * when the valve is opened and gives no startup curve, so this is the threshold the scene
 * has always used, kept at its existing value: below it the jet is still climbing and no
 * plume has formed, above it the water is striking the deflector. Moving it changes when
 * the spray appears and nothing else — no physics reads it.
 */
export const STARTUP_VALVE_OPENING = 0.22;
