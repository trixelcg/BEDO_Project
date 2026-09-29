/**
 * The experiment's adjustable inputs — what the Parameters panel edits (F09).
 *
 * Two, and only two, are student inputs rather than parts of the rig:
 *
 *   Q_total          the pump's delivery at full valve (`physics.ts` `flowRateLMin`)
 *   custom weight    the mass of the one extra disc on the tray, beside the six fixed ones
 *
 * Everything else a learner changes — cover, pump, valve, deflector, the discs on the
 * carrier — is the apparatus, and goes through the state machine. Both inputs live in the
 * simulation runtime's state, so there is one value of each and every surface reads that
 * one.
 */

import { WEIGHTS } from './apparatus';
import { TOTAL_FLOW_L_MIN } from './physics';

export interface ParameterRange {
  min: number;
  max: number;
  step: number;
}

/** Q_total the panel offers, L/min. The reference value, 120, sits inside it. */
export const PUMP_FLOW_RANGE_L_MIN: ParameterRange = { min: 20, max: 200, step: 5 };
export const DEFAULT_PUMP_FLOW_L_MIN = TOTAL_FLOW_L_MIN;

/** The custom disc's mass, g. */
export const CUSTOM_WEIGHT_RANGE_G: ParameterRange = { min: 5, max: 495, step: 5 };
export const DEFAULT_CUSTOM_WEIGHT_G = 25;

/** A mass one of the six tray discs already has. */
export const isFixedDenomination = (grams: number): boolean =>
  WEIGHTS.some((w) => w.grams === grams);

const onGrid = (value: number, range: ParameterRange): boolean =>
  Number.isFinite(value) &&
  value >= range.min &&
  value <= range.max &&
  Math.abs((value - range.min) / range.step - Math.round((value - range.min) / range.step)) < 1e-9;

export const isValidPumpFlowLMin = (value: number): boolean => onGrid(value, PUMP_FLOW_RANGE_L_MIN);

/**
 * A mass the custom disc may be given.
 *
 * Never one of the fixed denominations. The custom disc is a disc of its own: the carrier
 * lists what is on it by mass, so a custom disc at 20 g could not be told from the 20 g
 * disc — and then changing the custom mass could not say which disc to change. Skipping
 * those six values keeps "the one mass on the carrier that is not a tray denomination" and
 * "the custom disc" the same thing, always.
 */
export const isValidCustomWeightG = (grams: number): boolean =>
  onGrid(grams, CUSTOM_WEIGHT_RANGE_G) && !isFixedDenomination(grams);

/** Every mass the custom disc may take, in order — the slider's stops. */
export const CUSTOM_WEIGHT_CHOICES_G: readonly number[] = (() => {
  const out: number[] = [];
  const { min, max, step } = CUSTOM_WEIGHT_RANGE_G;
  for (let g = min; g <= max + 1e-9; g += step) {
    const grams = Math.round(g * 1000) / 1000;
    if (isValidCustomWeightG(grams)) out.push(grams);
  }
  return Object.freeze(out);
})();
