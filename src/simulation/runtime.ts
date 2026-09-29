/**
 * The simulation runtime — the authoritative owner of simulation state.
 *
 * Plain TypeScript. No React, no store library, no DOM. It can be driven from a test, a
 * script or a future Zustand store without changing a line, which is the point: the rig's
 * behaviour should be verifiable without rendering anything.
 *
 * ```
 *   dispatch(command)
 *        ↓
 *   apparatus command?  →  attempt(state, action)   ← the BEDO-006 gate, reused verbatim
 *        ↓                        ↓
 *      accepted                rejected → { ok: false, reason }, state untouched
 *        ↓
 *   commit + notify subscribers
 * ```
 *
 * **No guard is implemented here.** Apparatus legality has exactly one source, and this
 * calls it. The runtime's own commands — pump flow, experiment, readings — are not safety
 * decisions and are always accepted.
 *
 * **Subscriptions carry state, not events.** A `SimulationEvent` union was considered and
 * dropped: every listener that exists or is planned (React's `useSyncExternalStore`, the
 * future lesson runner, feedback) wants *the new state*, and the ones that want to know
 * what changed can diff against the previous state, which is handed to them. An event
 * stream would be a second thing to keep correct with no reader that needs it. See
 * `docs/33 §6`.
 */

import { attempt, type ApparatusAction, type RejectionReason } from '../domain/stateMachine';
import type { ExperimentId } from '../domain/experiments';
import { getExperiment } from '../domain/experiments';
import {
  isFixedDenomination,
  isValidCustomWeightG,
  isValidPumpFlowLMin,
} from '../domain/parameters';
import {
  MAX_FREE_READINGS,
  createInitialSimulationState,
  freezeSimulationState,
  type SimulationState,
} from './state';
import {
  isValidMeasurement,
  selectActualForceBlocker,
  selectFreeReadingBlocker,
  selectLiveReadout,
  selectReadings,
} from './selectors';

/** Commands the simulation understands beyond the apparatus itself. */
export type SimulationCommand =
  | ApparatusAction
  | { readonly type: 'SET_PUMP_FLOW'; readonly lPerMin: number }
  /**
   * The custom disc's mass. A disc already on the carrier is that disc, so it follows:
   * the load, the spring, the balance and the monitor all move with it (F09).
   */
  | { readonly type: 'SET_CUSTOM_WEIGHT'; readonly grams: number }
  /**
   * The sheet's deflector is fitted without the learner touching the tray — a guided
   * learner who confirms the install step as it stands (`docs/38 §3.1`).
   */
  | { readonly type: 'FIT_DEFLECTOR' }
  /** Free mode: take a reading of the rig as it stands (F10). */
  | { readonly type: 'RECORD_FREE_READING' }
  /** Free mode: clear the readings taken. */
  | { readonly type: 'CLEAR_FREE_READINGS' }
  | { readonly type: 'SELECT_EXPERIMENT'; readonly experimentId: ExperimentId }
  /** Start balancing a results row; its row follows the tray until the reading ends. */
  | { readonly type: 'BEGIN_READING'; readonly index: number }
  /** Finish the active reading: whatever is on the tray is committed to its row. */
  | { readonly type: 'END_READING' }
  /** Press Calculate: F_ac joins the table. */
  | { readonly type: 'RECORD_ACTUAL_FORCE' };

export type DispatchResult =
  | {
      readonly ok: true;
      readonly state: SimulationState;
      /** False when the command was valid but the simulation was already in that condition. */
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      readonly state: SimulationState;
      /** Why the apparatus refused. Typed codes; the UI owns the wording. */
      readonly reason: RejectionReason;
    };

/** Called after every accepted command that changed something. */
export type SimulationListener = (state: SimulationState, previous: SimulationState) => void;

export interface SimulationRuntime {
  getState(): SimulationState;
  dispatch(command: SimulationCommand): DispatchResult;
  /** Returns the unsubscribe function. Safe to call during a notification. */
  subscribe(listener: SimulationListener): () => void;
  /** Back to `createInitialSimulationState`, keeping the given experiment if one is passed. */
  reset(experimentId?: ExperimentId): SimulationState;
}

const APPARATUS_COMMANDS = new Set([
  'OPEN_COVER',
  'CLOSE_COVER',
  'POWER_ON',
  'POWER_OFF',
  'SET_VALVE',
  'OPEN_VOLUMETRIC_VALVE',
  'CLOSE_VOLUMETRIC_VALVE',
  'SELECT_DEFLECTOR',
  'ADD_WEIGHT',
  'REMOVE_WEIGHT',
  'REMOVE_ALL_WEIGHTS',
]);

const isApparatusAction = (command: SimulationCommand): command is ApparatusAction =>
  APPARATUS_COMMANDS.has(command.type);

