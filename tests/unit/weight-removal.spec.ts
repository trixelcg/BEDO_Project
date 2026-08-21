import { describe, expect, it, vi } from 'vitest';
import { attempt, restingState, type ApparatusState } from '../../src/domain/stateMachine';
import { createSimulationRuntime } from '../../src/simulation/runtime';
import { selectLoadedMassG, selectReadings } from '../../src/simulation/selectors';
import { evaluateInteraction } from '../../src/interaction/gate';
import { CURRENT_LESSON } from '../../src/lesson/currentLesson';

/**
 * Taking one disc back off the holder (BEDO-022, objective B).
 *
 * ## Source
 *
 * `Jetforce_Storyboard.pptx`, slide 32 — state **D, "The weights on the tank holder"**:
 *
 * > | Clickable Item | Next State | Transition | Event |
 * > | 5. Weights on holder | B | Click on the weight on holder | **The weight removed
 * >   from the tank holder in 2 sec.** |
 *
 * and slide 19, on the spring: *"moves downward when the weights are placed on the holder
 * and **moves upward when the weights are removed from it**"*.
 *
 * BEDO's separate state table (`Jet force_State machine.docx`) lists only clickables 1–7
 * and has no row for this eighth one; the storyboard's per-state slides are the fuller
 * specification and the one the app follows. See `docs/37 §7`.
 *
 * ## Identity
 *
 * By stack position. The pan can hold two 50 g discs, and mass is not an identity when it
 * is not unique — `docs/37 §8`.
 */

const loaded = (...grams: number[]): ApparatusState => ({
  ...restingState(90),
  loadedWeightsG: grams,
});

