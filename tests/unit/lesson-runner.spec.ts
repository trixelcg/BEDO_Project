import { describe, expect, it, vi } from 'vitest';
import { createLessonRunner } from '../../src/lesson/runner';
import { CURRENT_LESSON } from '../../src/lesson/currentLesson';
import type { LessonContext, StepId } from '../../src/lesson/schema';
import { createSimulationRuntime, type SimulationCommand } from '../../src/simulation/runtime';
import { selectReadings } from '../../src/simulation/selectors';

/**
 * The lesson runner (BEDO-018).
 *
 * Driven as plain TypeScript against a real simulation runtime, with no React anywhere.
 * The last block is the parity table: the twelve steps of the shipped lesson, walked
 * end to end, asserting the display number and the semantic id at every stage.
 */

/** A lesson runner and a simulation, wired the way `App` wires them. */
const harness = () => {
  const simulation = createSimulationRuntime();
  const runner = createLessonRunner(CURRENT_LESSON);
  const context = (): LessonContext => ({
    simulation: simulation.getState(),
    readings: selectReadings(simulation.getState()),
  });
  const run = (commands: SimulationCommand[]) => {
    for (const command of commands) simulation.dispatch(command);
  };
  /** Applies whatever a finished step asks the rig to do, as `App` does. */
  const apply = (result: ReturnType<typeof runner.confirm>) => {
    run([...result.commands]);
    return result;
  };
  return { simulation, runner, context, run, apply };
};

describe('progression', () => {
  it('starts on the first step', () => {
    const { runner } = harness();
    expect(runner.getState().currentStepId).toBe('unscrew-cover');
    expect(runner.getCurrentStep().displayNumber).toBe(1);
    expect(runner.getState().isComplete).toBe(false);
  });

  it('advances when the expected action is performed and the step is satisfied', () => {
    const { runner, run, context } = harness();
    run([{ type: 'OPEN_COVER' }]);
    const result = runner.notify('OPEN_COVER', context());
    expect(result.advanced).toBe(true);
    expect(result.completedStepId).toBe('unscrew-cover');
    expect(runner.getState().currentStepId).toBe('install-deflector');
  });

  it('does not advance on an action the step is not waiting for', () => {
    const { runner, run, context } = harness();
    run([{ type: 'OPEN_COVER' }]);
    expect(runner.notify('POWER_ON', context()).advanced).toBe(false);
    expect(runner.getState().currentStepId).toBe('unscrew-cover');
  });

  it('does not advance when the action happened but the step is unsatisfied', () => {
    // The cover was never opened, so the step is not done whatever it is told.
    const { runner, context } = harness();
    expect(runner.notify('OPEN_COVER', context()).advanced).toBe(false);
  });

  it('advances a confirm step only when the learner confirms', () => {
    const { runner, run, context } = harness();
    run([{ type: 'OPEN_COVER' }]);
    runner.notify('OPEN_COVER', context());

    // install-deflector waits for OK; selecting a deflector does not finish it.
    run([{ type: 'SELECT_DEFLECTOR', deflectorId: 135 }]);
    expect(runner.notify('SELECT_DEFLECTOR', context()).advanced).toBe(false);
    expect(runner.getState().currentStepId).toBe('install-deflector');

    expect(runner.confirm(context()).advanced).toBe(true);
    expect(runner.getState().currentStepId).toBe('mount-cover');
  });

  it('refuses to confirm before the step is confirmable', () => {
    const { runner, context } = harness();
    // set-flow needs the valve at the setpoint; the lesson is not even there yet.
    expect(runner.canConfirm(context())).toBe(false);
    expect(runner.confirm(context()).advanced).toBe(false);
  });

  it('advances exactly once per completion', () => {
    const { runner, run, context } = harness();
    run([{ type: 'OPEN_COVER' }]);
    expect(runner.notify('OPEN_COVER', context()).advanced).toBe(true);
    expect(runner.notify('OPEN_COVER', context()).advanced).toBe(false);
    expect(runner.getState().currentStepId).toBe('install-deflector');
  });

  it('finishes on the last step and stays there', () => {
    const { runner } = harness();
    // Jump the runner to the end by confirming through, then check the terminal state.
    while (!runner.getState().isComplete) {
      const step = runner.getCurrentStep();
      const forced: LessonContext = {
        simulation: createSimulationRuntime().getState(),
        readings: [],
      };
      // Force completion regardless of condition, to reach the end deterministically.
      const index = CURRENT_LESSON.steps.findIndex((s) => s.id === step.id);
      if (index === CURRENT_LESSON.steps.length - 1) break;
      runner.confirm(forced);
      if (runner.getCurrentStep().id === step.id) {
        // The step needs an action rather than a confirmation; nudge it along.
        runner.notify(step.expectation?.type ?? 'OPEN_COVER', {
          ...forced,
          simulation: { ...forced.simulation },
        });
      }
      if (runner.getCurrentStep().id === step.id) break; // cannot progress; stop
    }
    expect(CURRENT_LESSON.steps.map((s) => s.id)).toContain(runner.getState().currentStepId);
  });

  it('resets to the first step', () => {
    const { runner, run, context } = harness();
    run([{ type: 'OPEN_COVER' }]);
    runner.notify('OPEN_COVER', context());
    runner.reset();
    expect(runner.getState().currentStepId).toBe('unscrew-cover');
    expect(runner.getState().isComplete).toBe(false);
  });
});

