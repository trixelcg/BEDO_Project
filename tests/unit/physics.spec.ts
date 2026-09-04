import { describe, expect, it } from 'vitest';
import {
  BALANCE_TOLERANCE_FLOOR_G,
  BALANCE_TOLERANCE_FRACTION,
  balanceDeviation,
  balanceToleranceG,
  FIRST_READING_VALVE,
  GRAVITY_MS2,
  NOZZLE_AREA_M2,
  READING_FLOWS_L_MIN,
  bedoPolynomialFlowLMin,
  computeTheoreticalForce,
  powerLawFlowLMin,
  valveOpeningFor,
  SECOND_READING_VALVE,
  SPRING_RATE_N_PER_M,
  TOTAL_FLOW_L_MIN,
  TRAVEL_HEIGHT_M,
  VALVE_SNAP_MARGIN,
  WATER_DENSITY_KG_M3,
  computeRow,
  flowRateLMin,
  jetState,
  targetMassG,
} from '../../src/domain/physics';
import { DEFLECTORS, getDeflector } from '../../src/domain/apparatus';
import {
  FLOW_CHARACTERISTIC,
  PUMP_MAX_FLOW_L_MIN,
  VALVE_EXPONENT,
} from '../../src/domain/physicsConfig';
import {
  F_OBSERVED_FLAT_N,
  MOMENTUM_FACTORS,
  REFERENCE_FORCES_N,
  REFERENCE_Q_TOTAL,
  REFERENCE_ROWS,
  SECOND_READING_Q_L_MIN,
  SECOND_READING_VALVE_N,
  SECOND_READING_V0_DISPLAYED,
  SECOND_READING_V_FROM_DISPLAYED_V0,
} from '../fixtures/bedo-reference';

/**
 * Physics regression suite (BEDO-002 §2).
 *
 * BEDO's mathematical model is authoritative: every expected value here comes from
 * `tests/fixtures/bedo-reference.ts`, never from running the implementation. If one of
 * these fails after an edit to `src/lib/physics.ts`, the edit is wrong until the
 * spreadsheet says otherwise — that is the whole point of the file.
 *
 * Tolerances
 *  - flow rates      1e-6 absolute. The polynomial is exact arithmetic; anything larger
 *                    would hide a transcription error.
 *  - velocities      1e-4 absolute, the precision the reference table is printed to.
 *  - forces          1e-4 *relative*. BEDO's own Fth column carries sheet rounding —
 *                    its 120 deg row implies a factor of 1.50006 rather than 1.5
 *                    (`docs/13 §1.4`) — so an absolute tolerance would fail on their
 *                    rounding rather than on our arithmetic. The exact relationships
 *                    (factor ratios, the Fo - Fth identity) are pinned exactly below.
 */

const FLOW_TOLERANCE = 6;
const VELOCITY_TOLERANCE = 4;
const FORCE_RELATIVE_TOLERANCE = 1e-4;

const expectRelativeClose = (actual: number, expected: number, tolerance: number) => {
  const relative = Math.abs(actual - expected) / Math.abs(expected);
  expect(
    relative,
    `expected ${actual} to be within ${tolerance} relative of ${expected} (was ${relative.toExponential(2)})`
  ).toBeLessThanOrEqual(tolerance);
};

