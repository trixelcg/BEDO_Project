import { describe, expect, it } from 'vitest';
import {
  attempt,
  restingState,
  type ApparatusAction,
  type ApparatusState,
  type RejectionReason,
} from '../../src/domain/stateMachine';
import { REJECTION_PRESENTATION } from '../../src/lib/apparatusGate';

/**
 * The apparatus state machine (BEDO-006).
 *
 * These are the rules themselves, tested directly: pure input, pure output, no React in
 * the way. `tests/integration/safety-guards.spec.tsx` stays as it is and checks the other
 * half — that the React adapter still maps onto these rules. If the domain drifts from the
 * UI, one of the two suites goes red.
 *
 * Behaviour here is what the app already did. Where the state-machine document specifies
 * something the app has never implemented, that is asserted as *not* implemented, so the
 * gap stays visible instead of being quietly assumed away.
 */

/** Every action, in one place, so "did we test them all" is answerable. */
const ALL_ACTIONS: ApparatusAction[] = [
  { type: 'OPEN_COVER' },
  { type: 'CLOSE_COVER' },
  { type: 'POWER_ON' },
  { type: 'POWER_OFF' },
  { type: 'SET_VALVE', opening: 0.4 },
  { type: 'OPEN_VOLUMETRIC_VALVE' },
  { type: 'CLOSE_VOLUMETRIC_VALVE' },
  { type: 'SELECT_DEFLECTOR', deflectorId: 180 },
  { type: 'ADD_WEIGHT', massG: 50 },
  { type: 'REMOVE_ALL_WEIGHTS' },
];

const state = (overrides: Partial<ApparatusState> = {}): ApparatusState =>
  deepFreeze({ ...restingState(90), ...overrides });

/** Frozen inputs turn an accidental mutation into a thrown error, not a silent pass. */
function deepFreeze<T extends object>(value: T): T {
  Object.values(value).forEach((v) => {
    if (v && typeof v === 'object') deepFreeze(v as object);
  });
  return Object.freeze(value);
}

const expectOk = (result: ReturnType<typeof attempt>) => {
  if (!result.ok) throw new Error(`expected acceptance, got ${result.reason}`);
  return result;
};
const expectRejected = (result: ReturnType<typeof attempt>, reason: RejectionReason) => {
  if (result.ok) throw new Error(`expected rejection with ${reason}, but it was accepted`);
  expect(result.reason).toBe(reason);
  return result;
};

describe('the five safety guards', () => {
  // BEDO's state-machine document numbers these error1..error5. Each row is: the guard,
  // the state that triggers it, the action refused, and the code the domain answers with.
  const GUARDS: Array<{
    guard: string;
    given: ApparatusState;
    action: ApparatusAction;
    reason: RejectionReason;
  }> = [
    {
      guard: 'error1 — no weights while the tank is open',
      given: state({ isCoverOpen: true }),
      action: { type: 'ADD_WEIGHT', massG: 50 },
      reason: 'WEIGHTS_BLOCKED_BY_OPEN_COVER',
    },
    {
      guard: 'error2 — the cover comes off before a deflector goes on',
      given: state({ isCoverOpen: false }),
      action: { type: 'SELECT_DEFLECTOR', deflectorId: 180 },
      reason: 'DEFLECTOR_NEEDS_OPEN_COVER',
    },
    {
      guard: 'error3 — the tank stays shut while the pump runs',
      given: state({ isPowerOn: true }),
      action: { type: 'OPEN_COVER' },
      reason: 'COVER_BLOCKED_BY_POWER',
    },
    {
      guard: 'error4 — the pump stays off while the tank is open',
      given: state({ isCoverOpen: true }),
      action: { type: 'POWER_ON' },
      reason: 'POWER_BLOCKED_BY_OPEN_COVER',
    },
    {
      guard: 'error5 — the tray is cleared before the tank is opened',
      given: state({ loadedWeightsG: [100] }),
      action: { type: 'OPEN_COVER' },
      reason: 'COVER_BLOCKED_BY_WEIGHTS',
    },
  ];

  it.each(GUARDS)('$guard', ({ given, action, reason }) => {
    const result = expectRejected(attempt(given, action), reason);
    // A refusal changes nothing — the same object comes back.
    expect(result.state).toBe(given);
  });

  it('has a presentation for every reason the domain can return, and no orphans', () => {
    const reasons = new Set(GUARDS.map((g) => g.reason));
    reasons.add('VALVE_NEEDS_RUNNING_PUMP');
    expect(new Set(Object.keys(REJECTION_PRESENTATION))).toEqual(reasons);
  });

  it('reports the running pump before the loaded tray when both block the cover', () => {
    // Both guards apply; the app has always answered with error3, and the order is part
    // of the behaviour being preserved.
    expectRejected(
      attempt(state({ isPowerOn: true, loadedWeightsG: [100] }), { type: 'OPEN_COVER' }),
      'COVER_BLOCKED_BY_POWER'
    );
  });
});

