import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { CheckCircle2, Circle, ArrowRightCircle, Trophy } from 'lucide-react';
import type { Language, StepProgressRow } from '../types/index';

/**
 * The guided Steps view (F14): the whole procedure, and where the learner stands on it.
 *
 * A read-out, not a menu. It is drawn from `LessonView.progress`, which the runner answers
 * from the same state that drives the step card and the apparatus, so a step shows as
 * done the moment the rig shows it done and never before.
 *
 *   - **Completed / Current / Upcoming** differ by icon, weight and a word, not by colour
 *     alone: a check, "Done"; an arrow, bold, "Now"; a hollow circle, dimmed.
 *   - **Rows are not controls.** They are list items with no handler, so the list cannot
 *     be used to jump the procedure; the rig's own controls, through the gate, are the
 *     only way forward.
 *   - **Scrolls only when the current step changes** — and then only within the list, to
 *     bring the new current row into view. A learner scrolling back to read an earlier
 *     step is not pulled away while they do.
 *   - **Completion is its own state**, an unnumbered row after the last step, not a step.
 *   - Observation notes and the assessment question are not steps and are not listed.
 */

interface StepProgressProps {
  rows: readonly StepProgressRow[];
  isComplete: boolean;
  language: Language;
  /** Places the panel beside the aside dock rather than over it. */
  placement: 'start' | 'end';
  onClose: () => void;
}

const LABEL = {
  completed: { en: 'Done', ar: 'تمّت' },
  current: { en: 'Now', ar: 'الآن' },
  upcoming: { en: 'Next', ar: 'لاحقاً' },
} as const;

export const StepProgress: React.FC<StepProgressProps> = ({
  rows,
  isComplete,
  language,
  placement,
  onClose,
}) => {
  const isAr = language === 'ar';
  const listRef = useRef<HTMLOListElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);
  const currentId = rows.find((row) => row.status === 'current')?.stepId ?? null;
  const lastScrolledFor = useRef<string | null | undefined>(undefined);

  /** Centre `row` in the list's own scroll box — never the page. */
  const bringIntoView = (row: HTMLElement | null, smooth: boolean) => {
    const list = listRef.current;
    if (!list || !row) return;
    const top = row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
    if (typeof list.scrollTo === 'function') {
      list.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
    } else {
      list.scrollTop = Math.max(0, top);
    }
  };

  // Opening the panel shows the current step: placed, not animated.
  useLayoutEffect(() => {
    bringIntoView(currentRef.current, false);
    lastScrolledFor.current = currentId;
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After that, only a change of current step moves the list.
  useEffect(() => {
    if (lastScrolledFor.current === currentId) return;
    lastScrolledFor.current = currentId;
    if (currentId) bringIntoView(currentRef.current, true);
    else if (isComplete && listRef.current) {
      const done = listRef.current.lastElementChild as HTMLElement | null;
      bringIntoView(done, true);
    }
  }, [currentId, isComplete]);

  const doneCount = rows.filter((row) => row.status === 'completed').length;

  return (
    <nav
      className={`step-progress interactive is-${placement}`}
      aria-label={isAr ? 'خطوات الإجراء' : 'Procedure steps'}
      data-bedo-step-progress
    >
      <div className="step-progress-head">
        <span className="step-progress-title">{isAr ? 'الخطوات' : 'Steps'}</span>
        <span className="step-progress-count" aria-live="polite">
          {isAr ? `${doneCount} من ${rows.length} مكتملة` : `${doneCount} of ${rows.length} done`}
        </span>
        <button
          className="step-progress-close"
          onClick={onClose}
          aria-label={isAr ? 'إخفاء الخطوات' : 'Hide steps'}
        >
          ×
        </button>
      </div>
      <ol className="step-progress-list" ref={listRef}>
        {rows.map((row) => {
          const isCurrent = row.status === 'current';
          const Icon =
            row.status === 'completed' ? CheckCircle2 : isCurrent ? ArrowRightCircle : Circle;
          return (
            <li
              key={row.stepId}
              ref={isCurrent ? currentRef : undefined}
              className={`step-row is-${row.status}`}
              aria-current={isCurrent ? 'step' : undefined}
              data-step-id={row.stepId}
              data-status={row.status}
            >
              <Icon className="step-row-icon" size={18} aria-hidden="true" />
              <span className="step-row-num" aria-hidden="true">
                {row.displayNumber}
              </span>
              <span className="step-row-title">{isAr ? row.titleAr : row.titleEn}</span>
              <span className="step-row-state">
                <span className="sr-only">
                  {isAr ? `الخطوة ${row.displayNumber}: ` : `Step ${row.displayNumber}: `}
                </span>
                {isAr ? LABEL[row.status].ar : LABEL[row.status].en}
              </span>
            </li>
          );
        })}
        {isComplete && (
          <li className="step-row is-finished" data-status="finished" aria-current="step">
            <Trophy className="step-row-icon" size={18} aria-hidden="true" />
            <span className="step-row-num" aria-hidden="true" />
            <span className="step-row-title">{isAr ? 'اكتملت التجربة' : 'Experiment complete'}</span>
            <span className="step-row-state">{isAr ? 'انتهت' : 'Finished'}</span>
          </li>
        )}
      </ol>
    </nav>
  );
};
