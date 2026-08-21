import type { RecordRow } from '../domain/physics';
import type { ExperimentId, ExperimentStep, StepId } from '../domain/experiments';
import type { AnchorKey } from '../domain/apparatus';
import type { HighlightKey, PanelControl } from '../lesson/schema';

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
  /** The lesson has passed the step that installs the deflector. */
  hasInstalledDeflector: boolean;
  /** Which results row is being balanced, if any. */
  activeReadingIndex: number | null;
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
  recordedRows: RecordRow[];
  showMonitor: boolean;
  /** F_ac is only recorded once the student presses Calculate (step 11). */
  isCalculated: boolean;
  /** Index into the experiment's quiz options, or null if unanswered. */
  quizAnswer: number | null;
  params: CustomParams;
  warningMessage: { en: string; ar: string; code: ErrorCode } | null;
  /** Observation popup raised when a step is satisfied. */
  notice: { en: string; ar: string } | null;
}