describe('the cover', () => {
  it('opens when the rig is at rest', () => {
    const result = expectOk(attempt(state(), { type: 'OPEN_COVER' }));
    expect(result.state.isCoverOpen).toBe(true);
    expect(result.changed).toBe(true);
  });

  it('closes unconditionally — shutting the tank is never unsafe', () => {
    // Even with the pump somehow running and the tray loaded.
    const given = state({ isCoverOpen: true, isPowerOn: true, loadedWeightsG: [500] });
    const result = expectOk(attempt(given, { type: 'CLOSE_COVER' }));
    expect(result.state.isCoverOpen).toBe(false);
  });

  it('treats opening an open cover, or closing a closed one, as nothing to do', () => {
    const open = state({ isCoverOpen: true });
    const openResult = expectOk(attempt(open, { type: 'OPEN_COVER' }));
    expect(openResult.changed).toBe(false);
    expect(openResult.state).toBe(open);

    const shut = state();
    const shutResult = expectOk(attempt(shut, { type: 'CLOSE_COVER' }));
    expect(shutResult.changed).toBe(false);
    expect(shutResult.state).toBe(shut);
  });

  it('leaves everything else alone when it opens', () => {
    const given = state({ valveOpening: 0, selectedDeflectorId: 135 });
    const { state: next } = expectOk(attempt(given, { type: 'OPEN_COVER' }));
    expect({ ...next, isCoverOpen: false }).toEqual(given);
  });
});

describe('the pump', () => {
  it('starts when the tank is shut', () => {
    const result = expectOk(attempt(state(), { type: 'POWER_ON' }));
    expect(result.state.isPowerOn).toBe(true);
  });

  it('stops at any time, and shuts the valve with it', () => {
    // Preserved from the original handler: a restart never resumes at the old flow.
    const given = state({ isPowerOn: true, valveOpening: 0.5 });
    const { state: next } = expectOk(attempt(given, { type: 'POWER_OFF' }));
    expect(next.isPowerOn).toBe(false);
    expect(next.valveOpening).toBe(0);
  });

  it('does nothing when asked for the state it is already in', () => {
    expect(expectOk(attempt(state({ isPowerOn: true }), { type: 'POWER_ON' })).changed).toBe(false);
    expect(expectOk(attempt(state(), { type: 'POWER_OFF' })).changed).toBe(false);
  });

  it('starting the pump does not touch the valve', () => {
    const given = state({ valveOpening: 0 });
    const { state: next } = expectOk(attempt(given, { type: 'POWER_ON' }));
    expect(next.valveOpening).toBe(0);
  });
});