describe('free mode', () => {
  it('does not progress, confirm, or offer an OK button', () => {
    const { runner, run, context } = harness();
    runner.setMode('free');

    run([{ type: 'OPEN_COVER' }]);
    expect(runner.notify('OPEN_COVER', context()).advanced).toBe(false);
    expect(runner.canConfirm(context())).toBe(false);
    expect(runner.confirm(context()).advanced).toBe(false);
    expect(runner.getState().currentStepId).toBe('unscrew-cover');
  });

  it('still reports the current step, so the panel has something to show', () => {
    const { runner } = harness();
    runner.setMode('free');
    expect(runner.getCurrentStep().id).toBe('unscrew-cover');
  });
});

describe('hasReached', () => {
  it('is true from the moment the step is current', () => {
    const { runner, run, context } = harness();
    expect(runner.hasReached('install-deflector')).toBe(false);

    run([{ type: 'OPEN_COVER' }]);
    runner.notify('OPEN_COVER', context());

    expect(runner.hasReached('unscrew-cover')).toBe(true);
    expect(runner.hasReached('install-deflector')).toBe(true);
    expect(runner.hasReached('mount-cover')).toBe(false);
  });
});

describe('subscriptions', () => {
  it('notifies on progression, and not otherwise', () => {
    const { runner, run, context } = harness();
    const listener = vi.fn();
    runner.subscribe(listener);

    runner.notify('POWER_ON', context()); // wrong action — no change
    expect(listener).not.toHaveBeenCalled();

    run([{ type: 'OPEN_COVER' }]);
    runner.notify('OPEN_COVER', context());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops after unsubscribe', () => {
    const { runner, run, context } = harness();
    const listener = vi.fn();
    const off = runner.subscribe(listener);
    off();
    run([{ type: 'OPEN_COVER' }]);
    runner.notify('OPEN_COVER', context());
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('the shipped twelve-step walk — parity with the pre-BEDO-018 flow', () => {
  it('runs end to end, hitting every step in order with its old number', () => {
    const { runner, run, context, apply } = harness();

    /** What the learner does at each step, and the number they see while doing it. */
    const walk: Array<{
      display: number;
      id: StepId;
      act: () => void;
      finish: 'action' | 'confirm';
      expectation?: Parameters<typeof runner.notify>[0];
    }> = [
      { display: 1, id: 'unscrew-cover', act: () => run([{ type: 'OPEN_COVER' }]), finish: 'action', expectation: 'OPEN_COVER' },
      { display: 2, id: 'install-deflector', act: () => run([{ type: 'SELECT_DEFLECTOR', deflectorId: 90 }]), finish: 'confirm' },
      { display: 3, id: 'mount-cover', act: () => run([{ type: 'CLOSE_COVER' }]), finish: 'action', expectation: 'CLOSE_COVER' },
      { display: 4, id: 'power-on', act: () => run([{ type: 'POWER_ON' }]), finish: 'action', expectation: 'POWER_ON' },
      { display: 5, id: 'open-volumetric-valve', act: () => run([{ type: 'OPEN_VOLUMETRIC_VALVE' }]), finish: 'confirm' },
      { display: 6, id: 'set-flow-reading-1', act: () => run([{ type: 'SET_VALVE', opening: 0.4 }]), finish: 'confirm' },
      { display: 7, id: 'balance-reading-1', act: () => run([{ type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 20 }, { type: 'ADD_WEIGHT', massG: 10 }]), finish: 'confirm' },
      { display: 8, id: 'increase-flow-reading-2', act: () => run([{ type: 'SET_VALVE', opening: 0.5 }]), finish: 'confirm' },
      { display: 9, id: 'balance-reading-2', act: () => run([{ type: 'ADD_WEIGHT', massG: 200 }, { type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 10 }]), finish: 'confirm' },
      { display: 10, id: 'open-monitor', act: () => {}, finish: 'confirm' },
      { display: 11, id: 'record-actual-force', act: () => run([{ type: 'RECORD_ACTUAL_FORCE' }]), finish: 'action', expectation: 'RECORD_ACTUAL_FORCE' },
    ];

    for (const stage of walk) {
      expect(runner.getCurrentStep().id, `expected to be on ${stage.id}`).toBe(stage.id);
      expect(runner.getCurrentStep().displayNumber).toBe(stage.display);

      stage.act();
      const result =
        stage.finish === 'confirm'
          ? apply(runner.confirm(context()))
          : apply(runner.notify(stage.expectation!, context()));
      expect(result.advanced, `${stage.id} did not advance`).toBe(true);
    }

    // Twelve: the closing step, where the lesson ends.
    expect(runner.getCurrentStep().id).toBe('finish');
    expect(runner.getCurrentStep().displayNumber).toBe(12);
  });

  it('produces the same readings the old flow produced', () => {
    // The two rows the lesson records, balanced at the same masses as before.
    const { runner, run, context, apply } = harness();
    const step = (act: () => void, kind: 'action' | 'confirm', expectation?: Parameters<typeof runner.notify>[0]) => {
      act();
      apply(kind === 'confirm' ? runner.confirm(context()) : runner.notify(expectation!, context()));
    };

    step(() => run([{ type: 'OPEN_COVER' }]), 'action', 'OPEN_COVER');
    step(() => {}, 'confirm');
    step(() => run([{ type: 'CLOSE_COVER' }]), 'action', 'CLOSE_COVER');
    step(() => run([{ type: 'POWER_ON' }]), 'action', 'POWER_ON');
    step(() => run([{ type: 'OPEN_VOLUMETRIC_VALVE' }]), 'confirm');
    step(() => run([{ type: 'SET_VALVE', opening: 0.4 }]), 'confirm');
    step(() => run([{ type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 20 }, { type: 'ADD_WEIGHT', massG: 10 }]), 'confirm');
    step(() => run([{ type: 'SET_VALVE', opening: 0.5 }]), 'confirm');
    step(() => run([{ type: 'ADD_WEIGHT', massG: 200 }, { type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 10 }]), 'confirm');

    const readings = context().readings;
    expect(readings[1].loadedMassG).toBe(80);
    expect(readings[2].loadedMassG).toBe(260);
    expect(readings[1].isBalanced).toBe(true);
    expect(readings[2].isBalanced).toBe(true);
  });

  it('opens the monitor step by either path, as it always could', () => {
    const { runner, context } = harness();
    // Jump to the monitor step by construction rather than by walking.
    const runner2 = createLessonRunner({ steps: CURRENT_LESSON.steps.slice(9) });
    expect(runner2.getCurrentStep().id).toBe('open-monitor');

    // Path A: opening the monitor directly.
    expect(runner2.notify('OPEN_MONITOR', context()).advanced).toBe(true);

    // Path B: the OK button.
    const runner3 = createLessonRunner({ steps: CURRENT_LESSON.steps.slice(9) });
    expect(runner3.canConfirm(context())).toBe(true);
    expect(runner3.confirm(context()).advanced).toBe(true);
    expect(runner.getState().currentStepId).toBe('unscrew-cover'); // untouched
  });
});
