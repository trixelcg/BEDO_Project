import type { RecordRow } from '../domain/physics';
import type { ExperimentId } from '../domain/experiments';

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
export interface SimulationView {
  mode: Mode;
  experimentId: ExperimentId;
  currentStep: number;
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

