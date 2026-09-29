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
  BALANCE_TOLERANCE_G,
  GRAVITY_MS2,
  computeRow,
  jetState,
  type JetState,
  type RecordRow,
} from '../domain/physics';
import { gramsToNewtons, newtonsToGrams } from '../domain/units';
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
    const committed = index !== state.activeReadingIndex && index < state.committedReadingCount;
    const weightsG =
      index === state.activeReadingIndex
        ? state.apparatus.loadedWeightsG
        : committed
          ? (state.committedWeightsG[index] ?? [])
          : [];

    // A row already taken keeps the Q_total and deflector it was taken with (F09); the
    // row being balanced, and rows still to come, follow the rig.
    return computeRow(
      index,
      valveOpening,
      (committed ? state.committedDeflectorIds[index] : undefined) ??
        state.apparatus.selectedDeflectorId,
      [...weightsG],
      (committed ? state.committedPumpFlowLMin[index] : undefined) ?? state.pumpFlowLMin
    );
  });
}

/**
 * The free-mode readings, as table rows (F10): each computed from what was recorded with
 * it, by the same `computeRow` the lesson's table uses.
 */
export const selectFreeReadings = (state: SimulationState): RecordRow[] =>
  state.freeReadings.map((r, index) =>
    computeRow(index, r.valveOpening, r.deflectorId, [...r.weightsG], r.pumpFlowLMin)
  );

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
  /**
   * A deflector is on the rod (F09). Until one is, `theoreticalForceN` is the force the
   * selected one *would* take, and nothing is pushed: the jet runs straight to the cover.
   */
  deflectorFitted: boolean;
  /**
   * The jet force actually on the carrier: a fitted deflector, the pump running and the
   * tank shut. What the spring and the pointer answer to. Zero otherwise.
   */
  jetForceOnCarrierN: number;
  /** The mass that would balance that force, g — unrounded. */
  balancingMassG: number;
  /**
   * The carrier balances: what is on it is within `BALANCE_TOLERANCE_G` of the balancing
   * mass, the same test the results table applies — so free mode, where no reading is
   * being taken, still has an answer.
   */
  isBalanced: boolean;
}

export const selectLiveReadout = (state: SimulationState): LiveReadout => {
  const loadedMassG = selectLoadedMassG(state);
  const jetForceOnCarrierN = selectJetForceN(state);
  const balancingMassG = newtonsToGrams(jetForceOnCarrierN, GRAVITY_MS2);
  return {
    ...selectJetState(state),
    valveOpening: state.apparatus.valveOpening,
    loadedMassG,
    measuredForceN: gramsToNewtons(loadedMassG, GRAVITY_MS2),
    deflectorFitted: state.deflectorFitted,
    jetForceOnCarrierN,
    balancingMassG,
    isBalanced: Math.abs(loadedMassG - balancingMassG) <= BALANCE_TOLERANCE_G,
  };
};

/** The row the student is balancing right now, if any. */
export const selectActiveReading = (state: SimulationState): RecordRow | undefined =>
  state.activeReadingIndex === null
    ? undefined
    : selectReadings(state)[state.activeReadingIndex];

/*
  ---------------------------------------------------------------------------------------
  What counts as recorded (F15)

  One definition, used by the runtime to refuse a recording and by every surface that
  counts or shows one — the panel's "n / 2", the monitor's table and graph, the board's
  result rows and the CSV. A counter and the rows it counts can no longer disagree,
  because they are the same list.
  ---------------------------------------------------------------------------------------
*/

/** The rows of the results table that are readings: 1 and 2 (row 0 is the valve-shut zero). */
export const TABLE_READING_ROWS: readonly number[] = [1, 2];

/**
 * What a row of the results table is.
 *
 *   reference  row 1, the valve shut: the table's zero, derived, never measured
 *   recorded   a reading taken and valid — see `isValidMeasurement`
 *   live       the row being balanced now; its numbers belong to the live panel
 *   pending    not taken (row 4, n = 0.6, is never taken by the eleven-step lesson)
 */
export type ReadingStatus = 'reference' | 'recorded' | 'live' | 'pending';

