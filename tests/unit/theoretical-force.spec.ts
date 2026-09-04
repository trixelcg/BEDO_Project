import { describe, expect, it } from 'vitest';
import {
  GRAVITY_MS2,
  NOZZLE_AREA_M2,
  TRAVEL_HEIGHT_M,
  WATER_DENSITY_KG_M3,
  computeTheoreticalForce,
} from '../../src/domain/physics';
import { DEFLECTORS, momentumFactorFor } from '../../src/domain/apparatus';
import { PHYSICS_MODEL } from '../../src/domain/physicsConfig';
import { MOMENTUM_FACTORS, REFERENCE_FORCES_N } from '../fixtures/bedo-reference';

/**
 * `computeTheoreticalForce` — the one function every printed force goes through.
 *
 * Both formulations are tested against the figures the brief tabulates, at its stated
 * tolerance of 1e-3, so flipping `PHYSICS_MODEL` is a decision with evidence on both sides
 * rather than a leap.
 */

/** The brief's reference table, plus the legacy column BEDO's spreadsheet carries. */
const TABLE = [
  { flowRateLMin: 15.714, vNozzle: 3.336, vImpact: 3.232, legacy: 0.8199, momentum: 0.8465 },
  { flowRateLMin: 27.024, vNozzle: 5.738, vImpact: 5.677, legacy: 2.5303, momentum: 2.5568 },
];

const TOLERANCE = 1e-3;

describe('the flat plate against the brief’s reference table', () => {
  it.each(TABLE)('Q = $flowRateLMin L/min gives the tabulated velocities', (row) => {
    const jet = computeTheoreticalForce({ flowRateLMin: row.flowRateLMin, momentumFactor: 1 });
    expect(jet.nozzleVelocityMS).toBeCloseTo(row.vNozzle, 3);
    expect(jet.impactVelocityMS).toBeCloseTo(row.vImpact, 3);
  });

  it.each(TABLE)('Q = $flowRateLMin L/min gives F_th = $momentum N under momentumFlux', (row) => {
    const { theoreticalForceN } = computeTheoreticalForce({
      flowRateLMin: row.flowRateLMin,
      momentumFactor: 1,
      model: 'momentumFlux',
    });
    expect(Math.abs(theoreticalForceN - row.momentum)).toBeLessThanOrEqual(TOLERANCE);
  });

  it.each(TABLE)('Q = $flowRateLMin L/min gives F_th = $legacy N under legacyAV2', (row) => {
    const { theoreticalForceN } = computeTheoreticalForce({
      flowRateLMin: row.flowRateLMin,
      momentumFactor: 1,
      model: 'legacyAV2',
    });
    expect(Math.abs(theoreticalForceN - row.legacy)).toBeLessThanOrEqual(TOLERANCE);
  });
});

describe('the two models', () => {
  it('ship with legacyAV2, the form BEDO’s spreadsheet tabulates', () => {
    expect(PHYSICS_MODEL).toBe('legacyAV2');
    const shipped = computeTheoreticalForce({ flowRateLMin: 15.7144704, momentumFactor: 1 });
    // 0.819924835 N, the `Fth` column at n = 0.4, to seven figures.
    expect(shipped.theoreticalForceN).toBeCloseTo(REFERENCE_FORCES_N[90], 8);
    expect(shipped.model).toBe('legacyAV2');
  });

  it('differ by exactly V_nozzle / V_impact', () => {
    // The whole of the disagreement, stated as an identity: the legacy form multiplies the
    // momentum flux by the nozzle's area rather than the jet's area at the vane.
    for (const flowRateLMin of [5, 15.7144704, 27.024, 40]) {
      const a = computeTheoreticalForce({ flowRateLMin, momentumFactor: 1, model: 'legacyAV2' });
      const b = computeTheoreticalForce({ flowRateLMin, momentumFactor: 1, model: 'momentumFlux' });
      expect(a.theoreticalForceN / b.theoreticalForceN).toBeCloseTo(
        a.impactVelocityMS / a.nozzleVelocityMS,
        9
      );
      // The legacy form is always the smaller of the two, because the jet has slowed.
      expect(a.theoreticalForceN).toBeLessThan(b.theoreticalForceN);
    }
  });

  it('converge as the climb costs proportionally less velocity', () => {
    const gap = (flowRateLMin: number) => {
      const a = computeTheoreticalForce({ flowRateLMin, momentumFactor: 1, model: 'legacyAV2' });
      const b = computeTheoreticalForce({ flowRateLMin, momentumFactor: 1, model: 'momentumFlux' });
      return (b.theoreticalForceN - a.theoreticalForceN) / b.theoreticalForceN;
    };
    expect(gap(15.7144704)).toBeCloseTo(0.0314, 3); // 3.1 % at the first reading
    expect(gap(27.024)).toBeCloseTo(0.0107, 3); //     1.1 % at the second
    expect(gap(200)).toBeLessThan(0.0002); //          vanishing in a fast jet
  });

  it('agree exactly when there is no climb', () => {
    const shared = { flowRateLMin: 20, momentumFactor: 1, travelHeightM: 0 };
    const a = computeTheoreticalForce({ ...shared, model: 'legacyAV2' });
    const b = computeTheoreticalForce({ ...shared, model: 'momentumFlux' });
    expect(a.theoreticalForceN).toBeCloseTo(b.theoreticalForceN, 12);
  });
});

