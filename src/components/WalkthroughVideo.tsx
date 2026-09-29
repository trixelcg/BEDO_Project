import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The experiment walkthrough video (QA F13 — the player trapped the learner).
 *
 * What was wrong: the modal was a plain child of `.ui-container`, which is
 * `pointer-events: none` and hands pointer input back only to children marked
 * `interactive`. The modal was not marked. Its Close button and the video's own controls
 * therefore never received a click; the clicks fell through to the 3D canvas underneath,
 * where they could operate the apparatus behind the video. Nothing listened for Escape, so
 * the only way out was a reload, which lost the experiment. Separately, the production
 * server answered every request with the whole file and no `Accept-Ranges`, so even a
 * reachable timeline could not seek (`server.ts`).
 *
 * A second cause showed once clicks reached it: `.ui-container` is its own stacking context
 * (z-index 10), so the modal's z-index 1000 only counted inside it, and the docked Data
 * Monitor — a sibling above that context (z-index 100) — was painted over the player's
 * right-hand side, Close button included.
 *
 * This surface:
 *   - is portalled to <body>, above every panel, and `interactive`; it covers the scene,
 *     so nothing reaches the canvas or the monitor while it is up;
 *   - closes on the Close button and on Escape, always — the video's state (loading,
 *     errored, playing) never gates leaving;
 *   - has its own Play/Pause, ±10 s and timeline, driven from the media element's events
 *     rather than from assumptions, so they stay right after any seek;
 *   - keeps keyboard focus inside itself and hands it back to whatever opened it.
 *
 * It holds no simulator state and dispatches nothing. The simulator stays mounted
 * underneath; closing unmounts only this, so the rig is exactly as it was left.
 */

