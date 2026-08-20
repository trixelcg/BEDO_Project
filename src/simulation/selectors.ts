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

import { computeRow, jetState, type JetState, type RecordRow } from '../domain/physics';
import { ROW_VALVE_SETTINGS } from '../domain/physics';
import { getExperiment } from '../domain/experiments';
import type { DeflectorDef } from '../domain/apparatus';
import { deflectorsFor } from '../domain/experiments';
import { getDeflector } from '../domain/apparatus';
import type { SimulationState } from './state';

/**
 * The four rows of the results table.
 *
 * Each row is computed at its own fixed valve setting. The row being balanced follows the
 * tray; rows already taken show what they were balanced with; rows not yet reached are
 * empty.
 */
export function selectReadings(state: SimulationState): RecordRow[] {
  return ROW_VALVE_SETTINGS.map((valveOpening, index) => {
    const weightsG =
      index === state.activeReadingIndex
        ? state.apparatus.loadedWeightsG
        : index < state.committedReadingCount
          ? (state.committedWeightsG[index] ?? [])
          : [];

    return computeRow(
      index,
      valveOpening,
      state.apparatus.selectedDeflectorId,
      [...weightsG],
      state.pumpFlowLMin
    );
  });
}

/** The row the student is balancing right now, if any. */
export const selectActiveReading = (state: SimulationState): RecordRow | undefined =>
  state.activeReadingIndex === null
    ? undefined
    : selectReadings(state)[state.activeReadingIndex];

/** How many of the two student readings carry weights — the "n / 2" the panel shows. */
export const selectReadingsTaken = (state: SimulationState): number =>
  selectReadings(state).filter((row, index) => index > 0 && row.loadedMassG > 0).length;

/** Total mass on the tray, in grams. */
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
