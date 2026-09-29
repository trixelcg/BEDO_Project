/**
 * The lesson runner.
 *
 * Owns where the learner is, and nothing else. It reads simulation state to decide
 * whether a step is finished; it never writes to it — when a step completes it *returns*
 * the commands the caller should dispatch, so the simulation stays the only thing that
 * mutates the rig.
 *
 * Plain TypeScript: no React, no renderer, no DOM. `tests/unit/lesson-runner.spec.ts`
 * walks the entire lesson without rendering anything.
 *
 * ```
 *   apparatus action happens
 *          ↓
 *   notify(expectation, context)      does this finish the current step?
 *          ↓
 *   confirm(context)                  or the learner pressed OK
 *          ↓
 *   { advanced, commands }            what the simulation should now be told
 * ```
 */

import type {
  Lesson,
  LessonContext,
  LessonExpectation,
  LessonStepDefinition,
  StepId,
} from './schema';
import type { SimulationCommand } from '../simulation/runtime';

/** Guided walks the learner through the steps; free lets them touch anything. */
export type LessonMode = 'guided' | 'free';

export interface LessonState {
  readonly mode: LessonMode;
  /** Where the learner is. In free mode the lesson idles on the first step, as today. */
  readonly currentStepId: StepId;
  /** True once the last step has been reached. */
  readonly isComplete: boolean;
}

export interface AdvanceResult {
  readonly advanced: boolean;
  /** Commands the caller should hand to the simulation, in order. */
  readonly commands: readonly SimulationCommand[];
  /** The step that just finished, if one did — the caller raises its observation popup. */
  readonly completedStepId: StepId | null;
}

export interface LessonRunner {
  getState(): LessonState;
  getCurrentStep(): LessonStepDefinition;
  setMode(mode: LessonMode): void;

  /** Has the current step's goal been reached? Drives the guide arrow. */
  isSatisfied(context: LessonContext): boolean;
  /** Should the OK button be on screen? */
  canConfirm(context: LessonContext): boolean;

  /** The learner pressed OK. */
  confirm(context: LessonContext): AdvanceResult;
  /**
   * An action happened. Advances if the current step was waiting for exactly that and
   * completes on the action, or if it is a `condition` step whose goal now holds.
   */
  notify(expectation: LessonExpectation['type'], context: LessonContext): AdvanceResult;
  /**
   * The rig changed, by whatever route (F14). Finishes the current step if it is a
   * `condition` step and its goal now holds; otherwise does nothing.
   *
   * One step at a time: the caller dispatches the finished step's commands and asks
   * again, because the next step's condition must be read against the rig *after* them.
   */
  sync(context: LessonContext): AdvanceResult;

  /** True once the lesson has reached or passed a step — semantic, not a number. */
  hasReached(id: StepId): boolean;
  /**
   * True once the lesson has moved **past** a step — semantic, not a number.
   *
   * The distinction `hasReached` cannot draw, and it matters: standing *on* the step that
   * asks a learner to install a deflector is precisely when the deflector must still be on
   * the tray for them to install (`BEDO-021`, `docs/38 §3.1`). Free mode, which idles on
   * the first step, has completed nothing.
   */
  hasCompleted(id: StepId): boolean;

  reset(): void;
  subscribe(listener: (state: LessonState) => void): () => void;
}

const NOTHING: AdvanceResult = { advanced: false, commands: [], completedStepId: null };

export function createLessonRunner(
  lesson: Lesson,
  options: { mode?: LessonMode } = {}
): LessonRunner {
  const first = lesson.steps[0];
  let state: LessonState = {
    mode: options.mode ?? 'guided',
    currentStepId: first.id,
    isComplete: false,
  };
  const listeners = new Set<(state: LessonState) => void>();

  const indexOf = (id: StepId) => lesson.steps.findIndex((step) => step.id === id);
  const current = () => lesson.steps[indexOf(state.currentStepId)] ?? first;

  const set = (next: LessonState) => {
    if (
      next.mode === state.mode &&
      next.currentStepId === state.currentStepId &&
      next.isComplete === state.isComplete
    ) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) listener(state);
  };

  /** Moves to the next step, collecting whatever the finished step asks the rig to do. */
  const complete = (step: LessonStepDefinition): AdvanceResult => {
    const index = indexOf(step.id);
    const next = lesson.steps[index + 1];
    set({
      ...state,
      currentStepId: next ? next.id : step.id,
      isComplete: next === undefined,
    });
    return {
      advanced: true,
      commands: step.onComplete ?? [],
      completedStepId: step.id,
    };
  };

  return {
    getState: () => state,
    getCurrentStep: current,

    setMode(mode) {
      set({ ...state, mode });
    },

    isSatisfied(context) {
      return current().isSatisfied(context);
    },

    canConfirm(context) {
      if (state.mode !== 'guided' || state.isComplete) return false;
      const step = current();
      return step.advance.kind === 'confirm' && step.advance.when(context);
    },

    confirm(context) {
      if (state.mode !== 'guided' || state.isComplete) return NOTHING;
      const step = current();
      if (step.advance.kind !== 'confirm') return NOTHING;
      // The OK button is only offered when `when` holds, but a caller may ask anyway.
      if (!step.advance.when(context)) return NOTHING;
      return complete(step);
    },

    sync(context) {
      if (state.mode !== 'guided' || state.isComplete) return NOTHING;
      const step = current();
      if (step.advance.kind !== 'condition') return NOTHING;
      if (!step.isSatisfied(context)) return NOTHING;
      return complete(step);
    },

    notify(expectation, context) {
      if (state.mode !== 'guided' || state.isComplete) return NOTHING;
      const step = current();
      if (step.advance.kind === 'condition') {
        return step.isSatisfied(context) ? complete(step) : NOTHING;
      }
      const completesOnThisAction =
        (step.advance.kind === 'action' && step.expectation?.type === expectation) ||
        step.alsoCompletesOn === expectation;
      if (!completesOnThisAction) return NOTHING;
      if (!step.isSatisfied(context)) return NOTHING;
      return complete(step);
    },

    hasReached(id) {
      const target = indexOf(id);
      return target !== -1 && indexOf(state.currentStepId) >= target;
    },

    hasCompleted(id) {
      const target = indexOf(id);
      if (target === -1) return false;
      // Finishing the last step leaves it current, flagged complete: it is done too.
      return indexOf(state.currentStepId) > target || (state.isComplete && indexOf(state.currentStepId) >= target);
    },

    reset() {
      set({ ...state, currentStepId: first.id, isComplete: false });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
