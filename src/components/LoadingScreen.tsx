import React from 'react';
import type { Language } from '../types';

interface LoadingScreenProps {
  /** False once the experience is ready. The overlay fades, then stops rendering. */
  visible: boolean;
  language: Language;
  /** A genuine asset failure reported by three's loading manager. */
  failed: boolean;
  onRetry: () => void;
}

const COPY = {
  en: {
    title: 'Measurement of Jet Forces',
    code: 'VL-FM009',
    loading: 'Preparing the experiment…',
    failed: 'Unable to load the experiment.',
    retry: 'Retry',
  },
  ar: {
    title: 'قياس قوة نفث الماء',
    code: 'VL-FM009',
    loading: 'جارٍ تجهيز التجربة…',
    failed: 'تعذر تحميل التجربة.',
    retry: 'إعادة المحاولة',
  },
} as const;

/**
 * The screen shown until the experience is genuinely usable.
 *
 * It is driven by the `scene` readiness milestone, not by React having mounted: the
 * apparatus and the eight water plumes are ~14 MB of GLB, and until they are in the scene
 * graph the canvas shows an orange wireframe placeholder. That is the unfinished state
 * this covers.
 *
 * Direction is inherited from `<html dir>` rather than re-implemented here, so the layout
 * mirrors in Arabic for the same reason the rest of the interface does.
 */
export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  visible,
  language,
  failed,
  onRetry,
}) => {
  const t = COPY[language === 'ar' ? 'ar' : 'en'];

  return (
    <div
      className={`loading-screen${visible ? '' : ' is-hidden'}`}
      // `inert` while hidden: during the fade the overlay still paints, and without this
      // its retry button would remain focusable on top of a live, usable interface.
      inert={!visible}
      data-bedo-loading={visible ? 'active' : 'done'}
    >
      <div className="loading-card">
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
              Only the message sits in the live region. The percentage changes many times
              a second, and putting it here would make a screen reader announce the whole
              status on every tick.
            */}
            <p className="loading-message" role="status">
              {t.loading}
            </p>
            {/*
              Indeterminate, deliberately, and no percentage.

              three's loading manager counts ITEMS, not bytes. Measured on a throttled cold
              load, the item count reached 89% in 8.7 s and then sat there for 22.5 s while
              the 11.9 MB apparatus GLB — by far the majority of the wait — downloaded as a
              single item, before jumping to 100%. That number is real but it does not
              describe the remaining work, and a bar parked at 89% for twenty seconds is
              worse than no bar. A byte-accurate figure would mean owning the loaders, which
              is out of scope here. So: no value is claimed, and none is invented.
            */}
            <div className="loading-bar" role="progressbar" aria-label={t.loading}>
              <div className="loading-bar-fill is-indeterminate" />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
