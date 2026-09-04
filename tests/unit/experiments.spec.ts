import { describe, expect, it } from 'vitest';
import {
  EXPERIMENTS,
  TOTAL_STEPS,
  buildSteps,
  deflectorsFor,
  getExperiment,
  type ExperimentDef,
} from '../../src/domain/experiments';
import { DEFLECTORS, getDeflector } from '../../src/domain/apparatus';

/**
 * Experiment definitions (BEDO-002 §3).
 *
 * The four sheets are content, so this pins what makes them correct — count, identity,
 * ordering, the deflectors each one may be run with, and that nothing is missing its
 * Arabic half — rather than snapshotting the prose, which would turn every copy edit
 * into a failing test for no benefit.
 */

const ANGLES: Record<string, number[]> = {
  flat: [90],
  semi: [120, 180],
  conical: [135],
  oblique: [30, 45, 60],
};

describe('the four experiments', () => {
  it('are exactly BEDO Exp. 1-4, in sheet order', () => {
    expect(EXPERIMENTS).toHaveLength(4);
    expect(EXPERIMENTS.map((e) => e.id)).toEqual(['flat', 'semi', 'conical', 'oblique']);
    expect(EXPERIMENTS.map((e) => e.nameEn)).toEqual([
      'Exp. 1 — Flat surface deflector',
      'Exp. 2 — Semi-circular deflector',
      'Exp. 3 — Conical surface deflector',
      'Exp. 4 — Oblique surface deflector',
    ]);
  });

  it.each(EXPERIMENTS)('$id is fully bilingual', (experiment: ExperimentDef) => {
    for (const key of ['nameEn', 'nameAr', 'lawEn', 'lawAr', 'objectiveEn', 'objectiveAr'] as const) {
      expect(experiment[key], `${experiment.id}.${key}`).toMatch(/\S/);
    }
    expect(experiment.nameAr, `${experiment.id} nameAr is not Arabic`).toMatch(/[؀-ۿ]/);
    expect(experiment.objectiveAr).toMatch(/[؀-ۿ]/);
  });

  it.each(EXPERIMENTS)('$id offers only the deflectors of its own family', (experiment) => {
    expect(experiment.angles).toEqual(ANGLES[experiment.id]);
    expect(experiment.angles).toContain(experiment.defaultAngle);
    for (const angle of experiment.angles) {
      expect(getDeflector(angle).id, `${angle} is not a real deflector`).toBe(angle);
      expect(getDeflector(angle).family).toBe(experiment.id);
    }
  });

  it('together cover every deflector on the tray, without overlap', () => {
    const covered = EXPERIMENTS.flatMap((e) => e.angles).sort((a, b) => a - b);
    expect(covered).toEqual(DEFLECTORS.map((d) => d.id).sort((a, b) => a - b));
    expect(new Set(covered).size).toBe(covered.length);
  });

  it('states the force law each family derives', () => {
    expect(getExperiment('flat').lawEn).toContain('ρAV²');
    expect(getExperiment('semi').lawEn).toContain('(1 − cos β)');
    expect(getExperiment('conical').lawEn).toContain('1.707');
    expect(getExperiment('oblique').lawEn).toContain('sin²θ');
  });

  it('falls back to Exp. 1 for an unknown id', () => {
    expect(getExperiment('flat')).toBe(EXPERIMENTS[0]);
    // @ts-expect-error deliberately outside the union — the runtime must still be total.
    expect(getExperiment('nope')).toBe(EXPERIMENTS[0]);
  });
});

describe('deflectorsFor', () => {
  it.each(EXPERIMENTS)('$id resolves to its own tray deflectors', (experiment) => {
    const list = deflectorsFor(experiment.id);
    expect(list.map((d) => d.id).sort((a, b) => a - b)).toEqual(
      [...experiment.angles].sort((a, b) => a - b)
    );
    expect(list.every((d) => d.family === experiment.id)).toBe(true);
  });

  it('partitions the tray: every deflector belongs to exactly one experiment', () => {
    const seen = EXPERIMENTS.flatMap((e) => deflectorsFor(e.id));
    expect(seen).toHaveLength(DEFLECTORS.length);
    expect(new Set(seen.map((d) => d.id)).size).toBe(DEFLECTORS.length);
  });
});

