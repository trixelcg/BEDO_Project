import React from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { TOTAL_STEPS, type ExperimentDef } from '../domain/experiments';
import { CURRENT_LESSON } from '../lesson/currentLesson';
import type { SavedSession } from '../lib/sessionStore';
import type { Language } from '../types/index';

/**
 * The pre-experiment information panel.
 *
 * The reference opens on an information panel down the LEFT with the experiment number,
 * the apparatus title, the objective, and a single Start action — the rest of the viewport
 * quiet. That is what this reproduces. It is deliberately not a settings surface: the only
 * thing a learner can do here is read, and start.
 *
 * The objective is the approved `objectiveEn`/`objectiveAr` already carried by the
 * experiment definition, so no new instructional copy is invented here.
 */

interface ExperimentIntroProps {
  experiment: ExperimentDef;
  language: Language;
  onStart: () => void;
  /**
   * A half-finished run from a previous visit, or null.
   *
   * The whole session rather than a flag, because the offer has to say *what* it would
   * resume — an unlabelled Resume next to a Start is a coin toss.
   */
  resumable: SavedSession | null;
  onResume: () => void;
}

const COPY = {
  en: {
    eyebrow: 'Experiment 01',
    title: 'Measurement of Jet Forces',
    subtitle: 'Apparatus',
    objective: 'Objective',
    start: 'Start',
    startFresh: 'Start again',
    resume: 'Resume',
    resumeNote: (step: number, total: number, when: string) =>
      `You were on step ${step} of ${total}, ${when}.`,
  },
  ar: {
    eyebrow: 'التجربة 01',
    title: 'قياس قوة نفث الماء',
    subtitle: 'الجهاز',
    objective: 'الهدف',
    start: 'ابدأ',
    startFresh: 'البدء من جديد',
    resume: 'متابعة',
    resumeNote: (step: number, total: number, when: string) =>
      `كنت في الخطوة ${step} من ${total}، ${when}.`,
  },
} as const;

/**
 * How long ago, in words a learner recognises.
 *
 * Coarse on purpose: the question the offer has to answer is "is this mine, from a moment
 * ago, or somebody else's from last week", and minutes and days answer it. A timestamp
 * would not.
 */
const sinceWords = (savedAt: string, isAr: boolean): string => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(savedAt)) / 60000));
  if (!Number.isFinite(minutes)) return isAr ? 'سابقاً' : 'earlier';
  if (minutes < 2) return isAr ? 'قبل لحظات' : 'just now';
  if (minutes < 60) return isAr ? `قبل ${minutes} دقيقة` : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return isAr ? `قبل ${hours} ساعة` : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return isAr ? `قبل ${days} يوم` : `${days} days ago`;
};

export const ExperimentIntro: React.FC<ExperimentIntroProps> = ({
  experiment,
  language,
  onStart,
  resumable,
  onResume,
}) => {
  const isAr = language === 'ar';
  const t = COPY[isAr ? 'ar' : 'en'];

  const step = resumable
    ? CURRENT_LESSON.steps.find((s) => s.id === resumable.stepId)?.displayNumber
    : undefined;

  return (
    <div className="intro-layer" data-bedo-intro>
      <aside className="intro-panel interactive" aria-labelledby="intro-title">
        <div className="intro-eyebrow">{t.eyebrow}</div>
        <h1 id="intro-title" className="intro-title">
          {t.title}
        </h1>
        <div className="intro-subtitle">{t.subtitle}</div>

        <div className="intro-rule" />

        <h2 className="intro-section">{t.objective}</h2>
        <p className="intro-body">{isAr ? experiment.objectiveAr : experiment.objectiveEn}</p>

        {/*
          Resume, when there is something to resume.

          Offered above Start and labelled with what it would return to, so the choice is
          informed. Start is relabelled beside it — "Start" next to "Resume" reads as the
          neutral option, and it is the destructive one.
        */}
        {resumable && step !== undefined && (
          <div className="intro-resume" data-testid="intro-resume">
            <button className="btn-primary interactive intro-start" onClick={onResume}>
              <RotateCcw size={15} aria-hidden="true" />
              {t.resume}
            </button>
            <p className="intro-resume-note">
              {t.resumeNote(step, TOTAL_STEPS, sinceWords(resumable.savedAt, isAr))}
            </p>
          </div>
        )}

        <button
          className={`btn-${resumable ? 'secondary' : 'primary'} interactive intro-start`}
          onClick={onStart}
        >
          <Play size={15} aria-hidden="true" />
          {resumable ? t.startFresh : t.start}
        </button>
      </aside>
    </div>
  );
};