/** Applies a simulation-level command. Returns the same object when nothing changed. */
function applyCommand(state: SimulationState, command: SimulationCommand): SimulationState {
  switch (command.type) {
    case 'SET_PUMP_FLOW':
      // Only values the panel can offer. Anything else is ignored rather than clamped, so
      // a caller with a bad number finds out from the unchanged state, not from a
      // different number than it asked for.
      if (!isValidPumpFlowLMin(command.lPerMin)) return state;
      if (state.pumpFlowLMin === command.lPerMin) return state;
      return { ...state, pumpFlowLMin: command.lPerMin };

    case 'SET_CUSTOM_WEIGHT': {
      if (!isValidCustomWeightG(command.grams)) return state;
      if (state.customWeightG === command.grams) return state;
      // The one mass on the carrier that is not a tray denomination is the custom disc.
      const loaded = state.apparatus.loadedWeightsG;
      const onCarrier = loaded.some((g) => !isFixedDenomination(g));
      return {
        ...state,
        customWeightG: command.grams,
        apparatus: onCarrier
          ? {
              ...state.apparatus,
              loadedWeightsG: loaded.map((g) => (isFixedDenomination(g) ? g : command.grams)),
            }
          : state.apparatus,
      };
    }

    case 'FIT_DEFLECTOR':
      if (state.deflectorFitted) return state;
      return { ...state, deflectorFitted: true };

    case 'RECORD_FREE_READING': {
      // A reading is a measurement of F_ac, so it needs one (F15): a fitted deflector,
      // water on it, a load on the carrier, the carrier balanced — and room in the table.
      // The panel says which is missing and disables its button; this is the rule behind it.
      if (selectFreeReadingBlocker(state, MAX_FREE_READINGS) !== null) return state;
      const { apparatus } = state;
      return {
        ...state,
        freeReadings: [
          ...state.freeReadings,
          {
            valveOpening: apparatus.isPowerOn ? apparatus.valveOpening : 0,
            pumpFlowLMin: state.pumpFlowLMin,
            deflectorId: apparatus.selectedDeflectorId,
            weightsG: [...apparatus.loadedWeightsG],
          },
        ],
      };
    }

    case 'CLEAR_FREE_READINGS':
      if (state.freeReadings.length === 0) return state;
      return { ...state, freeReadings: [] };

    case 'SELECT_EXPERIMENT': {
      if (state.experimentId === command.experimentId) return state;
      // Loading a sheet re-runs the whole procedure: a fresh rig with that experiment's
      // deflector, and no readings carried over. This is what the app has always done.
      // The two parameters are the student's, and carry over — both of them.
      return createInitialSimulationState(
        command.experimentId,
        state.pumpFlowLMin,
        state.customWeightG
      );
    }

    case 'BEGIN_READING': {
      if (state.activeReadingIndex === command.index) return state;
      return {
        ...state,
        activeReadingIndex: command.index,
        // Every row before this one is settled, whether or not it carried weights.
        committedReadingCount: Math.max(state.committedReadingCount, command.index),
      };
    }

    case 'END_READING': {
      const index = state.activeReadingIndex;
      if (index === null) return state;
      // Only a valid measurement is committed as a reading (F15). The lesson ends a reading
      // only when its row balances, so this never refuses a lesson step; it is what makes
      // "recorded" mean the same thing wherever it is read.
      if (!isValidMeasurement(selectReadings(state)[index])) return state;
      // And the jet must actually be on the carrier: deflector fitted, pump on, tank shut.
      if (selectLiveReadout(state).jetForceOnCarrierN <= 0) return state;
      const committedWeightsG = [...state.committedWeightsG];
      while (committedWeightsG.length <= index) committedWeightsG.push([]);
      committedWeightsG[index] = [...state.apparatus.loadedWeightsG];
      // What the reading was taken *with* is part of the reading.
      const committedPumpFlowLMin = [...state.committedPumpFlowLMin];
      const committedDeflectorIds = [...state.committedDeflectorIds];
      committedPumpFlowLMin[index] = state.pumpFlowLMin;
      committedDeflectorIds[index] = state.apparatus.selectedDeflectorId;
      return {
        ...state,
        activeReadingIndex: null,
        committedReadingCount: Math.max(state.committedReadingCount, index + 1),
        committedWeightsG,
        committedPumpFlowLMin,
        committedDeflectorIds,
      };
    }

    case 'RECORD_ACTUAL_FORCE':
      // F_ac is the weight of each balanced reading: both must be recorded, and none in
      // progress (F15). Calculate is disabled, with the reason, until then.
      if (selectActualForceBlocker(state) !== null) return state;
      return { ...state, isActualForceRecorded: true };

    default:
      // Apparatus commands are handled before this point.
      return state;
  }
}

export function createSimulationRuntime(
  initial: SimulationState = createInitialSimulationState()
): SimulationRuntime {
  let state = freezeSimulationState({ ...initial });
  const listeners = new Set<SimulationListener>();

  const notify = (previous: SimulationState) => {
    // Iterate a copy: a listener may unsubscribe itself, or another, mid-notification.
    for (const listener of [...listeners]) listener(state, previous);
  };

  const commit = (next: SimulationState): boolean => {
    if (next === state) return false;
    const previous = state;
    state = freezeSimulationState(next);
    notify(previous);
    return true;
  };

  return {
    getState: () => state,

    dispatch(command) {
      if (isApparatusAction(command)) {
        const result = attempt(state.apparatus, command);
        if (!result.ok) {
          // A refusal is data, not an exception, and it changes nothing — so no listener
          // is notified. Feedback is the caller's business.
          return { ok: false, state, reason: result.reason };
        }
        let next = result.changed ? { ...state, apparatus: result.state } : state;
        // An accepted selection puts that deflector on the rod — even the one already
        // selected, which the state machine reports as unchanged: the rod was bare.
        if (command.type === 'SELECT_DEFLECTOR' && !next.deflectorFitted) {
          next = { ...next, deflectorFitted: true };
        }
        const changed = commit(next);
        return { ok: true, state, changed };
      }

      const changed = commit(applyCommand(state, command));
      return { ok: true, state, changed };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    reset(experimentId) {
      // The rig, not the parameters panel: Q_total and the custom mass stay as the student
      // set them — both of them, where the custom mass used to reset and Q_total not.
      commit(
        createInitialSimulationState(
          experimentId ?? state.experimentId,
          state.pumpFlowLMin,
          state.customWeightG
        )
      );
      return state;
    },
  };
}

/** The deflector an experiment loads with — used when resetting or switching sheets. */
export const defaultDeflectorFor = (experimentId: ExperimentId): number =>
  getExperiment(experimentId).defaultAngle;