describe('quizzes', () => {
  it.each(EXPERIMENTS)('$id asks five answerable questions', (experiment) => {
    // Five, the brief's minimum. It was one, so a learner's score was pass or fail on a
    // single guess and told an instructor almost nothing.
    expect(experiment.quiz.length).toBeGreaterThanOrEqual(5);

    experiment.quiz.forEach((question, index) => {
      const where = `${experiment.id}[${index}]`;
      expect(['mcq', 'trueFalse'], where).toContain(question.kind);
      expect(question.optionsEn.length, where).toBeGreaterThanOrEqual(2);
      expect(question.optionsAr, where).toHaveLength(question.optionsEn.length);
      expect(question.answer, where).toBeGreaterThanOrEqual(0);
      expect(question.answer, where).toBeLessThan(question.optionsEn.length);

      for (const key of ['promptEn', 'promptAr', 'explainEn', 'explainAr'] as const) {
        expect(question[key], `${where}.${key}`).toMatch(/\S/);
      }
      // Arabic, not English left in an Arabic field — the failure a bilingual data file
      // makes easy and a reviewer reading one language will not see.
      expect(question.promptAr, where).toMatch(/[؀-ۿ]/);
      expect(question.explainAr, where).toMatch(/[؀-ۿ]/);
      expect(question.optionsEn.every((o) => o.trim().length > 0), where).toBe(true);
      expect(question.optionsAr.every((o) => o.trim().length > 0), where).toBe(true);
    });
  });

  it.each(EXPERIMENTS)('$id asks each question once', (experiment) => {
    const prompts = experiment.quiz.map((q) => q.promptEn);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it.each(EXPERIMENTS)('$id does not put the answer in the same slot every time', (experiment) => {
    // A learner who notices that the answer is always the second option has learned
    // something, and it is not fluid mechanics.
    expect(new Set(experiment.quiz.map((q) => q.answer)).size).toBeGreaterThan(1);
  });

  it('gives true/false questions exactly two options', () => {
    for (const experiment of EXPERIMENTS) {
      if (experiment.quiz[0].kind === 'trueFalse') {
        expect(experiment.quiz[0].optionsEn).toEqual(['True', 'False']);
      }
    }
  });
});

describe('the guided procedure', () => {
  const steps = buildSteps('Flat surface (90°)', 'عاكس مسطح (90 درجة)');

  it('is eleven steps, numbered 1..11 in order', () => {
    // BEDO-019: the canonical sequence from all four experiment sheets — nine apparatus
    // steps, Calculate, then the closing step. Was twelve until the volumetric-valve step
    // was removed; it appears in no sheet, and BEDO removed it from their own build in
    // October 2025 (docs/32 §5.1, docs/35).
    expect(TOTAL_STEPS).toBe(11);
    expect(steps).toHaveLength(TOTAL_STEPS);
    expect(steps.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('carries a stable id for every step, matching the sheets', () => {
    expect(steps.map((s) => s.stepId)).toEqual([
      'unscrew-cover',
      'install-deflector',
      'mount-cover',
      'power-on',
      'set-flow-reading-1',
      'balance-reading-1',
      'increase-flow-reading-2',
      'balance-reading-2',
      'open-monitor',
      'record-actual-force',
      'open-answer-sheet',
    ]);
  });

  it('has no volumetric-valve step', () => {
    // The one instruction BEDO-019 removed. The valve itself is untouched — see
    // `state-machine.spec.ts` and `lesson-schema.spec.ts`.
    expect(steps.map((s) => s.titleEn)).not.toContain('Volumetric valve');
    for (const step of steps) {
      expect(step.bodyEn.toLowerCase()).not.toContain('volumetric');
    }
  });

  it('keeps the step order the experiment sheets specify', () => {
    expect(steps.map((s) => s.titleEn)).toEqual([
      'Unscrew the upper plate',
      'Install the deflector',
      'Screw the tank cover',
      'Power switch',
      'Adjust the flow valve',
      'Balance the pointer (reading 1)',
      'Increase the flow rate',
      'Balance the pointer (reading 2)',
      'Open the software monitor',
      'Record the actual force',
      'You finished!',
    ]);
  });

  it('points each step at the part of the rig it is about', () => {
    expect(steps.map((s) => s.target)).toEqual([
      'cover',
      'tray',
      'cover',
      'power',
      'flowValve',
      'weights',
      'flowValve',
      'weights',
      'overview',
      null,
      null,
    ]);
  });

  it.each(buildSteps('Flat surface (90°)', 'عاكس مسطح (90 درجة)'))(
    'step $id is fully bilingual',
    (step) => {
      for (const key of ['titleEn', 'titleAr', 'bodyEn', 'bodyAr'] as const) {
        expect(step[key], `step ${step.id}.${key}`).toMatch(/\S/);
      }
      expect(step.titleAr).toMatch(/[؀-ۿ]/);
      expect(step.bodyAr).toMatch(/[؀-ۿ]/);
      if (step.noticeEn) expect(step.noticeAr).toMatch(/[؀-ۿ]/);
    }
  );

  it('names the chosen deflector in step 2, in both languages', () => {
    for (const deflector of DEFLECTORS) {
      const [, install] = buildSteps(deflector.nameEn, deflector.nameAr);
      expect(install.bodyEn).toContain(deflector.nameEn);
      expect(install.bodyAr).toContain(deflector.nameAr);
    }
  });

  it('raises the observation popups the experiment sheets specify', () => {
    // Renumbered by BEDO-019; the popups themselves are unchanged and still hang off the
    // same steps — flow, balance, flow again, and the recording step.
    const withNotice = steps.filter((s) => s.noticeEn).map((s) => s.stepId);
    expect(withNotice).toEqual([
      'set-flow-reading-1',
      'balance-reading-1',
      'increase-flow-reading-2',
      'record-actual-force',
    ]);
    expect(steps[4].noticeEn).toContain('pushes the deflector upward');
    expect(steps[5].noticeEn).toContain('shape of water impinging');
    expect(steps[9].noticeEn).toContain('F_ac');
  });

  it('is a pure function of the deflector name', () => {
    expect(buildSteps('a', 'b')).toEqual(buildSteps('a', 'b'));
    expect(buildSteps('a', 'b')[1].bodyEn).not.toEqual(buildSteps('c', 'd')[1].bodyEn);
  });
});
