import { describe, expect, it } from 'vitest';
import { CURRENT_LESSON, CURRENT_LESSON_STEP_COUNT } from '../../src/lesson/currentLesson';
import { stepIndex, type LessonContext, type StepId } from '../../src/lesson/schema';
import { createInitialSimulationState } from '../../src/simulation/state';
import { selectReadings } from '../../src/simulation/selectors';
import { buildSteps } from '../../src/domain/experiments';
import { createSimulationRuntime, type SimulationCommand } from '../../src/simulation/runtime';

/**
 * The lesson definition (BEDO-018).
 *
 * The schema is data, so most of what can go wrong with it is structural: a duplicate id,
 * a step whose completion condition never fires, content and schema drifting apart. These
 * check the structure; `lesson-runner.spec.ts` checks the walk.
 */

const context = (commands: SimulationCommand[] = []): LessonContext => {
  const runtime = createSimulationRuntime(createInitialSimulationState());
  for (const command of commands) runtime.dispatch(command);
  return { simulation: runtime.getState(), readings: selectReadings(runtime.getState()) };
};

/** The twelve, in order, as the application ships them today. */
const EXPECTED_ORDER: StepId[] = [
  'unscrew-cover',
  'install-deflector',
  'mount-cover',
  'power-on',
  'open-volumetric-valve',
  'set-flow-reading-1',
  'balance-reading-1',
  'increase-flow-reading-2',
  'balance-reading-2',
  'open-monitor',
  'record-actual-force',
  'finish',
];

