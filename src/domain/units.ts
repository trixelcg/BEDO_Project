/**
 * The unit vocabulary of the BEDO domain.
 *
 * Every physical quantity in this layer carries its unit in its **name**, because that is
 * the only place a reader — or a reviewer — reliably sees it. The rig's own reference
 * simulator shows why: its monitor prints `Total Weight  0.45 gm  × g = 4.414 N`, where
 * the value is plainly kilograms and the label says grams. The arithmetic is right and the
 * label is wrong, and nothing in the code could have caught it.
 *
 * ## The convention
 *
 * A suffix names the unit the number is **stored in**, not the SI unit it would ideally be:
 *
 * | Suffix | Unit | Example |
 * |---|---|---|
 * | `G` | grams | `loadedMassG` |
 * | `Kg` | kilograms | — |
 * | `N` | newtons | `theoreticalForceN` |
 * | `Mm` | millimetres | `springDeflectionMm` |
 * | `M` | metres | `TRAVEL_HEIGHT_M` |
 * | `M2` | square metres | `NOZZLE_AREA_M2` |
 * | `MS` | metres per second | `impactVelocityMS` |
 * | `MS2` | metres per second squared | `GRAVITY_MS2` |
 * | `LMin` | litres per minute | `flowRateLMin` |
 * | `M3S` | cubic metres per second | `flowRateM3S` |
 * | `KgM3` | kilograms per cubic metre | `WATER_DENSITY_KG_M3` |
 * | `Rad` / `Deg` | radians / degrees | — |
 *
 * Dimensionless quantities carry no suffix: `valveOpening` (0..1), `momentumFactor`, `index`.
 *
 * **A rename never converts.** `mass` became `balancingMassG` and still holds grams; it did
 * not silently become kilograms. Changing a representation is a separate, migrated change.
 */

/** A point or vector in model space. Three numbers, no rendering library attached. */
export type Vec3 = readonly [number, number, number];

/** Litres per minute to cubic metres per second. */
export const litresPerMinuteToM3PerSecond = (flowRateLMin: number): number =>
  flowRateLMin / 60000;

/** Grams to newtons of weight, at the given gravitational acceleration. */
export const gramsToNewtons = (massG: number, gravityMS2: number): number =>
  (massG * gravityMS2) / 1000;

/** Newtons of weight back to the grams that would produce it. */
export const newtonsToGrams = (forceN: number, gravityMS2: number): number =>
  (forceN / gravityMS2) * 1000;

/** Rounds a mass to the nearest step, in grams — the tray is stocked in multiples of 10 g. */
export const roundMassG = (massG: number, stepG = 10): number =>
  Math.round(massG / stepG) * stepG;
