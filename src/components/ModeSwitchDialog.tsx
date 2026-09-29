import React, { useEffect, useRef } from 'react';

/**
 * Switching to Guided after the rig has changed in Free Mode (F10, F14).
 *
 * Guided picks the procedure up at its current step, which assumes the rig the steps
 * before it produced. When Free Mode has changed that rig, Guided cannot show it truthfully
 * as "step N" — nor, often, be completed from it — so the learner chooses between starting
 * the procedure again and staying in Free Mode. Q_total and the custom weight's mass are
 * kept either way; the dialog says so.
 *
 * F10 offered a third choice, "Keep the rig as it is". F14 removed it: it handed the
 * lesson a rig its steps disagreed with (the step list and the apparatus two sources of
 * truth), and could strand the learner — at step 1 with the pump running, Guided allows
 * neither the pump switch nor the cover.
 */
export const ModeSwitchDialog: React.FC<{
  isArabic: boolean;
  onChoose: (choice: 'reset' | 'cancel') => void;
}> = ({ isArabic, onChoose }) => {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onChoose('cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose]);

  return (
    <div className="mode-dialog-backdrop interactive" data-bedo-mode-dialog>
      <div
        className="mode-dialog glass-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bedo-mode-dialog-title"
        dir={isArabic ? 'rtl' : 'ltr'}
      >
        <h3 id="bedo-mode-dialog-title">
          {isArabic ? 'الانتقال إلى الوضع الموجّه' : 'Switch to Guided Mode'}
        </h3>
        <p>
          {isArabic
            ? 'تغيّر الجهاز في الوضع الحر، ولا تتطابق حالته مع خطوات الإجراء. يبدأ الوضع الموجّه من الخطوة 1 بجهاز في وضع السكون. الإعادة تمسح الجهاز وتقدّم الدرس وجميع القراءات المسجّلة؛ معاملاتك (Q_total والوزن المخصص) تبقى كما هي.'
            : 'The rig has changed in Free Mode and no longer matches the procedure’s steps. Guided Mode starts again at step 1 with the rig at rest. Resetting clears the rig, the lesson progress and all recorded readings; your parameters — Q_total and the custom weight — are kept.'}
        </p>
        <div className="mode-dialog-actions">
          <button ref={first} className="btn-primary" onClick={() => onChoose('reset')}>
            {isArabic ? 'إعادة الجهاز والبدء من الخطوة 1' : 'Reset the rig and start at step 1'}
          </button>
          <button className="btn-secondary" onClick={() => onChoose('cancel')}>
            {isArabic ? 'البقاء في الوضع الحر' : 'Stay in Free Mode'}
          </button>
        </div>
      </div>
    </div>
  );
};
