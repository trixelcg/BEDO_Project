import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSimulationRuntime, type SimulationCommand } from '../../src/simulation/runtime';
import { createInitialSimulationState } from '../../src/simulation/state';
import { selectLiveReadout, selectReadings } from '../../src/simulation/selectors';
import { GRAVITY_MS2, TOTAL_FLOW_L_MIN, jetState } from '../../src/domain/physics';
import { DEFLECTORS, WEIGHTS, getDeflector } from '../../src/domain/apparatus';
import { forceLawFor } from '../../src/domain/forceLaw';
import {
  CUSTOM_WEIGHT_CHOICES_G,
  DEFAULT_CUSTOM_WEIGHT_G,
  DEFAULT_PUMP_FLOW_L_MIN,
  isValidCustomWeightG,
} from '../../src/domain/parameters';

/**
 * F09 — one authoritative Jet Forces state (QA, 2026-09-29).
 *
 * Observed: flow and weight values changed in the UI while the board, the apparatus, the
 * water and the Data Monitor stayed put or showed different values; the Parameters tab
 * updated its own numbers while the working controls sat under Steps.
 *
 * The runtime is the one state. These tests drive it and read every dependent through the
 * selectors the surfaces read, and pin the wiring of the surfaces to those selectors.
 */

const source = (path: string) => readFileSync(path, 'utf8');
const APP = source('src/App.tsx');
const OVERLAY = source('src/components/UIOverlay.tsx');
const MONITOR = source('src/components/SoftwareMonitor.tsx');
const DEVICE = source('src/components/DeviceModel.tsx');

/** The Parameters tab's own JSX, between its marker and the Steps panel's. */
const PARAMS_PANEL = OVERLAY.slice(
  OVERLAY.indexOf('/* ------------------------------------------------ Parameters (F09) */'),
  OVERLAY.indexOf('/* ------------------------------------------------ Steps / controls */')
);

const drive = (commands: SimulationCommand[]) => {
  const r = createSimulationRuntime();
  for (const c of commands) {
    const result = r.dispatch(c);
    if (!result.ok) throw new Error(`${c.type} refused: ${result.reason}`);
  }
  return r;
};

/** A fitted 90° plate, pump running at the first reading's opening, tank shut. */
const running = (deflectorId = 90): SimulationCommand[] => [
  { type: 'OPEN_COVER' },
  { type: 'SELECT_DEFLECTOR', deflectorId },
  { type: 'CLOSE_COVER' },
  { type: 'POWER_ON' },
  { type: 'SET_VALVE', opening: 0.4 },
];