import {
  ARROW_SECONDS,
  SKIP_SECONDS,
  WALKTHROUGH_VIDEO_SRC,
  clampTime,
  formatTime,
} from '../lib/videoPlayback';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const WalkthroughVideo: React.FC<{
  isArabic: boolean;
  onClose: () => void;
  src?: string;
}> = ({ isArabic, onClose, src = WALKTHROUGH_VIDEO_SRC }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [waiting, setWaiting] = useState(false);

  // The latest onClose, so the key handler below never closes over a stale one.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    // Stop the sound first; unmounting would stop it too, but not before the next frame.
    videoRef.current?.pause();
    onCloseRef.current();
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || failed) return;
    if (v.paused || v.ended) {
      // `play()` rejects when a pause or a new load interrupts it, or when autoplay is
      // refused. None of those should throw into React; the events keep the button honest.
      void v.play()?.catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }, [failed]);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const next = clampTime(t, v.duration);
    v.currentTime = next;
    // Show the new position at once; `timeupdate` confirms it once the seek lands.
    setTime(next);
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (v) seekTo(v.currentTime + delta);
    },
    [seekTo]
  );

  // Focus in on open, back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  // Keys. Capture phase on window, so this runs before — and stops — the app's own
  // Escape handlers (board view, Data Monitor): one Escape closes the video and only it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const onRange = target instanceof HTMLInputElement && target.type === 'range';
      const onButton = target instanceof HTMLButtonElement;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key === 'Tab') {
        const root: HTMLDivElement | null = dialogRef.current;
        if (!root) return;
        const items: HTMLElement[] = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !root.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !root.contains(active))) {
          event.preventDefault();
          first.focus();
        }
        event.stopImmediatePropagation();
        return;
      }
      // Space / k toggle, unless a button has focus (its own Space press is its click).
      if ((event.key === ' ' || event.key === 'k') && !onButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        togglePlay();
        return;
      }
      // The timeline slider handles its own arrows; elsewhere they skip.
      if (!onRange && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const dir = event.key === 'ArrowRight' ? 1 : -1;
        seekBy((isArabic ? -dir : dir) * ARROW_SECONDS);
        return;
      }
      // Nothing else reaches the simulator's own shortcuts while the video is up.
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, togglePlay, seekBy, isArabic]);

  const fraction = duration > 0 ? time / duration : 0;
  const t = (en: string, ar: string) => (isArabic ? ar : en);

  return createPortal(
    <div
      ref={dialogRef}
      className="monitor-fullscreen interactive walkthrough-video"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bedo-video-title"
      dir={isArabic ? 'rtl' : 'ltr'}
      data-bedo-video
      style={{ background: 'rgba(20, 21, 23, 0.98)', padding: 24 }}
    >
      <div className="monitor-header" style={{ marginBottom: 16, paddingBottom: 16 }}>
        <div className="monitor-title-group">
          <h1 id="bedo-video-title">{t('Experiment Walkthrough Video', 'فيديو توضيحي للتجربة')}</h1>
        </div>
        <button ref={closeRef} className="btn-secondary" onClick={close} data-bedo-video-close>
          {t('Close', 'إغلاق')}
        </button>
      </div>

      <div className="walkthrough-stage">
        <video
          ref={videoRef}
          src={src}
          autoPlay
          playsInline
          preload="auto"
          muted={muted}
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onSeeked={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onError={() => {
            setFailed(true);
            setPlaying(false);
          }}
        />
        {failed && (
          <div className="walkthrough-message" role="alert">
            {t(
              'The video could not be loaded. Close returns you to the simulator.',
              'تعذّر تحميل الفيديو. زر الإغلاق يعيدك إلى المحاكي.'
            )}
          </div>
        )}
        {!failed && waiting && (
          <div className="walkthrough-message" aria-live="polite">
            {t('Loading…', 'جارٍ التحميل…')}
          </div>
        )}
      </div>

      {/* The controls always read left-to-right: a timeline runs with the video's time. */}
      <div className="walkthrough-controls" dir="ltr">
        <button
          className="btn-secondary"
          onClick={() => seekBy(-SKIP_SECONDS)}
          disabled={failed}
          aria-label={t(`Back ${SKIP_SECONDS} seconds`, `رجوع ${SKIP_SECONDS} ثوانٍ`)}
        >
          −{SKIP_SECONDS}s
        </button>
        <button
          className="btn-primary walkthrough-play"
          onClick={togglePlay}
          disabled={failed}
          aria-label={playing ? t('Pause', 'إيقاف مؤقت') : t('Play', 'تشغيل')}
          data-bedo-video-play
        >
          {playing ? t('Pause', 'إيقاف مؤقت') : t('Play', 'تشغيل')}
        </button>
        <button
          className="btn-secondary"
          onClick={() => seekBy(SKIP_SECONDS)}
          disabled={failed}
          aria-label={t(`Forward ${SKIP_SECONDS} seconds`, `تقديم ${SKIP_SECONDS} ثوانٍ`)}
        >
          +{SKIP_SECONDS}s
        </button>
        <input
          type="range"
          className="walkthrough-timeline"
          min={0}
          max={duration > 0 ? duration : 0}
          step={0.1}
          value={Math.min(time, duration > 0 ? duration : 0)}
          disabled={failed || !(duration > 0)}
          onChange={(e) => seekTo(Number(e.currentTarget.value))}
          aria-label={t('Video position', 'موضع الفيديو')}
          aria-valuetext={`${formatTime(time)} / ${formatTime(duration)}`}
          style={{ ['--fill' as string]: `${fraction * 100}%` }}
          data-bedo-video-timeline
        />
        <span className="walkthrough-time" aria-hidden="true">
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <button
          className="btn-secondary"
          onClick={() => setMuted((m) => !m)}
          aria-pressed={muted}
          aria-label={muted ? t('Unmute', 'تشغيل الصوت') : t('Mute', 'كتم الصوت')}
        >
          {muted ? t('Unmute', 'تشغيل الصوت') : t('Mute', 'كتم الصوت')}
        </button>
      </div>
    </div>,
    document.body
  );
};
