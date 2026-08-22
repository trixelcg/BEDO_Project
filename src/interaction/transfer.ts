/**
 * Physical transfers — the 2-second moves BEDO's storyboard specifies.
 *
 * ## The requirement, verbatim
 *
 * `Jetforce_Storyboard.pptx`, in five places:
 *
 * - sl. 7, 8, 14 — *"When the user clicks on the deflector, the deflector moves to the
 *   tank to install it in the rod **in 2 seconds**."*
 * - sl. 16 — *"the weight moves to the tank holder **in 2 sec**"*
 * - sl. 29, 30, 32 (state machine) — *"The weight moved to the tank holder **in 2 sec**"*
 * - sl. 32, state D — *"Click on the weight on holder → The weight **removed** from the
 *   tank holder **in 2 sec**."*
 *
 * So a transfer is not a teleport, and the duration is not a design choice: it is two
 * seconds because BEDO wrote two seconds. `docs/12 R-4` recorded this; `BEDO-022` gave
 * removal its semantics; this is the move itself.
 *
 * ## Where this sits
 *
 * Presentation. `BEDO-021 §22` is explicit that elapsed time, easing and transient
 * positions stay out of `SimulationRuntime`, and they do: the runtime commits a state
 * change, the scene observes the transition, and this schedules the interpolation between
 * the old transform and the new one. Nothing here can be read back into the rig's state,
 * and cancelling every transfer mid-flight leaves the simulation untouched.
 *
 * Pure TypeScript — no three.js, no React, no DOM. The vector maths belongs to the scene;
 * this owns only *how far along* each move is.
 */

/**
 * BEDO's number. Every transfer the storyboard specifies takes this long.
 */
export const TRANSFER_SECONDS = 2;

/**
 * How long a refused or missed object takes to get back where it came from.
 *
 * **Implementation timing, not BEDO source truth.** No BEDO document describes a failed
 * drop — the storyboard has no drag at all, and the sheets only ever describe the
 * successful case — so there is nothing to be faithful to. A recovery is not a lesson
 * beat and should not be sat through, so it is brisk and deliberately unlike the two
 * seconds that mean "something happened" (`BEDO-021 §9`).
 */
export const RETURN_SECONDS = 0.35;

export type TransferKind =
  /** Tray → rod, on an accepted `SELECT_DEFLECTOR`. Storyboard sl. 7/8/14. */
  | 'deflector-install'
  /** Holder → tray, on an accepted `REMOVE_WEIGHT`. Storyboard sl. 32, state D. */
  | 'weight-removal'
  /** Back where it came from, after a miss or a refusal. Implementation behaviour. */
  | 'return-to-source';

const DURATIONS: Readonly<Record<TransferKind, number>> = {
  'deflector-install': TRANSFER_SECONDS,
  'weight-removal': TRANSFER_SECONDS,
  'return-to-source': RETURN_SECONDS,
};

export const durationOf = (kind: TransferKind): number => DURATIONS[kind];

/**
 * Deterministic easing — the same curve the camera rig flies on.
 *
 * A transfer represents a part being carried and set down, so it starts and stops at rest.
 * Being a pure function of progress (and not of frame rate) is what lets a test assert the
 * position half-way through without rendering anything.
 */
export const easeInOutCubic = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

interface Flight {
  kind: TransferKind;
  elapsed: number;
  duration: number;
}

/**
 * The set of moves currently in flight, keyed by a caller-chosen id.
 *
 * Ids are the scene's own — `deflector:90`, `weight:3` — so restarting a transfer that is
 * already running is a no-op rather than a second ghost. That matters because an accepted
 * `SELECT_DEFLECTOR` can be observed twice: once by the handler that dispatched it, and
 * once by the state-transition observer that catches the 2D panel doing the same thing.
 */
export interface TransferSet {
  /** Starts a move, or does nothing if one with this id is already running. */
  start(id: string, kind: TransferKind): void;
  /** Advances every flight. Returns the ids that finished on this tick, in start order. */
  advance(seconds: number): readonly string[];
  /** Eased progress in [0, 1], or null if there is no such flight. */
  progressOf(id: string): number | null;
  kindOf(id: string): TransferKind | null;
  has(id: string): boolean;
  /** Drops a flight without finishing it. The caller decides what the scene does next. */
  cancel(id: string): void;
  clear(): void;
  readonly size: number;
}

export function createTransferSet(): TransferSet {
  const flights = new Map<string, Flight>();

  return {
    start(id, kind) {
      if (flights.has(id)) return;
      flights.set(id, { kind, elapsed: 0, duration: durationOf(kind) });
    },

    advance(seconds) {
      if (flights.size === 0) return [];
      const settled: string[] = [];
      for (const [id, flight] of flights) {
        flight.elapsed += seconds;
        if (flight.elapsed >= flight.duration) settled.push(id);
      }
      for (const id of settled) flights.delete(id);
      return settled;
    },

    progressOf(id) {
      const flight = flights.get(id);
      if (!flight) return null;
      if (flight.duration <= 0) return 1;
      return easeInOutCubic(Math.min(1, Math.max(0, flight.elapsed / flight.duration)));
    },

    kindOf: (id) => flights.get(id)?.kind ?? null,
    has: (id) => flights.has(id),
    cancel(id) {
      flights.delete(id);
    },
    clear() {
      flights.clear();
    },
    get size() {
      return flights.size;
    },
  };
}

/**
 * Which disc left the holder between two loaded-weight states.
 *
 * The scene has to animate *a* disc, and only the runtime knows which one went. Rather
 * than have the removal path smuggle its index into presentation state — which would put
 * a pointer's business in the rig's — the scene reads the transition, exactly as
 * `BEDO-021 §22` asks.
 *
 * Returns null unless exactly one disc left, so the all-at-once clear a reading step
 * performs (`REMOVE_ALL_WEIGHTS`) animates nothing: it is the lesson tidying up between
 * readings, not the learner taking a weight off, and BEDO gives it no transfer.
 *
 * Duplicate denominations stay honest by construction: this compares *positions*, so it
 * answers with a stack position rather than a mass. Where two adjacent discs weigh the
 * same the two lists are equal up to the last position and *which* of them left is not
 * determined by the states at all; the topmost consistent position is reported, being the
 * disc a learner watched come off the top of the pile. Nothing depends on the choice —
 * the runtime removed by index and has already recorded which — and the two discs are the
 * same object drawn twice.
 */
export const removedWeightIndex = (
  previous: readonly number[],
  next: readonly number[]
): number | null => {
  if (next.length !== previous.length - 1) return null;
  let index = 0;
  while (index < next.length && next[index] === previous[index]) index++;
  for (let i = index; i < next.length; i++) {
    if (next[i] !== previous[i + 1]) return null;
  }
  return index;
};
