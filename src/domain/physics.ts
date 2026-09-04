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
  FLOW_CHARACTERISTIC,
  PHYSICS_MODEL,
  PUMP_MAX_FLOW_L_MIN,
  VALVE_EXPONENT,
  type PhysicsModel,
} from './physicsConfig';
import {
  gramsToNewtons,
  litresPerMinuteToM3PerSecond,
  newtonsToGrams,
  roundMassG,
} from './units';

/** Nozzle bore. */
export const NOZZLE_DIAMETER_M = 0.01;
/**
 * Nozzle cross-section, 10 mm bore.
 *
 * BEDO's sheets carry it to three figures (pi r^2 for r = 5 mm is 7.853982e-5), and every
 * tabulated figure in their model is computed from this rounded value — so it stays as
 * written rather than being recomputed from the diameter.
 */
export const NOZZLE_AREA_M2 = 0.0000785;
/** Gravitational acceleration. */
export const GRAVITY_MS2 = 9.81;
/** Distance the jet climbs from nozzle lip to deflector face. */
export const TRAVEL_HEIGHT_M = 0.035;
export const WATER_DENSITY_KG_M3 = 1000;
/**
 * Pump delivery at a fully open valve — BEDO's `QT` column, re-rated.
 *
 * Was 120 L/min, the reference simulator's figure. See `physicsConfig.PUMP_MAX_FLOW_L_MIN`
 * for why a bench of this size cannot be delivering that.
 */
export const TOTAL_FLOW_L_MIN = PUMP_MAX_FLOW_L_MIN;

/** The pump delivery BEDO's reference table is tabulated at. Used only to reproduce it. */
export const BEDO_REFERENCE_FLOW_L_MIN = 120;
/** Deflector spring rate. The xlsx `hW` column: 0.4905 N deflects 2.4525 mm. */
export const SPRING_RATE_N_PER_M = 200;
/**
 * How close the tray has to be, as a fraction of the exact balancing mass.
 *
 * The brief asks for 2 %. Compared against the exact mass rather than the rounded display
 * target: with the old +/-30 g against a rounded target, an empty tray "balanced" any
 * target under 30 g, so the low-flow reading was already balanced before the student
 * touched a weight — and adding one made it worse.
 */
export const BALANCE_TOLERANCE_FRACTION = 0.02;

/**
 * The floor under that fraction, in grams — half the smallest stocked disc.
 *
 * Without it the first reading is **uncompletable**. Its exact balancing mass is 83.58 g,
 * so a strict 2 % is +/-1.67 g, and the tray is stocked in 10 g steps: the closest
 * reachable load is 80 g, 4.28 % away. A tolerance a student cannot satisfy with the
 * weights in front of them is a broken step, not a strict one.
 *
 * Half of `WEIGHTS`' smallest denomination is the smallest floor that guarantees at least
 * one reachable load for any target: every real number is within 5 g of a multiple of 10.
 * The second reading is unaffected — 2 % of 257.93 g is 5.16 g, already above the floor.
 */
export const BALANCE_TOLERANCE_FLOOR_G = 5;

/** The margin allowed at a given exact balancing mass, in grams. */
export const balanceToleranceG = (balancingMassG: number): number =>
  Math.max(BALANCE_TOLERANCE_FRACTION * Math.abs(balancingMassG), BALANCE_TOLERANCE_FLOOR_G);

/** How far the tray is from balancing the jet, and which way. */
export interface BalanceDeviation {
  /** loaded - required, in grams. Positive means too heavy; negative, too light. */
  readonly deviationG: number;
  /**
   * The same deviation as a fraction of the required mass.
   *
   * Zero when there is nothing to balance, rather than the infinity the division would
   * give: a shut valve is not "infinitely unbalanced", it is a rig at rest.
   */
  readonly deviationFraction: number;
  /** The margin this reading allows, in grams. */
  readonly toleranceG: number;
  readonly isBalanced: boolean;
}

