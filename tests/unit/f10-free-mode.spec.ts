import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSimulationRuntime, type SimulationCommand } from '../../src/simulation/runtime';
import { MAX_FREE_READINGS } from '../../src/simulation/state';
import { selectFreeReadings, selectLiveReadout } from '../../src/simulation/selectors';
import { attempt, restingState, type RejectionReason } from '../../src/domain/stateMachine';
import { REJECTION_PRESENTATION } from '../../src/lib/apparatusGate';
import { jetState } from '../../src/domain/physics';

/**
 * F10 — Free Mode as an independent, coherent experiment (QA, 2026-09-29). The QA report's
 * F10; `docs/QA_REPAIR_LEDGER.md` F11, plus the weight rows of its F10. See `docs/59`.
 *
 * Observed: valve control restricted and coupled to power (closed automatically), weight
 * interaction incomplete, and no results view to evaluate the experiment in free mode.
 * Required: keep only interlocks that reflect the approved apparatus rules, and say why;
 * mode changes must not silently change scientific inputs.
 */

const source = (path: string) => readFileSync(path, 'utf8');
const APP = source('src/App.tsx');
const MONITOR = source('src/components/SoftwareMonitor.tsx');
const DIALOG = source('src/components/ModeSwitchDialog.tsx');

const drive = (commands: SimulationCommand[]) => {
  const r = createSimulationRuntime();
  for (const c of commands) {
    const result = r.dispatch(c);
    if (!result.ok) throw new Error(`${c.type} refused: ${result.reason}`);
  }
  return r;
};

const RUNNING: SimulationCommand[] = [
  { type: 'OPEN_COVER' },
  { type: 'SELECT_DEFLECTOR', deflectorId: 90 },
  { type: 'CLOSE_COVER' },
  { type: 'POWER_ON' },
  { type: 'SET_VALVE', opening: 0.4 },
];

