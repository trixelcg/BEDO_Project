import { describe, expect, it } from 'vitest';
import { buildReportHtml, errorPercent, reportFilename, type ReportInput } from '../../src/lib/report';
import { buildForceChart, pathThrough, CURVE_SAMPLES } from '../../src/lib/forceChart';
import {
  FIRST_READING_VALVE,
  SECOND_READING_VALVE,
  computeRow,
} from '../../src/domain/physics';
import { getExperiment } from '../../src/domain/experiments';
import { getDeflector } from '../../src/domain/apparatus';

/**
 * The generated report (brief §6) and the chart it shares with the monitor (§5).
 *
 * The document is HTML rather than a PDF blob — see `src/lib/report.ts` for why — which
 * has the useful side effect that its contents can be asserted on directly rather than
 * through a binary parser.
 */

const rows = [
  computeRow(0, FIRST_READING_VALVE, 90, [50, 20, 10]),
  computeRow(1, SECOND_READING_VALVE, 90, [50, 20, 10, 100, 50, 20, 10]),
];

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  experiment: getExperiment('flat'),
  deflectorName: 'Flat surface (90°)',
  deflectorId: 90,
  momentumFactor: getDeflector(90).momentumFactor,
  rows,
  pumpFlowLMin: 40,
  quizAnswers: {},
  generatedAt: new Date('2026-09-04T10:00:00Z'),
  ...over,
});

describe('the chart both surfaces draw', () => {
  const chart = buildForceChart({ rows, deflectorId: 90, pumpFlowLMin: 40 });

  it('samples the theoretical curve rather than joining the readings', () => {
    // A polyline through two recorded points is a chord, not a curve — and before the
    // first reading there would be nothing on the chart at all, which is the state the
    // monitor opens in.
    expect(chart.curve).toHaveLength(CURVE_SAMPLES + 1);
    expect(pathThrough(chart.curve).startsWith('M ')).toBe(true);
  });

  it('draws the curve even with no readings at all', () => {
    const empty = buildForceChart({ rows: [], deflectorId: 90, pumpFlowLMin: 40 });
    expect(empty.curve).toHaveLength(CURVE_SAMPLES + 1);
    expect(empty.measured).toHaveLength(0);
    expect(pathThrough(empty.measured)).toBe('');
  });

  it('scales the axes so every recorded reading falls inside the plot', () => {
    const { box } = chart;
    for (const p of [...chart.measured, ...chart.theoretical, ...chart.curve]) {
      expect(p.x).toBeGreaterThanOrEqual(box.paddingX - 1e-6);
      expect(p.x).toBeLessThanOrEqual(box.paddingX + box.width + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(box.paddingY - 1e-6);
      expect(p.y).toBeLessThanOrEqual(box.paddingY + box.height + 1e-6);
    }
  });

  it('puts a larger force higher up the plot', () => {
    // y grows downward in SVG, so the check is worth stating rather than assuming.
    expect(chart.measured[1].y).toBeLessThan(chart.measured[0].y);
    expect(chart.measured[1].x).toBeGreaterThan(chart.measured[0].x);
  });

  it('follows the deflector: a stronger one lifts the whole curve', () => {
    const hemisphere = buildForceChart({ rows: [], deflectorId: 180, pumpFlowLMin: 40 });
    expect(hemisphere.maxForceN).toBeGreaterThan(chart.maxForceN);
  });
});

describe('the error column', () => {
  it('is signed, and relative to the theoretical force', () => {
    // 80 g against 83.58 g of theory: light by 4.28 %.
    expect(errorPercent(rows[0])).toBeCloseTo(-4.28, 1);
    // 260 g against 257.93 g: heavy by 0.80 %.
    expect(errorPercent(rows[1])).toBeCloseTo(0.8, 1);
  });

  it('is zero rather than infinite when there is no theoretical force', () => {
    expect(errorPercent(computeRow(0, 0, 90, []))).toBe(0);
  });
});

describe('the generated report', () => {
  const html = buildReportHtml(input());

  it('is one self-contained document, with no external references', () => {
    // It has to keep working saved to disk and opened a year later.
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<img[^>]+src=/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });

  it('carries both languages, each on its own printed page', () => {
    expect(html).toContain('dir="ltr" lang="en"');
    expect(html).toContain('dir="rtl" lang="ar"');
    expect(html).toContain('.page + .page { break-before: page; }');
    expect(html).toContain('Experiment report');
    expect(html).toContain('تقرير التجربة');
  });

  it('names the run: the experiment, the deflector and the date', () => {
    expect(html).toContain('Exp. 1 — Flat surface deflector');
    expect(html).toContain('Flat surface (90°)');
    expect(html).toContain('2026-09-04');
  });

  it('renders θ correctly, in both halves', () => {
    // §4.8/§6: the printed worksheets show it as `ɵ`. This is the actual glyph, and the
    // document declares UTF-8 so it cannot be re-encoded on the way to a printer.
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).not.toContain('ɵ');
    expect(html).toContain('90°');
  });

  it('prints the theory the build actually used, with its own constants', () => {
    expect(html).toContain('k = 1.000');
    expect(html).toContain('ρ · A · V_impact²'); // the shipped legacyAV2 model
    expect(html).toContain('7.850e-5 m²');
    expect(html).toContain('s = 0.035 m');
    expect(html).toContain('g = 9.81 m/s²');
  });

  it('prints every recorded reading, with its error', () => {
    expect(html).toContain('15.714');
    expect(html).toContain('27.024');
    expect(html).toContain('0.8199');
    expect(html).toContain('2.5303');
    expect(html).toContain('−4.28');
    expect(html).toContain('+0.80');
  });

  it('says so plainly when nothing was recorded', () => {
    const empty = buildReportHtml(input({ rows: [] }));
    expect(empty).toContain('No readings were recorded in this session.');
    expect(empty).toContain('لم تُسجَّل أي قراءات في هذه الجلسة.');
    // The chart is still drawn — the theory does not depend on the student.
    expect(empty).toContain('<svg');
  });

  it('embeds the chart as vector, not as a picture of one', () => {
    expect(html).toContain('<svg');
    expect(html).toContain('class="th"');
    expect(html).toContain('class="ac"');
    expect(html).not.toContain('data:image');
  });

  it('reports the assessment as a score, with what was answered', () => {
    const marked = buildReportHtml(
      input({ quizAnswers: { 0: 2, 1: 1, 2: 0, 3: 3, 4: 0 } })
    );
    // Four of the five right: question 3's answer is 1, and 3 was given.
    expect(marked).toContain('4 / 5');
    expect(marked).toContain('answered 5');
    expect(marked).toContain('class="wrong"');
    expect(marked).toContain('class="right"');
  });

  it('marks unanswered questions as unanswered rather than wrong', () => {
    expect(html).toContain('class="skipped"');
    expect(html).toContain('0 / 5');
    expect(html).toContain('not answered');
    expect(html).toContain('لم يُجب');
  });

  it('escapes the text it is given', () => {
    const nasty = buildReportHtml(input({ deflectorName: '<script>alert(1)</script>' }));
    expect(nasty).not.toContain('<script>alert(1)</script>');
    expect(nasty).toContain('&lt;script&gt;');
  });

  it('names the file for the experiment and the day', () => {
    expect(reportFilename(input())).toBe('jet-forces-flat-2026-09-04.html');
  });

  it('is deterministic for a given session', () => {
    expect(buildReportHtml(input())).toBe(buildReportHtml(input()));
  });
});
