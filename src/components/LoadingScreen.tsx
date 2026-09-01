import React from 'react';
import type { Language } from '../types';

/**
 * Which real milestone the startup has reached.
 *
 * These are not decorative stages on a timer — each maps to a readiness marker the
 * application already publishes. `apparatus` is entered when the shell is mounted
 * (`app`), and `ready` when the apparatus is in the scene graph (`scene`), which is the
 * reveal condition. Nothing advances without one of those actually happening.
 */
export type LoadingPhase = 'app' | 'apparatus' | 'ready';

const PHASE_ORDER: LoadingPhase[] = ['app', 'apparatus', 'ready'];

interface LoadingScreenProps {
  visible: boolean;
  language: Language;
  phase: LoadingPhase;
  /** A genuine asset failure reported by three's loading manager. */
  failed: boolean;
  onRetry: () => void;
}

const COPY = {
  en: {
    code: 'VL-FM009',
    title: 'Measurement of Jet Forces',
    phases: {
      app: 'Preparing application…',
      apparatus: 'Loading 3D experiment…',
      ready: 'Experiment ready',
    },
    failed: 'Unable to load the experiment.',
    retry: 'Retry',
  },
  ar: {
    code: 'VL-FM009',
    title: 'قياس قوة نفث الماء',
    /*
      Built only from wording the project already uses: «التجربة» is how every experiment
      is named in `src/domain/experiments.ts`, «تحميل» appears in the existing failure
      string, and «تجهيز»/«جاهز» are already in the interface. The English phase says
      "3D"; that is deliberately not translated here because the project has no approved
      Arabic term for it, and inventing one is worse than omitting it.
    */
    phases: {
      app: 'جارٍ تجهيز التطبيق…',
      apparatus: 'جارٍ تحميل التجربة…',
      ready: 'التجربة جاهزة',
    },
    failed: 'تعذر تحميل التجربة.',
    retry: 'إعادة المحاولة',
  },
} as const;

/**
 * The screen shown until the experience is genuinely usable.
 *
 * BEDO-UX-01 gated this on the right signal but drew it too quietly: a small block of text
 * on a near-black page, which a user reported as simply not seeing a loading screen at all
 * — measured, it was on screen for ~3.7 s, so the defect was perceptual, not timing. This
 * is the same contract with a presence that reads as a deliberate loading state.
 *
 * The mark is BEDO's own logo, replacing the typographic stand-in that stood here while the
 * repository had no logo file. The boot shell in `index.html` carries the same file at the
 * same size, so React's handover is invisible.
 *
 * It is the *dark-background* derivative (`public/bedo-logo-dark.png`), not the authored
 * artwork: half of BEDO's logo is a dark neutral that measures 1.77:1 against this screen's
 * #141517 and effectively vanished, leaving the mark reading as "B" plus grey shapes. The
 * derivative lifts only those neutrals to 7.99:1 — the readability the orange already had —
 * and leaves the brand colour bit-identical. `scripts/brand/build-icons.py` derives it from
 * the untouched original in `assets-source/brand/` and asserts both properties.
 */
export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  visible,
  language,
  phase,
  failed,
  onRetry,
}) => {
  const t = COPY[language === 'ar' ? 'ar' : 'en'];
  const reached = PHASE_ORDER.indexOf(phase);

  return (
    <div
      className={`loading-screen${visible ? '' : ' is-hidden'}`}
      // `inert` while hidden: during the fade the overlay still paints, and without this
      // its retry button would remain focusable on top of a live, usable interface.
      inert={!visible}
      data-bedo-loading={visible ? 'active' : 'done'}
      data-bedo-loading-phase={phase}
    >
      <div className="loading-card">
        {/*
          `alt` is the brand name and nothing else: the div this replaced read as "BEDO"
          to a screen reader, and the accessible output is unchanged. Nothing else on the
          card names the brand, so this is not a duplicate announcement. The intrinsic
          dimensions are declared so the card's height is reserved before the PNG loads.
        */}
        <img
          className="loading-mark"
          src="/bedo-logo-dark.png"
          alt="BEDO"
          width={447}
          height={447}
          decoding="async"
        />
        <div className="loading-rule" />
        <div className="loading-code">{t.code}</div>
        <h1 className="loading-title">{t.title}</h1>

        {failed ? (
          <>
            {/* `alert`, not `status`: a failed start needs to interrupt. */}
            <p className="loading-message" role="alert">
              {t.failed}
            </p>
            <button className="btn-secondary loading-retry" onClick={onRetry}>
              {t.retry}
            </button>
          </>
        ) : (
          <>
            {/*
              Only the phase label sits in the live region, and it changes twice for the
              whole startup — not per frame.
            */}
            <p className="loading-message" role="status">
              {t.phases[phase]}
            </p>
            {/*
              Segmented, not a percentage.

              Each segment is one real milestone, so a filled segment means that milestone
              actually happened and a full bar means the reveal condition is satisfied. The
              earlier build showed drei's item count, which sat at 89% for 22 s while the
              11.9 MB apparatus downloaded as a single item — a number that looked precise
              and was not. Segments claim only what can be observed.
            */}
            <div
              className="loading-bar"
              role="progressbar"
              aria-label={t.phases[phase]}
              aria-valuemin={0}
              aria-valuemax={PHASE_ORDER.length - 1}
              aria-valuenow={reached}
              aria-valuetext={t.phases[phase]}
            >
              {PHASE_ORDER.slice(0, -1).map((p, i) => (
                <div key={p} className={`loading-seg${i < reached ? ' is-done' : ''}`}>
                  {i === reached && <span className="loading-seg-active" />}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
