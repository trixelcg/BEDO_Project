import React from 'react';
import { Play } from 'lucide-react';
import type { ExperimentDef } from '../domain/experiments';
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
}

const COPY = {
  en: {
    eyebrow: 'Experiment 01',
    title: 'Measurement of Jet Forces',
    subtitle: 'Apparatus',
    objective: 'Objective',
    start: 'Start',
  },
  ar: {
    eyebrow: 'التجربة 01',
    title: 'قياس قوة نفث الماء',
    subtitle: 'الجهاز',
    objective: 'الهدف',
    start: 'ابدأ',
  },
} as const;

export const ExperimentIntro: React.FC<ExperimentIntroProps> = ({
  experiment,
  language,
  onStart,
}) => {
  const isAr = language === 'ar';
  const t = COPY[isAr ? 'ar' : 'en'];

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

        <button className="btn-primary interactive intro-start" onClick={onStart}>
          <Play size={15} aria-hidden="true" />
          {t.start}
        </button>
      </aside>
    </div>
  );
};
