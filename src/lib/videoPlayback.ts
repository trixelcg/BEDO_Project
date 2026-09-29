/**
 * The walkthrough player's pure parts (F13): what it plays, how far it skips, and how it
 * clamps and prints a time. Kept apart from the component so they can be tested without
 * a DOM.
 */

export const WALKTHROUGH_VIDEO_SRC = '/Bedo_Mesu_J.mp4';

/** How far the skip buttons and the arrow keys move the playhead, in seconds. */
export const SKIP_SECONDS = 10;
export const ARROW_SECONDS = 5;

/**
 * A seek target inside the video. Before metadata arrives the duration is NaN, and the
 * only valid position is the start.
 */
export const clampTime = (t: number, duration: number): number =>
  Math.min(
    Math.max(0, Number.isFinite(t) ? t : 0),
    Number.isFinite(duration) && duration > 0 ? duration : 0
  );

/** m:ss, whole seconds, never negative. */
export const formatTime = (seconds: number): string => {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