describe('constants', () => {
  it('pins every constant BEDO fixes in the reference material', () => {
    expect(NOZZLE_AREA_M2).toBe(0.0000785);
    expect(GRAVITY_MS2).toBe(9.81);
    expect(TRAVEL_HEIGHT_M).toBe(0.035);
    expect(WATER_DENSITY_KG_M3).toBe(1000);
    expect(TOTAL_FLOW_L_MIN).toBe(40);
    expect(SPRING_RATE_N_PER_M).toBe(200);
  });

  it('nozzle area is the area of the 10 mm bore', () => {
    // A = pi r^2 for r = 5 mm is 7.853982e-5; the sheet carries it to three figures.
    expect(NOZZLE_AREA_M2).toBeCloseTo(Math.PI * 0.005 ** 2, 7);
  });

  it('spring rate reproduces the xlsx hW column: 0.4905 N deflects 2.4525 mm', () => {
    expect((0.4905 / SPRING_RATE_N_PER_M) * 1000).toBeCloseTo(2.4525, 9);
  });

  it('balance tolerance is 2 % of the exact mass, floored at half the smallest disc', () => {
    expect(BALANCE_TOLERANCE_FRACTION).toBe(0.02);
    expect(BALANCE_TOLERANCE_FLOOR_G).toBe(5);
    // The floor binds at the first reading and the fraction binds at the second.
    expect(balanceToleranceG(83.5804)).toBeCloseTo(5, 9);
    expect(balanceToleranceG(257.9307)).toBeCloseTo(5.158614, 6);
  });

  it('a strict 2 % would make the first reading unreachable with the stocked weights', () => {
    // Why the floor exists, stated as a fact rather than left in a comment: the tray is
    // stocked in 10 g steps, so 80 g and 90 g are the only loads either side of 83.58 g,
    // and both are further than 2 % away.
    const exact = 83.5804;
    const strict = BALANCE_TOLERANCE_FRACTION * exact;
    expect(Math.abs(80 - exact)).toBeGreaterThan(strict);
    expect(Math.abs(90 - exact)).toBeGreaterThan(strict);
    // With the floor, exactly one of them is reachable.
    expect(balanceDeviation(80, exact).isBalanced).toBe(true);
    expect(balanceDeviation(90, exact).isBalanced).toBe(false);
  });

  it('reports the deviation signed, so the panel can say add or remove', () => {
    expect(balanceDeviation(70, 83.5804).deviationG).toBeCloseTo(-13.5804, 4);
    expect(balanceDeviation(100, 83.5804).deviationG).toBeCloseTo(16.4196, 4);
    expect(balanceDeviation(100, 83.5804).deviationFraction).toBeCloseTo(0.196453, 6);
  });

  it('never reports a rig at rest as balanced', () => {
    // 0 g on the tray against a jet asking for 0 g is arithmetically inside any window,
    // and calling it balanced is what let a reading be taken before the pump delivered.
    const rest = balanceDeviation(0, 0);
    expect(rest.deviationG).toBe(0);
    expect(rest.deviationFraction).toBe(0);
    expect(rest.isBalanced).toBe(false);
  });

  it('pins the two reading flows and derives their valve openings', () => {
    // A reading is the flow it records. The openings follow from the shipped
    // characteristic, so re-rating the pump moves them and leaves the figures alone.
    expect(READING_FLOWS_L_MIN).toEqual([15.7144704, 27.024]);
    expect(flowRateLMin(FIRST_READING_VALVE)).toBeCloseTo(15.7144704, 6);
    expect(flowRateLMin(SECOND_READING_VALVE)).toBeCloseTo(27.024, 6);
    // On the shipped power law at Q_max = 40.
    expect(FIRST_READING_VALVE).toBeCloseTo(0.53641, 5);
    expect(SECOND_READING_VALVE).toBeCloseTo(0.76995, 5);
    expect(VALVE_SNAP_MARGIN).toBe(0.02);
  });

  it('caps the pump within what the weights on the tray can balance', () => {
    // The reason Q_max moved from 120 to 40: a fully open valve has to be balanceable.
    // At 120 L/min it puts 51 N on the vane — 5.2 kg against a tray stocked to 500 g.
    const wideOpen = jetState(1, 90).theoreticalForceN;
    expect(PUMP_MAX_FLOW_L_MIN).toBe(40);
    expect(wideOpen).toBeCloseTo(5.6078, 3);
    expect((wideOpen / GRAVITY_MS2) * 1000).toBeLessThan(880); // reachable with the discs
  });
});

