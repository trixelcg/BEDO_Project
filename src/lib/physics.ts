// Jet-force physics for the VL-FM009 apparatus.
//
// This lived twice — once in App.tsx and once in DeviceModel.tsx — and both copies
// carried the same typo. Keep it in one place so the HUD, the 3D pointer and the
// monitor table can never disagree.

import type { RecordRow } from '../types/index';
import { getDeflector } from './apparatus';

/** Nozzle cross-section, 10 mm bore. */
export const NOZZLE_AREA_M2 = 0.0000785;
export const GRAVITY = 9.81;
/** Distance the jet climbs from nozzle lip to deflector face. */
export const TRAVEL_HEIGHT_M = 0.035;
export const WATER_DENSITY = 1000;
export const TOTAL_FLOW_L_MIN = 120;
export const SPRING_RATE_N_PER_M = 200;
/**
 * A reading counts as balanced within this margin of the exact balancing mass.
 *
 * Compared against the exact mass rather than the rounded display target: with the
 * old +/-30 g against a rounded target, an empty tray "balanced" any target under
 * 30 g, so the low-flow reading was already balanced before the student touched a
 * weight — and adding one made it worse.
 */
export const BALANCE_TOLERANCE_G = 10;

/**
 * Valve opening n (0..1) to volumetric flow. Verified against the reference
 * simulator: n = 0.5 gives 27.024 L/min, which is exactly the row it records.
 */
export const flowRateLMin = (n: number, qTotal: number = TOTAL_FLOW_L_MIN): number =>
  Math.max(0, qTotal * (-4.9138 * n ** 4 + 8.8783 * n ** 3 - 3.7629 * n ** 2 + 0.7265 * n));

/**
 * Valve opening for each row of the results table. Rows 1 and 2 are the two readings
 * the student takes (steps 6-7 and 8-9).
 *
 * The second reading sits at n = 0.5 because that reproduces the reference
 * simulator's recorded row exactly: Q = 27.024 L/min, v0 = 5.74, v = 5.679.
 * The old 0.2 / 0.4 pair put the first reading at a 12 g balancing mass, which no
 * combination of the available weights could reach.
 */
export const ROW_VALVE_SETTINGS = [0.0, 0.4, 0.5, 0.6];
export const FIRST_READING_VALVE = ROW_VALVE_SETTINGS[1];
export const SECOND_READING_VALVE = ROW_VALVE_SETTINGS[2];
/** The valve snaps to the setpoint once the student gets within this much of it. */
export const VALVE_SNAP_MARGIN = 0.02;

export interface JetState {
  flowRateQLMin: number;
  flowRateQM3: number;
  /** Nozzle exit velocity v0. */
  theoreticalVo: number;
  /** Impact velocity at the deflector face. */
  theoreticalV: number;
  /** Theoretical jet force (N). */
  fth: number;
}

/**
 * v = sqrt(v0^2 - 2*g*s), with s the travel height in metres.
 *
 * s enters linearly. The old code wrote `2 * g * Math.sqrt(0.035)`, subtracting
 * 3.67 instead of 0.69 — enough to drive v^2 negative at low flow, which clamped
 * the jet force to zero and made the balancing steps ask for 0 g of weights.
 * The reference simulator's own table confirms the linear form: it reports
 * v0 = 5.74 and v = 5.679, and sqrt(5.74^2 - 2*9.81*0.035) = 5.679.
 */
export function jetState(
  valveOpen: number,
  deflectorId: number,
  qTotal: number = TOTAL_FLOW_L_MIN
): JetState {
  const flowRateQLMin = flowRateLMin(valveOpen, qTotal);
  const flowRateQM3 = flowRateQLMin / 60000;
  const theoreticalVo = flowRateQM3 / NOZZLE_AREA_M2;

  const v2 = Math.max(0, theoreticalVo ** 2 - 2 * GRAVITY * TRAVEL_HEIGHT_M);

  const { factor } = getDeflector(deflectorId);
  const fth = factor * WATER_DENSITY * NOZZLE_AREA_M2 * v2;

  return {
    flowRateQLMin,
    flowRateQM3,
    theoreticalVo,
    theoreticalV: Math.sqrt(v2),
    fth,
  };
}

/** Mass of weights that balances the jet at this setting, rounded to the nearest 10 g. */
export const targetMassG = (
  valveOpen: number,
  deflectorId: number,
  qTotal: number = TOTAL_FLOW_L_MIN
): number => Math.round(((jetState(valveOpen, deflectorId, qTotal).fth / GRAVITY) * 1000) / 10) * 10;

export function computeRow(
  index: number,
  valveOpen: number,
  deflectorId: number,
  weights: number[],
  qTotal: number = TOTAL_FLOW_L_MIN
): RecordRow {
  const jet = jetState(valveOpen, deflectorId, qTotal);

  const mass = (jet.fth / GRAVITY) * 1000;
  const idealMass = Math.round(mass / 10) * 10;

  const actualWeightMass = weights.reduce((a, b) => a + b, 0);
  const weightsN = (actualWeightMass * GRAVITY) / 1000;
  const springhW = (weightsN / SPRING_RATE_N_PER_M) * 1000;

  return {
    index,
    totalFlowValue: qTotal,
    valveOpen,
    ...jet,
    weightsN,
    springhW,
    mass,
    idealMass,
    actualWeightMass,
    balanced: Math.abs(actualWeightMass - mass) <= BALANCE_TOLERANCE_G,
    loadedWeights: weights,
  };
}
