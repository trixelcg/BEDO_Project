/**
 * What a lesson step is.
 *
 * The lesson engine answers one question — *what should the learner do now?* — and the
 * simulation answers a different one — *is this action physically legal?* A student may
 * do something mechanically fine that the lesson did not ask for; both layers have to be
 * able to say so, which is why they stay apart.
 *
 * ## Identity is a name, not a number
 *
 * Before BEDO-018 a step *was* its number, and three files decided things by comparing
 * against it: `App.tsx`'s progression switch, `UIOverlay`'s `okVisible`, and
 * `DeviceModel`'s arrow. Two of those had genuinely different opinions about when a step
 * was finished (`CQ-06 #5`). Renumbering meant editing all three and hoping.
 *
 * Here a step is a `StepId`. The number it shows is metadata on the definition, so
 * `BEDO-019` can renumber, merge or drop steps by editing data — no code identifies a
 * step by its position.
 */

import type { AnchorKey } from '../domain/apparatus';
import type { StepId } from '../domain/experiments';
import type { RecordRow } from '../domain/physics';
import type { SimulationCommand } from '../simulation/runtime';
import type { SimulationState } from '../simulation/state';

/**
 * Step identity comes from the domain, where the content lives — one name per step, used
 * by both the copy and the schema, so they cannot drift apart.
 *
 * `open-volumetric-valve` has no primary-source support and `docs/32` recommends it lose
 * its number. That is a content decision, and `BEDO-019` makes it; naming it changes
 * nothing.
 */
export type { StepId } from '../domain/experiments';

/**
 * What the step is asking the learner to do.
 *
 * Reuses the simulation's own vocabulary wherever one exists, so an expectation and the
 * command that satisfies it are the same word. `OPEN_MONITOR` has no apparatus
 * equivalent — the monitor is a screen, not part of the rig.
 */
export type LessonExpectation =
  | { readonly type: 'OPEN_COVER' }
  | { readonly type: 'CLOSE_COVER' }
  | { readonly type: 'SELECT_DEFLECTOR' }
  | { readonly type: 'POWER_ON' }
  | { readonly type: 'OPEN_VOLUMETRIC_VALVE' }
  | { readonly type: 'SET_VALVE' }
  | { readonly type: 'ADD_WEIGHT' }
  | { readonly type: 'OPEN_MONITOR' }
  | { readonly type: 'RECORD_ACTUAL_FORCE' }
  | { readonly type: 'ANSWER_QUESTION' };

/** Groups of apparatus parts a step invites the learner to touch. */
export type HighlightKey =
  | 'cover'
  | 'deflectors'
  | 'power'
  | 'volumetricValve'
  | 'flowValve'
  | 'weights';

/** Sections of the control panel a step reveals in guided mode. */
export type PanelControl =
  | 'deflectors'
  | 'power'
  | 'volumetricValve'
  | 'flowValve'
  | 'weights'
  | 'monitor';

/** Everything a completion condition is allowed to look at. */
export interface LessonContext {
  readonly simulation: SimulationState;
  /** The results table, derived — a balance step is complete when its row balances. */
  readonly readings: readonly RecordRow[];
}

/**
 * How a step ends.
 *
 * `action` — performing the expected action finishes it, and the lesson moves on by
 *            itself. Steps 1, 3, 4 and 11 work this way today.
 * `confirm` — the learner presses OK. The step may be *ready* to confirm long before it
 *            is pressed, and `when` decides when the button appears.
 */
export type Advance =
  | { readonly kind: 'action' }
  | { readonly kind: 'confirm'; readonly when: (context: LessonContext) => boolean };

export interface LessonStepDefinition {
  readonly id: StepId;

  /**
   * The number the learner sees. **Metadata, not identity.**
   * `BEDO-019` changes these without touching a line of logic.
   */
  readonly displayNumber: number;

  /** The part of the rig this step is about — drives the arrow and the highlight. */
  readonly target: AnchorKey | null;

  /**
   * Where the camera goes, when that differs from `target`.
   *
   * Step 1 points its arrow at the cover but opens on the whole bench, so the student
   * sees the rig they are standing at rather than a close-up of a plate.
   */
  readonly cameraView?: AnchorKey;

  /** Apparatus parts that are live and highlighted while this step is current. */
  readonly highlight: readonly HighlightKey[];

  /** Panel sections shown while this step is current. */
  readonly panelControls: readonly PanelControl[];

  /** What the learner is being asked to do, if it is a single identifiable action. */
  readonly expectation: LessonExpectation | null;

  /**
   * Whether the step's goal has been reached.
   *
   * **The single authority.** The guide arrow disappears when this is true, and every
   * `confirm` step's OK button is driven by it or by `Advance.when`. Pure, deterministic,
   * and free of any knowledge of React or three.js.
   */
  readonly isSatisfied: (context: LessonContext) => boolean;

  readonly advance: Advance;

  /**
   * A second way to finish, when one exists.
   *
   * Only `open-monitor` has one: pressing OK opens the monitor, and so does opening the
   * monitor directly. Both finish the step, and both did before BEDO-018.
   */
  readonly alsoCompletesOn?: LessonExpectation['type'];

  /**
   * Simulation commands the step issues as it completes.
   *
   * This is where the last index-keyed rule went: `BEGIN_READING { index }` is *data on
   * the step that starts a reading*, so the simulation never learns a step number.
   */
  readonly onComplete?: readonly SimulationCommand[];
}

export interface Lesson {
  readonly steps: readonly LessonStepDefinition[];
}

/** Steps in order, by id — the runner walks the array, nothing else may. */
export const stepIndex = (lesson: Lesson, id: StepId): number =>
  lesson.steps.findIndex((step) => step.id === id);

export const findStep = (lesson: Lesson, id: StepId): LessonStepDefinition | undefined =>
  lesson.steps.find((step) => step.id === id);