describe('BEDO’s reference valve characteristic', () => {
  // Their quartic, still exact and still checked against their own table. It is no longer
  // the shipped curve — see `physicsConfig.FLOW_CHARACTERISTIC` — but it remains the
  // evidence that this implementation reads their model correctly.
  it.each(REFERENCE_ROWS)(
    'reproduces the BEDO row n=$n as $q L/min',
    ({ n, q }) => {
      expect(bedoPolynomialFlowLMin(n, REFERENCE_Q_TOTAL)).toBeCloseTo(q, FLOW_TOLERANCE);
    }
  );

  it('reproduces the reference simulator row at n = 0.5', () => {
    expect(bedoPolynomialFlowLMin(SECOND_READING_VALVE_N, REFERENCE_Q_TOTAL)).toBeCloseTo(
      SECOND_READING_Q_L_MIN,
      FLOW_TOLERANCE
    );
  });

  it('is the curve the smooth one replaces, and says why', () => {
    // 40 % to 50 % is a 72 % jump in flow across a tenth of the valve's travel. That is
    // the disorienting step the power law removes.
    const at40 = bedoPolynomialFlowLMin(0.4, REFERENCE_Q_TOTAL);
    const at50 = bedoPolynomialFlowLMin(0.5, REFERENCE_Q_TOTAL);
    expect((at50 - at40) / at40).toBeGreaterThan(0.7);
  });
});

describe('flow rate Q(n)', () => {
  it('is the configured characteristic', () => {
    expect(FLOW_CHARACTERISTIC).toBe('powerLaw');
    expect(VALVE_EXPONENT).toBe(1.5);
    expect(flowRateLMin(0.5)).toBe(powerLawFlowLMin(0.5, TOTAL_FLOW_L_MIN));
  });

  it('is Q_max n^1.5, exactly', () => {
    for (const n of [0.1, 0.25, 0.5, 0.75, 1]) {
      expect(flowRateLMin(n, 40)).toBeCloseTo(40 * n ** 1.5, 9);
    }
    expect(flowRateLMin(1)).toBe(TOTAL_FLOW_L_MIN);
  });

  it('rises no faster than a tenth of the range per tenth of a turn, anywhere', () => {
    // The property the quartic breaks. The steepest tenth of the power law is the last one.
    let steepest = 0;
    for (let n = 0; n < 1; n += 0.1) {
      const step = flowRateLMin(n + 0.1) - flowRateLMin(n);
      steepest = Math.max(steepest, step / TOTAL_FLOW_L_MIN);
    }
    expect(steepest).toBeLessThan(0.16);
  });

  it('defaults Q_total to the configured pump maximum', () => {
    expect(flowRateLMin(0.4)).toBe(flowRateLMin(0.4, TOTAL_FLOW_L_MIN));
    expect(TOTAL_FLOW_L_MIN).toBe(PUMP_MAX_FLOW_L_MIN);
  });

  it('scales linearly with Q_total', () => {
    for (const n of [0.2, 0.4, 0.6, 0.8, 1.0]) {
      expect(flowRateLMin(n, 80)).toBeCloseTo(2 * flowRateLMin(n, 40), 9);
      expect(flowRateLMin(n, 20)).toBeCloseTo(0.5 * flowRateLMin(n, 40), 9);
    }
  });

  it('is non-decreasing across the whole valve travel', () => {
    let previous = -1;
    for (let n = 0; n <= 1.0000001; n += 0.001) {
      const q = flowRateLMin(n);
      expect(q, `Q decreased at n=${n.toFixed(3)}`).toBeGreaterThanOrEqual(previous);
      previous = q;
    }
  });

  it('never returns a negative flow', () => {
    expect(flowRateLMin(-0.5)).toBe(0);
    expect(flowRateLMin(0)).toBe(0);
  });

  it('inverts: the opening for a flow delivers that flow', () => {
    for (const q of [1, 5, 15.7144704, 27.024, 39.9]) {
      expect(flowRateLMin(valveOpeningFor(q))).toBeCloseTo(q, 9);
    }
    expect(valveOpeningFor(0)).toBe(0);
    expect(valveOpeningFor(1000)).toBe(1); // clamped: the pump has a maximum
  });
});

