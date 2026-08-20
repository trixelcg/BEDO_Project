/**
 * Loading milestones (BEDO-002 §9).
 *
 * Three moments matter when this app is measured: the shell exists, the apparatus model
 * is in the scene graph, and the training UI is usable. Before this there was no way to
 * observe any of them from outside the bundle — `docs/11 §3.5` had to record "time to
 * visible 3D scene" by sampling screenshots by eye, which is not a number later work can
 * be compared against.
 *
 * The instrumentation is deliberately inert: it writes a data attribute on <html> and
 * drops a `performance.mark`. It renders nothing, changes no state, and is not read by
 * any application code — see `scripts/perf-baseline.mjs` and `tests/e2e`.
 */
export type ReadyStage = 'app' | 'scene' | 'training';

/** `app` -> data-bedo-app-ready, and so on. */
const attribute = (stage: ReadyStage) => `bedo${stage[0].toUpperCase()}${stage.slice(1)}Ready`;

export const READY_MARK = (stage: ReadyStage) => `bedo:${stage}-ready`;

export function markReady(stage: ReadyStage): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const key = attribute(stage);
  // First one wins: re-renders must not move a milestone that already happened.
  if (root.dataset[key]) return;
  root.dataset[key] = String(Math.round(performance.now()));
  performance.mark?.(READY_MARK(stage));
}

/** Test/measurement helper — milliseconds from navigation start, or null if not reached. */
export function readyAt(stage: ReadyStage): number | null {
  if (typeof document === 'undefined') return null;
  const raw = document.documentElement.dataset[attribute(stage)];
  return raw === undefined ? null : Number(raw);
}