/**
 * The signed deviation the panel shows, replacing a bare boolean.
 *
 * `isBalanced` is false whenever the jet is not asking for any mass at all. A shut valve
 * needs 0 g and an empty tray carries 0 g, which is arithmetically inside any tolerance —
 * and reporting that as "balanced" is what let a reading be taken before the pump was
 * even delivering.
 */
export function balanceDeviation(loadedMassG: number, balancingMassG: number): BalanceDeviation {
  const deviationG = loadedMassG - balancingMassG;
  const toleranceG = balanceToleranceG(balancingMassG);
  return {
    deviationG,
    deviationFraction: balancingMassG > 0 ? deviationG / balancingMassG : 0,
    toleranceG,
    isBalanced: balancingMassG > 0 && Math.abs(deviationG) <= toleranceG,
  };
}

/**
 * BEDO's reference valve characteristic — the quartic their simulator uses.
 *
 * Kept, exact, and still checked against `tests/fixtures/bedo-reference.ts`: at
 * Q_total = 120 it reproduces their whole n -> Q table, n = 0.5 giving the 27.024 L/min row
 * they record. It is selectable through `FLOW_CHARACTERISTIC`.
 */
export const bedoPolynomialFlowLMin = (n: number, pumpFlowLMin: number): number =>
  Math.max(0, pumpFlowLMin * (-4.9138 * n ** 4 + 8.8783 * n ** 3 - 3.7629 * n ** 2 + 0.7265 * n));

/** `Q = Q_max · n^exp` — the smooth characteristic, monotonic over the whole range. */
export const powerLawFlowLMin = (n: number, pumpFlowLMin: number): number =>
  pumpFlowLMin * Math.max(0, Math.min(1, n)) ** VALVE_EXPONENT;

/**
 * Valve opening n (0..1) to volumetric flow.
 *
 * Which curve is in force is `FLOW_CHARACTERISTIC`'s decision, and both are pinned. The
 * default is the power law: BEDO's quartic puts 40 % at 15.7 L/min and 50 % at 27.0 L/min,
 * a 72 % jump across a tenth of the valve's travel.
 */
export const flowRateLMin = (n: number, pumpFlowLMin: number = TOTAL_FLOW_L_MIN): number =>
  FLOW_CHARACTERISTIC === 'bedoPolynomial'
    ? bedoPolynomialFlowLMin(n, pumpFlowLMin)
    : powerLawFlowLMin(n, pumpFlowLMin);

/**
 * The valve opening that delivers a given flow — the inverse of the power law.
 *
 * This is how the two reading setpoints are derived rather than written down: a reading is
 * defined by the flow it records, so re-rating the pump moves the opening and leaves the
 * recorded figures where the worksheets expect them.
 */
export const valveOpeningFor = (
  targetFlowLMin: number,
  pumpFlowLMin: number = TOTAL_FLOW_L_MIN
): number => {
  if (!(pumpFlowLMin > 0) || targetFlowLMin <= 0) return 0;
  if (FLOW_CHARACTERISTIC === 'bedoPolynomial') {
    // The quartic has no closed-form inverse worth writing; a bisection over a monotonic
    // stretch is exact enough for a setpoint the valve then snaps to.
    let low = 0;
    let high = 1;
    for (let i = 0; i < 60; i += 1) {
      const mid = (low + high) / 2;
      if (bedoPolynomialFlowLMin(mid, pumpFlowLMin) < targetFlowLMin) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }
  return Math.min(1, (targetFlowLMin / pumpFlowLMin) ** (1 / VALVE_EXPONENT));
};

/**
 * The two flows the procedure records at, in L/min.
 *
 * A reading is defined by the flow it measures, not by a position on a valve. These are
 * the figures BEDO's reference simulator records and the worksheets are printed with, and
 * they stay put when the pump is re-rated — the *opening* moves instead.
 */
export const READING_FLOWS_L_MIN = [15.7144704, 27.024] as const;

/**
 * Valve openings for the two readings, derived from the flows above.
 *
 * They were `ROW_VALVE_SETTINGS[1]` and `[2]` — 0.4 and 0.5 on BEDO's quartic at
 * Q_total = 120. That array also generated the results table, which is where the monitor's
 * zero row and its untaken 43.457 L/min row came from; nothing generates rows now, and
 * these are simply where the two flow steps settle the valve. On the shipped power law at
 * Q_max = 40 they come out at 0.536 and 0.770.
 */
export const FIRST_READING_VALVE = valveOpeningFor(READING_FLOWS_L_MIN[0]);
export const SECOND_READING_VALVE = valveOpeningFor(READING_FLOWS_L_MIN[1]);

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
  /** Whether the tray balances the jet, within `balanceToleranceG` of the exact mass. */
  isBalanced: boolean;
  /** loaded - required, in grams. Positive means too heavy. */
  deviationG: number;
  /** The same deviation as a fraction of the required mass. */
  deviationFraction: number;
  /** The margin this row allows, in grams. */
  toleranceG: number;
  /** The individual weights on the tray, in grams. */
  loadedWeightsG: number[];
}

