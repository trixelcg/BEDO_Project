import { describe, expect, it } from 'vitest';
import { selectLiveReadout } from '../../src/simulation/selectors';
import { createInitialSimulationState } from '../../src/simulation/state';
import { GRAVITY_MS2, flowRateLMin, jetState } from '../../src/domain/physics';
import { getDeflector } from '../../src/domain/apparatus';

/**
 * The live half of the software board (BEDO-UX-12).
 *
 * The results table is computed at the four fixed openings the procedure records at, so it
 * cannot answer "what is the rig doing right now" — and before this the board had no field
 * that could. `selectLiveReadout` is that answer, and the point of these tests is that it
 * is *derived*: every number must equal what the domain function already returns, so the
 * board can never drift from the calculation it is displaying.
 */

const withState = (
  over: Partial<ReturnType<typeof createInitialSimulationState>['apparatus']> = {}
) => {
  const base = createInitialSimulationState();
  return { ...base, apparatus: { ...base.apparatus, ...over } };
};

describe('the live readout', () => {
  it('reports the valve opening the learner is actually holding', () => {
    expect(selectLiveReadout(withState({ valveOpening: 0.35 })).valveOpening).toBe(0.35);
  });

  // The two flow figures BEDO-UX-12 states explicitly.
  it('reports ~12.0 L/min at a valve opening of 0.35', () => {
    expect(selectLiveReadout(withState({ valveOpening: 0.35 })).flowRateLMin).toBeCloseTo(12.0, 1);
  });

  it('reports ~43.5 L/min at a valve opening of 0.60', () => {
    expect(selectLiveReadout(withState({ valveOpening: 0.6 })).flowRateLMin).toBeCloseTo(43.5, 1);
  });

  it('never recomputes the pump curve — it is the domain function', () => {
    for (const n of [0, 0.2, 0.35, 0.5, 0.6, 0.9, 1]) {
      expect(selectLiveReadout(withState({ valveOpening: n })).flowRateLMin).toBe(flowRateLMin(n));
    }
  });

  it('carries the same velocities and theoretical force as jetState', () => {
    const state = withState({ valveOpening: 0.6, selectedDeflectorId: 90 });
    const live = selectLiveReadout(state);
    const jet = jetState(0.6, 90);
    expect(live.nozzleVelocityMS).toBe(jet.nozzleVelocityMS);
    expect(live.impactVelocityMS).toBe(jet.impactVelocityMS);
    expect(live.theoreticalForceN).toBe(jet.theoreticalForceN);
    expect(live.flowRateM3S).toBe(jet.flowRateM3S);
  });

  it('follows the deflector on the rod, through its momentum factor', () => {
    const flat = selectLiveReadout(withState({ valveOpening: 0.6, selectedDeflectorId: 90 }));
    const conical = selectLiveReadout(withState({ valveOpening: 0.6, selectedDeflectorId: 135 }));
    // k = 1.000 for the flat plate, 1.707 for the 135° cone.
    expect(getDeflector(90).momentumFactor).toBe(1);
    expect(conical.theoreticalForceN / flat.theoreticalForceN).toBeCloseTo(
      getDeflector(135).momentumFactor,
      6
    );
  });

  it('follows the tray, not the results table', () => {
    expect(selectLiveReadout(withState({ loadedWeightsG: [] })).loadedMassG).toBe(0);
    expect(selectLiveReadout(withState({ loadedWeightsG: [50] })).loadedMassG).toBe(50);
    expect(selectLiveReadout(withState({ loadedWeightsG: [50, 100] })).loadedMassG).toBe(150);
    expect(selectLiveReadout(withState({ loadedWeightsG: [50, 100, 20] })).loadedMassG).toBe(170);
  });

  it('reports m × g for what is on the tray', () => {
    const live = selectLiveReadout(withState({ loadedWeightsG: [50, 100] }));
    expect(live.measuredForceN).toBeCloseTo((150 * GRAVITY_MS2) / 1000, 9);
  });

  it('is zero-flow with the valve shut, rather than undefined', () => {
    const live = selectLiveReadout(withState({ valveOpening: 0 }));
    expect(live.flowRateLMin).toBe(0);
    expect(live.nozzleVelocityMS).toBe(0);
    expect(live.impactVelocityMS).toBe(0);
    expect(live.theoreticalForceN).toBe(0);
  });
});
