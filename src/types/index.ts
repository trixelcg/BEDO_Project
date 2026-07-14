export type Language = 'en' | 'ar';

export interface DeflectorOption {
  id: number;
  nameEn: string;
  nameAr: string;
  factor: number; // multiplier for F_th calculation (e.g. 1.0, 2.0, 0.5, 1.707)
}

export interface StepDefinition {
  id: number;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
}

export interface RecordRow {
  index: number; // 0, 1, 2, 3 (represents rows 1 to 4)
  totalFlowValue: number; // constant flow rate like 120
  valveOpen: number; // Valve opening fraction n (0 to 1)
  flowRateQLMin: number; // Q (L/min)
  flowRateQM3: number; // Q (m^3/s)
  theoreticalVo: number; // v_o (m/s)
  theoreticalV: number; // v (m/s)
  weightsN: number; // added weights in Newtons
  springhW: number; // spring deflection in mm
  fth: number; // Theoretical Force (N)
  mass: number; // fth converted back to mass (g)
  idealMass: number; // Target mass to balance (g)
  actualWeightMass: number; // Mass of weights currently loaded on tray (g)
  balanced: boolean; // whether the tray is balanced with the pointer
  loadedWeights: number[]; // loaded weights array
}

/** Guided walks the student through the steps; Free lets them touch anything. */
export type Mode = 'guided' | 'free';

/** Which experiment is loaded — matches BEDO's four Phase 2 sheets. */
export type ExperimentId = 'flat' | 'semi' | 'conical' | 'oblique';

/**
 * The five guards from Jet force_State machine.docx. Any control may be clicked at any
 * time; these are what stop an unsafe one.
 */
export type ErrorCode = 'error1' | 'error2' | 'error3' | 'error4' | 'error5';

/** Student-adjustable inputs from the Custom Parameters panel. */
export interface CustomParams {
  /** Pump flow rate Q_total (L/min). */
  qTotal: number;
  /** An extra, student-defined weight denomination (g). */
  customWeightG: number;
}

export interface SimulationState {
  mode: Mode;
  experimentId: ExperimentId;
  currentStep: number;
  language: Language;
  selectedDeflectorId: number;
  isCoverOpen: boolean;
  isPowerOn: boolean;
  valveOpening: number; // 0 to 1
  loadedWeights: number[]; // Array of weights currently on pan (e.g. [50, 100])
  pointerOffset: number; // deviation from zero mark (mm)
  isVolumetricValveOpen: boolean; // volumetric valve open state
  recordedRows: RecordRow[];
  currentRecordIndex: number;
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

export interface SceneConfig {
  exposure: number;
  selfIllumination: number;
  hdrLight: number;
  hdrRotation: number;
  reflection: number;
  contrast: number;
  ambientColor: string;
  characterPosition: [number, number, number];
  characterRotation: [number, number, number];
  characterScale: [number, number, number];
  glassSpecular: number;
  glassRoughness: number;
  glassIor: number;
}

