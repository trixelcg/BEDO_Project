import { describe, expect, it, vi } from 'vitest';
import {
  createSimulationRuntime,
  type SimulationCommand,
} from '../../src/simulation/runtime';
import { createInitialSimulationState } from '../../src/simulation/state';
import {
  selectActiveReading,
  selectJetForceN,
  selectLoadedMassG,
  selectReadings,
  selectReadingsTaken,
} from '../../src/simulation/selectors';
import { TOTAL_FLOW_L_MIN } from '../../src/domain/physics';

/**
 * The simulation runtime (BEDO-008).
 *
 * Driven as plain TypeScript, with no React anywhere — which is the property being
 * tested as much as any assertion here. If this file ever needs a renderer, the
 * separation has been lost.
 *
 * Apparatus legality is not re-tested here; it belongs to `state-machine.spec.ts` and the
 * runtime calls it. What is tested is that the runtime *defers* to it, and everything the
 * runtime adds on top: readings, experiment configuration, subscriptions, reset.
 */

const runtime = () => createSimulationRuntime();

/** Drives a sequence and returns the runtime, for scenario tests. */
const drive = (commands: SimulationCommand[]) => {
  const r = runtime();
  for (const command of commands) r.dispatch(command);
  return r;
};

describe('initial state', () => {
  it('is the rig at rest, with the flat experiment loaded', () => {
    expect(runtime().getState()).toEqual({
      apparatus: {
        isCoverOpen: false,
        isPowerOn: false,
        valveOpening: 0,
        isVolumetricValveOpen: false,
        selectedDeflectorId: 90,
        loadedWeightsG: [],
      },
      experimentId: 'flat',
      pumpFlowLMin: TOTAL_FLOW_L_MIN,
      activeReadingIndex: null,
      committedReadingCount: 0,
      committedWeightsG: [],
      isActualForceRecorded: false,
    });
  });

  it('loads each experiment with its own default deflector', () => {
    expect(createInitialSimulationState('semi').apparatus.selectedDeflectorId).toBe(180);
    expect(createInitialSimulationState('conical').apparatus.selectedDeflectorId).toBe(135);
    expect(createInitialSimulationState('oblique').apparatus.selectedDeflectorId).toBe(45);
  });

  it('accepts a starting state, for tests and for restoring a session later', () => {
    const custom = createInitialSimulationState('semi', 60);
    expect(createSimulationRuntime(custom).getState().pumpFlowLMin).toBe(60);
  });
});

