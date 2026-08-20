import { describe, expect, it } from 'vitest';
import { springDeflectionMm, springHeightMm } from '../../src/domain/spring';
import { GRAVITY_MS2, SPRING_RATE_N_PER_M, jetState } from '../../src/domain/physics';

/**
 * The deflector spring (BEDO-007).
 *
 * Every expectation here traces to a primary BEDO source, cited at the assertion:
 *
 *   - `Jetforce_Storyboard.pptx` slide 8 — the three equations and the X = 0 floor
 *   - `Jetforce_Storyboard.pptx` slide 19 — direction of travel
 *   - `Jet force_Mathematical model.xlsx` sheet 1 column X — `=W4/200*1000`, k = 200 N/m
 *
 * The storyboard and the spreadsheet live outside this repository, alongside it in the
 * project folder; `docs/31 §1` records where, and quotes the passages relied on.
 */

/** Force of a mass on the holder, in newtons — the F_ac of the sheets. */
const weightForceN = (massG: number) => (massG * GRAVITY_MS2) / 1000;

/** A travel limit big enough not to interfere, for the tests that are not about it. */
const UNBOUNDED = 1000;

describe('h = F / k', () => {
  it('reproduces the spreadsheet row: 0.4905 N gives 2.4525 mm', () => {
    // xlsx sheet 1: W4 = 0.4905 (N), X4 = =W4/200*1000 -> 2.4525. This is the single
    // tabulated pair that fixes both the rate and the unit.
    expect(springHeightMm(0.4905)).toBeCloseTo(2.4525, 9);
  });

  it('is F/k expressed in millimetres, not metres', () => {
    // The distinction that matters: F/k is metres, and this is a thousand times that.
    expect(springHeightMm(1)).toBeCloseTo((1 / SPRING_RATE_N_PER_M) * 1000, 12);
    expect(springHeightMm(1)).toBeCloseTo(5, 12);
  });

  it('is linear in force and zero at zero', () => {
    expect(springHeightMm(0)).toBe(0);
    expect(springHeightMm(2)).toBeCloseTo(2 * springHeightMm(1), 12);
  });

  it('accepts an explicit rate', () => {
    expect(springHeightMm(1, 400)).toBeCloseTo(2.5, 12);
  });
});

describe('X = h_F − h_w', () => {
  it('is the jet’s displacement when nothing is on the holder', () => {
    // Storyboard sl. 8: hF >= hw, "the deflector spring moves upward".
    expect(springDeflectionMm(0.8199, 0, UNBOUNDED)).toBeCloseTo(springHeightMm(0.8199), 12);
  });

  it('is the difference of the two heights', () => {
    const x = springDeflectionMm(2.5303, weightForceN(200), UNBOUNDED);
    expect(x).toBeCloseTo(springHeightMm(2.5303) - springHeightMm(weightForceN(200)), 12);
  });

  it('falls as weights are added — slide 19’s "moves downward"', () => {
    const heights = [0, 50, 100, 150].map((g) =>
      springDeflectionMm(2.5303, weightForceN(g), UNBOUNDED)
    );
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeLessThan(heights[i - 1]);
    }
  });

  it('rises again as weights are removed', () => {
    const loaded = springDeflectionMm(2.5303, weightForceN(200), UNBOUNDED);
    const lighter = springDeflectionMm(2.5303, weightForceN(100), UNBOUNDED);
    expect(lighter).toBeGreaterThan(loaded);
  });
});

describe('the floor at zero — the correction BEDO-007 makes', () => {
  // Storyboard sl. 8, verbatim: "If hF <= hw, The X= 0 and the deflector spring will not
  // move." The previous implementation allowed X down to -0.45 x rest height.

  it('is zero when the weights exactly balance the jet', () => {
    const jetForceN = 0.8199;
    expect(springDeflectionMm(jetForceN, jetForceN, UNBOUNDED)).toBe(0);
  });

  it('is zero — not negative — when the weights outweigh the jet', () => {
    expect(springDeflectionMm(0.8199, weightForceN(380), UNBOUNDED)).toBe(0);
    expect(springDeflectionMm(0.1, 5, UNBOUNDED)).toBe(0);
  });

  it('is zero when there is no jet at all', () => {
    // Pump off, or the cover open: the app zeroes the jet force, and weights alone must
    // not pull the spring below its rest position.
    expect(springDeflectionMm(0, weightForceN(380), UNBOUNDED)).toBe(0);
    expect(springDeflectionMm(0, 0, UNBOUNDED)).toBe(0);
  });

  it('stays at zero however heavy the load gets', () => {
    // The n = 0.4 jet is balanced by 83.6 g, so anything above that outweighs it.
    for (const massG of [100, 500, 5000]) {
      expect(springDeflectionMm(0.8199, weightForceN(massG), UNBOUNDED)).toBe(0);
    }
    // ...and just below it, the spring is still lifted.
    expect(springDeflectionMm(0.8199, weightForceN(80), UNBOUNDED)).toBeGreaterThan(0);
  });
});