describe('the transition', () => {
  it('takes off the disc that was clicked', () => {
    const result = attempt(loaded(50, 100, 200), { type: 'REMOVE_WEIGHT', index: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.loadedWeightsG).toEqual([50, 200]);
  });

  it('takes off exactly one of two identical discs', () => {
    // The trap BEDO-022 §16 names: `filter(g => g !== 50)` would clear both.
    const result = attempt(loaded(50, 50), { type: 'REMOVE_WEIGHT', index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.loadedWeightsG).toEqual([50]);
  });

  it('distinguishes the two identical discs by position', () => {
    const three = loaded(50, 100, 50);
    for (const [index, expected] of [
      [0, [100, 50]],
      [2, [50, 100]],
    ] as const) {
      const result = attempt(three, { type: 'REMOVE_WEIGHT', index });
      expect(result.ok && result.state.loadedWeightsG, `index ${index}`).toEqual(expected);
    }
  });

  it('empties the pan when the last disc comes off', () => {
    const result = attempt(loaded(50), { type: 'REMOVE_WEIGHT', index: 0 });
    expect(result.ok && result.state.loadedWeightsG).toEqual([]);
  });

  it.each([-1, 1, 2, 99])('is a no-op at position %i, which holds no disc', (index) => {
    const before = loaded(50);
    const result = attempt(before, { type: 'REMOVE_WEIGHT', index });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    // Returned by identity, like every other transition that changes nothing.
    expect(result.state).toBe(before);
  });

  it('is a no-op on an empty pan', () => {
    const before = restingState(90);
    const result = attempt(before, { type: 'REMOVE_WEIGHT', index: 0 });
    expect(result.ok && result.changed).toBe(false);
    expect(result.ok && result.state).toBe(before);
  });

  it('never mutates the state it is given', () => {
    const before = loaded(50, 100);
    const snapshot = JSON.stringify(before);
    attempt(before, { type: 'REMOVE_WEIGHT', index: 0 });
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(before.loadedWeightsG).toEqual([50, 100]);
  });

  it('is allowed while the tank is open, because it is the way out of guard 5', () => {
    // Guard 5 is "remove all weights first before opening the tank". Refusing removal
    // with the tank open would be a deadlock, so removal is unguarded in the same way
    // clearing the tray always has been.
    const result = attempt({ ...loaded(50), isCoverOpen: true }, {
      type: 'REMOVE_WEIGHT',
      index: 0,
    });
    expect(result.ok && result.state.loadedWeightsG).toEqual([]);
  });

  it('leaves clear-all exactly as it was', () => {
    const result = attempt(loaded(50, 50, 100), { type: 'REMOVE_ALL_WEIGHTS' });
    expect(result.ok && result.state.loadedWeightsG).toEqual([]);
  });
});

describe('through the runtime', () => {
  const withWeights = (...grams: number[]) => {
    const runtime = createSimulationRuntime();
    for (const g of grams) runtime.dispatch({ type: 'ADD_WEIGHT', massG: g });
    return runtime;
  };

  it('commits the removal', () => {
    const runtime = withWeights(50, 100);
    const result = runtime.dispatch({ type: 'REMOVE_WEIGHT', index: 0 });
    expect(result.ok).toBe(true);
    expect(runtime.getState().apparatus.loadedWeightsG).toEqual([100]);
  });

  it('notifies subscribers exactly once', () => {
    const runtime = withWeights(50, 100);
    const listener = vi.fn();
    runtime.subscribe(listener);
    runtime.dispatch({ type: 'REMOVE_WEIGHT', index: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies nobody when nothing came off', () => {
    const runtime = withWeights(50);
    const listener = vi.fn();
    runtime.subscribe(listener);
    runtime.dispatch({ type: 'REMOVE_WEIGHT', index: 7 });
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.getState().apparatus.loadedWeightsG).toEqual([50]);
  });

  it('updates the derived mass and the measured force', () => {
    const runtime = withWeights(50, 20, 10);
    expect(selectLoadedMassG(runtime.getState())).toBe(80);

    runtime.dispatch({ type: 'REMOVE_WEIGHT', index: 2 });

    expect(selectLoadedMassG(runtime.getState())).toBe(70);
  });

  it('keeps the live reading in step with the pan', () => {
    const runtime = createSimulationRuntime();
    runtime.dispatch({ type: 'OPEN_COVER' });
    runtime.dispatch({ type: 'CLOSE_COVER' });
    runtime.dispatch({ type: 'POWER_ON' });
    runtime.dispatch({ type: 'SET_VALVE', opening: 0.4 });
    runtime.dispatch({ type: 'BEGIN_READING', index: 1 });
    runtime.dispatch({ type: 'ADD_WEIGHT', massG: 50 });
    runtime.dispatch({ type: 'ADD_WEIGHT', massG: 20 });
    runtime.dispatch({ type: 'ADD_WEIGHT', massG: 10 });
    expect(selectReadings(runtime.getState())[1].isBalanced).toBe(true);

    runtime.dispatch({ type: 'REMOVE_WEIGHT', index: 0 });

    const row = selectReadings(runtime.getState())[1];
    expect(row.loadedMassG).toBe(30);
    expect(row.isBalanced).toBe(false);
  });

  it('does not rewrite a reading that has already been committed', () => {
    // BEDO-022 §19: committed rows are snapshots. Emptying the pan for the next reading
    // must not erase the last one — which is exactly what the lesson does between
    // readings 1 and 2.
    const runtime = createSimulationRuntime();
    runtime.dispatch({ type: 'POWER_ON' });
    runtime.dispatch({ type: 'SET_VALVE', opening: 0.4 });
    runtime.dispatch({ type: 'BEGIN_READING', index: 1 });
    runtime.dispatch({ type: 'ADD_WEIGHT', massG: 50 });
    runtime.dispatch({ type: 'ADD_WEIGHT', massG: 20 });
    runtime.dispatch({ type: 'ADD_WEIGHT', massG: 10 });
    runtime.dispatch({ type: 'END_READING' });
    const committed = selectReadings(runtime.getState())[1].loadedMassG;
    expect(committed).toBe(80);

    runtime.dispatch({ type: 'REMOVE_WEIGHT', index: 0 });

    expect(selectReadings(runtime.getState())[1].loadedMassG).toBe(80);
  });
});

describe('through the gate', () => {
  const step = (id: string) => CURRENT_LESSON.steps.find((s) => s.id === id)!;
  const ask = (stepId: string, mode: 'guided' | 'free' = 'guided') =>
    evaluateInteraction({
      interaction: { kind: 'apparatus', action: { type: 'REMOVE_WEIGHT', index: 0 } },
      apparatus: loaded(50),
      experimentId: 'flat',
      step: step(stepId),
      lesson: CURRENT_LESSON,
      mode,
    });

  it('is available wherever adding a weight is', () => {
    // Removal inherits the `weights` affordance, so it is offered at exactly the steps
    // that invite the pan — no special case, and no "always allowed" escape hatch.
    for (const balanceStep of ['balance-reading-1', 'balance-reading-2']) {
      expect(ask(balanceStep), balanceStep).toEqual({ allowed: true, why: 'EXPECTED' });
    }
  });

  it('is refused where the pan is not the step’s business', () => {
    expect(ask('set-flow-reading-1')).toMatchObject({ allowed: false, blockedBy: 'lesson' });
  });

  it('cannot strand a learner who overloaded the pan', () => {
    // The recovery case BEDO-022 §12 is about: the step expects ADD_WEIGHT, the pan is
    // over the target, and both ways back must work.
    for (const action of [
      { type: 'REMOVE_WEIGHT', index: 0 },
      { type: 'REMOVE_ALL_WEIGHTS' },
    ] as const) {
      const decision = evaluateInteraction({
        interaction: { kind: 'apparatus', action },
        apparatus: loaded(500, 500),
        experimentId: 'flat',
        step: step('balance-reading-1'),
        lesson: CURRENT_LESSON,
        mode: 'guided',
      });
      expect(decision, action.type).toEqual({ allowed: true, why: 'EXPECTED' });
    }
  });

  it('is unrestricted in free mode', () => {
    expect(ask('unscrew-cover', 'free')).toEqual({ allowed: true, why: 'FREE_MODE' });
  });
});
