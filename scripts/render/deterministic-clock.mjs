/**
 * A virtual clock that makes the renderer reproducible.
 *
 * ## Why this exists
 *
 * Comparing two builds by screenshot only works if a screenshot is a function of the build
 * and nothing else. It was not. The scene animates continuously — the jet ripple advances on
 * a shader time uniform, the morph cache plays a startup, the tank level integrates, the
 * camera eases — so every capture landed at whatever animation phase real time happened to
 * produce. Two captures of the *same* build differed; that made any before/after difference
 * unattributable.
 *
 * ## How it works
 *
 * `performance.now` is replaced before any application code runs, so every consumer sees the
 * same virtual time: `THREE.Clock` reads it, and so does anything else that asks the clock
 * what time it is. It is pinned at zero while the page loads, which keeps asset-fetch
 * duration — the least reproducible thing in the run — out of the animation state entirely.
 *
 * From there the harness advances it in exact frame steps. Each step bumps virtual time by
 * one frame and lets one real animation frame render, so after N steps every time-driven
 * system in the scene is at exactly N/60 seconds, on every machine and every run. Deltas stay
 * physically sane — nothing sees a three-second jump it was never written to survive.
 *
 * `requestAnimationFrame` callbacks are handed virtual time too, so a consumer that trusts the
 * timestamp argument rather than the clock cannot reintroduce wall-clock drift.
 */

/** Frame step, in milliseconds. 60 Hz — the rate the animation code is written against. */
export const STEP_MS = 1000 / 60;

/**
 * Installed with `page.addInitScript`, so it is in place before the bundle evaluates.
 *
 * Serialised to the browser as source, so it must not close over anything.
 */
export function installDeterministicClock() {
  const STEP = 1000 / 60;
  let virtual = 0;

  const rafReal = window.requestAnimationFrame.bind(window);

  performance.now = () => virtual;
  window.requestAnimationFrame = (cb) => rafReal(() => cb(virtual));

  /** Advance exactly `frames` rendered frames, one frame step of virtual time each. */
  window.__advanceFrames = (frames) =>
    new Promise((resolve) => {
      let done = 0;
      const tick = () => {
        if (done >= frames) {
          resolve(virtual);
          return;
        }
        done++;
        virtual += STEP;
        rafReal(tick);
      };
      rafReal(tick);
    });

  window.__virtualNow = () => virtual;
}