describe('velocities', () => {
  it.each(REFERENCE_ROWS)('reproduces v0 and v for the BEDO row n=$n', ({ n, v0, v }) => {
    // Driven by the flow their row carries rather than by their valve opening: the
    // velocities are functions of Q, and Q is what their table fixes.
    const jet = computeTheoreticalForce({
      flowRateLMin: bedoPolynomialFlowLMin(n, REFERENCE_Q_TOTAL),
      momentumFactor: 1,
    });
    expect(jet.nozzleVelocityMS).toBeCloseTo(v0, VELOCITY_TOLERANCE);
    expect(jet.impactVelocityMS).toBeCloseTo(v, VELOCITY_TOLERANCE);
  });

  it('applies v = sqrt(v0^2 - 2gs) with s linear, not sqrt(s)', () => {
    // The regression this pins: `2 * g * Math.sqrt(s)` subtracts 3.67 instead of 0.687,
    // which drives v^2 negative at low flow and clamps the jet force to zero.
    for (const { n, v0, v } of REFERENCE_ROWS) {
      if (n === 0) continue;
      const expected = Math.sqrt(v0 ** 2 - 2 * GRAVITY_MS2 * TRAVEL_HEIGHT_M);
      expect(expected).toBeCloseTo(v, VELOCITY_TOLERANCE);
    }
  });

  it('matches the reference simulator row at n = 0.5', () => {
    const state = jetState(
      valveOpeningFor(SECOND_READING_Q_L_MIN),
      90
    );
    // The simulator prints v0 to two decimals...
    expect(state.nozzleVelocityMS).toBeCloseTo(SECOND_READING_V0_DISPLAYED, 2);
    // ...and both derivations agree with its printed v to the precision it is printed
    // at. Squaring the displayed v0 gives 5.6799; carrying full precision, as this
    // implementation does, gives 5.6774. The reference row reads 5.679, which is why the
    // agreement is only claimed to two decimals.
    expect(
      Math.sqrt(SECOND_READING_V0_DISPLAYED ** 2 - 2 * GRAVITY_MS2 * TRAVEL_HEIGHT_M)
    ).toBeCloseTo(SECOND_READING_V_FROM_DISPLAYED_V0, 2);
    expect(state.impactVelocityMS).toBeCloseTo(SECOND_READING_V_FROM_DISPLAYED_V0, 2);
    // The implementation's own value, pinned exactly.
    expect(state.impactVelocityMS).toBeCloseTo(5.677421, 5);
  });

  it('v0 is Q/A, with Q converted from L/min to m3/s', () => {
    const state = jetState(0.4, 90, REFERENCE_Q_TOTAL);
    expect(state.flowRateM3S).toBeCloseTo(state.flowRateLMin / 60000, 12);
    expect(state.nozzleVelocityMS).toBeCloseTo(state.flowRateM3S / NOZZLE_AREA_M2, 9);
  });

  it('clamps v to zero rather than going imaginary below the travel height', () => {
    // At n = 0.05 the jet leaves at 0.71 m/s and cannot climb the 35 mm to the face.
    const state = jetState(0.05, 90);
    expect(state.nozzleVelocityMS).toBeGreaterThan(0);
    expect(state.nozzleVelocityMS ** 2).toBeLessThan(2 * GRAVITY_MS2 * TRAVEL_HEIGHT_M);
    expect(state.impactVelocityMS).toBe(0);
    expect(state.theoreticalForceN).toBe(0);
    expect(Number.isNaN(state.impactVelocityMS)).toBe(false);
  });
});

describe('momentum factors', () => {
  it.each(Object.entries(MOMENTUM_FACTORS))(
    'deflector %s deg carries factor %s',
    (angle, factor) => {
      expect(getDeflector(Number(angle)).momentumFactor).toBeCloseTo(factor, 3);
    }
  );

  it('covers every deflector on the tray, and no others', () => {
    expect(DEFLECTORS.map((d) => d.id).sort((a, b) => a - b)).toEqual(
      Object.keys(MOMENTUM_FACTORS).map(Number).sort((a, b) => a - b)
    );
  });

  it('does not generalise 1 - cos(theta) to the oblique family', () => {
    // 1 - cos would give 0.134 / 0.293 / 0.5 instead of 0.25 / 0.5 / 0.75.
    for (const angle of [30, 45, 60]) {
      const oneMinusCos = 1 - Math.cos((angle * Math.PI) / 180);
      expect(getDeflector(angle).momentumFactor).not.toBeCloseTo(oneMinusCos, 2);
      expect(getDeflector(angle).momentumFactor).toBeCloseTo(
        Math.sin((angle * Math.PI) / 180) ** 2,
        3
      );
    }
  });
});

