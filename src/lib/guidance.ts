/**
 * How the interface points at the thing the student should touch next.
 *
 * ## Why the arrow is off
 *
 * A floating yellow arrow above the part is a label for a part, drawn in the air beside it.
 * It has to be positioned by hand for every anchor — `ANCHOR_VIEW` carries an
 * `arrowOffset` for the two under-bench valves precisely because the default put the arrow
 * inside the cabinet — and it still occludes whatever is behind it.
 *
 * The scene already has a better mechanism and has had one all along: `setGlow` swaps in a
 * per-object material clone and pulses its emissive, so the part the step is asking for
 * lights up *as itself*. Nothing is drawn in front of anything, nothing needs an offset,
 * and it works on a valve lever the size of a thumbnail.
 *
 * So the arrow is behind a flag and the flag is off. It is kept rather than deleted because
 * it is the fallback if the glow ever proves too subtle on a projector — one constant, and
 * no code to write back.
 *
 * The brief asks for `@react-three/postprocessing`'s `Outline` instead. That is a second
 * render pass and about 40 KB of dependency for an effect the emissive pulse already
 * achieves against a dark scene, and the brief itself offers the pulse as the alternative.
 */
export const GUIDE_ARROW_ENABLED = false;

/**
 * How long a hint stays lit, in seconds.
 *
 * Long enough to look up from the panel and find the part; short enough that it is not
 * simply a brighter permanent state, which would make the ordinary guided pulse mean
 * nothing.
 */
export const HINT_SECONDS = 3;

/**
 * How long the student may do nothing before the interface offers a hint, in seconds.
 *
 * Twenty, as the brief asks. Measured from the last interaction of any kind, not from the
 * step starting: a learner reading the instruction has not stalled, and a learner who
 * turned the valve nineteen seconds ago is still working.
 */
export const IDLE_HINT_SECONDS = 20;

/** Emissive intensity of the ordinary guided pulse, and of a hint. */
export const PULSE_BASE = 0.26;
export const PULSE_SWING = 0.12;
export const HINT_BASE = 0.85;
export const HINT_SWING = 0.45;
