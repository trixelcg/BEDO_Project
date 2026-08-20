/**
 * The deflector spring.
 *
 * ## The specification
 *
 * From BEDO's storyboard, `Jetforce_Storyboard.pptx` slide 8, which tabulates the spring
 * as three equations against one game object ("Deflector spring"):
 *
 *   h_w = F_ac / k          "If hw ≥ hF the deflector spring moves downward.
 *                             The spring will not exceed the cover or holder surface."
 *   h_F = F_th / k          "If hF ≥ hw, The deflector spring moves upward.
 *                             The spring will not exceed the cover or holder surface."
 *   X   = h_F − h_w         "If hF ≤ hw, The X = 0 and the deflector spring will not move.
 *                             The spring will not exceed the cover or holder surface."
 *
 * and slide 19, on the same object: *"According to the equation of X = h_F − h_w, the
 * deflector spring moves downward when the weights are placed on the holder and moves
 * upward when the weights are removed from it."*
 *
 * So X is the **net upward displacement from rest**, and it has a floor: when the weights
 * outweigh the jet, X is zero and the spring sits at rest. It does not travel below it.
 * Adding weights reduces X — that is the "moves downward" of slide 19 — until X reaches
 * zero and stops.
 *
 * ## The spring rate
 *
 * `Jet force_Mathematical model.xlsx`, sheet 1, column X ("h = F / k (stifness)") is
 * literally `=W4/200*1000` over a force column in newtons, tabulating 2.4525 for 0.4905 N.
 * That is k = 200 N/m with the result expressed in **millimetres**, and it is the same
 * relation `computeRow` already uses for the `springDeflectionMm` it reports as h_w.
 *
 * The storyboard writes the divisor as `(200×100)`, which does not reproduce its own
 * spreadsheet's tabulated values; the spreadsheet's formula and figures are taken as
 * authoritative. See `docs/31 §3`.
 *
 * ## The upper bound
 *
 * "The spring will not exceed the cover or holder surface" is a **geometric** constraint,
 * not a number, and no BEDO source gives one. So this module does not invent one: the
 * travel limit is a parameter, supplied by the caller from the measured model. See
 * `src/lib/apparatusView.ts`.
 */

import { SPRING_RATE_N_PER_M } from './physics';

/**
 * `h = F / k`, in millimetres — the displacement a force of `forceN` alone would produce.
 *
 * Storyboard sl. 8 calls this h_w when the force is F_ac and h_F when it is F_th.
 */
export const springHeightMm = (forceN: number, rateNPerM: number = SPRING_RATE_N_PER_M): number =>
  (forceN / rateNPerM) * 1000;

/**
 * `X = h_F − h_w`, clamped to the physically reachable range.
 *
 * @param jetForceN     F_th, the jet pushing the deflector up.
 * @param weightForceN  F_ac, the weight on the holder pulling it down.
 * @param maxTravelMm   How far the spring may rise before it meets the surface above it.
 *                      Measured from the model by the scene layer — the domain has no
 *                      geometry.
 * @returns             Net upward displacement from rest, in millimetres. Never negative.
 *
 * Positional rather than an options object: this is read once per rendered frame, and a
 * fresh object sixty times a second is a cost with no reader.
 */
export function springDeflectionMm(
  jetForceN: number,
  weightForceN: number,
  maxTravelMm: number,
  rateNPerM: number = SPRING_RATE_N_PER_M
): number {
  const heightFromJetMm = springHeightMm(jetForceN, rateNPerM);
  const heightFromWeightsMm = springHeightMm(weightForceN, rateNPerM);

  // Storyboard sl. 8: "If hF ≤ hw, The X = 0 and the deflector spring will not move."
  const netMm = heightFromJetMm - heightFromWeightsMm;
  if (!(netMm > 0)) return 0;

  // "The spring will not exceed the cover or holder surface."
  const limitMm = maxTravelMm > 0 ? maxTravelMm : 0;
  return netMm < limitMm ? netMm : limitMm;
}