describe('apparatus commands defer to the state machine', () => {
  it('accepts a legal action and updates the rig', () => {
    const r = runtime();
    const result = r.dispatch({ type: 'OPEN_COVER' });
    expect(result.ok).toBe(true);
    expect(r.getState().apparatus.isCoverOpen).toBe(true);
  });

  it('refuses an illegal action, with the state machine’s reason, and changes nothing', () => {
    const r = drive([{ type: 'POWER_ON' }]);
    const before = r.getState();

    const result = r.dispatch({ type: 'OPEN_COVER' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('COVER_BLOCKED_BY_POWER');
    expect(r.getState()).toBe(before); // identity: nothing was rebuilt
  });

  it('does not re-implement a single guard', async () => {
    // The runtime holds no conditions of its own; every refusal comes from `attempt`.
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync('src/simulation/runtime.ts', 'utf8')
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain('attempt(');
    for (const guardish of ['isCoverOpen &&', 'isPowerOn &&', 'BLOCKED', 'NEEDS_']) {
      expect(code, `runtime looks like it is deciding legality: ${guardish}`).not.toContain(guardish);
    }
  });

  it('reports a legal no-op as accepted but unchanged', () => {
    const r = runtime();
    const result = r.dispatch({ type: 'CLOSE_COVER' }); // already shut
    expect(result.ok && result.changed).toBe(false);
  });
});

describe('simulation commands', () => {
  it('sets the pump flow, which every derived figure follows', () => {
    const r = runtime();
    r.dispatch({ type: 'SET_PUMP_FLOW', lPerMin: 60 });
    expect(r.getState().pumpFlowLMin).toBe(60);
    // Half the pump delivery, half the flow at any opening.
    expect(selectReadings(r.getState())[1].flowRateLMin).toBeCloseTo(15.714470 / 2, 6);
  });

  it('switching experiment reloads the rig with that sheet’s deflector', () => {
    const r = drive([
      { type: 'POWER_ON' },
      { type: 'SET_VALVE', opening: 0.4 },
      { type: 'ADD_WEIGHT', massG: 50 },
    ]);

    r.dispatch({ type: 'SELECT_EXPERIMENT', experimentId: 'semi' });

    const state = r.getState();
    expect(state.experimentId).toBe('semi');
    expect(state.apparatus.selectedDeflectorId).toBe(180);
    expect(state.apparatus.isPowerOn).toBe(false);
    expect(state.apparatus.loadedWeightsG).toEqual([]);
  });

  it('keeps the student’s pump flow across an experiment change', () => {
    const r = drive([{ type: 'SET_PUMP_FLOW', lPerMin: 80 }]);
    r.dispatch({ type: 'SELECT_EXPERIMENT', experimentId: 'conical' });
    expect(r.getState().pumpFlowLMin).toBe(80);
  });

  it('records the actual force once', () => {
    const r = runtime();
    expect(r.dispatch({ type: 'RECORD_ACTUAL_FORCE' }).ok).toBe(true);
    expect(r.getState().isActualForceRecorded).toBe(true);
    const second = r.dispatch({ type: 'RECORD_ACTUAL_FORCE' });
    expect(second.ok && second.changed).toBe(false);
  });
});

describe('readings', () => {
  it('shows the live tray in the row being balanced', () => {
    const r = drive([
      { type: 'POWER_ON' },
      { type: 'SET_VALVE', opening: 0.4 },
      { type: 'BEGIN_READING', index: 1 },
      { type: 'ADD_WEIGHT', massG: 50 },
      { type: 'ADD_WEIGHT', massG: 20 },
      { type: 'ADD_WEIGHT', massG: 10 },
    ]);
    expect(selectActiveReading(r.getState())?.loadedMassG).toBe(80);
    expect(selectActiveReading(r.getState())?.isBalanced).toBe(true);
  });

  it('freezes the row when the reading ends, and the tray goes back to zero', () => {
    const r = drive([
      { type: 'POWER_ON' },
      { type: 'BEGIN_READING', index: 1 },
      { type: 'ADD_WEIGHT', massG: 50 },
      { type: 'ADD_WEIGHT', massG: 20 },
      { type: 'ADD_WEIGHT', massG: 10 },
      { type: 'END_READING' },
      { type: 'REMOVE_ALL_WEIGHTS' },
    ]);

    expect(selectLoadedMassG(r.getState())).toBe(0);
    // The reading keeps what it was balanced with.
    expect(selectReadings(r.getState())[1].loadedMassG).toBe(80);
    expect(r.getState().activeReadingIndex).toBeNull();
  });

  it('keeps earlier readings while a later one is being taken', () => {
    const r = drive([
      { type: 'POWER_ON' },
      { type: 'BEGIN_READING', index: 1 },
      { type: 'ADD_WEIGHT', massG: 80 },
      { type: 'END_READING' },
      { type: 'REMOVE_ALL_WEIGHTS' },
      { type: 'BEGIN_READING', index: 2 },
      { type: 'ADD_WEIGHT', massG: 260 },
    ]);

    const readings = selectReadings(r.getState());
    expect(readings[1].loadedMassG).toBe(80);
    expect(readings[2].loadedMassG).toBe(260);
    expect(selectReadingsTaken(r.getState())).toBe(2);
  });

  it('leaves untouched rows empty, including the row past the last reading', () => {
    const r = drive([{ type: 'BEGIN_READING', index: 1 }, { type: 'ADD_WEIGHT', massG: 80 }]);
    const readings = selectReadings(r.getState());
    expect(readings[0].loadedMassG).toBe(0);
    expect(readings[3].loadedMassG).toBe(0);
    // Row 3 still carries a theoretical force, which is `BUG-14` — preserved, not fixed.
    expect(readings[3].theoreticalForceN).toBeCloseTo(6.6287, 4);
  });

  it('has no idea what a lesson step is', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['runtime.ts', 'state.ts', 'selectors.ts']) {
      const source = readFileSync(`src/simulation/${file}`, 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, `${file} mentions a step`).not.toMatch(/currentStep|BALANCE_ROW|step ===/);
    }
  });
});

