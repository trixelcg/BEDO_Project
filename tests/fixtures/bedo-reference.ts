/**
 * Values from BEDO's own reference material — the authority this implementation is
 * pinned to (BEDO-002 §2).
 *
 * Provenance of every number in this file:
 *
 *  - `REFERENCE_ROWS`      `Jet force_Mathematical model.xlsx`, transcribed cell-by-cell
 *                          in `docs/13 §1.1-1.2` and `docs/22 §4.1`.
 *  - `REFERENCE_FORCES_N`  the same spreadsheet's `Fth` column at n = 0.4, one row per
 *                          deflector (`docs/13 §1.4`).
 *  - `F_OBSERVED_FLAT_N`   the spreadsheet's `Fo` column at n = 0.4 (`docs/13 §1.5`).
 *  - `MOMENTUM_FACTORS`    the three force laws printed on storyboard sl. 7-8, also
 *                          reproduced as ratios in `docs/13 §1.4`.
 *  - `SECOND_READING_*`    the shipped reference simulator's recorded row, quoted in
 *                          `src/lib/physics.ts:32-40`.
 *
 * The spreadsheet itself is not in the repository (it is BEDO's document, and
 * `docs/reference/` holds only what is redistributable), so the transcription in
 * `docs/13` is the checked-in source. Nothing here is derived from the implementation:
 * every value is read from BEDO material, which is what makes the physics specs a
 * genuine check rather than a snapshot of whatever the code happens to do.
 */

/** One row of BEDO's flow/velocity table at Q_total = 120 L/min. */
export interface ReferenceRow {
  /** Valve opening n. */
  n: number;
  /** Q (L/min). */
  q: number;
  /** Nozzle exit velocity v0 (m/s). */
  v0: number;
  /** Impact velocity v (m/s) at the deflector face. */
  v: number;
}

export const REFERENCE_Q_TOTAL = 120;

export const REFERENCE_ROWS: ReferenceRow[] = [
  { n: 0.0, q: 0, v0: 0, v: 0 },
  { n: 0.2, q: 6.9537984, v0: 1.4763903, v: 1.2218954 },
  { n: 0.4, q: 15.7144704, v0: 3.3364056, v: 3.2318574 },
  { n: 0.6, q: 43.4568384, v0: 9.226505, v: 9.1892162 },
  { n: 0.8, q: 84.7129344, v0: 17.985761, v: 17.966661 },
  { n: 1.0, q: 111.372, v0: 23.64586, v: 23.631335 },
];

/** BEDO's `Fth` column at n = 0.4, keyed by deflector angle (N). */
export const REFERENCE_FORCES_N: Record<number, number> = {
  30: 0.204989947,
  45: 0.409979894,
  60: 0.614969842,
  90: 0.819924835,
  120: 1.229939683,
  135: 1.399611694,
  180: 1.639849671,
};

/** BEDO's `Fo` column, flat deflector, n = 0.4 (N) — computed from v0, not v. */
export const F_OBSERVED_FLAT_N = 0.87383078;

/** The momentum factor each force law yields, per deflector angle. */
export const MOMENTUM_FACTORS: Record<number, number> = {
  30: 0.25,
  45: 0.5,
  60: 0.75,
  90: 1.0,
  120: 1.5,
  135: 1.707,
  180: 2.0,
};

/**
 * The reference simulator's second recorded reading. Its v is 5.679 because the
 * simulator squares the *displayed* (2 dp) v0 of 5.74; carrying full precision through
 * gives 5.6774, which is what this implementation computes. Both are asserted, each
 * against the chain it belongs to.
 */
export const SECOND_READING_VALVE_N = 0.5;
export const SECOND_READING_Q_L_MIN = 27.024;
export const SECOND_READING_V0_DISPLAYED = 5.74;
export const SECOND_READING_V_FROM_DISPLAYED_V0 = 5.679;
