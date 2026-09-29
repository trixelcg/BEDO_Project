import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSimulationRuntime, type SimulationCommand } from '../../src/simulation/runtime';
import { MAX_FREE_READINGS } from '../../src/simulation/state';
import {
  isValidMeasurement,
  selectActualForceBlocker,
  selectFreeReadingBlocker,
  selectReadingStatuses,
  selectReadings,
  selectRecordedReadingCount,
} from '../../src/simulation/selectors';
import { toCsv } from '../../src/lib/exportSchema';

/**
 * F15 — Live, recorded and balance states separated and synchronised (QA, 2026-09-29).
 *
 * Observed: counters disagreed with table rows, success states appeared for zero data,
 * and live values sat beside history. Required: one validity rule for a recording, the
 * counters derived from it, live separated from recorded, and an explicit reset.
 * `docs/62`.
 */

const source = (path: string) => readFileSync(path, 'utf8');
const MONITOR = source('src/components/SoftwareMonitor.tsx');
const OVERLAY = source('src/components/UIOverlay.tsx');
const APP = source('src/App.tsx');
const DEVICE = source('src/components/DeviceModel.tsx');
const DIALOG = source('src/components/ResetDialog.tsx');
const CSS = source('src/index.css');

const RIG: SimulationCommand[] = [
  { type: 'OPEN_COVER' },
  { type: 'SELECT_DEFLECTOR', deflectorId: 90 },
  { type: 'CLOSE_COVER' },
  { type: 'POWER_ON' },
  { type: 'SET_VALVE', opening: 0.4 },
];
const drive = (commands: SimulationCommand[]) => {
  const r = createSimulationRuntime();
  for (const c of commands) r.dispatch(c);
  return r;
};
const add = (...masses: number[]): SimulationCommand[] =>
  masses.map((massG) => ({ type: 'ADD_WEIGHT', massG }));

/** The lesson's commands through both readings, balanced at 80 g and 260 g. */
const BOTH: SimulationCommand[] = [
  ...RIG,
  { type: 'BEGIN_READING', index: 1 },
  ...add(50, 20, 10),
  { type: 'END_READING' },
  { type: 'REMOVE_ALL_WEIGHTS' },
  { type: 'SET_VALVE', opening: 0.5 },
  { type: 'BEGIN_READING', index: 2 },
  ...add(200, 20, 20, 20),
  { type: 'END_READING' },
];

describe('AC1 — every record counter equals the valid recorded row count', () => {
  it('the live tray is never counted: 50 g on reading 1 is "0 recorded"', () => {
    const r = drive([...RIG, { type: 'BEGIN_READING', index: 1 }, ...add(50)]);
    expect(selectRecordedReadingCount(r.getState())).toBe(0);
    expect(selectReadingStatuses(r.getState())).toEqual(['reference', 'live', 'pending', 'pending']);
  });

  it('at every point of the procedure, the count is the number of "recorded" rows', () => {
    const r = createSimulationRuntime();
    for (const command of BOTH) {
      r.dispatch(command);
      const statuses = selectReadingStatuses(r.getState());
      expect(selectRecordedReadingCount(r.getState()), command.type).toBe(
        statuses.filter((s) => s === 'recorded').length
      );
    }
    expect(selectRecordedReadingCount(r.getState())).toBe(2);
  });

  it('every surface shows that one number: panel, monitor and board read the view, not their own rule', () => {
    expect(OVERLAY).toMatch(/const readingsShown = state\.recordedCount;/);
    expect(OVERLAY).not.toMatch(/loadedMassG \?\? 0\) > 0/);
    expect(MONITOR).toMatch(/data-bedo-recorded-count=\{recordedCount\}/);
    expect(DEVICE).toMatch(/const recorded = r !== undefined && state\.rowStatuses\[index\] === 'recorded';/);
    expect(APP).toMatch(/: selectRecordedReadingCount\(simulation\),/);
  });

  it('a reading is only committed when it is a valid measurement', () => {
    // 50 g does not balance 83.6 g: END_READING commits nothing.
    const r = drive([...RIG, { type: 'BEGIN_READING', index: 1 }, ...add(50), { type: 'END_READING' }]);
    expect(r.getState().activeReadingIndex).toBe(1);
    expect(r.getState().committedWeightsG[1]).toBeUndefined();
    // Nor with the pump off, whatever the tray.
    const off = drive([...RIG, { type: 'BEGIN_READING', index: 1 }, ...add(50, 20, 10), { type: 'POWER_OFF' }, { type: 'END_READING' }]);
    expect(off.getState().activeReadingIndex).toBe(1);
  });

  it('"balanced" with nothing on nothing is not a measurement', () => {
    expect(isValidMeasurement({ flowRateLMin: 0, loadedMassG: 0, isBalanced: true })).toBe(false);
    expect(isValidMeasurement({ flowRateLMin: 15.7, loadedMassG: 0, isBalanced: true })).toBe(false);
    expect(isValidMeasurement({ flowRateLMin: 15.7, loadedMassG: 80, isBalanced: false })).toBe(false);
    expect(isValidMeasurement({ flowRateLMin: 15.7, loadedMassG: 80, isBalanced: true })).toBe(true);
  });

  it('free mode: the counter is the table, and the table only holds valid readings', () => {
    const r = drive([...RIG, ...add(50)]);
    r.dispatch({ type: 'RECORD_FREE_READING' });
    expect(r.getState().freeReadings).toHaveLength(0);
    r.dispatch(add(20)[0]);
    r.dispatch(add(10)[0]);
    r.dispatch({ type: 'RECORD_FREE_READING' });
    expect(r.getState().freeReadings).toHaveLength(1);
    expect(APP).toMatch(/\? freeReadings\.length/);
  });
});

