/**
 * What the simulation actually owns.
 *
 * Before BEDO-008 a single `SimulationState` in `App.tsx` held eighteen fields that
 * answered three different questions — what the rig is doing, where the student is in the
 * lesson, and what the interface is showing — and React owned all of them. This is the
 * first of those three, and only that:
 *
 *   SIMULATION    here. The rig's condition and the measurements taken from it.
 *   LESSON        stays in `App.tsx` for now; `BEDO-018`/`BEDO-019` own it.
 *   PRESENTATION  stays in React. Language, panels, popups, the monitor's visibility.
 *   DERIVED       not stored at all — see `selectors.ts`.
 *
 * The full field-by-field table is in `docs/33 §3`.
 *
 * Nothing here refers to a lesson step. The results table used to be built from
 * `BALANCE_ROW = { 7: 1, 9: 2 }` — a map from *step number* to table row — which is why
 * inserting or removing a step changed what the monitor displayed. The same behaviour is
 * expressed here as "which reading is being taken", and the lesson says which one that is.
 */

import type { ApparatusState } from '../domain/stateMachine';
import { restingState } from '../domain/stateMachine';
import type { ExperimentId } from '../domain/experiments';
import { getExperiment } from '../domain/experiments';
import { TOTAL_FLOW_L_MIN } from '../domain/physics';

export interface SimulationState {
  /** The rig: cover, power, valve, volumetric valve, deflector, tray. Owned by the state machine. */
  readonly apparatus: ApparatusState;

  /** Which of the four experiment sheets is loaded. Selects the deflectors and the force law. */
  readonly experimentId: ExperimentId;

  /** Pump delivery Q_total. A student-adjustable input that feeds every flow calculation. */
  readonly pumpFlowLMin: number;

  /**
   * The results row currently being balanced, or null between readings.
   *
   * While a reading is active its row shows the live tray; the moment it ends, whatever
   * was on the tray is committed to `committedWeightsG` and stops moving.
   */
  readonly activeReadingIndex: number | null;

  /** How many rows have been taken. Rows below this show their committed weights. */
  readonly committedReadingCount: number;

  /** The weights each finished reading was balanced with, by row index, in grams. */
  readonly committedWeightsG: readonly (readonly number[])[];

  /** F_ac appears in the table only once the student has pressed Calculate. */
  readonly isActualForceRecorded: boolean;
}

/**
 * The rig as a student finds it: shut, off, drained, tray empty, nothing recorded.
 *
 * One initializer, so "what does the simulation start as" has exactly one answer — it used
 * to be spelled out in `App.tsx`'s `initialState` and re-derived by every reset path.
 */
export const createInitialSimulationState = (
  experimentId: ExperimentId = 'flat',
  pumpFlowLMin: number = TOTAL_FLOW_L_MIN
): SimulationState =>
  freezeSimulationState({
    apparatus: restingState(getExperiment(experimentId).defaultAngle),
    experimentId,
    pumpFlowLMin,
    activeReadingIndex: null,
    committedReadingCount: 0,
    committedWeightsG: [],
    isActualForceRecorded: false,
  });

/**
 * Freezes a state and the arrays inside it.
 *
 * Callers get the real object rather than a copy, so this is what stops a consumer
 * pushing a weight onto the tray behind the runtime's back. It runs once per accepted
 * command — never per frame — so the cost is irrelevant.
 */
export function freezeSimulationState(state: SimulationState): SimulationState {
  Object.freeze(state.apparatus);
  Object.freeze(state.apparatus.loadedWeightsG);
  state.committedWeightsG.forEach((row) => Object.freeze(row));
  Object.freeze(state.committedWeightsG);
  return Object.freeze(state);
}