describe('the flow valve', () => {
  it('opens while the pump runs', () => {
    const given = state({ isPowerOn: true });
    const { state: next } = expectOk(attempt(given, { type: 'SET_VALVE', opening: 0.4 }));
    expect(next.valveOpening).toBe(0.4);
  });

  it('will not open while the pump is off', () => {
    expectRejected(
      attempt(state(), { type: 'SET_VALVE', opening: 0.4 }),
      'VALVE_NEEDS_RUNNING_PUMP'
    );
  });

  it('may always be shut, pump or no pump', () => {
    // Setting zero is not "opening" it: the original guard was `opening > 0`.
    const result = expectOk(attempt(state({ valveOpening: 0 }), { type: 'SET_VALVE', opening: 0 }));
    expect(result.changed).toBe(false);
    expect(expectOk(attempt(state({ isPowerOn: true, valveOpening: 0.5 }), { type: 'SET_VALVE', opening: 0 })).state.valveOpening).toBe(0);
  });

  it('accepts the exact opening it is given — snapping is the lesson’s job', () => {
    // The reading setpoints (0.4, 0.5) and the snap margin belong to the lesson layer;
    // the domain has no opinion about which openings are interesting. See docs/30 §7.
    const given = state({ isPowerOn: true });
    for (const opening of [0.01, 0.385, 0.4, 0.777, 1]) {
      expect(expectOk(attempt(given, { type: 'SET_VALVE', opening })).state.valveOpening).toBe(
        opening
      );
    }
  });

  it('does not range-check the opening — the app never has', () => {
    // Current behaviour, pinned rather than endorsed: the slider constrains 0..1, so no
    // out-of-range value can reach here from the UI. Adding a clamp would be a new
    // product restriction; docs/30 §9 records it as a candidate.
    const given = state({ isPowerOn: true });
    expect(expectOk(attempt(given, { type: 'SET_VALVE', opening: 5 })).state.valveOpening).toBe(5);
    expect(expectOk(attempt(given, { type: 'SET_VALVE', opening: -1 })).state.valveOpening).toBe(-1);
  });
});

describe('the volumetric valve', () => {
  it('opens and closes with no guard at all', () => {
    // The state-machine document lists it as a clickable whose transitions are A->A,
    // B->B, C->C, D->D: it turns, and nothing else changes.
    const opened = expectOk(attempt(state(), { type: 'OPEN_VOLUMETRIC_VALVE' }));
    expect(opened.state.isVolumetricValveOpen).toBe(true);

    const closed = expectOk(attempt(opened.state, { type: 'CLOSE_VOLUMETRIC_VALVE' }));
    expect(closed.state.isVolumetricValveOpen).toBe(false);
  });

  it('works whatever the rig is doing', () => {
    for (const given of [
      state({ isCoverOpen: true }),
      state({ isPowerOn: true, valveOpening: 0.5 }),
      state({ loadedWeightsG: [200] }),
    ]) {
      expect(attempt(given, { type: 'OPEN_VOLUMETRIC_VALVE' }).ok).toBe(true);
    }
  });

  it('changes nothing but itself', () => {
    const given = state({ isPowerOn: true, valveOpening: 0.5, loadedWeightsG: [50] });
    const { state: next } = expectOk(attempt(given, { type: 'OPEN_VOLUMETRIC_VALVE' }));
    expect({ ...next, isVolumetricValveOpen: false }).toEqual(given);
  });
});

describe('the deflector', () => {
  it('is installed while the tank is open', () => {
    const given = state({ isCoverOpen: true });
    const { state: next } = expectOk(attempt(given, { type: 'SELECT_DEFLECTOR', deflectorId: 135 }));
    expect(next.selectedDeflectorId).toBe(135);
  });

  it('is not scoped to the loaded experiment — the app has never scoped it', () => {
    // BUG-05, preserved deliberately: a 180 deg deflector can be fitted during Exp. 1.
    // The domain does not know which experiment is loaded, and BEDO-022 owns the fix.
    const given = state({ isCoverOpen: true, selectedDeflectorId: 90 });
    expect(expectOk(attempt(given, { type: 'SELECT_DEFLECTOR', deflectorId: 180 })).state.selectedDeflectorId).toBe(180);
  });

  it('accepts an id that is not a real deflector', () => {
    // Also current behaviour: `getDeflector` falls back to the flat plate downstream, so
    // nothing breaks, and validating here would be a new restriction.
    const given = state({ isCoverOpen: true });
    expect(expectOk(attempt(given, { type: 'SELECT_DEFLECTOR', deflectorId: 999 })).state.selectedDeflectorId).toBe(999);
  });

  it('does nothing when the same deflector is chosen again', () => {
    const given = state({ isCoverOpen: true, selectedDeflectorId: 90 });
    expect(expectOk(attempt(given, { type: 'SELECT_DEFLECTOR', deflectorId: 90 })).changed).toBe(false);
  });
});