describe('theoretical force F_th', () => {
  it.each(Object.entries(REFERENCE_FORCES_N))(
    'reproduces BEDO F_th for the %s deg deflector at n = 0.4',
    (angle, expected) => {
      const { theoreticalForceN } = jetState(FIRST_READING_VALVE, Number(angle));
      expectRelativeClose(theoreticalForceN, expected, FORCE_RELATIVE_TOLERANCE);
    }
  );

  it('is exactly factor x rho x A x v^2', () => {
    for (const deflector of DEFLECTORS) {
      const state = jetState(FIRST_READING_VALVE, deflector.id);
      expect(state.theoreticalForceN).toBeCloseTo(
        deflector.momentumFactor * WATER_DENSITY_KG_M3 * NOZZLE_AREA_M2 * state.impactVelocityMS ** 2,
        12
      );
    }
  });

  it('ratios to the flat plate are the momentum factors, exactly', () => {
    const flat = jetState(FIRST_READING_VALVE, 90).theoreticalForceN;
    for (const [angle, factor] of Object.entries(MOMENTUM_FACTORS)) {
      const theoreticalForceN = jetState(FIRST_READING_VALVE, Number(angle)).theoreticalForceN;
      expect(theoreticalForceN / flat).toBeCloseTo(factor, 9);
    }
  });

  it('scales with v^2: doubling the velocity quadruples the force', () => {
    const a = jetState(FIRST_READING_VALVE, 90);
    const b = jetState(FIRST_READING_VALVE, 90, TOTAL_FLOW_L_MIN * 2);
    expect(b.nozzleVelocityMS / a.nozzleVelocityMS).toBeCloseTo(2, 9);
    expect(b.theoreticalForceN / a.theoreticalForceN).toBeCloseTo((b.impactVelocityMS / a.impactVelocityMS) ** 2, 9);
  });

  it('falls back to the flat deflector for an unknown id', () => {
    expect(jetState(0.4, 999).theoreticalForceN).toBe(jetState(0.4, 90).theoreticalForceN);
  });
});

describe('observed force F_o', () => {
  it('is rho x A x v0^2, and exceeds F_th by exactly rho x A x 2gs', () => {
    // BEDO's sheet carries both columns; the constant 0.05390595 N gap between them is
    // what proves the 2gs form is linear. `docs/13 §1.5`.
    const state = jetState(FIRST_READING_VALVE, 90);
    const observed = WATER_DENSITY_KG_M3 * NOZZLE_AREA_M2 * state.nozzleVelocityMS ** 2;

    expectRelativeClose(observed, F_OBSERVED_FLAT_N, FORCE_RELATIVE_TOLERANCE);
    expect(observed - state.theoreticalForceN).toBeCloseTo(
      WATER_DENSITY_KG_M3 * NOZZLE_AREA_M2 * 2 * GRAVITY_MS2 * TRAVEL_HEIGHT_M,
      9
    );
    expect(F_OBSERVED_FLAT_N - REFERENCE_FORCES_N[90]).toBeCloseTo(0.05390595, 8);
  });
});

describe('balancing mass', () => {
  it('is F_th / g, in grams, rounded to the nearest 10', () => {
    for (const n of [0, FIRST_READING_VALVE, SECOND_READING_VALVE, 0.9]) {
      const exact = (jetState(n, 90).theoreticalForceN / GRAVITY_MS2) * 1000;
      expect(targetMassG(n, 90)).toBe(Math.round(exact / 10) * 10);
      expect(targetMassG(n, 90) % 10).toBe(0);
    }
  });

  it('is reachable from the weight set at both reading settings', () => {
    // The pair of readings the guided lesson takes: 83.6 g and 257.9 g.
    expect(targetMassG(FIRST_READING_VALVE, 90)).toBe(80);
    expect(targetMassG(SECOND_READING_VALVE, 90)).toBe(260);
  });
});

