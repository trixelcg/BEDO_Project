import React from 'react';
import { CheckCircle2, Info } from 'lucide-react';
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
  okVisible: boolean;
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
  onOkClick,
  showAnswerSheet,
  onOpenAnswerSheet,
}) => {
  const isAr = language === 'ar';
  const step = lesson.step;
  if (!step) return null;

  /*
    The completed state (F14). Finishing the last step is not another step: the card
    says the procedure is done, with no step number and nothing to confirm, and keeps
    the answer sheet — the one thing the learner does next — in reach.
  */
  if (lesson.isComplete) {
    return (
      <div className="step-card is-complete interactive" data-bedo-step-card data-testid="lesson-complete">
        <div className="step-card-number">
          <span className="step-badge is-complete">
            <CheckCircle2 size={14} aria-hidden="true" /> {isAr ? 'اكتملت' : 'Complete'}
          </span>
        </div>
        <div className="step-card-body">
          <h3 className="step-card-title">{isAr ? 'لقد انتهيت!' : 'You finished!'}</h3>
          <p className="step-card-primary">
            {isAr
              ? `اكتملت الخطوات الـ ${lesson.totalSteps}. قراءاتك وقيمة F_ac في شاشة البيانات، وورقة الإجابة هي مكان حلّ النتائج.`
              : `All ${lesson.totalSteps} steps are done. Your readings and F_ac are in the Data Monitor; the answer sheet is where you work the results.`}
          </p>
        </div>
        <div className="step-card-actions">
          {showAnswerSheet && (
            <button className="btn-primary interactive answer-sheet-btn" onClick={onOpenAnswerSheet}>
              {isAr ? 'عرض ورقة الإجابة' : 'Open the answer sheet'}
            </button>
          )}
        </div>
      </div>
    );
  }

  const target = lesson.target ? TARGET_LABEL[lesson.target] : null;
  const notice = isAr ? step.noticeAr : step.noticeEn;

  // The reference's secondary row: the part, the observation, and the prompt to continue.
  const secondary = [
    target ? (isAr ? target.ar : target.en) : null,
    notice,
    okVisible ? (isAr ? 'اضغط موافق للمتابعة' : 'Press OK to continue') : null,
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
      </div>

      <div className="step-card-actions">
        {showAnswerSheet && (
          <button className="btn-primary interactive answer-sheet-btn" onClick={onOpenAnswerSheet}>
            {isAr ? 'عرض ورقة الإجابة' : 'Open the answer sheet'}
          </button>
        )}
        {okVisible && (
          <button className="btn-primary interactive ok-confirm-btn" onClick={onOkClick}>
            {isAr ? 'موافق' : 'OK'}
          </button>
        )}
      </div>
    </div>
  );
};