describe('the weights', () => {
  it('go on the tray while the tank is shut, in the order they were added', () => {
    let current = state();
    for (const massG of [50, 20, 10]) {
      current = expectOk(attempt(current, { type: 'ADD_WEIGHT', massG })).state;
    }
    expect(current.loadedWeightsG).toEqual([50, 20, 10]);
  });

  it('may be added more than once — a duplicate is a second disc, not an error', () => {
    const once = expectOk(attempt(state(), { type: 'ADD_WEIGHT', massG: 50 })).state;
    const twice = expectOk(attempt(once, { type: 'ADD_WEIGHT', massG: 50 })).state;
    expect(twice.loadedWeightsG).toEqual([50, 50]);
  });

  it('accepts any denomination — including the student’s custom weight', () => {
    // The Custom Parameters panel can mint one, so the domain must not police the set.
    expect(expectOk(attempt(state(), { type: 'ADD_WEIGHT', massG: 25 })).state.loadedWeightsG).toEqual([25]);
  });

  it('all come off at once, even while the tank is open', () => {
    // This is how a student recovers from error5, so it must not be guarded.
    const given = state({ isCoverOpen: true, loadedWeightsG: [100, 200] });
    expect(expectOk(attempt(given, { type: 'REMOVE_ALL_WEIGHTS' })).state.loadedWeightsG).toEqual([]);
  });

  it('clearing an empty tray does nothing', () => {
    expect(expectOk(attempt(state(), { type: 'REMOVE_ALL_WEIGHTS' })).changed).toBe(false);
  });
});

describe('purity', () => {
  it.each(ALL_ACTIONS)('$type never mutates the state it is given', (action) => {
    // The inputs are deep-frozen, so a mutation throws rather than passing quietly.
    for (const given of [
      state(),
      state({ isCoverOpen: true }),
      state({ isPowerOn: true, valveOpening: 0.5 }),
      state({ loadedWeightsG: [50, 100] }),
    ]) {
      const before = JSON.stringify(given);
      expect(() => attempt(given, action)).not.toThrow();
      expect(JSON.stringify(given)).toBe(before);
    }
  });

  it.each(ALL_ACTIONS)('$type is deterministic', (action) => {
    const given = state({ isPowerOn: true, loadedWeightsG: [50] });
    expect(attempt(given, action)).toEqual(attempt(given, action));
  });

  it('never returns the input object as a *changed* state', () => {
    const given = state();
    const result = expectOk(attempt(given, { type: 'OPEN_COVER' }));
    expect(result.state).not.toBe(given);
  });

  it('handles every action in the union — none falls through', () => {
    // A new action added without a case would return undefined and fail here.
    for (const action of ALL_ACTIONS) {
      const result = attempt(state({ isCoverOpen: true, isPowerOn: false }), action);
      expect(result, `${action.type} returned nothing`).toBeDefined();
      expect(typeof result.ok).toBe('boolean');
    }
  });

  it('covers the whole action union in ALL_ACTIONS', () => {
    // Guards the guard above: the list must not fall behind the type.
    const covered = new Set(ALL_ACTIONS.map((a) => a.type));
    expect(covered).toEqual(
      new Set([
        'OPEN_COVER',
        'CLOSE_COVER',
        'POWER_ON',
        'POWER_OFF',
        'SET_VALVE',
        'OPEN_VOLUMETRIC_VALVE',
        'CLOSE_VOLUMETRIC_VALVE',
        'SELECT_DEFLECTOR',
        'ADD_WEIGHT',
        'REMOVE_ALL_WEIGHTS',
      ])
    );
  });
});