describe('AC1 — Custom Weight updates the stack, mass, force, balance and monitor', () => {
  it('a custom disc already on the carrier takes the new mass', () => {
    const r = drive([...running(), { type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 25 }]);
    r.dispatch({ type: 'SET_CUSTOM_WEIGHT', grams: 35 });
    const state = r.getState();
    expect(state.customWeightG).toBe(35);
    // The stack the scene draws, disc for disc: the 50 g stays, the custom disc is 35 g.
    expect(state.apparatus.loadedWeightsG).toEqual([50, 35]);
    const live = selectLiveReadout(state);
    expect(live.loadedMassG).toBe(85);
    expect(live.measuredForceN).toBeCloseTo((85 * GRAVITY_MS2) / 1000, 9);
  });

  it('moves the balance: 80 g balances the first reading, and the custom disc can make it', () => {
    const r = drive([...running(), { type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 25 }]);
    const target = selectLiveReadout(r.getState()).balancingMassG;
    expect(target).toBeCloseTo(83.6, 1);
    expect(selectLiveReadout(r.getState()).isBalanced).toBe(true); // 75 g, within 10 g
    r.dispatch({ type: 'SET_CUSTOM_WEIGHT', grams: 95 });
    expect(selectLiveReadout(r.getState()).isBalanced).toBe(false); // 145 g
    r.dispatch({ type: 'SET_CUSTOM_WEIGHT', grams: 35 });
    expect(selectLiveReadout(r.getState()).isBalanced).toBe(true); // 85 g
  });

  it('the reading being balanced — the monitor’s row — follows it', () => {
    const r = drive([
      ...running(),
      { type: 'BEGIN_READING', index: 1 },
      { type: 'ADD_WEIGHT', massG: 25 },
    ]);
    r.dispatch({ type: 'SET_CUSTOM_WEIGHT', grams: 85 });
    const row = selectReadings(r.getState())[1];
    expect(row.loadedWeightsG).toEqual([85]);
    expect(row.loadedMassG).toBe(85);
    expect(row.isBalanced).toBe(true);
  });

  it('a custom disc on the tray is only re-specified; the fixed discs never change', () => {
    const r = drive([...running(), { type: 'ADD_WEIGHT', massG: 20 }]);
    r.dispatch({ type: 'SET_CUSTOM_WEIGHT', grams: 45 });
    expect(r.getState().apparatus.loadedWeightsG).toEqual([20]);
    expect(r.getState().customWeightG).toBe(45);
  });

  it('never takes a tray denomination, or a value the panel cannot offer', () => {
    for (const w of WEIGHTS) expect(isValidCustomWeightG(w.grams)).toBe(false);
    for (const bad of [0, -5, 7, 500, 1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = drive([]);
      const result = r.dispatch({ type: 'SET_CUSTOM_WEIGHT', grams: bad });
      expect(result.ok && result.changed).toBe(false);
      expect(r.getState().customWeightG).toBe(DEFAULT_CUSTOM_WEIGHT_G);
    }
    // The slider's stops are exactly the valid masses.
    expect(CUSTOM_WEIGHT_CHOICES_G.every(isValidCustomWeightG)).toBe(true);
    expect(CUSTOM_WEIGHT_CHOICES_G).toContain(DEFAULT_CUSTOM_WEIGHT_G);
    expect(CUSTOM_WEIGHT_CHOICES_G.some((g) => WEIGHTS.some((w) => w.grams === g))).toBe(false);
  });

  it('is simulation state: App keeps no copy, and the scene is handed the runtime’s', () => {
    expect(APP).not.toMatch(/ui\.customWeightG|customWeightG: 25/);
    expect(APP).toMatch(/customWeightG=\{simulation\.customWeightG\}/);
    expect(APP).toMatch(/customWeightG: simulation\.customWeightG/);
    expect(APP).toMatch(/type: 'SET_CUSTOM_WEIGHT', grams: params\.customWeightG/);
    // The scene builds the stack from the runtime's list of discs.
    expect(DEVICE).toMatch(/state\.loadedWeightsG\.forEach\(\(grams, idx\)/);
  });
});

describe('AC2 — pump flow drives the flow state, the jet and every dependent value', () => {
  it('Q_total reaches flow, velocity, the force on the carrier and the balancing mass', () => {
    const at = (q: number) => {
      const r = drive([...running(), { type: 'SET_PUMP_FLOW', lPerMin: q }]);
      return selectLiveReadout(r.getState());
    };
    const low = at(60);
    const high = at(TOTAL_FLOW_L_MIN);
    expect(low.flowRateLMin).toBeCloseTo(high.flowRateLMin / 2, 9);
    expect(low.nozzleVelocityMS).toBeCloseTo(high.nozzleVelocityMS / 2, 9);
    expect(high.jetForceOnCarrierN).toBe(jetState(0.4, 90, TOTAL_FLOW_L_MIN).theoreticalForceN);
    expect(low.jetForceOnCarrierN).toBe(jetState(0.4, 90, 60).theoreticalForceN);
    expect(low.balancingMassG).toBeLessThan(high.balancingMassG);
  });

  it('the carrier and pointer take the runtime’s force — no second jet calculation', () => {
    // It used to call `jetState(valve, deflector)` without Q_total.
    expect(DEVICE).not.toMatch(/jetState\(/);
    expect(DEVICE).toMatch(/const jetForceN = state\.live\.jetForceOnCarrierN;/);
  });

  it('the water and the hose follow the same live state', () => {
    // The jet path (F08) is built from the live exit velocity and flow.
    expect(DEVICE).toMatch(/v0: state\.live\.nozzleVelocityMS,/);
    expect(DEVICE).toMatch(/q: state\.live\.flowRateM3S,/);
    expect(DEVICE).toMatch(/hose\.speed = state\.live\.flowRateM3S/);
  });

  it('the panels read the flow from the runtime rather than re-evaluating the pump curve', () => {
    expect(OVERLAY).not.toMatch(/flowRateLMin\(/);
    expect(OVERLAY).toMatch(/const flow = state\.live\.flowRateLMin;/);
    expect(PARAMS_PANEL).toMatch(/live\.flowRateLMin\.toFixed\(2\)/);
  });

  it('ignores a Q_total the panel cannot offer', () => {
    for (const bad of [0, 7, 10, 205, -20, Number.NaN]) {
      const r = drive([]);
      r.dispatch({ type: 'SET_PUMP_FLOW', lPerMin: bad });
      expect(r.getState().pumpFlowLMin).toBe(DEFAULT_PUMP_FLOW_L_MIN);
    }
  });
});

describe('AC3 — the deflector updates model, coefficient, equation and water together', () => {
  it('the rod starts bare; fitting one is runtime state, and only then does the jet push', () => {
    const bare = drive([{ type: 'POWER_ON' }, { type: 'SET_VALVE', opening: 0.4 }]);
    expect(bare.getState().deflectorFitted).toBe(false);
    expect(selectLiveReadout(bare.getState()).jetForceOnCarrierN).toBe(0);

    const fitted = drive(running(60));
    expect(fitted.getState().deflectorFitted).toBe(true);
    expect(selectLiveReadout(fitted.getState()).jetForceOnCarrierN).toBeGreaterThan(0);
  });

  it('selecting the deflector already selected still fits it', () => {
    const r = drive([{ type: 'OPEN_COVER' }]);
    expect(r.getState().apparatus.selectedDeflectorId).toBe(90);
    const result = r.dispatch({ type: 'SELECT_DEFLECTOR', deflectorId: 90 });
    expect(result.ok && result.changed).toBe(true);
    expect(r.getState().deflectorFitted).toBe(true);
  });

  it('a guided learner who confirms the install step untouched gets the sheet’s deflector', () => {
    const lesson = source('src/lesson/currentLesson.ts');
    const step = lesson.slice(lesson.indexOf("id: 'install-deflector'"), lesson.indexOf("id: 'mount-cover'"));
    expect(step).toMatch(/onComplete: \[\{ type: 'FIT_DEFLECTOR' \}\]/);
    expect(APP).toMatch(/hasInstalledDeflector: simulation\.deflectorFitted,/);
    expect(APP).not.toMatch(/deflectorInstalled/);
  });

  it('the force law and k are the fitted deflector’s, and agree with the force', () => {
    for (const d of DEFLECTORS) {
      const law = forceLawFor(d.id);
      expect(law.k).toBe(d.momentumFactor);
      expect(law.factorEn).toContain(d.momentumFactor.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
      const ratio = jetState(0.6, d.id).theoreticalForceN / jetState(0.6, 90).theoreticalForceN;
      expect(ratio).toBeCloseTo(law.k, 9);
    }
    // QA IMG25: the conical sheet's "1.707 ρAV²" printed beside a 90° plate at k = 1.000.
    expect(MONITOR).not.toMatch(/experiment\.lawEn/);
    expect(MONITOR).toMatch(/const law = forceLawFor\(state\.selectedDeflectorId\);/);
    expect(PARAMS_PANEL).toMatch(/law\.equation/);
  });

  it('switching deflector changes the live force by its own k', () => {
    const flat = selectLiveReadout(drive(running(90)).getState());
    const cone = selectLiveReadout(drive(running(135)).getState());
    expect(cone.jetForceOnCarrierN / flat.jetForceOnCarrierN).toBeCloseTo(getDeflector(135).momentumFactor, 9);
  });
});

describe('AC4 — labels and units are visible and unambiguous', () => {
  it('every editable value has a label and its unit', () => {
    expect(PARAMS_PANEL).toMatch(/htmlFor="bedo-param-qtotal"/);
    expect(PARAMS_PANEL).toMatch(/Pump delivery at full valve, Q_total/);
    expect(PARAMS_PANEL).toMatch(/\{params\.pumpFlowLMin\} L\/min/);
    expect(PARAMS_PANEL).toMatch(/htmlFor="bedo-param-custom"/);
    expect(PARAMS_PANEL).toMatch(/Custom weight disc mass/);
    expect(PARAMS_PANEL).toMatch(/\{params\.customWeightG\} g/);
    expect(PARAMS_PANEL.match(/aria-valuetext=/g)?.length).toBe(2);
  });

  it('every derived figure carries its unit', () => {
    for (const unit of [' m/s', ' N', ' g · ']) expect(PARAMS_PANEL).toContain(unit);
    expect(PARAMS_PANEL).toMatch(/Momentum factor \$\{law\.factorEn\}/);
  });
});

describe('AC5 — Reset acts on the authoritative state; there is no Save/Load', () => {
  it('Reset restores the rig and keeps both parameters, the same way', () => {
    const r = drive([
      ...running(),
      { type: 'SET_PUMP_FLOW', lPerMin: 80 },
      { type: 'SET_CUSTOM_WEIGHT', grams: 65 },
    ]);
    r.reset();
    const s = r.getState();
    expect(s.pumpFlowLMin).toBe(80);
    expect(s.customWeightG).toBe(65);
    expect(s.deflectorFitted).toBe(false);
    expect(s.apparatus.isPowerOn).toBe(false);
  });

  it('loading another sheet keeps both parameters too', () => {
    const r = drive([{ type: 'SET_PUMP_FLOW', lPerMin: 80 }, { type: 'SET_CUSTOM_WEIGHT', grams: 65 }]);
    r.dispatch({ type: 'SELECT_EXPERIMENT', experimentId: 'semi' });
    expect(r.getState().pumpFlowLMin).toBe(80);
    expect(r.getState().customWeightG).toBe(65);
  });

  it('Restore defaults goes through the same runtime path', () => {
    expect(PARAMS_PANEL).toMatch(
      /onSetParams\(\{\s*pumpFlowLMin: DEFAULT_PUMP_FLOW_L_MIN,\s*customWeightG: DEFAULT_CUSTOM_WEIGHT_G,\s*\}\)/
    );
  });

  it('no Save/Load of state is exposed (DEC06)', () => {
    for (const code of [APP, OVERLAY, MONITOR]) {
      expect(code).not.toMatch(/>\s*(Save|Load) (state|session|parameters)/i);
    }
  });
});

describe('AC6 — no two controls disagree about one physical variable', () => {
  it('the Parameters tab no longer chooses the deflector', () => {
    expect(PARAMS_PANEL).not.toMatch(/onSelectDeflector/);
    expect(PARAMS_PANEL).toMatch(/Deflector on the rod/);
  });

  it('a reading already taken keeps the Q_total and deflector it was taken with', () => {
    const r = drive([
      ...running(),
      { type: 'BEGIN_READING', index: 1 },
      { type: 'ADD_WEIGHT', massG: 50 },
      { type: 'ADD_WEIGHT', massG: 20 },
      { type: 'ADD_WEIGHT', massG: 10 },
      { type: 'END_READING' },
    ]);
    const taken = selectReadings(r.getState())[1];
    r.dispatch({ type: 'SET_PUMP_FLOW', lPerMin: 60 });
    const after = selectReadings(r.getState())[1];
    expect(after.flowRateLMin).toBe(taken.flowRateLMin);
    expect(after.pumpFlowLMin).toBe(TOTAL_FLOW_L_MIN);
    expect(after.theoreticalForceN).toBe(taken.theoreticalForceN);
    // Rows not yet taken follow the new Q_total.
    expect(selectReadings(r.getState())[2].pumpFlowLMin).toBe(60);
  });

  it('every surface reads one value of each parameter', () => {
    const initial = createInitialSimulationState();
    expect(initial.pumpFlowLMin).toBe(DEFAULT_PUMP_FLOW_L_MIN);
    expect(initial.customWeightG).toBe(DEFAULT_CUSTOM_WEIGHT_G);
    // The panel, the Steps weights and the scene all read `state.params`, which App builds
    // from the runtime alone.
    expect(APP).toMatch(
      /params: \{ pumpFlowLMin: simulation\.pumpFlowLMin, customWeightG: simulation\.customWeightG \}/
    );
  });
});