describe('definition integrity', () => {
  it('is the twelve steps that ship today, in order', () => {
    expect(CURRENT_LESSON.steps.map((s) => s.id)).toEqual(EXPECTED_ORDER);
    expect(CURRENT_LESSON_STEP_COUNT).toBe(12);
  });

  it('gives every step a unique id', () => {
    const ids = CURRENT_LESSON.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers them 1..12 for display', () => {
    expect(CURRENT_LESSON.steps.map((s) => s.displayNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('matches the bilingual content step for step, by id', () => {
    // Content and schema are keyed by the same name, so they cannot drift apart.
    const content = buildSteps('Flat surface (90°)', 'عاكس مسطح (90 درجة)');
    expect(content.map((s) => s.stepId)).toEqual(EXPECTED_ORDER);
    for (const step of CURRENT_LESSON.steps) {
      const copy = content.find((c) => c.stepId === step.id);
      expect(copy, `no copy for ${step.id}`).toBeDefined();
      expect(copy!.id).toBe(step.displayNumber);
    }
  });

  it('points every step at a part of the rig, or at nothing on purpose', () => {
    for (const step of CURRENT_LESSON.steps) {
      if (step.target === null) {
        // Only the monitor-side steps have no anchor.
        expect(['record-actual-force', 'finish']).toContain(step.id);
      }
    }
  });

  it('only ever highlights parts a learner can act on', () => {
    const known = ['cover', 'deflectors', 'power', 'volumetricValve', 'flowValve', 'weights'];
    for (const step of CURRENT_LESSON.steps) {
      for (const key of step.highlight) expect(known).toContain(key);
    }
  });

  it('issues reading commands from the steps that own them, not from a step-number map', () => {
    // `BALANCE_ROW = { 7: 1, 9: 2 }` is gone; the step that starts a reading says which.
    const readingCommands = CURRENT_LESSON.steps.flatMap((step) =>
      (step.onComplete ?? []).map((command) => [step.id, command] as const)
    );
    const begins = readingCommands.filter(([, c]) => c.type === 'BEGIN_READING');
    expect(begins.map(([id, c]) => [id, (c as { index: number }).index])).toEqual([
      ['set-flow-reading-1', 1],
      ['increase-flow-reading-2', 2],
    ]);
    const ends = readingCommands.filter(([, c]) => c.type === 'END_READING').map(([id]) => id);
    expect(ends).toEqual(['balance-reading-1', 'balance-reading-2']);
  });
});

describe('identity is the id, not the position', () => {
  it('finds a step by name wherever it sits', () => {
    expect(stepIndex(CURRENT_LESSON, 'balance-reading-1')).toBe(6);
    // The number is metadata hanging off the definition, not the way it is found.
    const step = CURRENT_LESSON.steps.find((s) => s.id === 'balance-reading-1')!;
    expect(step.displayNumber).toBe(7);
  });

  it('survives renumbering — BEDO-019 changes data, not code', () => {
    // Renumber every step and the schema still resolves by name. This is the property
    // that makes the canonical 11-step migration a content change.
    const renumbered = {
      steps: CURRENT_LESSON.steps.map((step, i) => ({ ...step, displayNumber: i + 100 })),
    };
    expect(stepIndex(renumbered, 'open-monitor')).toBe(stepIndex(CURRENT_LESSON, 'open-monitor'));
    expect(renumbered.steps.find((s) => s.id === 'finish')!.displayNumber).toBe(111);
  });
});

describe('completion conditions', () => {
  // Each row: the step, a state where it is not satisfied, and the commands that satisfy
  // it. Every condition reads simulation state — none depends on a click having happened.
  const CASES: Array<{ id: StepId; satisfyWith: SimulationCommand[] }> = [
    { id: 'unscrew-cover', satisfyWith: [{ type: 'OPEN_COVER' }] },
    { id: 'mount-cover', satisfyWith: [] }, // satisfied at rest: the cover starts shut
    { id: 'power-on', satisfyWith: [{ type: 'POWER_ON' }] },
    { id: 'open-volumetric-valve', satisfyWith: [{ type: 'OPEN_VOLUMETRIC_VALVE' }] },
    {
      id: 'set-flow-reading-1',
      satisfyWith: [{ type: 'POWER_ON' }, { type: 'SET_VALVE', opening: 0.4 }],
    },
    {
      id: 'balance-reading-1',
      satisfyWith: [
        { type: 'BEGIN_READING', index: 1 },
        { type: 'ADD_WEIGHT', massG: 50 },
        { type: 'ADD_WEIGHT', massG: 20 },
        { type: 'ADD_WEIGHT', massG: 10 },
      ],
    },
    {
      id: 'increase-flow-reading-2',
      satisfyWith: [{ type: 'POWER_ON' }, { type: 'SET_VALVE', opening: 0.5 }],
    },
    {
      id: 'balance-reading-2',
      satisfyWith: [
        { type: 'BEGIN_READING', index: 2 },
        { type: 'ADD_WEIGHT', massG: 200 },
        { type: 'ADD_WEIGHT', massG: 50 },
        { type: 'ADD_WEIGHT', massG: 10 },
      ],
    },
    { id: 'record-actual-force', satisfyWith: [{ type: 'RECORD_ACTUAL_FORCE' }] },
  ];

  it.each(CASES)('$id becomes satisfied by its own condition', ({ id, satisfyWith }) => {
    const step = CURRENT_LESSON.steps.find((s) => s.id === id)!;
    if (satisfyWith.length > 0) {
      expect(step.isSatisfied(context()), `${id} was satisfied before anything happened`).toBe(
        false
      );
    }
    expect(step.isSatisfied(context(satisfyWith))).toBe(true);
  });

  it('ignores state that has nothing to do with the step', () => {
    const step = CURRENT_LESSON.steps.find((s) => s.id === 'power-on')!;
    const irrelevant = context([
      { type: 'OPEN_VOLUMETRIC_VALVE' },
      { type: 'ADD_WEIGHT', massG: 500 },
      { type: 'SET_PUMP_FLOW', lPerMin: 60 },
    ]);
    expect(step.isSatisfied(irrelevant)).toBe(false);
    expect(step.isSatisfied(context([{ type: 'POWER_ON' }]))).toBe(true);
  });

  it('leaves install-deflector without a condition of its own, as today', () => {
    // Nothing observable marks a deflector as installed — the rod always carries one — so
    // the arrow stays up until the learner confirms. Pinned because it is a real quirk.
    const step = CURRENT_LESSON.steps.find((s) => s.id === 'install-deflector')!;
    expect(step.isSatisfied(context([{ type: 'OPEN_COVER' }]))).toBe(false);
    expect(step.advance.kind).toBe('confirm');
  });

  it('is deterministic', () => {
    const c = context([{ type: 'POWER_ON' }]);
    for (const step of CURRENT_LESSON.steps) {
      expect(step.isSatisfied(c)).toBe(step.isSatisfied(c));
    }
  });
});
