import React from 'react';
import { Info } from 'lucide-react';
import type { AnchorKey } from '../domain/apparatus';
import type { Language, LessonView } from '../types/index';

/**
 * The guided step, at the bottom centre of the viewport.
 *
 * The reference experience puts one instruction in front of the learner at a time, over
 * the apparatus, in the shape
 *
 *     [ step number ] primary action
 *                 (i) what to look at   [ OK ]
 *
 * rather than listing the procedure permanently down the left. That is the hierarchy this
 * reproduces; the styling is the current BEDO language, not the original's.
 *
 * All of the content already existed in the lesson model — `body` is the action, `target`
 * names the part, and `notice` is the observation the reference shows as secondary text.
 * Nothing here invents copy.
 */

interface StepInstructionCardProps {
  lesson: LessonView;
  language: Language;
  /** The step can be confirmed — drives the "press X to continue" line. */
  okVisible: boolean;
  /**
   * The confirming control lives in the contextual panel above, not on this card.
   *
   * True on the balance steps, where confirming *is* recording the reading and the Record
   * button sits with the weights and the balance bar it belongs to. Two buttons doing the
   * same thing, one on the card and one in the panel, is the duplication this avoids.
   */
  okInPanel: boolean;
  onOkClick: () => void;
  showAnswerSheet: boolean;
  onOpenAnswerSheet: () => void;
}

/** What the reference prints on the secondary row: the part the step is about. */
const TARGET_LABEL: Record<AnchorKey, { en: string; ar: string }> = {
  cover: { en: 'Cover', ar: 'الغطاء' },
  tray: { en: 'Deflector', ar: 'العاكس' },
  weights: { en: 'Weights', ar: 'الأثقال' },
  pointer: { en: 'Pointer', ar: 'المؤشر' },
  pan: { en: 'Weight base', ar: 'قاعدة الأثقال' },
  power: { en: 'Power', ar: 'الطاقة' },
  flowValve: { en: 'Flow control valve', ar: 'صمام التحكم في التدفق' },
  volumetricValve: { en: 'Volumetric valve', ar: 'الصمام الحجمي' },
  overview: { en: 'Apparatus', ar: 'الجهاز' },
  // No step targets the board; it is where the Board utility looks. Labelled for
  // completeness so the map stays total over AnchorKey.
  board: { en: 'Board', ar: 'اللوحة' },
};

export const StepInstructionCard: React.FC<StepInstructionCardProps> = ({
  lesson,
  language,
  okVisible,
  okInPanel,
  onOkClick,
  showAnswerSheet,
  onOpenAnswerSheet,
}) => {
  const isAr = language === 'ar';
  const step = lesson.step;
  if (!step) return null;

  const target = lesson.target ? TARGET_LABEL[lesson.target] : null;
  const notice = isAr ? step.noticeAr : step.noticeEn;

  // The reference's secondary row: the part, the observation, and the prompt to continue.
  const secondary = [
    target ? (isAr ? target.ar : target.en) : null,
    notice,
    okVisible
      ? lesson.recordsReading
        ? isAr
          ? 'اضغط "تسجيل القراءة" لحفظ هذه القراءة'
          : 'Press Record reading to save this reading'
        : isAr
          ? 'اضغط موافق للمتابعة'
          : 'Press OK to continue'
      : null,
  ]
    .filter(Boolean)
    .join(isAr ? ' — ' : ' — ');

  return (
    <div className="step-card interactive" data-bedo-step-card>
      <div className="step-card-number">
        {/* Kept as `.step-badge` text: the E2E suite and the harness read "Step n / 11". */}
        <span className="step-badge">
          {isAr
            ? `الخطوة ${lesson.displayNumber} / ${lesson.totalSteps}`
            : `Step ${lesson.displayNumber} / ${lesson.totalSteps}`}
        </span>
      </div>

      <div className="step-card-body">
        {/*
          The reference card shows only the action. The title is kept as the card's
          heading because it is what names the step to assistive technology — and to the
          suite, which identifies steps by it — so the card carries both: what this step
          is, then what to do.
        */}
        <h3 className="step-card-title">{isAr ? step.titleAr : step.titleEn}</h3>
        <p className="step-card-primary">{isAr ? step.bodyAr : step.bodyEn}</p>
        {secondary && (
          <p className="step-card-secondary">
            <Info size={13} aria-hidden="true" />
            <span>{secondary}</span>
          </p>
        )}
        {lesson.isComplete && (
          <p className="step-card-complete" data-testid="lesson-complete">
            {isAr ? '✅ اكتملت التجربة.' : '✅ Experiment complete.'}
          </p>
        )}
      </div>

      <div className="step-card-actions">
        {showAnswerSheet && (
          <button className="btn-primary interactive answer-sheet-btn" onClick={onOpenAnswerSheet}>
            {isAr ? 'عرض ورقة الإجابة' : 'Open the answer sheet'}
          </button>
        )}
        {/*
          The class stays `ok-confirm-btn` — it is what the browser suite presses — but a
          step that writes a results row says so. "OK" on a balance step gave no hint that
          pressing it was the act of recording.
        */}
        {okVisible && !okInPanel && (
          <button className="btn-primary interactive ok-confirm-btn" onClick={onOkClick}>
            {lesson.recordsReading
              ? isAr
                ? 'تسجيل القراءة'
                : 'Record reading'
              : isAr
                ? 'موافق'
                : 'OK'}
          </button>
        )}
      </div>
    </div>
  );
};
