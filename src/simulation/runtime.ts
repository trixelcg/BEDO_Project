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
  createInitialSimulationState,
  freezeSimulationState,
  type SimulationState,
} from './state';

/** Commands the simulation understands beyond the apparatus itself. */
export type SimulationCommand =
  | ApparatusAction
  | { readonly type: 'SET_PUMP_FLOW'; readonly lPerMin: number }
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
  'REMOVE_ALL_WEIGHTS',
]);

const isApparatusAction = (command: SimulationCommand): command is ApparatusAction =>
  APPARATUS_COMMANDS.has(command.type);

/** Applies a simulation-level command. Returns the same object when nothing changed. */
function applyCommand(state: SimulationState, command: SimulationCommand): SimulationState {
  switch (command.type) {
    case 'SET_PUMP_FLOW':
      if (state.pumpFlowLMin === command.lPerMin) return state;
      return { ...state, pumpFlowLMin: command.lPerMin };

    case 'SELECT_EXPERIMENT': {
      if (state.experimentId === command.experimentId) return state;
      // Loading a sheet re-runs the whole procedure: a fresh rig with that experiment's
      // deflector, and no readings carried over. This is what the app has always done.
      return createInitialSimulationState(command.experimentId, state.pumpFlowLMin);
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
      const committedWeightsG = [...state.committedWeightsG];
      while (committedWeightsG.length <= index) committedWeightsG.push([]);
      committedWeightsG[index] = [...state.apparatus.loadedWeightsG];
      return {
        ...state,
        activeReadingIndex: null,
        committedReadingCount: Math.max(state.committedReadingCount, index + 1),
        committedWeightsG,
      };
    }

    case 'RECORD_ACTUAL_FORCE':
      if (state.isActualForceRecorded) return state;
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
        const changed = result.changed && commit({ ...state, apparatus: result.state });
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
      commit(createInitialSimulationState(experimentId ?? state.experimentId, state.pumpFlowLMin));
      return state;
    },
  };
}

/** The deflector an experiment loads with — used when resetting or switching sheets. */
export const defaultDeflectorFor = (experimentId: ExperimentId): number =>
  getExperiment(experimentId).defaultAngle;
