import { describe, expect, it } from 'vitest';
import {
  CAPACITY_L,
  SETTLING_VOLUME_L,
  advance,
  dump,
  emptyMeasurement,
  flowErrorPercent,
  gaugeFraction,
  isSettled,
  measuredFlowLMin,
  secondsToFill,
  startCollecting,
} from '../../src/domain/volumetric';
import { READING_FLOWS_L_MIN } from '../../src/domain/physics';

/**
 * The volumetric measuring tank.
 *
 * The arithmetic has no free parameters — `Q = ΔV / Δt` is a definition — so what is
 * tested here is that a timed fill recovers the flow it was filled at, and that the edges
 * (no time, no flow, a full tank, a dumped tank) each behave as a measurement rather than
 * as a number.
 */

/** Runs a collection for `seconds` at a steady flow, one frame at 60 Hz. */
const collect = (flowLMin: number, seconds: number) => {
  let m = startCollecting();
  const step = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += step) m = advance(m, flowLMin, step);
  return m;
};

describe('a timed fill recovers the flow it was filled at', () => {
  it.each(READING_FLOWS_L_MIN)('recovers %s L/min to within a thousandth', (flowLMin) => {
    const m = collect(flowLMin, 10);
    expect(m.elapsedS).toBeCloseTo(10, 6);
    expect(m.volumeL).toBeCloseTo((flowLMin * 10) / 60, 6);
    expect(measuredFlowLMin(m)).toBeCloseTo(flowLMin, 3);
  });

  it('reports no error against the flowmeter it was filled from', () => {
    const m = collect(READING_FLOWS_L_MIN[1], 8);
    expect(flowErrorPercent(measuredFlowLMin(m), READING_FLOWS_L_MIN[1])).toBeCloseTo(0, 6);
  });

  it('reports a signed error when the two disagree', () => {
    // 10 % fast and 10 % slow, so the panel can say which way.
    expect(flowErrorPercent(22, 20)).toBeCloseTo(10, 9);
    expect(flowErrorPercent(18, 20)).toBeCloseTo(-10, 9);
    expect(flowErrorPercent(20, 0)).toBe(0);
  });
});

describe('the clock and the tank', () => {
  it('collects nothing until the dump valve is shut', () => {
    const idle = emptyMeasurement();
    expect(idle.isCollecting).toBe(false);
    // Time passes and the pump runs; nothing accumulates, because the valve is open.
    expect(advance(idle, 27, 5)).toBe(idle);
  });

  it('starts every collection from zero', () => {
    const m = advance(startCollecting(), 27, 5);
    expect(m.volumeL).toBeGreaterThan(0);
    const fresh = startCollecting();
    expect(fresh.volumeL).toBe(0);
    expect(fresh.elapsedS).toBe(0);
  });

  it('empties the tank and stops the clock when the valve is opened', () => {
    const running = collect(27, 5);
    expect(running.volumeL).toBeGreaterThan(0);
    const dumped = dump();
    expect(dumped.volumeL).toBe(0);
    expect(dumped.elapsedS).toBe(0);
    expect(dumped.isCollecting).toBe(false);
  });

  it('stops the clock when the tank fills, so the reading cannot decay', () => {
    // A measurement that kept timing past the top graduation would report a flow that fell
    // as the seconds ran on — the reading would be wrong in a way that looks like physics.
    const full = collect(60, 20); // 60 L/min fills 7 L in 7 s
    expect(full.isFull).toBe(true);
    expect(full.volumeL).toBe(CAPACITY_L);
    const settled = measuredFlowLMin(full);

    const later = advance(full, 60, 30);
    expect(later).toBe(full);
    expect(measuredFlowLMin(later)).toBe(settled);
  });

  it('never overfills', () => {
    expect(collect(200, 60).volumeL).toBe(CAPACITY_L);
  });

  it('accumulates nothing while the pump is off', () => {
    const m = collect(0, 10);
    expect(m.volumeL).toBe(0);
    expect(m.elapsedS).toBeCloseTo(10, 6);
    // No volume in ten seconds is a flow of zero, not a division by zero.
    expect(measuredFlowLMin(m)).toBe(0);
  });

  it('reports zero rather than infinity before any time has passed', () => {
    expect(measuredFlowLMin(startCollecting())).toBe(0);
  });

  it('ignores a zero or backwards frame', () => {
    const m = startCollecting();
    expect(advance(m, 27, 0)).toBe(m);
    expect(advance(m, 27, -0.5)).toBe(m);
  });

  it('treats a negative flow as no flow', () => {
    expect(advance(startCollecting(), -30, 5).volumeL).toBe(0);
  });
});

describe('what the panel is allowed to claim', () => {
  it('marks a measurement unsettled until enough has collected to time', () => {
    // At 27 L/min half a litre takes 1.1 s. Below that a tenth of a second of reaction
    // time is a several-per-cent error, and the figure should not be read as a result.
    expect(isSettled(startCollecting())).toBe(false);
    expect(isSettled(collect(27, 0.5))).toBe(false);
    expect(isSettled(collect(27, 2))).toBe(true);
    expect(SETTLING_VOLUME_L).toBeLessThan(CAPACITY_L);
  });

  it('says how long a fill will take at a given flow', () => {
    // The two the procedure records at: long enough to time, short enough to sit through.
    expect(secondsToFill(READING_FLOWS_L_MIN[0])).toBeCloseTo(26.7, 1);
    expect(secondsToFill(READING_FLOWS_L_MIN[1])).toBeCloseTo(15.5, 1);
    expect(secondsToFill(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('the gauge column', () => {
  it('runs from the bottom mark to the top and no further', () => {
    expect(gaugeFraction(emptyMeasurement())).toBe(0);
    expect(gaugeFraction(collect(60, 20))).toBe(1);
    expect(gaugeFraction(collect(60, 3.5))).toBeCloseTo(0.5, 2);
  });

  it('is monotonic while collecting', () => {
    let m = startCollecting();
    let previous = -1;
    for (let i = 0; i < 600; i += 1) {
      m = advance(m, 27, 1 / 60);
      const f = gaugeFraction(m);
      expect(f).toBeGreaterThanOrEqual(previous);
      previous = f;
    }
  });
});

describe('purity', () => {
  it('never mutates the measurement it is given', () => {
    const m = startCollecting();
    const before = { ...m };
    advance(m, 27, 1);
    expect(m).toEqual(before);
  });

  it('is deterministic', () => {
    expect(collect(27.024, 6)).toEqual(collect(27.024, 6));
  });
});