describe('the ceiling — "will not exceed the cover or holder surface"', () => {
  it('never returns more than the travel it is given', () => {
    expect(springDeflectionMm(100, 0, 25)).toBe(25);
    expect(springDeflectionMm(100, 0, 5)).toBe(5);
  });

  it('returns the exact value while it is under the limit', () => {
    expect(springDeflectionMm(1, 0, 25)).toBeCloseTo(5, 12);
  });

  it('meets the limit exactly at the crossover, and holds there beyond it', () => {
    const limit = 10;
    const forceAtLimit = (limit / 1000) * SPRING_RATE_N_PER_M; // h = F/k -> F = h k
    expect(springDeflectionMm(forceAtLimit, 0, limit)).toBeCloseTo(limit, 9);
    expect(springDeflectionMm(forceAtLimit * 2, 0, limit)).toBe(limit);
  });

  it('collapses to no movement if the geometry leaves no room', () => {
    expect(springDeflectionMm(100, 0, 0)).toBe(0);
    // A nonsensical negative limit must not invert the clamp.
    expect(springDeflectionMm(100, 0, -5)).toBe(0);
  });
});

describe('the lesson’s own readings', () => {
  // The two readings the guided lesson takes, computed from the verified physics rather
  // than from hand-written numbers, so this cannot drift from `physics.ts`.
  const limit = 25.38; // the measured travel of the shipped model; see apparatusView.ts

  it('reading 1: the jet at n = 0.4 lifts the spring, and 80 g nearly cancels it', () => {
    const { theoreticalForceN } = jetState(0.4, 90);
    expect(springDeflectionMm(theoreticalForceN, 0, limit)).toBeCloseTo(4.0996, 3);
    const balanced = springDeflectionMm(theoreticalForceN, weightForceN(80), limit);
    expect(balanced).toBeGreaterThan(0);
    expect(balanced).toBeLessThan(0.2); // all but cancelled
  });

  it('reading 2: the jet at n = 0.5 lifts it further, and 260 g overshoots to zero', () => {
    const { theoreticalForceN } = jetState(0.5, 90);
    expect(springDeflectionMm(theoreticalForceN, 0, limit)).toBeCloseTo(12.6515, 3);
    // 260 g weighs marginally more than the jet lifts, so the spring sits at rest.
    expect(springDeflectionMm(theoreticalForceN, weightForceN(260), limit)).toBe(0);
  });

  it('the 180 deg deflector at full flow is held by the travel limit', () => {
    // Free mode allows the valve wide open; without a ceiling the spring would stretch
    // far through the cover.
    const { theoreticalForceN } = jetState(1.0, 180);
    expect(springHeightMm(theoreticalForceN)).toBeGreaterThan(limit);
    expect(springDeflectionMm(theoreticalForceN, 0, limit)).toBe(limit);
  });
});

describe('as a function', () => {
  it('is deterministic', () => {
    for (let i = 0; i < 5; i++) {
      expect(springDeflectionMm(0.8199, 0.7848, 25.38)).toBe(
        springDeflectionMm(0.8199, 0.7848, 25.38)
      );
    }
  });

  it('is total — no input throws or returns a non-number', () => {
    for (const [jet, weight, limit] of [
      [0, 0, 0],
      [-1, 0, 10],
      [1, -1, 10],
      [Number.MAX_VALUE, 0, 10],
    ]) {
      const result = springDeflectionMm(jet, weight, limit);
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });

  it('never returns a negative displacement, for any pair of forces', () => {
    for (let jet = 0; jet <= 4; jet += 0.5) {
      for (let weight = 0; weight <= 4; weight += 0.5) {
        expect(springDeflectionMm(jet, weight, 25.38)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
