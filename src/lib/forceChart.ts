/**
 * The force-against-flow plot, as geometry.
 *
 * ## Why this is not in the component
 *
 * The same chart has to be drawn twice: once in the software monitor and once inside the
 * generated report, which is a standalone HTML document with no React in it. Two drawings
 * of the same data that are separately maintained are two drawings that will eventually
 * disagree about something — the axis scale, which rows are plotted, whether the curve is
 * sampled or joined up — and the disagreement will be in the artefact the student hands in.
 *
 * So the geometry is computed here, in chart coordinates, and both renderers place marks at
 * the points it returns.
 *
 * ## What is plotted
 *
 * The theoretical curve is **sampled**, not joined between readings: `F_th(Q)` is a known
 * function of the valve opening, and a polyline through two recorded points is a chord, not
 * a curve. Before the first reading it is the only thing on the chart, which is the state
 * the monitor opens in and used to render as an empty box with a legend under it.
 */

import { jetState } from '../domain/physics';
import type { RecordRow } from '../domain/physics';

/** How many samples the theoretical curve is drawn from. The brief asks for 40. */
export const CURVE_SAMPLES = 40;

export interface ChartBox {
  /** Distance from the left edge of the viewBox to the y axis. */
  readonly paddingX: number;
  /** Distance from the top edge of the viewBox to the top of the plot. */
  readonly paddingY: number;
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_BOX: ChartBox = { paddingX: 40, paddingY: 30, width: 340, height: 190 };

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

export interface ForceChart {
  /** Axis maxima, in data units. */
  readonly maxFlowLMin: number;
  readonly maxForceN: number;
  /** `F_th(Q)` across the valve's whole range, in chart coordinates. */
  readonly curve: readonly ChartPoint[];
  /** One marker per recorded reading, at its theoretical force. */
  readonly theoretical: readonly ChartPoint[];
  /** One marker per recorded reading, at the force the student measured. */
  readonly measured: readonly ChartPoint[];
  /** Grid ratios, and the value each one stands for on each axis. */
  readonly ticks: readonly { readonly ratio: number; readonly flow: number; readonly force: number }[];
  readonly box: ChartBox;
}

/** Rounds an axis maximum up to something a person would choose. */
const niceCeil = (value: number): number => {
  const step = 10 ** Math.floor(Math.log10(Math.max(value, 1e-6)));
  return Math.ceil(value / step) * step;
};

export interface ForceChartInput {
  readonly rows: readonly RecordRow[];
  readonly deflectorId: number;
  readonly pumpFlowLMin: number;
  readonly box?: ChartBox;
}

export function buildForceChart({
  rows,
  deflectorId,
  pumpFlowLMin,
  box = DEFAULT_BOX,
}: ForceChartInput): ForceChart {
  const samples = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => {
    const jet = jetState(i / CURVE_SAMPLES, deflectorId, pumpFlowLMin);
    return { flowRateLMin: jet.flowRateLMin, forceN: jet.theoreticalForceN };
  });

  // Scaled to the data rather than pinned, which used to clip every reading. The curve
  // spans the whole valve, so it sets the axes and the readings always fall inside them.
  const maxFlowLMin = niceCeil(Math.max(10, ...samples.map((s) => s.flowRateLMin)) * 1.05);
  const maxForceN = niceCeil(
    Math.max(
      0.5,
      ...samples.map((s) => s.forceN),
      ...rows.map((r) => Math.max(r.theoreticalForceN, r.measuredForceN))
    ) * 1.1
  );

  const at = (flow: number, force: number): ChartPoint => ({
    x: box.paddingX + (flow / maxFlowLMin) * box.width,
    y: box.paddingY + box.height - (force / maxForceN) * box.height,
  });

  return {
    maxFlowLMin,
    maxForceN,
    box,
    curve: samples.map((s) => at(s.flowRateLMin, s.forceN)),
    theoretical: rows.map((r) => at(r.flowRateLMin, r.theoreticalForceN)),
    measured: rows.map((r) => at(r.flowRateLMin, r.measuredForceN)),
    ticks: [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      ratio,
      flow: ratio * maxFlowLMin,
      force: (1 - ratio) * maxForceN,
    })),
  };
}

/** An SVG path through a run of points. Empty for an empty run, which draws nothing. */
export const pathThrough = (points: readonly ChartPoint[]): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
