import { FIRST_READING_VALVE, SECOND_READING_VALVE } from '../../src/domain/physics';
import { describe, expect, it } from 'vitest';
import { springDeflectionMm } from '../../src/domain/spring';
import { GRAVITY_MS2, SPRING_RATE_N_PER_M, jetState } from '../../src/domain/physics';
import { SPRING_REST_HEIGHT_MODEL_UNITS, springTravelLimitMm } from '../../src/lib/apparatusView';

/**
 * Old model vs BEDO specification (BEDO-007 §12).
 *
 * This exists to answer one question about the correction: *did the result change because
 * the source requires it, or because the new formula looked tidier?* Every row below is
 * computed twice — once by the implementation that shipped, reproduced verbatim here, and
 * once by the corrected model — and the difference is stated.
 *
 * The old implementation, from `DeviceModel.tsx` before this task:
 *
 *   const netForce   = jetForceN - weightForceN;               // newtons
 *   const restH      = springInfoRef.current.restH;            // model units
 *   const deflection = clamp(netForce / 200, -0.45 * restH, 0.45 * restH);
 *
 * It differs from the specification in exactly one respect: the lower bound. The spec
 * (`Jetforce_Storyboard.pptx` sl. 8) says *"If hF ≤ hw, The X = 0 and the deflector spring
 * will not move"*; the old clamp let X fall to −45 % of the spring's rest height, so a
 * loaded tray visibly compressed the spring below its seat.
 *
 * The upper bound is numerically unchanged — see `docs/31 §5`.
 */

/** The shipped implementation, reproduced exactly, in millimetres for comparability. */
const legacyDeflectionMm = (jetForceN: number, weightForceN: number): number => {
  const netForce = jetForceN - weightForceN;
  const restH = SPRING_REST_HEIGHT_MODEL_UNITS;
  const min = -0.45 * restH;
  const max = 0.45 * restH;
  const deflectionModelUnits = Math.min(Math.max(netForce / SPRING_RATE_N_PER_M, min), max);
  return deflectionModelUnits * 1000; // model units are metres; see apparatusView.ts
};

const weightForceN = (massG: number) => (massG * GRAVITY_MS2) / 1000;
const LIMIT = springTravelLimitMm(SPRING_REST_HEIGHT_MODEL_UNITS);

interface Row {
  label: string;
  jetForceN: number;
  weightForceN: number;
  /** Whether the specification requires this row to change, and why. */
  changes: false | string;
}

const ROWS: Row[] = [
  {
    label: 'rest — pump off, tray empty',
    jetForceN: 0,
    weightForceN: 0,
    changes: false,
  },
  {
    label: 'jet only, n = 0.4, flat plate',
    jetForceN: jetState(FIRST_READING_VALVE, 90).theoreticalForceN,
    weightForceN: 0,
    changes: false,
  },
  {
    label: 'jet only, n = 0.5, flat plate',
    jetForceN: jetState(SECOND_READING_VALVE, 90).theoreticalForceN,
    weightForceN: 0,
    changes: false,
  },
  {
    label: 'reading 1 balanced — n = 0.4 against 80 g',
    jetForceN: jetState(FIRST_READING_VALVE, 90).theoreticalForceN,
    weightForceN: weightForceN(80),
    changes: false,
  },
  {
    label: 'reading 2 balanced — n = 0.5 against 260 g',
    jetForceN: jetState(SECOND_READING_VALVE, 90).theoreticalForceN,
    weightForceN: weightForceN(260),
    changes: 'the 260 g reading weighs 0.02 N more than the jet lifts, so the old model dipped just below rest',
  },
  {
    label: 'overloaded — n = 0.4 against 380 g',
    jetForceN: jetState(FIRST_READING_VALVE, 90).theoreticalForceN,
    weightForceN: weightForceN(380),
    changes: 'hw exceeds hF: sl. 8 requires X = 0, the old model compressed the spring',
  },
  {
    label: 'weights with the pump off',
    jetForceN: 0,
    weightForceN: weightForceN(380),
    changes: 'no jet at all: sl. 8 requires X = 0, the old model compressed the spring hardest here',
  },
  {
    label: 'a single 500 g disc, pump off',
    jetForceN: 0,
    weightForceN: weightForceN(500),
    changes: 'hw exceeds hF; the old model hit its −45 % floor',
  },
  {
    label: '180 deg deflector at full flow — above the travel limit',
    jetForceN: jetState(1.0, 180).theoreticalForceN,
    weightForceN: 0,
    changes: false,
  },
];

describe('old model vs specification', () => {
  it.each(ROWS)('$label', ({ jetForceN, weightForceN: weight, changes }) => {
    const old = legacyDeflectionMm(jetForceN, weight);
    const corrected = springDeflectionMm(jetForceN, weight, LIMIT);

    if (changes === false) {
      // Unchanged rows are the majority, and they are the evidence that this is a
      // targeted correction rather than a new model.
      expect(corrected).toBeCloseTo(old, 9);
      return;
    }

    // Changed rows: the old value was below rest, the new one is exactly zero.
    expect(old).toBeLessThan(0);
    expect(corrected).toBe(0);
  });

  it('changes nothing whenever the jet outweighs the load', () => {
    // A sweep, not a sample: wherever the old model was already in spec, it stays.
    for (let jet = 0; jet <= 5; jet += 0.25) {
      for (let load = 0; load <= 5; load += 0.25) {
        if (jet <= load) continue;
        expect(springDeflectionMm(jet, load, LIMIT)).toBeCloseTo(
          legacyDeflectionMm(jet, load),
          9
        );
      }
    }
  });

  it('differs from the old model only where the old model went below rest', () => {
    for (let jet = 0; jet <= 5; jet += 0.25) {
      for (let load = 0; load <= 5; load += 0.25) {
        const old = legacyDeflectionMm(jet, load);
        const corrected = springDeflectionMm(jet, load, LIMIT);
        if (Math.abs(corrected - old) > 1e-9) {
          expect(old, `unexpected difference at jet=${jet} load=${load}`).toBeLessThan(0);
          expect(corrected).toBe(0);
        }
      }
    }
  });

  it('keeps the same ceiling as the old model', () => {
    // The upper clamp is unchanged in value: 45 % of the measured rest height. Only its
    // status changed — it is now a scene-measured travel limit passed in, not physics.
    expect(LIMIT).toBeCloseTo(0.45 * SPRING_REST_HEIGHT_MODEL_UNITS * 1000, 9);
    const huge = 1000;
    expect(springDeflectionMm(huge, 0, LIMIT)).toBeCloseTo(legacyDeflectionMm(huge, 0), 9);
  });
});
