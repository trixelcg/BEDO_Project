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

export interface SimulationState {
  currentStep: number;
  language: Language;
  selectedDeflectorId: number;
  isCoverOpen: boolean;
  isPowerOn: boolean;
  valveOpening: number; // 0 to 1
  loadedWeights: number[]; // Array of weights currently on pan (e.g. [50, 100])
  pointerOffset: number; // deviation from zero mark (mm)
  recordedRows: RecordRow[];
  currentRecordIndex: number;
  showMonitor: boolean;
  warningMessage: { en: string; ar: string } | null;
}
