/**
 * The React adapter for the simulation runtime.
 *
 * Deliberately thin, and deliberately here rather than in `src/simulation/` — the runtime
 * has no idea React exists, and this is the only file that knows about both.
 *
 * `useSyncExternalStore` is React's own contract for exactly this: an external store that
 * owns state and notifies subscribers. It is tearing-safe, needs no dependency, and gives
 * the future Zustand migration nothing to undo — a store would subscribe to the runtime
 * the same way this does.
 *
 * The runtime returns the *same object* until something actually changes, so React's
 * identity check does the work: a rejected action, or one that changed nothing, causes no
 * render.
 */

import { useMemo, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import {
  createSimulationRuntime,
  type SimulationRuntime,
} from '../simulation/runtime';
import { createInitialSimulationState, type SimulationState } from '../simulation/state';
import type { ExperimentId } from '../domain/experiments';

/** Creates one runtime for the lifetime of the component. */
export function useSimulationRuntime(experimentId?: ExperimentId): SimulationRuntime {
  const ref = useRef<SimulationRuntime | null>(null);
  if (ref.current === null) {
    ref.current = createSimulationRuntime(createInitialSimulationState(experimentId));
  }
  return ref.current;
}

/** Subscribes to the runtime and re-renders when its state changes. */
export function useSimulationState(runtime: SimulationRuntime): SimulationState {
  const subscribe = useMemo(
    () => (onStoreChange: () => void) => runtime.subscribe(onStoreChange),
    [runtime]
  );
  return useSyncExternalStore(subscribe, runtime.getState, runtime.getState);
}