describe('AC2 — F_ac is recorded only when its prerequisites hold', () => {
  it('Calculate is refused until both readings are recorded, and while one is in progress', () => {
    const r = createSimulationRuntime();
    expect(selectActualForceBlocker(r.getState())).toBe('READINGS_MISSING');
    r.dispatch({ type: 'RECORD_ACTUAL_FORCE' });
    expect(r.getState().isActualForceRecorded).toBe(false);

    const midway = drive(BOTH.slice(0, -1)); // reading 2 balanced, not ended
    expect(selectActualForceBlocker(midway.getState())).toBe('READING_IN_PROGRESS');
    midway.dispatch({ type: 'RECORD_ACTUAL_FORCE' });
    expect(midway.getState().isActualForceRecorded).toBe(false);

    const done = drive(BOTH);
    expect(selectActualForceBlocker(done.getState())).toBeNull();
    done.dispatch({ type: 'RECORD_ACTUAL_FORCE' });
    expect(done.getState().isActualForceRecorded).toBe(true);
    expect(selectActualForceBlocker(done.getState())).toBe('ALREADY_RECORDED');
  });

  it('the monitor disables Calculate with the reason, and gives F_ac only to recorded rows', () => {
    expect(MONITOR).toMatch(/disabled=\{isCalculated \|\| actualForceBlocker !== null\}/);
    expect(MONITOR).toMatch(/`Record both readings first — \$\{recordedCount\} of \$\{recordableCount\} recorded\.`/);
    expect(MONITOR).toMatch(/\{status === 'recorded' && acShown \? row\.measuredForceN\.toFixed\(4\) : '—'\}/);
  });

  it('a free reading needs water on a fitted deflector and a balanced load, and says which is missing', () => {
    const blocker = (commands: SimulationCommand[]) =>
      selectFreeReadingBlocker(drive(commands).getState(), MAX_FREE_READINGS);
    expect(blocker([{ type: 'POWER_ON' }])).toBe('NO_DEFLECTOR');
    expect(blocker(RIG.slice(0, 3))).toBe('NO_FLOW'); // fitted, pump off
    expect(blocker(RIG)).toBe('NO_LOAD');
    expect(blocker([...RIG, ...add(50)])).toBe('NOT_BALANCED');
    expect(blocker([...RIG, ...add(50, 20, 10)])).toBeNull();
    for (const reason of ['NO_DEFLECTOR', 'NO_FLOW', 'NO_LOAD', 'NOT_BALANCED', 'TABLE_FULL']) {
      expect(MONITOR, reason).toContain(`case '${reason}':`);
    }
    expect(MONITOR).toMatch(/disabled=\{!canRecord\}/);
    expect(MONITOR).toMatch(/const canRecord = freeReadingBlocker === null;/);
  });
});