describe('the resting rig', () => {
  it('starts shut, off, drained and empty', () => {
    expect(restingState(90)).toEqual({
      isCoverOpen: false,
      isPowerOn: false,
      valveOpening: 0,
      isVolumetricValveOpen: false,
      selectedDeflectorId: 90,
      loadedWeightsG: [],
    });
  });

  it('carries whichever deflector the experiment loads with', () => {
    expect(restingState(180).selectedDeflectorId).toBe(180);
  });
});

describe('the guided sequence, as pure transitions', () => {
  it('runs the lesson’s apparatus actions end to end without a single refusal', () => {
    // Steps 1-9 of the lesson, as apparatus actions only. If any guard were mis-stated,
    // the walkthrough itself would become impossible.
    const script: ApparatusAction[] = [
      { type: 'OPEN_COVER' }, //            step 1
      { type: 'SELECT_DEFLECTOR', deflectorId: 90 }, // step 2
      { type: 'CLOSE_COVER' }, //           step 3
      { type: 'POWER_ON' }, //              step 4
      { type: 'OPEN_VOLUMETRIC_VALVE' }, // step 5
      { type: 'SET_VALVE', opening: 0.4 }, // step 6
      { type: 'ADD_WEIGHT', massG: 50 }, //  step 7
      { type: 'ADD_WEIGHT', massG: 20 },
      { type: 'ADD_WEIGHT', massG: 10 },
      { type: 'REMOVE_ALL_WEIGHTS' },
      { type: 'SET_VALVE', opening: 0.5 }, // step 8
      { type: 'ADD_WEIGHT', massG: 200 }, // step 9
      { type: 'ADD_WEIGHT', massG: 50 },
      { type: 'ADD_WEIGHT', massG: 10 },
    ];

    let current = restingState(90);
    for (const action of script) {
      const result = attempt(current, action);
      if (!result.ok) throw new Error(`${action.type} was refused: ${result.reason}`);
      current = result.state;
    }

    expect(current).toEqual({
      isCoverOpen: false,
      isPowerOn: true,
      valveOpening: 0.5,
      isVolumetricValveOpen: true,
      selectedDeflectorId: 90,
      loadedWeightsG: [200, 50, 10],
    });
  });

  it('refuses to open the tank at the end, with the pump still running', () => {
    const running = state({ isPowerOn: true, valveOpening: 0.5, loadedWeightsG: [200, 50, 10] });
    expectRejected(attempt(running, { type: 'OPEN_COVER' }), 'COVER_BLOCKED_BY_POWER');
  });
});

describe('presentation-owned behavior', () => {
  // Single-weight removal is implemented and covered in weight-removal.spec.ts, including
  // stack identity, runtime routing, and the storyboard's two-second transfer. Do not use
  // ALL_ACTIONS as a completeness list here: its fixtures intentionally contain only
  // parameter-free actions.

  it('does not drain the tank when the pump stops (R-13, BEDO-010)', () => {
    // The document has A -> B "water drains" on power-off. Here, power-off shuts the
    // valve and nothing else; there is no water level in the domain at all.
    const running = state({ isPowerOn: true, valveOpening: 0.5, isVolumetricValveOpen: true });
    const { state: next } = expectOk(attempt(running, { type: 'POWER_OFF' }));
    expect(next.isVolumetricValveOpen).toBe(true);
    expect(Object.keys(next).sort()).toEqual([
      'isCoverOpen',
      'isPowerOn',
      'isVolumetricValveOpen',
      'loadedWeightsG',
      'selectedDeflectorId',
      'valveOpening',
    ]);
  });
});
