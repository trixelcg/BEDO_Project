import { describe, expect, it } from 'vitest';
import {
  EXPERIMENTS,
  deflectorsFor,
  getExperiment,
  isDeflectorInScope,
  type ExperimentId,
} from '../../src/domain/experiments';
import { DEFLECTORS, getDeflector } from '../../src/domain/apparatus';
import { deflectorsSelectableIn, evaluateInteraction } from '../../src/interaction/gate';
import { CURRENT_LESSON } from '../../src/lesson/currentLesson';
import { restingState } from '../../src/domain/stateMachine';
import { jetState, targetMassG } from '../../src/domain/physics';
import { createSimulationRuntime } from '../../src/simulation/runtime';

/**
 * BUG-05 — an experiment must not run on another experiment's deflector.
 *
 * ## The fixture is the source, not the code
 *
 * Every number below is transcribed from BEDO's Phase 2 experiment sheets, and the
 * expected momentum factors are computed here from the angles the sheets state rather
 * than imported from `src/domain/apparatus.ts`. A test that read the factor out of the
 * module it is checking would pass whatever the module said.
 *
 * Sources (`/Measurement of Jet Forces/Phase 2/`):
 *
 * | Sheet | Step 2 | Objectives |
 * |---|---|---|
 * | `Exp.1. Flat surface deflector.docx` | "Drag the 90° flat deflector" | "(ɵ = 90°) … F = ρAV²" |
 * | `Exp.2.Semi-circular deflector.docx` | "Drag the 120° or 180° semi-circular deflector" | "(ɑ = 0°, β = 120° or 180°) … F = ρAV²(1 − cos(β))" |
 * | `Exp.3. Conical surface deflector..docx` | "Drag the 135° conical surface deflector" | "(ɑ = 0°, β = 135°) … F = 1.707 ρAV²" |
 * | `Exp.4.Oblique surface deflector.docx` | "Drag the 45° oblique surface deflector" | "(ɵ = 30°, 45° or 60°) … Fx = ρAV² (sin(ɵ))²" |
 *
 * Two of the four give the learner a choice and two do not. That asymmetry is BEDO's, and
 * it is why the scope is a set per experiment rather than a single required id.
 */

/**
 * BEDO prints its factors to three decimals — `Exp.3`'s objective states the conical
 * deflector's outright, as *"F = 1.707 ρAV²"*, and 1 − cos 135° is 1.70710678…. The
 * apparatus rounds to the same three places (`src/domain/apparatus.ts:109-110`), so the
 * fixture does too. The other six angles are exact at three decimals either way.
 */
const asPrinted = (x: number) => Math.round(x * 1000) / 1000;

/** Transcribed from the sheets. Angles in the order the sheet names them. */
const SHEETS: ReadonlyArray<{
  readonly id: ExperimentId;
  readonly angles: readonly number[];
  readonly defaultAngle: number;
  readonly factor: (angle: number) => number;
  readonly formula: string;
}> = [
  { id: 'flat', angles: [90], defaultAngle: 90, factor: () => 1.0, formula: 'F = ρAV²' },
  {
    id: 'semi',
    angles: [120, 180],
    defaultAngle: 180,
    factor: (b) => asPrinted(1 - Math.cos((b * Math.PI) / 180)),
    formula: 'F = ρAV²(1 − cos β)',
  },
  {
    id: 'conical',
    angles: [135],
    defaultAngle: 135,
    factor: (b) => asPrinted(1 - Math.cos((b * Math.PI) / 180)), // 1.707, as the sheet prints it
    formula: 'F = 1.707 ρAV²',
  },
  {
    id: 'oblique',
    angles: [30, 45, 60],
    defaultAngle: 45,
    factor: (t) => asPrinted(Math.sin((t * Math.PI) / 180) ** 2),
    formula: 'Fx = ρAV² sin²θ',
  },
];

const OUT_OF_SCOPE: Record<ExperimentId, number> = {
  flat: 180, //     the 180° hemisphere — factor 2.0, twice the flat plate's
  semi: 90, //      the flat plate
  conical: 90,
  oblique: 180,
};

