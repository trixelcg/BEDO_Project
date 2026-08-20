/**
 * What a refusal looks like to a student.
 *
 * The domain refuses actions with typed codes and no language
 * (`src/domain/stateMachine.ts`). Everything a student actually sees — which words, in
 * which language, in a red banner or a blue one — is decided here, on the presentation
 * side, where it belongs.
 *
 * BEDO-008 removed the state adapters that used to live alongside this map: the runtime
 * owns `ApparatusState` itself now, so nothing has to translate it in and out of a React
 * object any more.
 *
 * Every string below is the copy the app shipped before BEDO-006, character for
 * character. `tests/integration/safety-guards.spec.tsx` asserts them, and rewriting them
 * is a UX task, not a refactor.
 */

import type { RejectionReason } from '../domain/stateMachine';
import type { ErrorCode } from '../types/index';

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
