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
import type { WaterShapeKey } from '../domain/apparatus';
import { MODEL_UNITS_PER_METRE } from './apparatusView';
import { DRAIN_CAPACITY_FRACTION } from './tankWater';

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
 * Select the one authored cache that represents the current water state.
 *
 * ## What the two shapes actually are (BEDO-WATER-05)
 *
 * `Jetforce_Storyboard.pptx` sl. 18 names them "water shape before impact" and "water shape
 * after impact", and the caches say what those mean far more precisely than the words do.
 * Playing each one against the measured apparatus (tank floor 1.08096, nozzle mouth 1.26176,
 * deflector underside 1.28455):
 *
 * | frame | `Water_low` y-span      | `Water90_Flat` y-span   |
 * |-------|-------------------------|-------------------------|
 * | 0     | 1.22874 .. 1.23790      | 1.25460 .. 1.26789      |
 * | 10    | 1.22874 .. 1.26354      | 1.25460 .. 1.27622      |
 * | 20    | 1.22874 .. **1.26520**  | 1.25460 .. **1.28170**  |
 * | 80    | 1.09046 .. 1.26527      | 1.06208 .. 1.28202      |
 *
 * Both emerge at the nozzle as a ~10 mm nub and climb. The plume's top reaches 1.28202 —
 * the deflector's underside — and then spreads to 168 mm across. `Water_low`'s top stops at
 * **1.26527, the nozzle mouth**, 19 mm short of the plate, and instead of spreading it falls:
 * its floor descends to 1.09046 and it flares to 51 mm.
 *
 * So `Water_low` is not a startup transient and not a thin jet in the mouth-to-plate gap. It
 * is **the low-flow state**: water that leaves the nozzle, never reaches the deflector, and
 * runs back down around the tube to pool on the floor. `docs/44` describes the same thing in
 * the reference recording — "55.5 - 65.5 s | Low flow. Tank **empty**, jet column only" —
 * and measures that column as 27 px at the deflector widening to 48-54 px below, a taper
 * that matches this silhouette.
 *
 * ## Why the old selector could never show it
 *
 * The condition was `impactVelocityMS > 0`, and `jetState` computes
 * `impactVelocityMS = sqrt(max(0, v0^2 - 2*g*s))` with `s = TRAVEL_HEIGHT_M`. That is zero
 * only while `v0 <= sqrt(2 * 9.81 * 0.035) = 0.8287 m/s`, i.e. while
 * `Q <= 0.8287 * NOZZLE_AREA_M2 = 3.90 L/min`, i.e. below **n = 0.0617**. The water is not
 * drawn at all until `n > 0.05`, so the pre-impact shape was reachable only inside a
 * 0.05..0.0617 sliver — 1.2 % of the valve's travel, below every setpoint the experiment
 * uses (`ROW_VALVE_SETTINGS` is 0.4 / 0.5 / 0.6). In practice it never rendered.
 *
 * The defect was that a *presentation* question — has the water reached the plate yet? — was
 * being answered by a *physics* scalar that asks something else: how fast would it be going
 * if it got there. Nothing about the physics is wrong; it was the wrong quantity to ask.
 *
 * ## What decides it now
 *
 * `DRAIN_CAPACITY_FRACTION`, which already exists and already draws exactly this line. It is
 * the presentation threshold `lib/tankWater.ts` calibrated against the same two reference
 * intervals: below it the tank stays empty (the 55.5-65.5 s low-flow window), above it the
 * tank fills (72.0-78.4 s). The recording shows the column in the first and the spread in
 * the second, so one number governs both halves of the same observation — and no new
 * threshold is invented here. Against the canonical setpoints:
 *
 *   n = 0.40  ->  Q/Q_total = 0.131  <=  0.178  ->  `Water_low`   (first reading)
 *   n = 0.50  ->  Q/Q_total = 0.225  >   0.178  ->  the deflector's plume (second reading)
 *   n = 0.60  ->  Q/Q_total = 0.362  >   0.178  ->  the deflector's plume
 *
 * The crossover sits at n = 0.4565, so the column now owns the lower half of the valve's
 * travel rather than a sliver of it.
 *
 * This is presentation mapping only. It reads the flow the domain already computed and
 * writes nothing back: no equation, pump curve, valve semantic or state-machine rule is
 * touched, and `impactVelocityMS` keeps its meaning and its consumers.
 */
export const waterShapeForFlow = (
  inflowFraction: number,
  deflectorShape: WaterShapeKey
): WaterShapeKey =>
  inflowFraction > DRAIN_CAPACITY_FRACTION ? deflectorShape : JET_ASSET;
