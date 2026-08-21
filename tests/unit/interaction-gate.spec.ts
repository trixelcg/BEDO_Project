import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALL_AFFORDANCES,
  affordanceOf,
  affordancesAvailableAt,
  availableAffordances,
  evaluateInteraction,
  type Interaction,
  type InteractionAffordance,
} from '../../src/interaction/gate';
import { CURRENT_LESSON } from '../../src/lesson/currentLesson';
import { restingState, type ApparatusAction, type ApparatusState } from '../../src/domain/stateMachine';
import type { StepId } from '../../src/domain/experiments';

/**
 * The interaction gate (BEDO-020).
 *
 * `BUG-04`: the guided panel enforced the lesson by hiding buttons, which the 3D scene
 * could not do, so every hotspot dispatched at every step. These tests are about the one
 * function both surfaces now ask.
 *
 * Everything here is pure — no React, no scene, no DOM. The gate is a function of
 * (interaction, apparatus state, step, lesson, mode) and nothing else, which is what makes
 * the parity claim testable at all.
 */

const step = (id: StepId) => {
  const found = CURRENT_LESSON.steps.find((s) => s.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
};

const apparatus = (over: Partial<ApparatusState> = {}): ApparatusState => ({
  ...restingState(90), // Exp. 1's flat plate
  ...over,
});

const ask = (
  interaction: Interaction,
  stepId: StepId,
  over: Partial<ApparatusState> = {},
  mode: 'guided' | 'free' = 'guided'
) =>
  evaluateInteraction({
    interaction,
    apparatus: apparatus(over),
    step: step(stepId),
    lesson: CURRENT_LESSON,
    mode,
  });

const act = (action: ApparatusAction): Interaction => ({ kind: 'apparatus', action });

/**
 * One action per affordance, each paired with a rig state that makes it *mechanically*
 * legal — so that whenever these are refused, the lesson is the only thing refusing.
 *
 * The pairing matters: `SET_VALVE` needs a running pump and `SELECT_DEFLECTOR` needs an
 * open tank, and a shared resting state would have the apparatus answering half of these
 * tests while they claimed to be about the lesson.
 */
const LEGAL: ReadonlyArray<
  readonly [InteractionAffordance, ApparatusAction, Partial<ApparatusState>]
> = [
  ['cover', { type: 'OPEN_COVER' }, {}],
  ['deflectors', { type: 'SELECT_DEFLECTOR', deflectorId: 1 }, { isCoverOpen: true }],
  ['power', { type: 'POWER_ON' }, {}],
  ['volumetricValve', { type: 'OPEN_VOLUMETRIC_VALVE' }, {}],
  ['flowValve', { type: 'SET_VALVE', opening: 0.4 }, { isPowerOn: true }],
  ['weights', { type: 'ADD_WEIGHT', massG: 50 }, {}],
];

describe('guided mode', () => {
  it('allows the action the step is asking for', () => {
    expect(ask(act({ type: 'OPEN_COVER' }), 'unscrew-cover')).toEqual({
      allowed: true,
      why: 'EXPECTED',
    });
    expect(ask(act({ type: 'POWER_ON' }), 'power-on')).toEqual({
      allowed: true,
      why: 'EXPECTED',
    });
    expect(ask(act({ type: 'SET_VALVE', opening: 0.4 }), 'set-flow-reading-1', {
      isPowerOn: true,
    })).toEqual({ allowed: true, why: 'EXPECTED' });
  });

  it('blocks a mechanically legal action the step did not ask for', () => {
    // The BUG-04 case exactly: the power switch is a live mesh in the scene at step 1,
    // the cover is closed, and turning the pump on is perfectly safe. It is simply not
    // what step 1 is about.
    expect(ask(act({ type: 'POWER_ON' }), 'unscrew-cover')).toEqual({
      allowed: false,
      blockedBy: 'lesson',
      reason: 'NOT_EXPECTED_IN_CURRENT_STEP',
      affordance: 'power',
    });
  });

  it('blocks powering the pump *off* in the middle of a reading', () => {
    // Before the gate this worked from the 3D switch, mid-reading, silently.
    const decision = ask(act({ type: 'POWER_OFF' }), 'set-flow-reading-1', {
      isPowerOn: true,
    });
    expect(decision).toMatchObject({ allowed: false, blockedBy: 'lesson' });
  });

  it('allows clearing the tray at a balance step, which is the recovery path', () => {
    // `REMOVE_ALL_WEIGHTS` is no step's expectation, so a gate keyed on expectations
    // alone would strand a learner who overloaded the pan. Keying on the affordance the
    // step invites — `weights` — keeps the escape hatch open.
    expect(
      ask(act({ type: 'REMOVE_ALL_WEIGHTS' }), 'balance-reading-1', {
        isPowerOn: true,
        loadedWeightsG: [500],
      })
    ).toEqual({ allowed: true, why: 'EXPECTED' });
  });

  it.each(CURRENT_LESSON.steps.map((s) => s.id))(
    'blocks every affordance the step does not invite — %s',
    (id) => {
      const invited = affordancesAvailableAt(CURRENT_LESSON, step(id));
      for (const [affordance, action, state] of LEGAL) {
        if (invited.has(affordance)) continue;
        // Mechanically fine, so a refusal here can only be the lesson's.
        expect(ask(act(action), id, state), `${affordance} at ${id}`).toEqual({
          allowed: false,
          blockedBy: 'lesson',
          reason: 'NOT_EXPECTED_IN_CURRENT_STEP',
          affordance,
        });
      }
    }
  );
});

describe('always available', () => {
  it('accepts the volumetric valve at every one of the eleven steps', () => {
    // BEDO-019 took the valve's step number away and kept the valve. This is the
    // regression that proves BEDO-020 did not quietly take the valve away too.
    for (const s of CURRENT_LESSON.steps) {
      expect(ask(act({ type: 'OPEN_VOLUMETRIC_VALVE' }), s.id), s.id).toEqual({
        allowed: true,
        why: 'ALWAYS_AVAILABLE',
      });
      expect(ask(act({ type: 'CLOSE_VOLUMETRIC_VALVE' }), s.id), s.id).toEqual({
        allowed: true,
        why: 'ALWAYS_AVAILABLE',
      });
    }
  });

  it('reads the lesson, and does not name the valve', () => {
    // Remove the metadata and the permission goes with it — the gate has no opinion of
    // its own about which control this is.
    const withoutAlwaysAvailable = { ...CURRENT_LESSON, alwaysAvailable: [] };
    const decision = evaluateInteraction({
      interaction: act({ type: 'OPEN_VOLUMETRIC_VALVE' }),
      apparatus: apparatus(),
      step: step('unscrew-cover'),
      lesson: withoutAlwaysAvailable,
      mode: 'guided',
    });
    expect(decision).toMatchObject({ allowed: false, blockedBy: 'lesson' });
  });

  it('still obeys the apparatus', () => {
    // Always available is not "always accepted": the valve needs a running pump, and
    // that refusal comes from the rig, not the lesson.
    expect(ask(act({ type: 'OPEN_VOLUMETRIC_VALVE' }), 'unscrew-cover')).toMatchObject({
      allowed: true,
    });
    // (the resting rig permits it; VALVE_NEEDS_RUNNING_PUMP guards the flow valve)
    expect(ask(act({ type: 'SET_VALVE', opening: 0.4 }), 'set-flow-reading-1')).toEqual({
      allowed: false,
      blockedBy: 'apparatus',
      reason: 'VALVE_NEEDS_RUNNING_PUMP',
    });
  });
});

describe('free mode', () => {
  it('never lesson-blocks a mechanically legal action, at any step', () => {
    for (const s of CURRENT_LESSON.steps) {
      for (const [, action, state] of LEGAL) {
        expect(ask(act(action), s.id, state, 'free'), `${action.type} at ${s.id}`).toEqual({
          allowed: true,
          why: 'FREE_MODE',
        });
      }
    }
  });

  it('keeps the safety guards', () => {
    expect(ask(act({ type: 'ADD_WEIGHT', massG: 50 }), 'unscrew-cover', { isCoverOpen: true }, 'free')).toEqual({
      allowed: false,
      blockedBy: 'apparatus',
      reason: 'WEIGHTS_BLOCKED_BY_OPEN_COVER',
    });
  });

  it('opens every affordance to the scene', () => {
    expect([...availableAffordances(CURRENT_LESSON, step('unscrew-cover'), 'free')].sort()).toEqual(
      [...ALL_AFFORDANCES].sort()
    );
  });
});

describe('precedence', () => {
  /**
   * When an action is both unsafe and premature the learner gets the *safety* reason.
   *
   * `attempt()` is pure, so asking it first commits nothing — the choice is purely about
   * which sentence is more use. "You can't add weights while the tank is open" is one of
   * BEDO's five documented rules and describes the real rig; "not this step" describes the
   * software. See `docs/36 §5`.
   */
  it('reports the apparatus reason when both would refuse', () => {
    // Step 2 asks for a deflector and the tank is open, so weights are both unsafe and
    // off-script.
    expect(
      ask(act({ type: 'ADD_WEIGHT', massG: 50 }), 'install-deflector', { isCoverOpen: true })
    ).toEqual({
      allowed: false,
      blockedBy: 'apparatus',
      reason: 'WEIGHTS_BLOCKED_BY_OPEN_COVER',
    });
  });

  it('reports the lesson reason when only the lesson refuses', () => {
    expect(ask(act({ type: 'OPEN_COVER' }), 'power-on')).toEqual({
      allowed: false,
      blockedBy: 'lesson',
      reason: 'NOT_EXPECTED_IN_CURRENT_STEP',
      affordance: 'cover',
    });
  });

  it('reports the apparatus reason at the very step that asks for the action', () => {
    // Step 4 asks the learner to power on; with the tank open the rig still refuses, and
    // this is the message the app has shown since long before BEDO-020.
    expect(ask(act({ type: 'POWER_ON' }), 'power-on', { isCoverOpen: true })).toEqual({
      allowed: false,
      blockedBy: 'apparatus',
      reason: 'POWER_BLOCKED_BY_OPEN_COVER',
    });
  });

  it('keeps the two vocabularies disjoint', () => {
    // A lesson refusal must never be mistakable for a safety guard, or the presentation
    // layer cannot choose between a red banner and a blue notice.
    const lessonReasons = ['NOT_EXPECTED_IN_CURRENT_STEP'];
    const apparatusReasons = [
      'WEIGHTS_BLOCKED_BY_OPEN_COVER',
      'DEFLECTOR_NEEDS_OPEN_COVER',
      'COVER_BLOCKED_BY_POWER',
      'POWER_BLOCKED_BY_OPEN_COVER',
      'COVER_BLOCKED_BY_WEIGHTS',
      'VALVE_NEEDS_RUNNING_PUMP',
    ];
    expect(lessonReasons.filter((r) => apparatusReasons.includes(r))).toEqual([]);
  });
});

describe('presentation interactions', () => {
  it('offers the answer sheet only at the closing step', () => {
    for (const s of CURRENT_LESSON.steps) {
      const decision = ask({ kind: 'presentation', action: 'OPEN_ANSWER_SHEET' }, s.id);
      expect(decision.allowed, s.id).toBe(s.id === 'open-answer-sheet');
    }
  });

  it('offers the monitor once the readings are taken', () => {
    expect(ask({ kind: 'presentation', action: 'OPEN_MONITOR' }, 'open-monitor').allowed).toBe(true);
    expect(ask({ kind: 'presentation', action: 'OPEN_MONITOR' }, 'unscrew-cover').allowed).toBe(false);
  });

  it('does not put a screen through the apparatus state machine', () => {
    // The tank is open, which refuses several apparatus actions. It has nothing to say
    // about a monitor, and the gate must not invent an opinion.
    const decision = ask({ kind: 'presentation', action: 'OPEN_MONITOR' }, 'open-monitor', {
      isCoverOpen: true,
    });
    expect(decision).toEqual({ allowed: true, why: 'EXPECTED' });
  });
});

describe('affordance mapping', () => {
  it('is total over every apparatus action', () => {
    const actions: ApparatusAction[] = [
      { type: 'OPEN_COVER' },
      { type: 'CLOSE_COVER' },
      { type: 'POWER_ON' },
      { type: 'POWER_OFF' },
      { type: 'SET_VALVE', opening: 0.4 },
      { type: 'OPEN_VOLUMETRIC_VALVE' },
      { type: 'CLOSE_VOLUMETRIC_VALVE' },
      { type: 'SELECT_DEFLECTOR', deflectorId: 1 },
      { type: 'ADD_WEIGHT', massG: 50 },
      { type: 'REMOVE_ALL_WEIGHTS' },
    ];
    for (const action of actions) {
      expect(ALL_AFFORDANCES, action.type).toContain(affordanceOf(act(action)));
    }
  });

  it('puts both directions of a two-way control on one affordance', () => {
    expect(affordanceOf(act({ type: 'OPEN_COVER' }))).toBe(affordanceOf(act({ type: 'CLOSE_COVER' })));
    expect(affordanceOf(act({ type: 'POWER_ON' }))).toBe(affordanceOf(act({ type: 'POWER_OFF' })));
  });
});

describe('determinism', () => {
  it('returns the same decision for the same inputs', () => {
    const once = ask(act({ type: 'POWER_ON' }), 'unscrew-cover');
    for (let i = 0; i < 50; i++) {
      expect(ask(act({ type: 'POWER_ON' }), 'unscrew-cover')).toEqual(once);
    }
  });

  it('does not mutate the state it is given', () => {
    const state = apparatus({ isPowerOn: true, loadedWeightsG: [50] });
    const before = JSON.stringify(state);
    evaluateInteraction({
      interaction: act({ type: 'OPEN_COVER' }),
      apparatus: state,
      step: step('unscrew-cover'),
      lesson: CURRENT_LESSON,
      mode: 'guided',
    });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('source', () => {
  const source = readFileSync(resolve(__dirname, '../../src/interaction/gate.ts'), 'utf8');
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = stripComments(source);

  it('decides nothing from a step number', () => {
    // The property BEDO-018 bought: renumbering the lesson must not change the policy.
    expect(code).not.toMatch(/displayNumber/);
    expect(code).not.toMatch(/totalSteps/);
  });

  it('names no mesh, no button and no specific control', () => {
    expect(code).not.toMatch(/MESH\./);
    expect(code).not.toMatch(/getElementById|querySelector|data-testid/);
    // `volumetricValve` may appear only as a member of the affordance union, never in a
    // condition — hardcoding it would defeat `alwaysAvailable`.
    const inConditions = code.split('\n').filter(
      (line) => /volumetricValve/.test(line) && /if|===|includes|\?/.test(line)
    );
    expect(inConditions).toEqual([]);
  });

  it('imports no framework', () => {
    expect(code).not.toMatch(/from 'react'|@react-three|from 'three'/);
  });
});