describe('computeRow', () => {
  const row = (weights: number[], n = FIRST_READING_VALVE) => computeRow(1, n, 90, weights);

  it('carries the jet state and the row inputs through unchanged', () => {
    const jet = jetState(FIRST_READING_VALVE, 90);
    const r = row([50, 20, 10]);
    expect(r.index).toBe(1);
    expect(r.valveOpening).toBe(FIRST_READING_VALVE);
    expect(r.pumpFlowLMin).toBe(TOTAL_FLOW_L_MIN);
    expect(r.flowRateLMin).toBe(jet.flowRateLMin);
    expect(r.nozzleVelocityMS).toBe(jet.nozzleVelocityMS);
    expect(r.impactVelocityMS).toBe(jet.impactVelocityMS);
    expect(r.theoreticalForceN).toBe(jet.theoreticalForceN);
    expect(r.loadedWeightsG).toEqual([50, 20, 10]);
  });

  it('records F_ac as the loaded mass x g', () => {
    expect(row([50, 20, 10]).measuredForceN).toBeCloseTo((80 * GRAVITY_MS2) / 1000, 12);
    expect(row([]).measuredForceN).toBe(0);
  });

  it('records spring deflection as F_ac / k, in millimetres', () => {
    const r = row([50, 20, 10]);
    expect(r.springDeflectionMm).toBeCloseTo((r.measuredForceN / SPRING_RATE_N_PER_M) * 1000, 12);
    expect(r.springDeflectionMm).toBeCloseTo(3.924, 3);
  });

  it('reports the exact balancing mass and the displayed 10 g target separately', () => {
    const r = row([]);
    expect(r.balancingMassG).toBeCloseTo(83.5804, 3);
    expect(r.targetMassG).toBe(80);
  });

  it('balances against the exact mass, not the rounded target', () => {
    // Exact mass 83.5804 g; the window is the 5 g floor, so 78.58 - 88.58 g.
    expect(row([]).isBalanced).toBe(false);
    expect(row([50, 20, 10]).isBalanced).toBe(true); // 80 g, 3.6 g from exact
    expect(row([50, 20, 20]).isBalanced).toBe(false); // 90 g, 6.4 g from exact
    expect(row([50, 50]).isBalanced).toBe(false); // 100 g, 16.4 g from exact
    expect(row([50, 20]).isBalanced).toBe(false); // 70 g, 13.6 g from exact
  });

  it('balances the second reading at 260 g and rejects 250 g', () => {
    // Exact mass 257.9307 g, window +/-5.159 g: 252.77 - 263.09 g. 250 g used to pass
    // against a flat 10 g window while the panel still displayed "target 260 g" — the
    // defect this replaces.
    expect(row([200, 50, 10], SECOND_READING_VALVE).isBalanced).toBe(true); // 260 g
    expect(row([200, 50], SECOND_READING_VALVE).isBalanced).toBe(false); // 250 g
    expect(row([200, 20, 10], SECOND_READING_VALVE).isBalanced).toBe(false); // 230 g
    expect(row([200], SECOND_READING_VALVE).isBalanced).toBe(false); // 200 g
    expect(row([], SECOND_READING_VALVE).balancingMassG).toBeCloseTo(257.9307, 3);
  });

  it('carries the signed deviation onto the row the panel renders', () => {
    const r = row([50, 20]); // 70 g against 83.5804 g
    expect(r.deviationG).toBeCloseTo(-13.5805, 3);
    expect(r.deviationFraction).toBeCloseTo(-0.1624842, 6);
    expect(r.toleranceG).toBeCloseTo(5, 9);
  });

  it('treats the closed-valve row as a zero row', () => {
    const r = computeRow(0, 0, 90, []);
    expect(r.flowRateLMin).toBe(0);
    expect(r.nozzleVelocityMS).toBe(0);
    expect(r.impactVelocityMS).toBe(0);
    expect(r.theoreticalForceN).toBe(0);
    expect(r.targetMassG).toBe(0);
    // A shut valve asks for nothing, and nothing is not a balanced reading.
    expect(r.isBalanced).toBe(false);
  });

  it('is deterministic: the same inputs give the same row', () => {
    expect(row([50, 20, 10])).toEqual(row([50, 20, 10]));
  });
});