/**
 * The jet at one valve setting, against one deflector.
 *
 * A thin adapter over `computeTheoreticalForce`: it turns a valve opening into a flow and
 * a deflector id into a momentum factor, and the equations live in one place below.
 *
 * On the travel height: s enters linearly. The old code wrote `2 * g * Math.sqrt(0.035)`,
 * subtracting 3.67 instead of 0.69 — enough to drive v^2 negative at low flow, which
 * clamped the jet force to zero and made the balancing steps ask for 0 g of weights. The
 * reference simulator's own table confirms the linear form: it reports v0 = 5.74 and
 * v = 5.679, and sqrt(5.74^2 - 2*9.81*0.035) = 5.679.
 */
export function jetState(
  valveOpening: number,
  deflectorId: number,
  pumpFlowLMin: number = TOTAL_FLOW_L_MIN
): JetState {
  const flow = flowRateLMin(valveOpening, pumpFlowLMin);
  const { momentumFactor } = getDeflector(deflectorId);
  const jet = computeTheoreticalForce({ flowRateLMin: flow, momentumFactor });

  return {
    flowRateLMin: flow,
    flowRateM3S: jet.flowRateM3S,
    nozzleVelocityMS: jet.nozzleVelocityMS,
    impactVelocityMS: jet.impactVelocityMS,
    theoreticalForceN: jet.theoreticalForceN,
  };
}

/** Everything the theoretical force depends on. Defaults are this apparatus's. */
export interface TheoreticalForceInput {
  /** Volumetric flow through the nozzle, L/min. */
  flowRateLMin: number;
  /**
   * The deflector's momentum factor k, dimensionless.
   *
   * The brief writes this parameter as `theta`, with `k = 1 - cos(theta)`. It is taken as k
   * instead because that generalisation is wrong for three of the seven deflectors: BEDO's
   * oblique family derives `Fx = rho A V^2 sin^2(theta)`, giving 0.25 / 0.5 / 0.75 at
   * 30 / 45 / 60 degrees where `1 - cos` would give 0.134 / 0.293 / 0.5. The angle-to-k
   * step is `momentumFactorFor` in `./apparatus`, where each family's law is written out
   * with its source; this function takes the answer.
   */
  momentumFactor: number;
  /**
   * Nozzle cross-section, m². Defaults to `NOZZLE_AREA_M2`.
   *
   * The area is the parameter rather than the bore because BEDO's model tabulates
   * A = 7.85e-5 m² and computes every velocity and force from that rounded figure.
   * Recomputing pi (d/2)^2 from the 10 mm bore gives 7.853982e-5 — a 0.05 % difference,
   * which is small and is still five times the tolerance their table is pinned to.
   */
  nozzleAreaM2?: number;
  /** Nozzle bore, m. Used only when no area is given: A = pi (d/2)^2. */
  nozzleDiameterM?: number;
  /** Nozzle lip to vane face, m. */
  travelHeightM?: number;
  densityKgM3?: number;
  gravityMS2?: number;
  /** Which force law. Defaults to the configured `PHYSICS_MODEL`. */
  model?: PhysicsModel;
}