describe('AC1 — flow and volumetric controls, without artificial sequence locks', () => {
  it('the flow valve turns in any state of the rig — it is a hand valve', () => {
    const rest = restingState(90);
    for (const given of [
      rest,
      { ...rest, isCoverOpen: true },
      { ...rest, isPowerOn: true },
      { ...rest, loadedWeightsG: [50] },
    ]) {
      const result = attempt(given, { type: 'SET_VALVE', opening: 0.7 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state.valveOpening).toBe(0.7);
    }
  });

  it('the volumetric valve opens and shuts in any state', () => {
    const rest = restingState(90);
    for (const given of [rest, { ...rest, isPowerOn: true }, { ...rest, isCoverOpen: true }]) {
      expect(attempt(given, { type: 'OPEN_VOLUMETRIC_VALVE' }).ok).toBe(true);
      expect(attempt({ ...given, isVolumetricValveOpen: true }, { type: 'CLOSE_VOLUMETRIC_VALVE' }).ok).toBe(true);
    }
  });

  it('only BEDO’s five documented guards remain, each with its reason on screen', () => {
    const reasons = Object.keys(REJECTION_PRESENTATION) as RejectionReason[];
    expect(reasons.sort()).toEqual(
      [
        'COVER_BLOCKED_BY_POWER',
        'COVER_BLOCKED_BY_WEIGHTS',
        'DEFLECTOR_NEEDS_OPEN_COVER',
        'POWER_BLOCKED_BY_OPEN_COVER',
        'WEIGHTS_BLOCKED_BY_OPEN_COVER',
      ].sort()
    );
    for (const r of reasons) {
      expect(REJECTION_PRESENTATION[r].code).toMatch(/^error[1-5]$/);
      expect(REJECTION_PRESENTATION[r].en.length).toBeGreaterThan(10);
    }
  });
});

describe('AC2 — turning the power off does not rewrite the valve', () => {
  it('the valve keeps its opening; the water stops because the pump has', () => {
    const r = drive([...RUNNING]);
    const on = selectLiveReadout(r.getState());
    r.dispatch({ type: 'POWER_OFF' });
    const off = selectLiveReadout(r.getState());
    expect(r.getState().apparatus.valveOpening).toBe(0.4);
    expect(off.flowRateLMin).toBe(0);
    expect(off.jetForceOnCarrierN).toBe(0);
    // On again: the same flow as before, without touching the valve.
    r.dispatch({ type: 'POWER_ON' });
    expect(selectLiveReadout(r.getState()).flowRateLMin).toBe(on.flowRateLMin);
  });

  it('Q_total, the custom mass and the deflector are untouched by power', () => {
    const r = drive([
      ...RUNNING,
      { type: 'SET_PUMP_FLOW', lPerMin: 80 },
      { type: 'SET_CUSTOM_WEIGHT', grams: 65 },
    ]);
    r.dispatch({ type: 'POWER_OFF' });
    const s = r.getState();
    expect([s.pumpFlowLMin, s.customWeightG, s.apparatus.selectedDeflectorId, s.deflectorFitted]).toEqual([
      80,
      65,
      90,
      true,
    ]);
  });
});

describe('AC3 — weights added, repeated and removed within the rig’s rules', () => {
  it('the same mass twice: both seat and both count', () => {
    const r = drive([...RUNNING, { type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 50 }]);
    expect(r.getState().apparatus.loadedWeightsG).toEqual([50, 50]);
    expect(selectLiveReadout(r.getState()).loadedMassG).toBe(100);
  });

  it('one comes off by its place in the stack, the rest stay', () => {
    const r = drive([
      ...RUNNING,
      { type: 'ADD_WEIGHT', massG: 50 },
      { type: 'ADD_WEIGHT', massG: 20 },
      { type: 'ADD_WEIGHT', massG: 50 },
    ]);
    r.dispatch({ type: 'REMOVE_WEIGHT', index: 2 });
    expect(r.getState().apparatus.loadedWeightsG).toEqual([50, 20]);
    r.dispatch({ type: 'REMOVE_ALL_WEIGHTS' });
    expect(r.getState().apparatus.loadedWeightsG).toEqual([]);
  });

  it('a refused weight action changes nothing (error1: the tank is open)', () => {
    const r = drive([{ type: 'OPEN_COVER' }]);
    const before = r.getState();
    const result = r.dispatch({ type: 'ADD_WEIGHT', massG: 50 });
    expect(result.ok).toBe(false);
    expect(r.getState()).toBe(before);
  });
});

describe('AC4 — the Data Monitor has results to evaluate in free mode', () => {
  // Since F15 a free reading is a measurement: it needs water on a fitted deflector and a
  // balanced load (`docs/62`). 80 g balances n = 0.4 (83.6 g); 670 g balances n = 0.6
  // (675.7 g).
  const BALANCED_04: SimulationCommand[] = [
    { type: 'ADD_WEIGHT', massG: 50 },
    { type: 'ADD_WEIGHT', massG: 20 },
    { type: 'ADD_WEIGHT', massG: 10 },
  ];

  it('Record reading captures the rig as it stands, by the same computation as the lesson', () => {
    const r = drive([...RUNNING, ...BALANCED_04]);
    r.dispatch({ type: 'RECORD_FREE_READING' });
    r.dispatch({ type: 'SET_VALVE', opening: 0.6 });
    for (const massG of [500, 50, 20, 20]) r.dispatch({ type: 'ADD_WEIGHT', massG }); // 80 + 590 = 670 g
    r.dispatch({ type: 'RECORD_FREE_READING' });
    const rows = selectFreeReadings(r.getState());
    expect(rows).toHaveLength(2);
    expect(rows[0].flowRateLMin).toBe(jetState(0.4, 90).flowRateLMin);
    expect(rows[0].loadedMassG).toBe(80);
    expect(rows[1].loadedMassG).toBe(670);
    expect(rows[1].theoreticalForceN).toBe(jetState(0.6, 90).theoreticalForceN);
  });

  it('a rig with no water on the deflector records nothing (F15: was a zero-flow row)', () => {
    const r = drive([...RUNNING, ...BALANCED_04, { type: 'POWER_OFF' }]);
    r.dispatch({ type: 'RECORD_FREE_READING' });
    expect(r.getState().freeReadings).toHaveLength(0);
  });

  it('needs a fitted deflector, a balance and room in the table; Clear empties it', () => {
    const bare = drive([{ type: 'POWER_ON' }]);
    bare.dispatch({ type: 'RECORD_FREE_READING' });
    expect(bare.getState().freeReadings).toHaveLength(0);

    const unbalanced = drive([...RUNNING, { type: 'ADD_WEIGHT', massG: 50 }]);
    unbalanced.dispatch({ type: 'RECORD_FREE_READING' });
    expect(unbalanced.getState().freeReadings).toHaveLength(0);

    const r = drive([...RUNNING, ...BALANCED_04]);
    for (let i = 0; i < MAX_FREE_READINGS + 3; i++) r.dispatch({ type: 'RECORD_FREE_READING' });
    expect(r.getState().freeReadings).toHaveLength(MAX_FREE_READINGS);
    r.dispatch({ type: 'CLEAR_FREE_READINGS' });
    expect(r.getState().freeReadings).toHaveLength(0);
  });

  it('free mode shows them in the monitor, the graph, the CSV and the board', () => {
    expect(APP).toMatch(/recordedRows: lessonState\.mode === 'free' \? freeReadings : readings,/);
    expect(MONITOR).toMatch(/onClick=\{onRecordReading\}/);
    expect(MONITOR).toMatch(/onClick=\{onClearReadings\}/);
    // The export is built from the same rows the table shows.
    expect(MONITOR).toMatch(/const csv = toCsv\(recordedRows,/);
    expect(source('src/components/DeviceModel.tsx')).toMatch(/state\.readingsSource === 'free'/);
  });

  it('a free reading carries its F_ac: shown at once, no Calculate step in free mode', () => {
    expect(MONITOR).toMatch(/const acShown = isCalculated \|\| free;/);
    expect(MONITOR).toMatch(/\{status === 'recorded' && acShown \? row\.measuredForceN\.toFixed\(4\) : '—'\}/);
    expect(MONITOR).toMatch(/isCalculated: acShown,/);
    expect(MONITOR).toMatch(/\{!free && \(\s*<button\s+className="btn-primary"\s+onClick=\{onCalculate\}/);
    expect(source('src/components/DeviceModel.tsx')).toMatch(
      /recorded && \(state\.isCalculated \|\| state\.readingsSource === 'free'\)/
    );
    // F_ac is the weight of what was on the carrier when the reading was taken.
    const r = drive([...RUNNING, ...BALANCED_04, { type: 'RECORD_FREE_READING' }]);
    expect(selectFreeReadings(r.getState())[0].measuredForceN).toBeCloseTo(0.7848, 4);
  });
});

describe('AC5 — switching Free/Guided preserves the inputs unless a confirmation resets', () => {
  it('changing mode does not touch the simulation', () => {
    const handler = APP.slice(APP.indexOf('const handleSetMode'), APP.indexOf('const handleConfirmGuided'));
    expect(handler).not.toMatch(/runtime\.(dispatch|reset)/);
  });

  it('to Guided with a changed rig asks first; only "reset" resets, and keeps the parameters', () => {
    // F14 narrowed F10's rule: Guided takes back only the rig it left (or a rig at rest at
    // step 1); anything else asks, and the choices are reset or stay (`docs/61`).
    expect(APP).toMatch(/if \(mode === 'guided' && !guidedWouldRecogniseRig\(\)\) \{/);
    const confirm = APP.slice(APP.indexOf('const handleConfirmGuided'), APP.indexOf('const runSessionCommands'));
    expect(confirm.match(/runtime\.reset\(\)/g)).toHaveLength(1);
    expect(confirm).toMatch(/if \(choice === 'cancel'\) \{/);
    for (const label of ['Reset the rig and start at step 1', 'Stay in Free Mode']) {
      expect(DIALOG).toContain(label);
    }
    expect(DIALOG).not.toMatch(/onChoose\('keep'\)/);
    // The runtime's reset keeps Q_total and the custom mass (F09 AC5).
    const r = drive([{ type: 'SET_PUMP_FLOW', lPerMin: 80 }, { type: 'SET_CUSTOM_WEIGHT', grams: 65 }, ...RUNNING]);
    r.reset();
    expect([r.getState().pumpFlowLMin, r.getState().customWeightG]).toEqual([80, 65]);
  });

  it('free readings survive a mode switch; Reset simulator clears them', () => {
    const r = drive([...RUNNING, { type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 20 }, { type: 'ADD_WEIGHT', massG: 10 }, { type: 'RECORD_FREE_READING' }]);
    expect(r.getState().freeReadings).toHaveLength(1);
    r.reset();
    expect(r.getState().freeReadings).toHaveLength(0);
  });
});
