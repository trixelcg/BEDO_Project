import { FIRST_READING_VALVE, TOTAL_FLOW_L_MIN, SECOND_READING_VALVE } from '../../src/domain/physics';
import { describe, expect, it } from 'vitest';
import {
  gramsToNewtons,
  litresPerMinuteToM3PerSecond,
  newtonsToGrams,
  roundMassG,
} from '../../src/domain/units';
import {
  GRAVITY_MS2,
  NOZZLE_AREA_M2,
  SPRING_RATE_N_PER_M,
  computeRow,
  jetState,
} from '../../src/domain/physics';

/**
 * Unit semantics (BEDO-005 §15).
 *
 * BEDO-005 renamed the domain's fields so each one states the unit it is stored in. A
 * name only helps if it is true, so these check that the number behind each suffix is in
 * the unit the suffix claims — and, just as important, that the rename **converted
 * nothing**. `mass` became `balancingMassG` and is still grams; it did not quietly become
 * kilograms on the way.
 *
 * The rig's own reference simulator is the cautionary tale: its monitor prints
 * `Total Weight 0.45 gm × g = 4.414 N`, where 0.45 is plainly kilograms and the label
 * says grams. Right arithmetic, wrong label, nothing to catch it.
 */

describe('conversions', () => {
  it('L/min to m3/s divides by 60 000', () => {
    expect(litresPerMinuteToM3PerSecond(60000)).toBe(1);
    expect(litresPerMinuteToM3PerSecond(27.024)).toBeCloseTo(4.504e-4, 12);
    expect(litresPerMinuteToM3PerSecond(0)).toBe(0);
  });

  it('grams to newtons goes through kilograms', () => {
    // 1000 g weighs g newtons; a gram-to-newton conversion that forgot the /1000 would
    // be 1000x out and every balancing mass with it.
    expect(gramsToNewtons(1000, GRAVITY_MS2)).toBeCloseTo(GRAVITY_MS2, 12);
    expect(gramsToNewtons(80, 9.81)).toBeCloseTo(0.7848, 12);
    expect(gramsToNewtons(0, 9.81)).toBe(0);
  });

  it('newtons back to grams is the exact inverse', () => {
    for (const massG of [10, 80, 257.9307, 500]) {
      expect(newtonsToGrams(gramsToNewtons(massG, GRAVITY_MS2), GRAVITY_MS2)).toBeCloseTo(massG, 9);
    }
  });

  it('rounds a mass to the tray’s 10 g granularity', () => {
    expect(roundMassG(83.58)).toBe(80);
    expect(roundMassG(85)).toBe(90);
    expect(roundMassG(257.93)).toBe(260);
    expect(roundMassG(0)).toBe(0);
    expect(roundMassG(83.58, 50)).toBe(100);
  });
});

describe('the units a reading is stored in', () => {
  const row = computeRow(1, FIRST_READING_VALVE, 90, [50, 20, 10]);

  it('holds masses in grams, not kilograms', () => {
    // 80 g of weights. If any of these had been "helpfully" converted to kg during the
    // rename they would read 0.08, and every balance comparison would silently fail.
    expect(row.loadedMassG).toBe(80);
    expect(row.balancingMassG).toBeCloseTo(83.5804, 3);
    expect(row.targetMassG).toBe(80);
    expect(row.loadedWeightsG).toEqual([50, 20, 10]);
  });

  it('holds forces in newtons', () => {
    expect(row.measuredForceN).toBeCloseTo(0.7848, 6);
    expect(row.theoreticalForceN).toBeCloseTo(0.8199, 4);
    // A force in newtons, divided by g, is a mass in kilograms — times 1000, grams.
    expect((row.theoreticalForceN / GRAVITY_MS2) * 1000).toBeCloseTo(row.balancingMassG, 9);
  });

  it('holds spring deflection in millimetres', () => {
    // k is N/m, so F/k is metres; the field is millimetres and must be 1000x that.
    expect(row.springDeflectionMm).toBeCloseTo(
      (row.measuredForceN / SPRING_RATE_N_PER_M) * 1000,
      12
    );
    expect(row.springDeflectionMm).toBeCloseTo(3.924, 3);
    expect(row.springDeflectionMm / 1000).toBeCloseTo(row.measuredForceN / SPRING_RATE_N_PER_M, 12);
  });

  it('holds velocities in metres per second', () => {
    // v0 = Q/A with Q in m3/s and A in m2 gives m/s directly.
    expect(row.nozzleVelocityMS).toBeCloseTo(row.flowRateM3S / NOZZLE_AREA_M2, 9);
    expect(row.nozzleVelocityMS).toBeCloseTo(3.336, 3);
    expect(row.impactVelocityMS).toBeLessThan(row.nozzleVelocityMS);
  });

  it('holds the two flow rates in their two different units', () => {
    expect(row.flowRateLMin).toBeCloseTo(15.714, 3);
    expect(row.flowRateM3S).toBeCloseTo(row.flowRateLMin / 60000, 12);
    expect(row.pumpFlowLMin).toBe(TOTAL_FLOW_L_MIN);
  });

  it('keeps the valve opening dimensionless, 0 to 1', () => {
    expect(row.valveOpening).toBe(FIRST_READING_VALVE);
    expect(row.valveOpening).toBeGreaterThanOrEqual(0);
    expect(row.valveOpening).toBeLessThanOrEqual(1);
  });

  it('exposes the same jet quantities as jetState, under the same names', () => {
    // The reading extends the jet state; the two must not drift apart.
    const jet = jetState(FIRST_READING_VALVE, 90);
    expect(row.flowRateLMin).toBe(jet.flowRateLMin);
    expect(row.flowRateM3S).toBe(jet.flowRateM3S);
    expect(row.nozzleVelocityMS).toBe(jet.nozzleVelocityMS);
    expect(row.impactVelocityMS).toBe(jet.impactVelocityMS);
    expect(row.theoreticalForceN).toBe(jet.theoreticalForceN);
  });
});

describe('what the rename must not have done', () => {
  it('left every stored value in the unit it was already in', () => {
    // The pre-BEDO-005 field names and their values, as the BEDO-002 baseline pinned
    // them. Each assertion is the old name's value read through the new name.
    const row = computeRow(2, SECOND_READING_VALVE, 90, [200, 50, 10]);
    expect(row.loadedMassG).toBe(260); //  actualWeightMass, grams
    expect(row.balancingMassG).toBeCloseTo(257.9307, 3); //  mass, grams
    expect(row.targetMassG).toBe(260); //  idealMass, grams
    expect(row.measuredForceN).toBeCloseTo(2.5506, 4); //  weightsN, newtons
    expect(row.theoreticalForceN).toBeCloseTo(2.5303, 4); //  fth, newtons
    expect(row.springDeflectionMm).toBeCloseTo(12.753, 3); //  springhW, millimetres
    expect(row.pumpFlowLMin).toBe(TOTAL_FLOW_L_MIN); //  totalFlowValue, L/min
    expect(row.valveOpening).toBe(SECOND_READING_VALVE); //  valveOpen, dimensionless
  });
});
