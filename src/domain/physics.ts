// Jet-force physics for the VL-FM009 apparatus.
//
// This lived twice — once in App.tsx and once in DeviceModel.tsx — and both copies
// carried the same typo. Keep it in one place so the HUD, the 3D pointer and the
// monitor table can never disagree.
//
// Verified cell-by-cell against BEDO's `Jet force_Mathematical model.xlsx` (docs/13 §1)
// and pinned by tests/unit/physics.spec.ts. **No equation here may change without
// reference evidence that the current one is wrong** — that is the Phase 2 brief's rule,
// and the specs are how it is enforced.
//
// Field names carry their units; see ./units.ts for the convention.

import { getDeflector } from './apparatus';
import {
  gramsToNewtons,
  litresPerMinuteToM3PerSecond,
  newtonsToGrams,
  roundMassG,
} from './units';

/** Nozzle cross-section, 10 mm bore. */
export const NOZZLE_AREA_M2 = 0.0000785;
/** Gravitational acceleration. */
export const GRAVITY_MS2 = 9.81;
/** Distance the jet climbs from nozzle lip to deflector face. */
export const TRAVEL_HEIGHT_M = 0.035;
export const WATER_DENSITY_KG_M3 = 1000;
/** Pump delivery at full valve opening — BEDO's `QT` column. */
export const TOTAL_FLOW_L_MIN = 120;
/** Deflector spring rate. The xlsx `hW` column: 0.4905 N deflects 2.4525 mm. */
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
export const flowRateLMin = (n: number, pumpFlowLMin: number = TOTAL_FLOW_L_MIN): number =>
  Math.max(0, pumpFlowLMin * (-4.9138 * n ** 4 + 8.8783 * n ** 3 - 3.7629 * n ** 2 + 0.7265 * n));

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

/** The state of the jet at one valve setting, against one deflector. */
export interface JetState {
  flowRateLMin: number;
  flowRateM3S: number;
  /** Nozzle exit velocity, v0. */
  nozzleVelocityMS: number;
  /** Impact velocity at the deflector face, v. */
  impactVelocityMS: number;
  /** Theoretical jet force, F_th. */
  theoreticalForceN: number;
}

/**
 * One row of the results table: the jet state, what the student loaded, and what that
 * means. `computeRow` builds it; nothing mutates it.
 */
export interface RecordRow extends JetState {
  /** 0-based row index; the table displays index + 1. */
  index: number;
  /** Pump delivery this row was computed at, Q_total. */
  pumpFlowLMin: number;
  /** Valve opening n for this row, 0..1. */
  valveOpening: number;
  /** F_ac — the weight of what is on the tray. */
  measuredForceN: number;
  /** Spring travel under that weight, F_ac / k. */
  springDeflectionMm: number;
  /** The exact mass that balances the jet — unrounded. */
  balancingMassG: number;
  /** The same mass rounded to the nearest 10 g, as the student is shown it. */
  targetMassG: number;
  /** What the student has actually put on the tray. */
  loadedMassG: number;
  /** Whether the tray balances the jet, within BALANCE_TOLERANCE_G of the exact mass. */
  isBalanced: boolean;
  /** The individual weights on the tray, in grams. */
  loadedWeightsG: number[];
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
  valveOpening: number,
  deflectorId: number,
  pumpFlowLMin: number = TOTAL_FLOW_L_MIN
): JetState {
  const flow = flowRateLMin(valveOpening, pumpFlowLMin);
  const flowRateM3S = litresPerMinuteToM3PerSecond(flow);
  const nozzleVelocityMS = flowRateM3S / NOZZLE_AREA_M2;

  const impactVelocitySquared = Math.max(
    0,
    nozzleVelocityMS ** 2 - 2 * GRAVITY_MS2 * TRAVEL_HEIGHT_M
  );

  const { momentumFactor } = getDeflector(deflectorId);
  const theoreticalForceN =
    momentumFactor * WATER_DENSITY_KG_M3 * NOZZLE_AREA_M2 * impactVelocitySquared;

  return {
    flowRateLMin: flow,
    flowRateM3S,
    nozzleVelocityMS,
    impactVelocityMS: Math.sqrt(impactVelocitySquared),
    theoreticalForceN,
  };
}

/** Mass of weights that balances the jet at this setting, rounded to the nearest 10 g. */
export const targetMassG = (
  valveOpening: number,
  deflectorId: number,
  pumpFlowLMin: number = TOTAL_FLOW_L_MIN
): number =>
  roundMassG(
    newtonsToGrams(jetState(valveOpening, deflectorId, pumpFlowLMin).theoreticalForceN, GRAVITY_MS2)
  );

export function computeRow(
  index: number,
  valveOpening: number,
  deflectorId: number,
  loadedWeightsG: number[],
  pumpFlowLMin: number = TOTAL_FLOW_L_MIN
): RecordRow {
  const jet = jetState(valveOpening, deflectorId, pumpFlowLMin);

  const balancingMassG = newtonsToGrams(jet.theoreticalForceN, GRAVITY_MS2);
  const loadedMassG = loadedWeightsG.reduce((a, b) => a + b, 0);
  const measuredForceN = gramsToNewtons(loadedMassG, GRAVITY_MS2);

  return {
    index,
    pumpFlowLMin,
    valveOpening,
    ...jet,
    measuredForceN,
    // The spring rate is N/m and the display is millimetres.
    springDeflectionMm: (measuredForceN / SPRING_RATE_N_PER_M) * 1000,
    balancingMassG,
    targetMassG: roundMassG(balancingMassG),
    loadedMassG,
    isBalanced: Math.abs(loadedMassG - balancingMassG) <= BALANCE_TOLERANCE_G,
    loadedWeightsG,
  };
}