describe('the sheets and the domain agree', () => {
  it.each(SHEETS)('$id runs the angles its sheet names', (sheet) => {
    expect(getExperiment(sheet.id).angles.slice().sort((a, b) => a - b)).toEqual(
      sheet.angles.slice().sort((a, b) => a - b)
    );
    expect(getExperiment(sheet.id).defaultAngle).toBe(sheet.defaultAngle);
  });

  it.each(SHEETS)('$id carries the momentum factor its formula gives', (sheet) => {
    for (const angle of sheet.angles) {
      expect(getDeflector(angle).momentumFactor, `${sheet.id} @ ${angle}°`).toBeCloseTo(
        sheet.factor(angle),
        10
      );
    }
  });

  it('never lets the default fall outside the experiment’s own set', () => {
    for (const experiment of EXPERIMENTS) {
      expect(
        isDeflectorInScope(experiment.id, experiment.defaultAngle),
        `${experiment.id} loads a deflector it is not run with`
      ).toBe(true);
    }
  });

  it('keeps the two encodings of the mapping in step', () => {
    // `angles` comes from the sheets and `family` from the model's naming. They describe
    // the same fact, and BEDO-022 §2 wants one authority — so if they ever disagree, this
    // fails rather than one of them silently winning somewhere.
    for (const experiment of EXPERIMENTS) {
      const byFamily = deflectorsFor(experiment.id)
        .map((d) => d.id)
        .sort((a, b) => a - b);
      expect(byFamily, experiment.id).toEqual(experiment.angles.slice().sort((a, b) => a - b));
    }
  });

  it('accounts for every deflector on the tray exactly once', () => {
    const claimed = EXPERIMENTS.flatMap((e) => e.angles).sort((a, b) => a - b);
    expect(claimed).toEqual(DEFLECTORS.map((d) => d.id).sort((a, b) => a - b));
  });
});

describe('scope', () => {
  it.each(SHEETS)('$id accepts its own angles and refuses the rest', (sheet) => {
    for (const d of DEFLECTORS) {
      expect(isDeflectorInScope(sheet.id, d.id), `${sheet.id} vs ${d.id}°`).toBe(
        sheet.angles.includes(d.id)
      );
    }
  });

  it.each(SHEETS)('$id offers exactly its own angles in guided mode', (sheet) => {
    expect(deflectorsSelectableIn(sheet.id, 'guided').slice().sort((a, b) => a - b)).toEqual(
      sheet.angles.slice().sort((a, b) => a - b)
    );
  });

  it.each(SHEETS)('$id offers all seven in free mode', (sheet) => {
    expect(deflectorsSelectableIn(sheet.id, 'free').slice().sort((a, b) => a - b)).toEqual(
      DEFLECTORS.map((d) => d.id).sort((a, b) => a - b)
    );
  });
});

describe('the gate', () => {
  const installStep = CURRENT_LESSON.steps.find((s) => s.id === 'install-deflector')!;

  const select = (experimentId: ExperimentId, deflectorId: number, mode: 'guided' | 'free') =>
    evaluateInteraction({
      interaction: { kind: 'apparatus', action: { type: 'SELECT_DEFLECTOR', deflectorId } },
      apparatus: { ...restingState(getExperiment(experimentId).defaultAngle), isCoverOpen: true },
      experimentId,
      step: installStep,
      lesson: CURRENT_LESSON,
      mode,
    });

  it.each(SHEETS)('accepts every angle $id is run with', (sheet) => {
    for (const angle of sheet.angles) {
      expect(select(sheet.id, angle, 'guided'), `${sheet.id} @ ${angle}°`).toEqual({
        allowed: true,
        why: 'EXPECTED',
      });
    }
  });

  it.each(SHEETS)('refuses another experiment’s deflector in $id', (sheet) => {
    const wrong = OUT_OF_SCOPE[sheet.id];
    expect(select(sheet.id, wrong, 'guided')).toEqual({
      allowed: false,
      blockedBy: 'lesson',
      reason: 'DEFLECTOR_NOT_IN_EXPERIMENT',
      affordance: 'deflectors',
    });
  });

  it('says the deflector is wrong, not that the step is', () => {
    // Two lesson reasons, deliberately. The learner *is* on the deflector step and *is*
    // touching the tray; telling them "follow the highlighted step first" would be false.
    const decision = select('flat', 180, 'guided');
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.blockedBy).toBe('lesson');
    expect(decision.reason).not.toBe('NOT_EXPECTED_IN_CURRENT_STEP');
  });

  it('leaves free mode alone', () => {
    for (const sheet of SHEETS) {
      expect(select(sheet.id, OUT_OF_SCOPE[sheet.id], 'free')).toEqual({
        allowed: true,
        why: 'FREE_MODE',
      });
    }
  });

  it('still refuses a deflector while the tank is shut, whatever its scope', () => {
    // Apparatus first: guard 2 is about the rig and outranks the experiment's scope.
    const decision = evaluateInteraction({
      interaction: { kind: 'apparatus', action: { type: 'SELECT_DEFLECTOR', deflectorId: 180 } },
      apparatus: restingState(90),
      experimentId: 'flat',
      step: installStep,
      lesson: CURRENT_LESSON,
      mode: 'guided',
    });
    expect(decision).toEqual({
      allowed: false,
      blockedBy: 'apparatus',
      reason: 'DEFLECTOR_NEEDS_OPEN_COVER',
    });
  });
});