/**
 * A measurement of F_ac is valid when the jet was pushing on something and the carrier
 * balanced it: water flowing, a load on the carrier, and that load within
 * `BALANCE_TOLERANCE_G` of the mass that balances the jet. Only then is "mass × g" the
 * jet force. The old tests passed an empty carrier with no flow — 0 g against 0 N — as
 * "balanced".
 */
export const isValidMeasurement = (row: {
  flowRateLMin: number;
  loadedMassG: number;
  isBalanced: boolean;
}): boolean => row.flowRateLMin > 0 && row.loadedMassG > 0 && row.isBalanced;

/** The status of each of the lesson table's four rows. */
export const selectReadingStatuses = (state: SimulationState): ReadingStatus[] =>
  selectReadings(state).map((row, index) => {
    if (index === 0) return 'reference';
    if (index === state.activeReadingIndex) return 'live';
    const taken = index < state.committedReadingCount && state.committedWeightsG[index] !== undefined;
    return taken && isValidMeasurement(row) ? 'recorded' : 'pending';
  });

/** How many of the procedure's readings are recorded — the "n / 2" everywhere. */
export const selectRecordedReadingCount = (state: SimulationState): number => {
  const statuses = selectReadingStatuses(state);
  return TABLE_READING_ROWS.filter((index) => statuses[index] === 'recorded').length;
};

/** Kept for existing callers: the recorded count, not "rows with weights on". */
export const selectReadingsTaken = selectRecordedReadingCount;

/** Why F_ac cannot be recorded yet, or null when it can (F15). */
export type ActualForceBlocker = 'READINGS_MISSING' | 'READING_IN_PROGRESS' | 'ALREADY_RECORDED';

export const selectActualForceBlocker = (state: SimulationState): ActualForceBlocker | null => {
  if (state.isActualForceRecorded) return 'ALREADY_RECORDED';
  if (state.activeReadingIndex !== null) return 'READING_IN_PROGRESS';
  if (selectRecordedReadingCount(state) < TABLE_READING_ROWS.length) return 'READINGS_MISSING';
  return null;
};

/** Why a free reading cannot be recorded now, or null when it can (F15). */
export type FreeReadingBlocker = 'NO_DEFLECTOR' | 'NO_FLOW' | 'NO_LOAD' | 'NOT_BALANCED' | 'TABLE_FULL';

export const selectFreeReadingBlocker = (
  state: SimulationState,
  maxReadings: number
): FreeReadingBlocker | null => {
  if (state.freeReadings.length >= maxReadings) return 'TABLE_FULL';
  if (!state.deflectorFitted) return 'NO_DEFLECTOR';
  const live = selectLiveReadout(state);
  // No jet on the carrier: pump off, valve shut, or tank open.
  if (live.jetForceOnCarrierN <= 0 || live.flowRateLMin <= 0) return 'NO_FLOW';
  if (live.loadedMassG <= 0) return 'NO_LOAD';
  if (!live.isBalanced) return 'NOT_BALANCED';
  return null;
};

/** Total mass on the tray, in grams. */
export const selectLoadedMassG = (state: SimulationState): number =>
  state.apparatus.loadedWeightsG.reduce((total, massG) => total + massG, 0);

/**
 * The jet as it stands: flow, velocities, theoretical force.
 *
 * No flow while the pump is off, whatever the valve is set to (F10): the valve is left
 * where the learner put it, and the pump not running is what stops the water.
 */
export const selectJetState = (state: SimulationState): JetState =>
  jetState(
    state.apparatus.isPowerOn ? state.apparatus.valveOpening : 0,
    state.apparatus.selectedDeflectorId,
    state.pumpFlowLMin
  );

/**
 * The jet force actually acting on the deflector.
 *
 * Zero unless a deflector is fitted and the pump is running with the tank shut — the
 * condition the scene has always applied, plus the rod not being bare (F09): with nothing
 * on it the jet runs straight to the cover and pushes nothing.
 */
export const selectJetForceN = (state: SimulationState): number =>
  state.deflectorFitted && state.apparatus.isPowerOn && !state.apparatus.isCoverOpen
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