describe('the function’s own arithmetic', () => {
  it('reports the mass flow as rho Q, in both models', () => {
    for (const model of ['legacyAV2', 'momentumFlux'] as const) {
      const jet = computeTheoreticalForce({ flowRateLMin: 27.024, momentumFactor: 1, model });
      expect(jet.massFlowKgS).toBeCloseTo(WATER_DENSITY_KG_M3 * (27.024 / 60000), 12);
    }
  });

  it('defaults the nozzle to BEDO’s tabulated area, and takes a bore when given one', () => {
    expect(computeTheoreticalForce({ flowRateLMin: 20, momentumFactor: 1 }).nozzleAreaM2).toBe(
      NOZZLE_AREA_M2
    );
    // pi (d/2)^2 for a 10 mm bore is 7.853982e-5 — 0.05 % from the sheet's 7.85e-5, which
    // is why the area rather than the bore is the default.
    const fromBore = computeTheoreticalForce({
      flowRateLMin: 20,
      momentumFactor: 1,
      nozzleDiameterM: 0.01,
    });
    expect(fromBore.nozzleAreaM2).toBeCloseTo(Math.PI * 0.005 ** 2, 12);
    expect(fromBore.nozzleAreaM2 / NOZZLE_AREA_M2).toBeCloseTo(1.0005, 4);
  });

  it('scales linearly with k, whichever model is in force', () => {
    for (const model of ['legacyAV2', 'momentumFlux'] as const) {
      const unit = computeTheoreticalForce({ flowRateLMin: 27.024, momentumFactor: 1, model });
      for (const k of [0.25, 0.5, 1.5, 2]) {
        const scaled = computeTheoreticalForce({ flowRateLMin: 27.024, momentumFactor: k, model });
        expect(scaled.theoreticalForceN / unit.theoreticalForceN).toBeCloseTo(k, 12);
      }
    }
  });

  it('clamps a jet that cannot climb to the vane, rather than going imaginary', () => {
    // 2 g s is 0.6867 m²/s², so anything below 0.829 m/s at the nozzle falls back.
    const jet = computeTheoreticalForce({ flowRateLMin: 2, momentumFactor: 1 });
    expect(jet.nozzleVelocityMS).toBeGreaterThan(0);
    expect(jet.nozzleVelocityMS ** 2).toBeLessThan(2 * GRAVITY_MS2 * TRAVEL_HEIGHT_M);
    expect(jet.impactVelocityMS).toBe(0);
    expect(jet.theoreticalForceN).toBe(0);
  });

  it('treats a negative flow as no flow', () => {
    const jet = computeTheoreticalForce({ flowRateLMin: -10, momentumFactor: 1 });
    expect(jet.flowRateM3S).toBe(0);
    expect(jet.theoreticalForceN).toBe(0);
  });

  it('is pure: the same input always gives the same result', () => {
    const input = { flowRateLMin: 27.024, momentumFactor: 1.707 };
    expect(computeTheoreticalForce(input)).toEqual(computeTheoreticalForce(input));
  });
});

describe('momentum factors are computed from each family’s own law', () => {
  it('gives every deflector on the tray the factor its family’s law implies', () => {
    for (const deflector of DEFLECTORS) {
      expect(deflector.momentumFactor, `${deflector.id}°`).toBe(
        momentumFactorFor(deflector.family, deflector.id)
      );
      expect(deflector.momentumFactor).toBeCloseTo(MOMENTUM_FACTORS[deflector.id], 3);
    }
  });

  it('uses sin²θ for the oblique family and 1 − cos θ for the rest', () => {
    for (const angle of [30, 45, 60]) {
      expect(momentumFactorFor('oblique', angle)).toBeCloseTo(
        Math.sin((angle * Math.PI) / 180) ** 2,
        3
      );
    }
    for (const angle of [120, 180]) {
      expect(momentumFactorFor('semi', angle)).toBeCloseTo(
        1 - Math.cos((angle * Math.PI) / 180),
        3
      );
    }
    expect(momentumFactorFor('conical', 135)).toBeCloseTo(1.707, 3);
    expect(momentumFactorFor('flat', 90)).toBe(1);
  });

  it('does not generalise 1 − cos θ across the oblique family', () => {
    // The brief's generalisation, and what it would cost: nearly a factor of two at 30°.
    for (const angle of [30, 45, 60]) {
      const oneMinusCos = 1 - Math.cos((angle * Math.PI) / 180);
      expect(momentumFactorFor('oblique', angle)).not.toBeCloseTo(oneMinusCos, 2);
    }
    expect(1 - Math.cos((30 * Math.PI) / 180)).toBeCloseTo(0.134, 3);
    expect(momentumFactorFor('oblique', 30)).toBe(0.25);
  });
});