describe('physics uses the experiment’s own factor', () => {
  it.each(SHEETS)('$id computes its force from its own deflector', (sheet) => {
    const n = 0.4;
    const flow = 120;
    for (const angle of sheet.angles) {
      const jet = jetState(n, angle, flow);
      // F_th = k ρ A V², with k the sheet's factor — the equation is untouched; only the
      // k that reaches it is what BEDO-022 is about.
      const expected = sheet.factor(angle) * 1000 * 0.0000785 * jet.impactVelocityMS ** 2;
      expect(jet.theoreticalForceN, `${sheet.id} @ ${angle}°`).toBeCloseTo(expected, 12);
    }
  });

  it('is the whole of BUG-05: the same flow, two deflectors, two different forces', () => {
    const flat = jetState(0.4, 90, 120).theoreticalForceN;
    const hemisphere = jetState(0.4, 180, 120).theoreticalForceN;
    expect(hemisphere).toBeCloseTo(flat * 2, 12);
    // A student running "Exp. 1 — Flat surface deflector" against the 180° disc read a
    // force twice the one their worksheet's F = ρAV² predicts, and nothing said so.
  });

  it('balances at a different mass, which is what the learner actually sees', () => {
    expect(targetMassG(0.4, 90, 120)).toBe(80);
    expect(targetMassG(0.4, 180, 120)).toBe(170); // rounded to 10 g, as the rig reads

  });
});

describe('switching experiment', () => {
  it.each(SHEETS)('loads $id with a deflector it is run with', (sheet) => {
    const runtime = createSimulationRuntime();
    runtime.dispatch({ type: 'SELECT_EXPERIMENT', experimentId: sheet.id });
    const { experimentId, apparatus } = runtime.getState();
    expect(experimentId).toBe(sheet.id);
    expect(apparatus.selectedDeflectorId).toBe(sheet.defaultAngle);
    expect(isDeflectorInScope(experimentId, apparatus.selectedDeflectorId)).toBe(true);
  });

  it('cannot carry a stale deflector across a switch', () => {
    // The route that would corrupt physics: install 180° while Exp. 2 is loaded, then
    // switch to Exp. 1 and run it with k = 2.0. Switching rebuilds the rig.
    const runtime = createSimulationRuntime();
    runtime.dispatch({ type: 'SELECT_EXPERIMENT', experimentId: 'semi' });
    runtime.dispatch({ type: 'OPEN_COVER' });
    runtime.dispatch({ type: 'SELECT_DEFLECTOR', deflectorId: 180 });
    expect(runtime.getState().apparatus.selectedDeflectorId).toBe(180);

    runtime.dispatch({ type: 'SELECT_EXPERIMENT', experimentId: 'flat' });

    expect(runtime.getState().apparatus.selectedDeflectorId).toBe(90);
    expect(runtime.getState().apparatus.isCoverOpen).toBe(false);
  });

  it('is deterministic for every pair of experiments', () => {
    for (const from of EXPERIMENTS) {
      for (const to of EXPERIMENTS) {
        const runtime = createSimulationRuntime();
        runtime.dispatch({ type: 'SELECT_EXPERIMENT', experimentId: from.id });
        runtime.dispatch({ type: 'SELECT_EXPERIMENT', experimentId: to.id });
        const state = runtime.getState();
        expect(
          isDeflectorInScope(state.experimentId, state.apparatus.selectedDeflectorId),
          `${from.id} → ${to.id}`
        ).toBe(true);
      }
    }
  });
});

describe('the lesson step', () => {
  const installStep = CURRENT_LESSON.steps.find((s) => s.id === 'install-deflector')!;
  const contextWith = (experimentId: ExperimentId, deflectorId: number) => {
    const runtime = createSimulationRuntime();
    runtime.dispatch({ type: 'SELECT_EXPERIMENT', experimentId });
    runtime.dispatch({ type: 'OPEN_COVER' });
    // Bypass the gate on purpose: this is the lesson's own rule being tested, and free
    // exploration is a real route to an out-of-scope deflector.
    runtime.dispatch({ type: 'SELECT_DEFLECTOR', deflectorId });
    return { simulation: runtime.getState(), readings: [] };
  };

  it.each(SHEETS)('confirms $id with any deflector its sheet names', (sheet) => {
    for (const angle of sheet.angles) {
      expect(
        installStep.advance.kind === 'confirm' &&
          installStep.advance.when(contextWith(sheet.id, angle)),
        `${sheet.id} @ ${angle}°`
      ).toBe(true);
    }
  });

  it.each(SHEETS)('will not confirm $id with another experiment’s deflector', (sheet) => {
    const context = contextWith(sheet.id, OUT_OF_SCOPE[sheet.id]);
    expect(
      installStep.advance.kind === 'confirm' && installStep.advance.when(context)
    ).toBe(false);
  });

  it('still requires the tank to be open', () => {
    const runtime = createSimulationRuntime();
    const context = { simulation: runtime.getState(), readings: [] };
    expect(installStep.advance.kind === 'confirm' && installStep.advance.when(context)).toBe(false);
  });
});
