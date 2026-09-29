/**
 * The deflector spring.
 *
 * ## F05 — below rest, down to a mechanical stop
 *
 * QA (F05) supersedes the floor below. The pointer is a fixed reference at the carrier's
 * rest height, and the carrier must move *towards* it as the load changes — from above it
 * while the jet wins, and from below it while the load wins. A floor at rest drew an
 * overloaded pan exactly on the pointer, which is what a balanced pan looks like: 580 g
 * against an 80 g jet read as balanced (measured 2026-09-28).
 *
 * So the displacement is signed, X = h_F − h_w, and bounded on both sides:
 *
 *   * **up** by the travel above the spring — the storyboard's "will not exceed the cover
 *     or holder surface" (`maxTravelMm`, unchanged);
 *   * **down** by the carrier's mechanical stop (`maxCompressionMm`): the lesser of the
 *     spring's working compression and the travel left before the deflector comes within
 *     the minimum safe clearance of the nozzle. Measured and set by the scene
 *     (`lib/carrierTravel.ts`); the domain has no geometry. Past the stop, more load moves
 *     nothing.
 *
 * `maxCompressionMm` defaults to 0, which is exactly the storyboard's floor — every caller
 * that does not pass it keeps the BEDO-007 behaviour described next.
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
 * @param jetForceN         F_th, the jet pushing the deflector up.
 * @param weightForceN      F_ac, the weight on the holder pulling it down.
 * @param maxTravelMm       How far the spring may rise before it meets the surface above
 *                          it. Measured from the model by the scene layer — the domain has
 *                          no geometry.
 * @param maxCompressionMm  How far the carrier may go *below* rest before its mechanical
 *                          stop (F05). 0 — the default — is the storyboard's floor.
 * @returns                 Net displacement from rest, in millimetres: positive up,
 *                          negative down, never past either limit.
 *
 * Positional rather than an options object: this is read once per rendered frame, and a
 * fresh object sixty times a second is a cost with no reader.
 */
export function springDeflectionMm(
  jetForceN: number,
  weightForceN: number,
  maxTravelMm: number,
  maxCompressionMm: number = 0,
  rateNPerM: number = SPRING_RATE_N_PER_M
): number {
  const heightFromJetMm = springHeightMm(jetForceN, rateNPerM);
  const heightFromWeightsMm = springHeightMm(weightForceN, rateNPerM);
  const netMm = heightFromJetMm - heightFromWeightsMm;

  // Below rest: down to the mechanical stop, and no further (F05). With no allowance this
  // is storyboard sl. 8's "If hF ≤ hw, The X = 0 and the deflector spring will not move."
  if (!(netMm > 0)) {
    const stopMm = maxCompressionMm > 0 ? maxCompressionMm : 0;
    if (!(netMm < 0) || stopMm === 0) return 0;
    return netMm > -stopMm ? netMm : -stopMm;
  }

  // "The spring will not exceed the cover or holder surface."
  const limitMm = maxTravelMm > 0 ? maxTravelMm : 0;
  return netMm < limitMm ? netMm : limitMm;
}