describe('subscriptions', () => {
  it('notifies with the new state and the one it replaced', () => {
    const r = runtime();
    const listener = vi.fn();
    r.subscribe(listener);

    const before = r.getState();
    r.dispatch({ type: 'OPEN_COVER' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(r.getState(), before);
  });

  it('says nothing when an action is refused', () => {
    const r = drive([{ type: 'POWER_ON' }]);
    const listener = vi.fn();
    r.subscribe(listener);

    r.dispatch({ type: 'OPEN_COVER' }); // blocked by the running pump

    expect(listener).not.toHaveBeenCalled();
  });

  it('says nothing when an accepted action changes nothing', () => {
    const r = runtime();
    const listener = vi.fn();
    r.subscribe(listener);

    r.dispatch({ type: 'CLOSE_COVER' }); // already shut

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies every listener, in subscription order', () => {
    const r = runtime();
    const order: string[] = [];
    r.subscribe(() => order.push('first'));
    r.subscribe(() => order.push('second'));

    r.dispatch({ type: 'OPEN_COVER' });

    expect(order).toEqual(['first', 'second']);
  });

  it('stops notifying after unsubscribe', () => {
    const r = runtime();
    const listener = vi.fn();
    const unsubscribe = r.subscribe(listener);

    r.dispatch({ type: 'OPEN_COVER' });
    unsubscribe();
    r.dispatch({ type: 'CLOSE_COVER' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('survives a listener unsubscribing itself mid-notification', () => {
    // Iterating the live set would skip or throw; the runtime iterates a copy.
    const r = runtime();
    const seen: string[] = [];
    const off = r.subscribe(() => {
      seen.push('self-removing');
      off();
    });
    r.subscribe(() => seen.push('other'));

    r.dispatch({ type: 'OPEN_COVER' });
    r.dispatch({ type: 'CLOSE_COVER' });

    expect(seen).toEqual(['self-removing', 'other', 'other']);
  });

  it('unsubscribing twice is harmless', () => {
    const r = runtime();
    const off = r.subscribe(() => {});
    off();
    expect(() => off()).not.toThrow();
  });
});

describe('immutability', () => {
  it('hands out state a caller cannot mutate', () => {
    const r = drive([{ type: 'ADD_WEIGHT', massG: 50 }]);
    const state = r.getState();

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.apparatus)).toBe(true);
    expect(Object.isFrozen(state.apparatus.loadedWeightsG)).toBe(true);
    expect(() => {
      (state.apparatus.loadedWeightsG as number[]).push(999);
    }).toThrow();
    expect(r.getState().apparatus.loadedWeightsG).toEqual([50]);
  });

  it('freezes committed readings too', () => {
    const r = drive([
      { type: 'BEGIN_READING', index: 1 },
      { type: 'ADD_WEIGHT', massG: 50 },
      { type: 'END_READING' },
    ]);
    const state = r.getState();
    expect(Object.isFrozen(state.committedWeightsG)).toBe(true);
    expect(Object.isFrozen(state.committedWeightsG[1])).toBe(true);
  });

  it('gives selectors their own arrays, so a reading cannot be edited in place', () => {
    const r = drive([{ type: 'BEGIN_READING', index: 1 }, { type: 'ADD_WEIGHT', massG: 50 }]);
    const reading = selectReadings(r.getState())[1];
    reading.loadedWeightsG.push(999);
    expect(selectReadings(r.getState())[1].loadedMassG).toBe(50);
  });
});

describe('reset', () => {
  it('returns the simulation to rest, keeping the experiment', () => {
    const r = drive([
      { type: 'SELECT_EXPERIMENT', experimentId: 'conical' },
      { type: 'POWER_ON' },
      { type: 'SET_VALVE', opening: 0.5 },
      { type: 'ADD_WEIGHT', massG: 200 },
      { type: 'BEGIN_READING', index: 1 },
      { type: 'RECORD_ACTUAL_FORCE' },
    ]);

    r.reset();

    expect(r.getState()).toEqual(createInitialSimulationState('conical'));
  });

  it('can reset into a different experiment', () => {
    const r = drive([{ type: 'POWER_ON' }]);
    r.reset('oblique');
    expect(r.getState().experimentId).toBe('oblique');
    expect(r.getState().apparatus.selectedDeflectorId).toBe(45);
  });

  it('notifies subscribers', () => {
    const r = drive([{ type: 'POWER_ON' }]);
    const listener = vi.fn();
    r.subscribe(listener);
    r.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the student’s pump flow', () => {
    // Reset restores the rig, not the parameters panel — as the app has always behaved.
    const r = drive([{ type: 'SET_PUMP_FLOW', lPerMin: 80 }, { type: 'POWER_ON' }]);
    r.reset();
    expect(r.getState().pumpFlowLMin).toBe(80);
  });
});

describe('determinism', () => {
  it('the same commands from the same start give the same state', () => {
    const script: SimulationCommand[] = [
      { type: 'OPEN_COVER' },
      { type: 'SELECT_DEFLECTOR', deflectorId: 135 },
      { type: 'CLOSE_COVER' },
      { type: 'POWER_ON' },
      { type: 'SET_VALVE', opening: 0.4 },
      { type: 'BEGIN_READING', index: 1 },
      { type: 'ADD_WEIGHT', massG: 50 },
      { type: 'END_READING' },
    ];
    expect(drive(script).getState()).toEqual(drive(script).getState());
  });

  it('two runtimes never share state', () => {
    const a = runtime();
    const b = runtime();
    a.dispatch({ type: 'POWER_ON' });
    expect(b.getState().apparatus.isPowerOn).toBe(false);
  });
});

describe('selectors', () => {
  it('report the jet force only while the pump runs with the tank shut', () => {
    const r = drive([{ type: 'POWER_ON' }, { type: 'SET_VALVE', opening: 0.4 }]);
    expect(selectJetForceN(r.getState())).toBeCloseTo(0.8199, 4);

    r.dispatch({ type: 'POWER_OFF' });
    expect(selectJetForceN(r.getState())).toBe(0);
  });

  it('follow the deflector on the rod', () => {
    // Fitting a deflector needs the tank open, which needs the pump off — the runtime
    // enforces that through the state machine, so the sequence has to be a legal one.
    const r = drive([{ type: 'OPEN_COVER' }]);
    const before = selectReadings(r.getState())[1].theoreticalForceN;

    r.dispatch({ type: 'SELECT_DEFLECTOR', deflectorId: 180 });

    // The 180 deg deflector turns the jet through twice the momentum change of the flat
    // plate, and every row of the table follows it.
    expect(selectReadings(r.getState())[1].theoreticalForceN).toBeCloseTo(before * 2, 9);
  });

  it('compute each row at its own fixed valve setting, not the live valve', () => {
    // A detail worth pinning: the table's four rows are computed at 0, 0.4, 0.5 and 0.6
    // whatever the valve is actually doing. Only the weights follow the student.
    const r = drive([{ type: 'POWER_ON' }, { type: 'SET_VALVE', opening: 0.9 }]);
    expect(selectReadings(r.getState()).map((row) => row.valveOpening)).toEqual([0, 0.4, 0.5, 0.6]);
  });
});

describe('apparatus sequences', () => {
  // Realistic use, expressed as apparatus commands only — no lesson numbering anywhere.
  const SCENARIOS: Array<{
    name: string;
    commands: SimulationCommand[];
    expect: (state: ReturnType<ReturnType<typeof runtime>['getState']>) => void;
  }> = [
    {
      name: 'fit a deflector and start the pump',
      commands: [
        { type: 'OPEN_COVER' },
        { type: 'SELECT_DEFLECTOR', deflectorId: 120 },
        { type: 'CLOSE_COVER' },
        { type: 'POWER_ON' },
        { type: 'SET_VALVE', opening: 0.4 },
      ],
      expect: (s) => {
        expect(s.apparatus.selectedDeflectorId).toBe(120);
        expect(s.apparatus.isPowerOn).toBe(true);
        expect(s.apparatus.valveOpening).toBe(0.4);
      },
    },
    {
      name: 'both readings, start to finish',
      commands: [
        { type: 'POWER_ON' },
        { type: 'SET_VALVE', opening: 0.4 },
        { type: 'BEGIN_READING', index: 1 },
        { type: 'ADD_WEIGHT', massG: 50 },
        { type: 'ADD_WEIGHT', massG: 20 },
        { type: 'ADD_WEIGHT', massG: 10 },
        { type: 'END_READING' },
        { type: 'REMOVE_ALL_WEIGHTS' },
        { type: 'SET_VALVE', opening: 0.5 },
        { type: 'BEGIN_READING', index: 2 },
        { type: 'ADD_WEIGHT', massG: 200 },
        { type: 'ADD_WEIGHT', massG: 50 },
        { type: 'ADD_WEIGHT', massG: 10 },
        { type: 'END_READING' },
        { type: 'REMOVE_ALL_WEIGHTS' },
        { type: 'RECORD_ACTUAL_FORCE' },
      ],
      expect: (s) => {
        const readings = selectReadings(s);
        expect(readings[1].loadedMassG).toBe(80);
        expect(readings[2].loadedMassG).toBe(260);
        expect(readings[1].isBalanced).toBe(true);
        expect(readings[2].isBalanced).toBe(true);
        expect(s.isActualForceRecorded).toBe(true);
        expect(s.committedReadingCount).toBe(3);
      },
    },
    {
      name: 'a refused action leaves the sequence able to continue',
      commands: [
        { type: 'POWER_ON' },
        { type: 'OPEN_COVER' }, //          refused — the pump is running
        { type: 'POWER_OFF' },
        { type: 'OPEN_COVER' }, //          now allowed
        { type: 'SELECT_DEFLECTOR', deflectorId: 30 },
        { type: 'CLOSE_COVER' },
      ],
      expect: (s) => {
        expect(s.apparatus.isCoverOpen).toBe(false);
        expect(s.apparatus.selectedDeflectorId).toBe(30);
        expect(s.apparatus.isPowerOn).toBe(false);
      },
    },
    {
      name: 'the valve shuts with the pump',
      commands: [
        { type: 'POWER_ON' },
        { type: 'SET_VALVE', opening: 0.6 },
        { type: 'POWER_OFF' },
      ],
      expect: (s) => expect(s.apparatus.valveOpening).toBe(0),
    },
    {
      name: 'clearing the tray recovers from an over-loaded reading',
      commands: [
        { type: 'BEGIN_READING', index: 1 },
        { type: 'ADD_WEIGHT', massG: 500 },
        { type: 'REMOVE_ALL_WEIGHTS' },
        { type: 'ADD_WEIGHT', massG: 80 },
      ],
      expect: (s) => expect(selectReadings(s)[1].loadedMassG).toBe(80),
    },
  ];

  it.each(SCENARIOS)('$name', ({ commands, expect: assert }) => {
    assert(drive(commands).getState());
  });
});
