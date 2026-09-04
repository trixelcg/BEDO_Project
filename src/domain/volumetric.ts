/**
 * The volumetric measuring tank — the second way to know the flow.
 *
 * ## What it is for
 *
 * The bench carries a graduated tank with a dump valve. Shut the valve, time how long the
 * level takes to rise through a known volume, and `Q = ΔV / Δt` gives the flow without
 * reading the flowmeter at all. Comparing the two is the point: it is the check that makes
 * the flowmeter's figure a measurement rather than an assertion.
 *
 * That is what the *Open volumetric valve* control was for. It toggled a boolean nothing
 * read, so pressing it changed the label and nothing else — the dead button in the brief's
 * §1.5. The valve now empties the tank and re-arms a measurement, and closing it starts one.
 *
 * ## What is measured and what is chosen
 *
 * The arithmetic is exact and has no free parameters: volume accumulates at the flow the
 * domain already computes, and `ΔV / Δt` is a definition.
 *
 * `CAPACITY_L` is **not** a verified BEDO constant — no source in the repository gives the
 * bench's tank a volume. 7 litres is the low-range measuring tank of the Armfield F1-10 the
 * apparatus is modelled on, and it is the value that makes the exercise work at the two
 * flows the procedure records at: a full fill takes 27 s at 15.7 L/min and 16 s at
 * 27.0 L/min, which is long enough to time by hand and short enough to sit through. If BEDO
 * documents a capacity, it replaces this and this paragraph should say so.
 *
 * Pure functions over a value. No timers, no React, no scene: the caller owns the clock,
 * which is what lets the whole exercise be tested without rendering anything.
 */

/** Full scale of the graduated tank, in litres. A presentation choice — see above. */
export const CAPACITY_L = 7;

/**
 * A measurement is only meaningful once enough has collected to time.
 *
 * Below this the elapsed time is dominated by when the student happened to press the
 * button, and `ΔV / Δt` swings wildly — at 0.2 s a tenth of a second of reaction time is a
 * 50 % error. The panel shows the figures throughout and marks them unsettled until here.
 */
export const SETTLING_VOLUME_L = 0.5;

/** A timed collection in the measuring tank. */
export interface VolumetricMeasurement {
  /** Is the dump valve shut, with the tank collecting? */
  readonly isCollecting: boolean;
  /** Seconds since collection started. */
  readonly elapsedS: number;
  /** Litres collected, 0..CAPACITY_L. */
  readonly volumeL: number;
  /** True once the tank has filled to the top graduation and can hold no more. */
  readonly isFull: boolean;
}

/** An empty tank with the dump valve open. */
export const emptyMeasurement = (): VolumetricMeasurement => ({
  isCollecting: false,
  elapsedS: 0,
  volumeL: 0,
  isFull: false,
});

/** Shut the dump valve: a fresh measurement starts from zero. */
export const startCollecting = (): VolumetricMeasurement => ({
  isCollecting: true,
  elapsedS: 0,
  volumeL: 0,
  isFull: false,
});

/** Open the dump valve: the tank empties and the clock stops. */
export const dump = (): VolumetricMeasurement => emptyMeasurement();

/**
 * Advance a collection by `deltaS` seconds at the flow the rig is delivering.
 *
 * The clock stops when the tank fills, because a measurement that kept timing past the top
 * graduation would report a flow that fell as the seconds ran on. Returns the same object
 * when nothing can change, so a caller can skip work on identity.
 */
export function advance(
  measurement: VolumetricMeasurement,
  flowLMin: number,
  deltaS: number
): VolumetricMeasurement {
  if (!measurement.isCollecting || measurement.isFull) return measurement;
  if (!(deltaS > 0)) return measurement;

  const volumeL = Math.min(CAPACITY_L, measurement.volumeL + (Math.max(0, flowLMin) * deltaS) / 60);
  return {
    isCollecting: true,
    elapsedS: measurement.elapsedS + deltaS,
    volumeL,
    isFull: volumeL >= CAPACITY_L,
  };
}

/**
 * `Q = ΔV / Δt`, in L/min — the whole point of the exercise.
 *
 * Zero before any time has passed, rather than infinite: a tank that has been collecting
 * for no time has not measured a flow, and dividing by zero would put an Infinity on screen.
 */
export const measuredFlowLMin = (measurement: VolumetricMeasurement): number =>
  measurement.elapsedS > 0 ? (measurement.volumeL / measurement.elapsedS) * 60 : 0;

/** Whether the measurement has run long enough to be worth reading. */
export const isSettled = (measurement: VolumetricMeasurement): boolean =>
  measurement.volumeL >= SETTLING_VOLUME_L;

/**
 * How far the volumetric measurement is from the flowmeter, as a signed percentage.
 *
 * Positive means the timed fill reports more than the meter. Zero when there is nothing to
 * compare against.
 */
export const flowErrorPercent = (measuredLMin: number, referenceLMin: number): number =>
  referenceLMin > 0 ? ((measuredLMin - referenceLMin) / referenceLMin) * 100 : 0;

/** Where the water sits in the graduated window, 0 at the bottom mark and 1 at the top. */
export const gaugeFraction = (measurement: VolumetricMeasurement): number =>
  Math.max(0, Math.min(1, measurement.volumeL / CAPACITY_L));

/** Seconds to fill the tank at a given flow, or Infinity when nothing is arriving. */
export const secondsToFill = (flowLMin: number): number =>
  flowLMin > 0 ? (CAPACITY_L / flowLMin) * 60 : Number.POSITIVE_INFINITY;
