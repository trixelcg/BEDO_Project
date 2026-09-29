import React, { useEffect, useRef } from 'react';

/**
 * "Reset simulator", said before it is done (F15).
 *
 * Reset clears a lot at once — the rig, the guided progress, every reading and F_ac — and
 * keeps a few things the learner set. The button used to do it on the spot, and a second,
 * unlabelled "Reset" in the monitor did the same beside Export. This lists, from the
 * current state, exactly what will go and what will stay, and asks.
 *
 * App shows it only when there is something to lose; resetting a rig already at rest
 * needs no confirmation.
 */
export interface ResetSummary {
  /** The rig is not at rest: cover, pump, valve, weights or a fitted deflector. */
  rigInUse: boolean;
  /** Guided progress to lose: the step the lesson is on, or null if at step 1. */
  guidedStep: number | 'complete' | null;
  /** Recorded lesson readings, and whether F_ac is recorded. */
  lessonReadings: number;
  actualForceRecorded: boolean;
  /** Free readings in the table. */
  freeReadings: number;
  /** What stays. */
  pumpFlowLMin: number;
  customWeightG: number;
  experimentName: string;
}

export const ResetDialog: React.FC<{
  isArabic: boolean;
  summary: ResetSummary;
  onChoose: (choice: 'reset' | 'cancel') => void;
}> = ({ isArabic, summary, onChoose }) => {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onChoose('cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose]);

  const t = (en: string, ar: string) => (isArabic ? ar : en);
  const cleared: string[] = [];
  if (summary.rigInUse)
    cleared.push(t('The rig: cover, pump, valve, weights and deflector', 'الجهاز: الغطاء والمضخة والصمام والأثقال والعاكس'));
  if (summary.guidedStep !== null)
    cleared.push(
      summary.guidedStep === 'complete'
        ? t('Guided progress: the completed lesson (back to step 1)', 'تقدّم الوضع الموجّه: الدرس المكتمل (العودة إلى الخطوة 1)')
        : t(`Guided progress: step ${summary.guidedStep} (back to step 1)`, `تقدّم الوضع الموجّه: الخطوة ${summary.guidedStep} (العودة إلى الخطوة 1)`)
    );
  if (summary.lessonReadings > 0)
    cleared.push(
      t(
        `${summary.lessonReadings} recorded lesson reading${summary.lessonReadings === 1 ? '' : 's'}${summary.actualForceRecorded ? ' and their F_ac' : ''}`,
        `${summary.lessonReadings} من قراءات الدرس المسجّلة${summary.actualForceRecorded ? ' وقيمة F_ac' : ''}`
      )
    );
  if (summary.freeReadings > 0)
    cleared.push(
      t(
        `${summary.freeReadings} free reading${summary.freeReadings === 1 ? '' : 's'}`,
        `${summary.freeReadings} من قراءات الوضع الحر`
      )
    );

  return (
    <div className="mode-dialog-backdrop interactive" data-bedo-reset-dialog>
      <div
        className="mode-dialog glass-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bedo-reset-title"
        aria-describedby="bedo-reset-body"
        dir={isArabic ? 'rtl' : 'ltr'}
      >
        <h3 id="bedo-reset-title">{t('Reset the simulator?', 'إعادة ضبط المحاكي؟')}</h3>
        <div id="bedo-reset-body">
          <p className="reset-dialog-label">{t('This clears:', 'يمسح:')}</p>
          <ul className="reset-dialog-list" data-bedo-reset-clears>
            {cleared.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="reset-dialog-label">{t('This keeps:', 'يُبقي:')}</p>
          <ul className="reset-dialog-list is-kept" data-bedo-reset-keeps>
            <li>{t(`Q_total ${summary.pumpFlowLMin} L/min and the custom weight ${summary.customWeightG} g`, `Q_total ${summary.pumpFlowLMin} L/min والوزن المخصص ${summary.customWeightG} غ`)}</li>
            <li>{t(`The experiment: ${summary.experimentName}`, `التجربة: ${summary.experimentName}`)}</li>
            <li>{t('The mode and the language', 'الوضع واللغة')}</li>
          </ul>
        </div>
        <div className="mode-dialog-actions">
          <button className="btn-primary" onClick={() => onChoose('reset')} style={{ background: 'var(--danger-fill)', color: '#fff' }}>
            {t('Yes, reset', 'نعم، أعد الضبط')}
          </button>
          <button ref={cancel} className="btn-secondary" onClick={() => onChoose('cancel')}>
            {t('Cancel', 'إلغاء')}
          </button>
        </div>
      </div>
    </div>
  );
};
