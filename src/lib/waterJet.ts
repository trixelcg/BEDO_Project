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
 * The asset is therefore scaled by its full width: its silhouette *is* the visible water
 * body. What that body is scaled *to* is `bodyScale` below, not the bore — see there.
 */
export const JET_ASSET = 'low' as const;

// --- The visible body, which is not the bore -------------------------------------------
//
// ## Why these are two different things
//
// BEDO-017 scaled the *rendered* water to `NOZZLE_DIAMETER_M`. That fixed a real defect —
// the water had been drawn at 95 % of the tank's diameter, 17 times too wide — but it
// overshot, and `Bedo_Mesu_J.mp4` shows by how much.
//
// In the reference the water inside the tank is a broad translucent body that **envelops
// the nozzle tube** and spans from the tank floor up to the deflector. Measured per row at
// t = 60.63 s it is 27 px at the deflector, 48-54 px through its body and 74 px at the
// flared foot. Using the deflector cone as an in-frame ruler — the one object visible in
// both the low-flow and high-flow shots — that body is about **one deflector diameter**
// across. It is emphatically not a 10 mm thread; at 10 mm it is invisible, which is what
// the deployed build looked like and why it was reported as wrong.
//
// So the two concepts are separated:
//
//   * **physical bore** — `NOZZLE_DIAMETER_M`, derived from `NOZZLE_AREA_M2`. Feeds the
//     force, velocity and momentum equations. Unchanged, and still asserted at 10.00 mm.
//   * **visible body** — the authored Alembic silhouette, sized from the deflector the way
//     the reference draws it. Presentation only; no equation reads it.
//
// `Water_low`'s own silhouette settles which of the two the asset represents: rendered at
// its settled frame it is a tapered column, narrow at the top, widening downward to a
// flared foot — which is exactly the shape in the video. BEDO authored the *visible body*,
// not the bore.

/**
 * What to scale the authored water body by — **one factor, applied to every axis**.
 *
 * ## Why this is uniform (BEDO-UX-17)
 *
 * It used to be two: cross-flow from the deflector's diameter, along-flow from the span the
 * body has to cover. Two independent factors on one mesh is a stretch, and measured against
 * the shipped assets it was a severe one. `Water_low` is authored 5.083 wide by 17.481 long
 * — an aspect of 3.44:1 — and the apparatus puts a 32.5 mm deflector 230.8 mm above the tank
 * floor, so the pair rendered it at 7.10:1. The authored silhouette was stretched **2.06x**
 * along the flow, and the 32.5 mm result was 18 % of the tank's 181 mm bore: narrower than
 * the nozzle tube it is supposed to swallow, which is what put the tube in front of the
 * water instead of inside it.
 *
 * BEDO authored these caches as finished shapes. Their proportions are the asset, not a
 * parameter, so the only thing the runtime may choose is how big to draw them — hence a
 * single factor. The span is what sets it, because the span is the one dimension the
 * apparatus actually fixes: the body runs from the tank floor to the deflector's underside
 * in both reference frames. Width then follows from the artwork: 17.481 -> 230.8 mm implies
 * 5.083 -> **67.0 mm**, comfortably inside the 181 mm tank and wide enough to envelop the
 * nozzle, which is what the reference shows.
 *
 * This supersedes `BODY_WIDTH_IN_DEFLECTORS = 1.0`, which came from reading the low-flow
 * column and the deflector cone as equal widths in `Bedo_Mesu_J.mp4`. The authored geometry
 * disagrees with that reading, and the authored geometry is the stronger source: it is the
 * artwork itself rather than a measurement off a compressed frame.
 *
 * `assetHeight` is the shape's own measured extent, so this works whatever units the GLB was
 * authored in.
 */
export function bodyScale(spanModelUnits: number, assetHeight: number): number {
  return Math.max(spanModelUnits, 1e-6) / Math.max(assetHeight, 1e-9);
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
 * The valve opening at which the jet is treated as reaching the deflector.
 *
 * **Implementation behaviour, not source truth.** BEDO says only that the water "forms"
 * when the valve is opened and gives no startup curve, so this is the threshold the scene
 * has always used, kept at its existing value: below it the jet is still climbing and no
 * plume has formed, above it the water is striking the deflector. Moving it changes when
 * the spray appears and nothing else — no physics reads it.
 */
export const STARTUP_VALVE_OPENING = 0.22;
