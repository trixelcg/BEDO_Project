/**
 * Derived views of simulation state.
 *
 * Nothing here is stored. The results table, the jet, the mass on the tray — all of it is
 * computed from the authoritative state plus the verified domain functions, so the same
 * physical truth cannot be recorded in two places and drift apart. That is what the
 * `recordedRows` array in React state used to be: a copy of the physics, kept in sync by
 * an effect that had to list five dependencies to stay correct.
 *
 * Pure functions of state. No React, no memoisation — callers that need it (the React
 * adapter) memoise on the state object, which only changes when something really did.
 */

import {
  GRAVITY_MS2,
  computeRow,
  jetState,
  type JetState,
  type RecordRow,
} from '../domain/physics';
import { gramsToNewtons } from '../domain/units';
import { getExperiment } from '../domain/experiments';
import type { DeflectorDef } from '../domain/apparatus';
import { deflectorsFor } from '../domain/experiments';
import { getDeflector } from '../domain/apparatus';
import type { SimulationState } from './state';

/**
 * The results table: one row per reading the student recorded, and nothing else.
 *
 * It used to map `ROW_VALVE_SETTINGS` — four rows that existed whether or not anyone had
 * taken them. That produced the monitor's zero row and its 43.457 L/min row with no mass
 * against it, and it is why the row being balanced moved as discs landed on the tray.
 * Rows now come from `state.recordedReadings`, which only `RECORD_READING` writes to.
 *
 * Still derived: the reading stores its inputs and this recomputes Q, the velocities and
 * the forces, so the table and the live panel are the same arithmetic.
 */
export function selectReadings(state: SimulationState): RecordRow[] {
  return state.recordedReadings.map((reading, index) =>
    computeRow(
      index,
      reading.valveOpening,
      reading.deflectorId,
      [...reading.loadedWeightsG],
      reading.pumpFlowLMin
    )
  );
}

/**
 * The rig as it stands right now — what the software board reports live.
 *
 * Deliberately *not* a row of the results table. The table is computed at the four fixed
 * `ROW_VALVE_SETTINGS` the procedure records at, so it can never show the opening the
 * learner is actually holding; and its mass follows only the row being balanced, which is
 * nothing at all in free mode. This is the other question: what is true of the apparatus
 * at this instant.
 *
 * Every number is read from the same domain functions the physics and the results table
 * use — `jetState` for the jet, `gramsToNewtons` for the tray — so the board cannot drift
 * from the calculation it is displaying. No equation is repeated here or in the component.
 */
export interface LiveReadout extends JetState {
  /** Valve opening n, 0..1. The board shows it as a percentage. */
  valveOpening: number;
  /** What is on the tray right now, in grams. */
  loadedMassG: number;
  /** The weight of that mass — F_ac as the pan measures it, before any recording. */
  measuredForceN: number;
}

export const selectLiveReadout = (state: SimulationState): LiveReadout => {
  const loadedMassG = selectLoadedMassG(state);
  return {
    ...selectJetState(state),
    valveOpening: state.apparatus.valveOpening,
    loadedMassG,
    measuredForceN: gramsToNewtons(loadedMassG, GRAVITY_MS2),
  };
};

/**
 * The rig as one results row, right now — the row a `RECORD_READING` would write.
 *
 * This is what the balance indicator, the add/remove hint and the Record button all read.
 * It is deliberately not a table row: nothing about it is recorded, and it changes with
 * every disc and every turn of the valve.
 */
export const selectLiveRow = (state: SimulationState): RecordRow =>
  computeRow(
    state.recordedReadings.length,
    state.apparatus.valveOpening,
    state.apparatus.selectedDeflectorId,
    [...state.apparatus.loadedWeightsG],
    state.pumpFlowLMin
  );

/**
 * How many readings have been recorded — the "n / 2" the panel shows.
 *
 * Now simply a length. It used to count table rows carrying any mass at all, which is why
 * it reached 2 / 2 while the panel beside it still read "Unbalanced".
 */
export const selectReadingsTaken = (state: SimulationState): number =>
  state.recordedReadings.length;

/**
 * Whether a reading may be taken right now.
 *
 * The same condition the runtime enforces, exposed so a control can be disabled rather
 * than silently do nothing. The runtime remains the authority; this is the UI reading it.
 */
export const selectCanRecordReading = (state: SimulationState): boolean =>
  selectLiveRow(state).isBalanced;

/**
 * Total mass on the tray, in grams.
 *
 * **The single authority for "Total Weight".** The board, the software monitor and the
 * step panel all read this one selector. They used to each sum something of their own:
 * the monitor summed the table's `loadedMassG` — which answers "how much have all the
 * readings together carried" — and reported 0 g in free mode with a fully loaded tray,
 * while the row beside it said 250 g.
 */
export const selectLoadedMassG = (state: SimulationState): number =>
  state.apparatus.loadedWeightsG.reduce((total, massG) => total + massG, 0);

/** The jet as it stands: flow, velocities, theoretical force. */
export const selectJetState = (state: SimulationState): JetState =>
  jetState(state.apparatus.valveOpening, state.apparatus.selectedDeflectorId, state.pumpFlowLMin);

/**
 * The jet force actually acting on the deflector.
 *
 * Zero unless the pump is running with the tank shut — the same condition the scene has
 * always applied before letting the jet push anything.
 */
export const selectJetForceN = (state: SimulationState): number =>
  state.apparatus.isPowerOn && !state.apparatus.isCoverOpen
    ? selectJetState(state).theoreticalForceN
    : 0;

export const selectIsPumpRunning = (state: SimulationState): boolean =>
  state.apparatus.isPowerOn;

/** The deflector on the rod. */
export const selectDeflector = (state: SimulationState): DeflectorDef =>
  getDeflector(state.apparatus.selectedDeflectorId);

/** The deflectors this experiment's sheet offers. */
export const selectAvailableDeflectors = (state: SimulationState): DeflectorDef[] =>
  deflectorsFor(state.experimentId);

export const selectExperiment = (state: SimulationState) => getExperiment(state.experimentId);
