import type { VolumetricMeasurement } from '../domain/volumetric';
import type { RecordRow } from '../domain/physics';
import type { LiveReadout } from '../simulation/selectors';
import type { ExperimentId, ExperimentStep, StepId } from '../domain/experiments';
import type { AnchorKey } from '../domain/apparatus';
import type { HighlightKey, PanelControl } from '../lesson/schema';
import type { InteractionAffordance } from '../interaction/gate';

export type Language = 'en' | 'ar';

/** Guided walks the student through the steps; Free lets them touch anything. */
export type Mode = 'guided' | 'free';

export type { ExperimentId };

/**
 * The five guards from Jet force_State machine.docx. Any control may be clicked at any
 * time; these are what stop an unsafe one.
 */
export type ErrorCode = 'error1' | 'error2' | 'error3' | 'error4' | 'error5';

/** Student-adjustable inputs from the Custom Parameters panel. */
export interface CustomParams {
  /** Pump delivery Q_total. */
  pumpFlowLMin: number;
  /** An extra, student-defined weight denomination (g). */
  customWeightG: number;
}

/**
 * What the components read: a projection of the simulation runtime (the rig) and React's
 * own lesson/UI state, assembled by `App`. Not a source of truth — see `docs/33 §3`.
 */
/**
 * What the components need to know about the lesson.
 *
 * Every field is answered by the lesson runner. Before BEDO-018 each component worked
 * these out for itself by comparing `currentStep` against a number, and two of them
 * disagreed about when a step was finished.
 */
export interface LessonView {
  isGuided: boolean;
  /** Stable identity. Components compare against this, never against a number. */
  stepId: StepId | null;
  /** For display only: "Step 7 / 12". */
  displayNumber: number;
  totalSteps: number;
  /** The bilingual copy for the current step. */
  step: ExperimentStep | undefined;
  /** Where the arrow points and what is highlighted. */
  target: AnchorKey | null;
  /** Where the camera goes, when it differs from `target`. */
  cameraView: AnchorKey | null;
  /** The step's goal has been reached — the guide arrow stands down. */
  isSatisfied: boolean;
  /** The OK button should be on screen. */
  canConfirm: boolean;
  /** Apparatus parts the learner is invited to touch right now. */
  highlight: readonly HighlightKey[];
  /** Panel sections to show. */
  panelControls: readonly PanelControl[];
  /**
   * What the interaction gate will accept right now — everything in free mode.
   *
   * Not the same as `highlight`: the step's highlight is what the learner is being *asked*
   * for, and this is what they are *allowed*. The volumetric valve is in the second and
   * not the first. See `src/interaction/gate.ts`.
   */
  available: readonly InteractionAffordance[];
  /**
   * Deflector angles the gate will accept right now — the experiment's own in guided mode,
   * all seven in free.
   *
   * The scene needs the ids, not just the `deflectors` affordance: the tray carries all
   * seven whatever experiment is loaded, and `BUG-05` was every one of them dispatching.
   */
  selectableDeflectorIds: readonly number[];
  /**
   * A deflector is on the rod.
   *
   * Not "the lesson has reached step 2". BEDO's own state machine has the rig start with
   * the *"weights and deflectors on the table"* (storyboard sl. 29) and puts one in the rod
   * only when the learner installs it (sl. 31) — which is also what makes step 2's
   * instruction performable, since a deflector already drawn on the rod is not on the tray
   * to be dragged. True once the learner installs one, or once the lesson is past the step
   * that asks them to. `docs/38 §3.1`.
   */
  hasInstalledDeflector: boolean;
  /**
   * Bumped whenever the run starts over — Reset, or loading another experiment sheet.
   *
   * Presentation coordination, not lesson state: the scene has animations in flight that a
   * restart must abandon, and "the step went back to the first one" is not a signal it can
   * read without following a step number (`BEDO-021 §23`).
   */
  runId: number;
  /** How many readings the student has recorded. */
  readingsTaken: number;
  /**
   * Confirming this step records a reading.
   *
   * Read off the step's own `onComplete`, never off its number, so the card can name the
   * action ("Record reading") instead of saying OK to something the student cannot see.
   */
  recordsReading: boolean;
  /**
   * Whether a reading may be taken right now — i.e. the tray balances the jet.
   *
   * Read from `selectCanRecordReading`, which is the same condition the runtime enforces,
   * so a Record control is disabled for the same reason a dispatch would be ignored.
   */
  canRecordReading: boolean;
  /** The numbered procedure is finished. Not a step — there is no step 12. */
  isComplete: boolean;
  /** The worksheet this experiment's closing step opens, or null if none shipped. */
  answerSheetUrl: string | null;
}

export interface SimulationView {
  experimentId: ExperimentId;
  language: Language;
  selectedDeflectorId: number;
  isCoverOpen: boolean;
  isPowerOn: boolean;
  valveOpening: number; // 0 to 1
  /** Weights currently on the pan, in grams (e.g. [50, 100]). */
  loadedWeightsG: readonly number[];
  isVolumetricValveOpen: boolean; // volumetric valve open state
  /** The readings actually recorded, in order. Empty until the student records one. */
  recordedRows: RecordRow[];
  /**
   * The rig at this instant, for the software board.
   *
   * Separate from `recordedRows` on purpose: those are readings already taken, and this is
   * the opening, deflector and tray the learner is holding right now. Derived, never
   * stored — see `selectLiveReadout`.
   */
  live: LiveReadout;
  /**
   * The same instant expressed as a results row — balancing mass, signed deviation and
   * the tolerance that applies. What the balance indicator and the Record control read.
   */
  liveRow: RecordRow;
  showMonitor: boolean;
  /** Presentation only: the board is docked beside the apparatus, or expanded over it. */
  monitorExpanded: boolean;
  /** F_ac is only recorded once the student presses Calculate (step 11). */
  isCalculated: boolean;
  /** Index into the experiment's quiz options, or null if unanswered. */
  quizAnswer: number | null;
  params: CustomParams;
  /**
   * The volumetric measuring tank, as the frame loop last reported it.
   *
   * Presentation state, sampled rather than owned here — see `App`'s `onVolumetricSample`.
   */
  volumetric: VolumetricMeasurement;
  warningMessage: { en: string; ar: string; code: ErrorCode } | null;
  /** Observation popup raised when a step is satisfied. */
  notice: { en: string; ar: string } | null;
}