describe('AC3 — live values are visually distinct from historical rows', () => {
  it('the monitor has a Live section and a Recorded section, headed as such', () => {
    expect(MONITOR).toMatch(/'Now — live values, not recorded'/);
    expect(MONITOR).toMatch(/data-bedo-live-section/);
    expect(MONITOR).toMatch(/data-bedo-recorded-section/);
    const live = CSS.slice(CSS.indexOf('.mon-live-section {'), CSS.indexOf('}', CSS.indexOf('.mon-live-section {')));
    const recorded = CSS.slice(CSS.indexOf('.mon-recorded-section {'), CSS.indexOf('}', CSS.indexOf('.mon-recorded-section {')));
    expect(live).toMatch(/border: 1px dashed/);
    expect(recorded).toMatch(/border: 1px solid/);
  });

  it('a row not recorded shows no numbers, and every row states what it is', () => {
    expect(MONITOR).toMatch(/const shown = status === 'recorded' \|\| status === 'reference';/);
    expect(MONITOR).toMatch(/const cell = \(value: string \| number\) => \(shown \? value : '—'\);/);
    expect(MONITOR).toMatch(/<td className="mon-row-status">\{statusLabel\(status\)\}<\/td>/);
    for (const label of ["'Reference · valve shut'", "'✓ Recorded'", "'● Balancing now — see Live'", "'Not recorded'"]) {
      expect(MONITOR).toContain(label);
    }
    expect(CSS).toMatch(/\.data-table tr\.mon-row\.is-live td \{/);
  });

  it('the graph plots only the reference and recorded readings', () => {
    expect(MONITOR).toMatch(/rowStatuses\[i\] === 'recorded' \|\| rowStatuses\[i\] === 'reference'/);
    expect(MONITOR).toMatch(/d=\{path\(plotted, \(r\) => r\.theoreticalForceN\)\}/);
  });

  it('the CSV carries a measurement only for a recorded reading (BUG-14)', () => {
    const r = drive([...RIG, { type: 'BEGIN_READING', index: 1 }, ...add(50)]);
    const csv = toCsv(selectReadings(r.getState()), {
      title: 't',
      isCalculated: false,
      statuses: selectReadingStatuses(r.getState()),
    }).split('\n');
    expect(csv[2]).toBe('1,120.0,0.00,0.000,0.0000e+0,0.000,0.000,0,0.00,0.0000,');
    expect(csv[3]).toBe('2,120.0,0.40,,,,,,,,'); // being balanced
    expect(csv[5]).toBe('4,120.0,0.60,,,,,,,,'); // never taken

    const done = drive([...BOTH, { type: 'RECORD_ACTUAL_FORCE' }]);
    const rows = toCsv(selectReadings(done.getState()), {
      title: 't',
      isCalculated: true,
      statuses: selectReadingStatuses(done.getState()),
    }).split('\n');
    expect(rows[3]).toBe('2,120.0,0.40,15.714,2.6191e-4,3.336,3.232,80,3.92,0.8199,0.7848');
    expect(rows[4]).toBe('3,120.0,0.50,27.024,4.5040e-4,5.738,5.677,260,12.75,2.5303,2.5506');
    expect(MONITOR).toMatch(/statuses: rowStatuses,/);
  });
});

describe('AC4 — reset says what it clears', () => {
  it('"Reset simulator" asks first whenever there is something to lose, listing it', () => {
    expect(APP).toMatch(/if \(somethingToLose\(resetSummary\(\)\)\) \{\s*setUi\(\(prev\) => \(\{ \.\.\.prev, confirmReset: true \}\)\);/);
    expect(DIALOG).toMatch(/'This clears:'/);
    expect(DIALOG).toMatch(/'This keeps:'/);
    for (const clears of ['The rig: cover, pump, valve, weights and deflector', 'Guided progress', 'recorded lesson reading', 'free reading']) {
      expect(DIALOG).toContain(clears);
    }
    expect(DIALOG).toMatch(/Q_total \$\{summary\.pumpFlowLMin\} L\/min and the custom weight \$\{summary\.customWeightG\} g/);
    expect(DIALOG).toMatch(/role="alertdialog"/);
  });

  it('the runtime reset clears exactly that, and keeps the parameters', () => {
    const r = drive([
      { type: 'SET_PUMP_FLOW', lPerMin: 110 },
      { type: 'SET_CUSTOM_WEIGHT', grams: 35 },
      ...BOTH,
      { type: 'RECORD_ACTUAL_FORCE' },
    ]);
    r.reset();
    const s = r.getState();
    expect(selectRecordedReadingCount(s)).toBe(0);
    expect(s.isActualForceRecorded).toBe(false);
    expect(s.freeReadings).toHaveLength(0);
    expect(s.apparatus.loadedWeightsG).toEqual([]);
    expect(s.deflectorFitted).toBe(false);
    expect([s.pumpFlowLMin, s.customWeightG]).toEqual([110, 35]);
  });

  it('there is one reset of everything, and it is named; "Clear readings" says it clears only those', () => {
    expect(MONITOR).not.toMatch(/'Reset'\}/);
    expect(MONITOR).not.toMatch(/onReset/);
    expect(MONITOR).toMatch(/'Clears the free readings only; the rig is left as it is\.'/);
    expect(OVERLAY).toMatch(/'Clears the rig, the lesson progress and all readings; keeps Q_total and the custom weight\. Asks first when there is anything to lose\.'/);
    expect(source('src/components/ModeSwitchDialog.tsx')).toMatch(/Resetting clears the rig, the lesson progress and all recorded readings/);
  });
});