export interface TheoreticalForce {
  flowRateM3S: number;
  nozzleAreaM2: number;
  /** V_nozzle = Q / A. */
  nozzleVelocityMS: number;
  /** V_impact = sqrt(V_nozzle^2 - 2 g s), floored at zero. */
  impactVelocityMS: number;
  /** Mass flow, rho Q — constant along the jet, which is the point of the momentum form. */
  massFlowKgS: number;
  theoreticalForceN: number;
  model: PhysicsModel;
}

/**
 * The theoretical jet force, both formulations, one pure function.
 *
 * ```
 *   m_dot   = rho Q                          mass flow, constant
 *   V_nozzle = Q / A                         A = pi (d/2)^2
 *   V_impact = sqrt(V_nozzle^2 - 2 g s)      s = nozzle-to-vane rise
 *
 *   momentumFlux   F_th = k rho Q V_impact
 *   legacyAV2      F_th = k rho A V_impact^2
 * ```
 *
 * The two differ by exactly `V_nozzle / V_impact`: the legacy form multiplies the momentum
 * flux by the nozzle's own area, which is the jet's area only if it has not widened on the
 * way up. Continuity says it has. They therefore agree in the limit of a tall, fast jet and
 * diverge at low flow, where the 35 mm climb costs proportionally more velocity — 3.2 % at
 * the first reading, 1.1 % at the second.
 *
 * Which one ships is `PHYSICS_MODEL`'s decision, and `physicsConfig.ts` says why the
 * default is the legacy form. Everything that prints a force — the target-mass hint, the
 * board, the monitor, the table, the chart, the report — reaches it through here.
 */
export function computeTheoreticalForce(input: TheoreticalForceInput): TheoreticalForce {
  const {
    flowRateLMin: flow,
    momentumFactor,
    travelHeightM = TRAVEL_HEIGHT_M,
    densityKgM3 = WATER_DENSITY_KG_M3,
    gravityMS2 = GRAVITY_MS2,
    model = PHYSICS_MODEL,
  } = input;

  const nozzleAreaM2 =
    input.nozzleAreaM2 ??
    (input.nozzleDiameterM !== undefined
      ? Math.PI * (input.nozzleDiameterM / 2) ** 2
      : NOZZLE_AREA_M2);

  const flowRateM3S = litresPerMinuteToM3PerSecond(Math.max(0, flow));
  const nozzleVelocityMS = nozzleAreaM2 > 0 ? flowRateM3S / nozzleAreaM2 : 0;

  // Negative under the root means the jet does not reach the vane at all: the clamp is the
  // physical statement that it falls back, not a numerical guard.
  const impactVelocityMS = Math.sqrt(
    Math.max(0, nozzleVelocityMS ** 2 - 2 * gravityMS2 * travelHeightM)
  );

  const massFlowKgS = densityKgM3 * flowRateM3S;
  const theoreticalForceN =
    model === 'momentumFlux'
      ? momentumFactor * massFlowKgS * impactVelocityMS
      : momentumFactor * densityKgM3 * nozzleAreaM2 * impactVelocityMS ** 2;

  return {
    flowRateM3S,
    nozzleAreaM2,
    nozzleVelocityMS,
    impactVelocityMS,
    massFlowKgS,
    theoreticalForceN,
    model,
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
  const balance = balanceDeviation(loadedMassG, balancingMassG);

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
    isBalanced: balance.isBalanced,
    deviationG: balance.deviationG,
    deviationFraction: balance.deviationFraction,
    toleranceG: balance.toleranceG,
    loadedWeightsG,
  };
}
