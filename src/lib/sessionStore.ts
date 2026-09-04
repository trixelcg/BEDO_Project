/**
 * Where a half-finished experiment lives between visits.
 *
 * ## What is kept, and why only this
 *
 * A student who closes the tab four steps into an eleven-step procedure has done real
 * work: they chose a sheet, fitted a deflector, opened the valve, balanced a reading. None
 * of it survived a refresh. What is stored is the four things that work consists of — where
 * they are in the lesson, what the rig is set to, what they have recorded, and what they
 * have answered — and nothing about how the interface happened to be arranged.
 *
 * Panels, camera, popups and which overlay was open are all deliberately absent. They are
 * presentation, they are cheap to re-establish, and restoring them puts a learner back into
 * a screen they have no memory of arranging.
 *
 * ## Why it validates rather than trusts
 *
 * The stored blob is JSON in the user's own browser: it can be edited, it can be left over
 * from an older build with a different shape, and it can be truncated by a browser reclaiming
 * space. So nothing is cast — every field is checked, and anything unexpected discards the
 * whole snapshot rather than restoring half of one. A rig in a state the state machine could
 * not have produced is worse than a fresh one.
 *
 * `SCHEMA_VERSION` is the coarse half of the same rule: bump it and every stored session is
 * ignored, which is the right answer whenever the shape of what is stored changes.
 *
 * ## Where it lives
 *
 * `localStorage`, alongside the language preference, and reached the same way — every access
 * inside a `try`, because reading it *throws* when site data is blocked rather than
 * returning null. `tests/unit/domain-boundary.spec.ts` forbids storage under `src/domain`;
 * this is `src/lib`, which is the presentation side of that line.
 */

import type { ExperimentId } from '../domain/experiments';
import type { RecordedReading, SimulationState } from '../simulation/state';
import type { StepId } from '../domain/experiments';

/** One stable, namespaced key. Changing it silently forgets every saved session. */
export const SESSION_KEY = 'bedo.session';

/**
 * Bump whenever the stored shape changes.
 *
 * A stored session from a different version is discarded, not migrated: this is a
 * convenience that saves someone ten minutes of clicking, and a migration path for it
 * would be more code than the thing it protects.
 */
export const SCHEMA_VERSION = 1;

export interface SavedSession {
  readonly version: number;
  /** When it was saved, ISO 8601 — shown on the intro so a stale session is recognisable. */
  readonly savedAt: string;
  readonly experimentId: ExperimentId;
  /** Where the learner had got to. */
  readonly stepId: StepId;
  readonly simulation: SimulationState;
  /** Assessment answers by question index. */
  readonly quizAnswers: Readonly<Record<number, number>>;
}

const EXPERIMENTS: readonly ExperimentId[] = ['flat', 'semi', 'conical', 'oblique'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isMassList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((g) => isFiniteNumber(g) && g > 0);

const isReading = (value: unknown): value is RecordedReading =>
  isRecord(value) &&
  isFiniteNumber(value.valveOpening) &&
  value.valveOpening >= 0 &&
  value.valveOpening <= 1 &&
  isFiniteNumber(value.deflectorId) &&
  isFiniteNumber(value.pumpFlowLMin) &&
  value.pumpFlowLMin > 0 &&
  isMassList(value.loadedWeightsG);

const isApparatus = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.isCoverOpen === 'boolean' &&
  typeof value.isPowerOn === 'boolean' &&
  typeof value.isVolumetricValveOpen === 'boolean' &&
  isFiniteNumber(value.valveOpening) &&
  value.valveOpening >= 0 &&
  value.valveOpening <= 1 &&
  isFiniteNumber(value.selectedDeflectorId) &&
  isMassList(value.loadedWeightsG);

const isSimulation = (value: unknown): value is SimulationState =>
  isRecord(value) &&
  isApparatus(value.apparatus) &&
  EXPERIMENTS.includes(value.experimentId as ExperimentId) &&
  isFiniteNumber(value.pumpFlowLMin) &&
  value.pumpFlowLMin > 0 &&
  Array.isArray(value.recordedReadings) &&
  value.recordedReadings.every(isReading) &&
  typeof value.isActualForceRecorded === 'boolean';

const isAnswers = (value: unknown): value is Record<number, number> =>
  isRecord(value) &&
  Object.entries(value).every(
    ([key, answer]) => /^\d+$/.test(key) && isFiniteNumber(answer) && answer >= 0
  );

/**
 * Whether a parsed blob is a session this build can restore.
 *
 * Exported because it is the interesting half: a spec can hand it a malformed snapshot
 * without going near storage.
 */
export function isSavedSession(value: unknown, stepIds: readonly string[]): value is SavedSession {
  return (
    isRecord(value) &&
    value.version === SCHEMA_VERSION &&
    typeof value.savedAt === 'string' &&
    EXPERIMENTS.includes(value.experimentId as ExperimentId) &&
    typeof value.stepId === 'string' &&
    // The step has to be one this build has. A renamed or removed step would otherwise
    // restore a learner to nowhere.
    stepIds.includes(value.stepId) &&
    isSimulation(value.simulation) &&
    isAnswers(value.quizAnswers) &&
    // The rig and the sheet must agree. They cannot disagree through any route the app
    // offers, so a snapshot where they do has been edited or is from another build.
    (value.simulation as SimulationState).experimentId === value.experimentId
  );
}

/**
 * The saved session, or null when there isn't a usable one.
 *
 * Null covers every failure: no key, unparseable, wrong version, wrong shape, storage
 * unavailable or throwing. The caller never has to distinguish them, because the answer is
 * the same in all of them — start fresh.
 */
export function readSession(stepIds: readonly string[]): SavedSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSavedSession(parsed, stepIds) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Save a session. Failure is swallowed by design.
 *
 * If storage is full, blocked or throwing, the experiment must still run — losing the
 * ability to resume is a far smaller harm than refusing to continue.
 */
export function writeSession(session: Omit<SavedSession, 'version' | 'savedAt'>): void {
  try {
    const payload: SavedSession = {
      ...session,
      version: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
    };
    globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Ignored: see above.
  }
}

/** Forget the saved session — on Reset, and once the procedure is finished. */
export function clearSession(): void {
  try {
    globalThis.localStorage?.removeItem(SESSION_KEY);
  } catch {
    // Ignored: see above.
  }
}
