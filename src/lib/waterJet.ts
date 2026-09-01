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
 * Its silhouette *is* the visible water body. Nothing scales it to anything — see
 * `WATER_MODEL_SCALE`.
 */
export const JET_ASSET = 'low' as const;

// --- The visible body is not the bore -------------------------------------------------
//
// Two separate concepts, and only one of them is physics:
//
//   * **physical bore** — `NOZZLE_DIAMETER_M`, derived from `NOZZLE_AREA_M2`. Feeds the
//     force, velocity and momentum equations. Unchanged, and still asserted at 10.00 mm.
//   * **visible body** — BEDO's authored Alembic silhouette, drawn at the size and place it
//     was authored at. Presentation only; no equation reads it.
//
// BEDO-017 collapsed the two, scaling the rendered water to the 10 mm bore, which drew an
// invisible thread. Later attempts sized it from the deflector or the tank instead. All of
// them were solving a problem that did not exist: the artwork already knows how big it is.

/**
 * The whole water transform: authored centimetres to model metres (BEDO-UX-18).
 *
 * ## The caches were already in the rig's coordinate system
 *
 * Every previous attempt at this measured each shape and fitted it — stand it upright if it
 * looks like it is lying down, re-centre it on its own origin, scale it to the deflector or
 * to the span. All of that was unnecessary, and it is what kept producing water that was the
 * wrong width or in the wrong place.
 *
 * Reading the **full node transform chain** out of the eight GLBs — not just the mesh node,
 * which is what earlier measurements got wrong — every shape centres on the same point:
 *
 *   Water_low  x 1.0002  z -22.9383      Water90_Flat   x 1.0105  z -22.9285
 *   Water30    x 1.0251  z -22.9227      Water120_Hemi  x 1.0115  z -22.9366
 *   Water45    x 1.0090  z -22.9303      Water135_Con   x 1.0243  z -22.9284
 *   Water60    x 1.0232  z -22.9308      Water180_Hemi  x 1.0099  z -22.9285
 *
 * The apparatus puts the nozzle, the tank and the deflector all on one axis at
 * (0.0101, -0.2293). Dividing gives 0.010000 from z on all eight shapes, to five decimal
 * places. They were authored in **centimetres, in the rig's own space**, so the model
 * position they belong at is the position they already have.
 *
 * At this scale, measured against the apparatus (tank floor 1.0581, deflector underside
 * 1.2889, bore 181 mm): the jet is 51 mm across, and the seven plumes are 109-170 mm — every
 * one of them inside the tank, each sitting on the floor and reaching the deflector. Nothing
 * needs fitting because nothing was ever out of place.
 *
 * So there is no `bodyScale`, no `plumeScale`, no `PLUME_SPREAD` and no measured `waterFit`
 * any more. There is this number, and it is not a tuning knob: it is a unit conversion.
 */
export const WATER_MODEL_SCALE = 0.01;


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
