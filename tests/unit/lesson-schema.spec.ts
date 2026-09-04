import { FIRST_READING_VALVE, SECOND_READING_VALVE } from '../../src/domain/physics';
import { describe, expect, it } from 'vitest';
import { CURRENT_LESSON, CURRENT_LESSON_STEP_COUNT } from '../../src/lesson/currentLesson';
import { stepIndex, type LessonContext, type StepId } from '../../src/lesson/schema';
import { createInitialSimulationState } from '../../src/simulation/state';
import { selectLiveRow, selectReadings } from '../../src/simulation/selectors';
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
  const state = runtime.getState();
  return { simulation: state, readings: selectReadings(state), liveRow: selectLiveRow(state) };
};

/**
 * The canonical eleven, in order (BEDO-019).
 *
 * Nine apparatus steps, then Calculate, then the closing step that opens the answer sheet —
 * exactly the sequence all four BEDO experiment sheets specify (`docs/32 §3`). The
 * volumetric valve is absent because it appears in none of them.
 */
const EXPECTED_ORDER: StepId[] = [
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
];

describe('definition integrity', () => {
  it('is the canonical eleven steps, in order', () => {
    expect(CURRENT_LESSON.steps.map((s) => s.id)).toEqual(EXPECTED_ORDER);
    expect(CURRENT_LESSON_STEP_COUNT).toBe(11);
  });

  it('gives every step a unique id', () => {
    const ids = CURRENT_LESSON.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers them 1..11 for display, once each', () => {
    const numbers = CURRENT_LESSON.steps.map((s) => s.displayNumber);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(numbers).size).toBe(numbers.length);
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
        expect(['record-actual-force', 'open-answer-sheet']).toContain(step.id);
      }
    }
  });

  it('only ever highlights parts a learner can act on', () => {
    const known = ['cover', 'deflectors', 'power', 'volumetricValve', 'flowValve', 'weights'];
    for (const step of CURRENT_LESSON.steps) {
      for (const key of step.highlight) expect(known).toContain(key);
    }
  });

  it('records a reading only from the steps that balance one', () => {
    // `BALANCE_ROW = { 7: 1, 9: 2 }` is gone, and so is the index it carried: a step no
    // longer says *which* row it writes, only that confirming it takes a reading.
    const readingCommands = CURRENT_LESSON.steps.flatMap((step) =>
      (step.onComplete ?? []).map((command) => [step.id, command] as const)
    );
    const records = readingCommands
      .filter(([, c]) => c.type === 'RECORD_READING')
      .map(([id]) => id);
    expect(records).toEqual(['balance-reading-1', 'balance-reading-2']);
  });

  it('never empties the tray as a step completes', () => {
    // The pan is cumulative across readings, as it is on the apparatus. Clearing it here
    // is what made the board read "Total Weight 0 g" beside a recorded row of 250 g.
    const clears = CURRENT_LESSON.steps.flatMap((step) =>
      (step.onComplete ?? []).filter((c) => c.type === 'REMOVE_ALL_WEIGHTS')
    );
    expect(clears).toEqual([]);
  });
});

describe('identity is the id, not the position', () => {
  it('finds a step by name wherever it sits', () => {
    expect(stepIndex(CURRENT_LESSON, 'balance-reading-1')).toBe(5);
    // The number is metadata hanging off the definition, not the way it is found. It moved
    // from 7 to 6 in BEDO-019 and no code noticed.
    const step = CURRENT_LESSON.steps.find((s) => s.id === 'balance-reading-1')!;
    expect(step.displayNumber).toBe(6);
  });

  it('survives renumbering — BEDO-019 changes data, not code', () => {
    // Renumber every step and the schema still resolves by name. This is the property
    // that makes the canonical 11-step migration a content change.
    const renumbered = {
      steps: CURRENT_LESSON.steps.map((step, i) => ({ ...step, displayNumber: i + 100 })),
    };
    expect(stepIndex(renumbered, 'open-monitor')).toBe(stepIndex(CURRENT_LESSON, 'open-monitor'));
    expect(renumbered.steps.find((s) => s.id === 'open-answer-sheet')!.displayNumber).toBe(110);
  });
});

describe('completion conditions', () => {
  // Each row: the step, a state where it is not satisfied, and the commands that satisfy
  // it. Every condition reads simulation state — none depends on a click having happened.
  const CASES: Array<{ id: StepId; satisfyWith: SimulationCommand[] }> = [
    { id: 'unscrew-cover', satisfyWith: [{ type: 'OPEN_COVER' }] },
    { id: 'mount-cover', satisfyWith: [] }, // satisfied at rest: the cover starts shut
    { id: 'power-on', satisfyWith: [{ type: 'POWER_ON' }] },
    {
      id: 'set-flow-reading-1',
      satisfyWith: [{ type: 'POWER_ON' }, { type: 'SET_VALVE', opening: FIRST_READING_VALVE }],
    },
    {
      // 80 g against the 83.58 g the jet asks for at this opening.
      id: 'balance-reading-1',
      satisfyWith: [
        { type: 'POWER_ON' },
        { type: 'SET_VALVE', opening: FIRST_READING_VALVE },
        { type: 'ADD_WEIGHT', massG: 50 },
        { type: 'ADD_WEIGHT', massG: 20 },
        { type: 'ADD_WEIGHT', massG: 10 },
      ],
    },
    {
      id: 'increase-flow-reading-2',
      satisfyWith: [{ type: 'POWER_ON' }, { type: 'SET_VALVE', opening: SECOND_READING_VALVE }],
    },
    {
      // 260 g against 257.93 g at the second setpoint.
      id: 'balance-reading-2',
      satisfyWith: [
        { type: 'POWER_ON' },
        { type: 'SET_VALVE', opening: SECOND_READING_VALVE },
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
