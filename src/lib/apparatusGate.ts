/**
 * The bridge between the apparatus state machine and this React application.
 *
 * The domain refuses actions with typed codes and no language
 * (`src/domain/stateMachine.ts`). Everything a student actually sees — which words, in
 * which language, in a red banner or a blue one — is decided here, on the presentation
 * side, where it belongs.
 *
 * Every string below is the copy the app shipped before BEDO-006, character for
 * character. `tests/integration/safety-guards.spec.tsx` asserts them, and rewriting them
 * is a UX task, not a refactor.
 */

import type { ApparatusState, RejectionReason } from '../domain/stateMachine';
import type { ErrorCode, SimulationState } from '../types/index';

/** How a refusal is presented, and the copy it carries. */
interface RejectionPresentation {
  /**
   * `warning` is the red blocking banner used by the five documented guards; `notice` is
   * the blue observation banner. The pump-not-running refusal has always been a notice —
   * it is a nudge, not a safety stop — and that distinction is preserved.
   */
  readonly severity: 'warning' | 'notice';
  /**
   * The guard's number in BEDO's state-machine document, for the five that have one.
   * Carried on `warningMessage` as it always was, though nothing reads it today.
   */
  readonly code?: ErrorCode;
  readonly en: string;
  readonly ar: string;
}

export const REJECTION_PRESENTATION: Record<RejectionReason, RejectionPresentation> = {
  WEIGHTS_BLOCKED_BY_OPEN_COVER: {
    severity: 'warning',
    code: 'error1',
    en: 'You can’t add weights while the tank is open.',
    ar: 'لا يمكن إضافة الأوزان أثناء فتح الخزان.',
  },
  DEFLECTOR_NEEDS_OPEN_COVER: {
    severity: 'warning',
    code: 'error2',
    en: 'Remove the tank cover first.',
    ar: 'يرجى إزالة غطاء الخزان أولاً.',
  },
  COVER_BLOCKED_BY_POWER: {
    severity: 'warning',
    code: 'error3',
    en: 'You can’t open the tank while the power is on.',
    ar: 'لا يمكن فتح الخزان أثناء تشغيل الطاقة.',
  },
  POWER_BLOCKED_BY_OPEN_COVER: {
    severity: 'warning',
    code: 'error4',
    en: 'You can’t turn on the power while the tank is open.',
    ar: 'لا يمكن تشغيل الطاقة أثناء فتح الخزان.',
  },
  COVER_BLOCKED_BY_WEIGHTS: {
    severity: 'warning',
    code: 'error5',
    en: 'Remove all weights first before opening the tank.',
    ar: 'يرجى إزالة جميع الأوزان قبل فتح الخزان.',
  },
  VALVE_NEEDS_RUNNING_PUMP: {
    severity: 'notice',
    en: 'Turn on the power switch before opening the valve.',
    ar: 'يرجى تشغيل مفتاح الطاقة قبل فتح الصمام.',
  },
};

/** The apparatus fields of the application state, and nothing else. */
export const toApparatusState = (state: SimulationState): ApparatusState => ({
  isCoverOpen: state.isCoverOpen,
  isPowerOn: state.isPowerOn,
  valveOpening: state.valveOpening,
  isVolumetricValveOpen: state.isVolumetricValveOpen,
  selectedDeflectorId: state.selectedDeflectorId,
  loadedWeightsG: state.loadedWeightsG,
});

/** Folds an accepted apparatus state back into the application state. */
export const withApparatusState = (
  state: SimulationState,
  apparatus: ApparatusState
): SimulationState => ({
  ...state,
  isCoverOpen: apparatus.isCoverOpen,
  isPowerOn: apparatus.isPowerOn,
  valveOpening: apparatus.valveOpening,
  isVolumetricValveOpen: apparatus.isVolumetricValveOpen,
  selectedDeflectorId: apparatus.selectedDeflectorId,
  loadedWeightsG: [...apparatus.loadedWeightsG],
});

/**
 * Puts a refusal on screen.
 *
 * A warning replaces `warningMessage`; a notice sets `notice` and leaves `warningMessage`
 * cleared — which is what the old handlers did, since each one cleared the warning before
 * deciding anything.
 */
export const withRejection = (
  state: SimulationState,
  reason: RejectionReason
): SimulationState => {
  const presentation = REJECTION_PRESENTATION[reason];
  if (presentation.severity === 'notice') {
    return {
      ...state,
      warningMessage: null,
      notice: { en: presentation.en, ar: presentation.ar },
    };
  }
  return {
    ...state,
    warningMessage: {
      en: presentation.en,
      ar: presentation.ar,
      // Every warning-severity reason carries a code; the type keeps it optional because
      // the notice does not.
      code: presentation.code!,
    },
  };
};
