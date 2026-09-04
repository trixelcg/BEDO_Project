/**
 * The student's report, generated from what they actually did.
 *
 * ## What it replaces
 *
 * `public/answer-sheets/*.pdf` are four blank worksheets copied from BEDO's Phase 2
 * delivery. They are the same four documents whatever the learner did, they carry the
 * theory as it was printed in 2022, and the student is expected to write their own figures
 * onto them by hand. What the closing step actually wants to hand over is *this run*: the
 * readings taken, the chart they make, the error against theory, and the assessment score.
 *
 * ## Why the browser renders it, and not a PDF library
 *
 * The brief suggests `@react-pdf/renderer` or `jspdf`. Both were rejected, for one reason
 * that is about weight and one that is about correctness:
 *
 *   - **Arabic.** This report is bilingual and the Arabic half is not decoration. jsPDF has
 *     no bidirectional text support and no Arabic shaping: to get readable output you embed
 *     a font, reverse the strings yourself and join the letter forms by hand, and the
 *     result still breaks wherever a number is embedded in a sentence. `@react-pdf`'s
 *     layout engine has the same gap. The browser already has a text engine that does all
 *     of this correctly, and it is the one rendering the app's own Arabic.
 *   - **Weight.** Either library is several hundred kilobytes, for a document a learner
 *     generates once at the end of a session.
 *
 * So the report is a self-contained HTML document with print styling, opened in a tab. The
 * browser's own print dialog turns it into a PDF, with selectable text, correct Arabic
 * shaping and a vector chart. It is also readable, printable and archivable as it stands,
 * which a generated PDF blob is not.
 *
 * ## Self-contained
 *
 * No stylesheet link, no script, no image reference — the chart is inline SVG built from
 * the same `buildForceChart` the monitor draws, so the document keeps working when it is
 * saved to disk and opened a year later.
 */

import type { ExperimentDef } from '../domain/experiments';
import type { RecordRow } from '../domain/physics';
import { GRAVITY_MS2, NOZZLE_AREA_M2, TRAVEL_HEIGHT_M, WATER_DENSITY_KG_M3 } from '../domain/physics';
import { PHYSICS_MODEL } from '../domain/physicsConfig';
import { buildForceChart, pathThrough, type ChartBox } from './forceChart';

export interface ReportInput {
  experiment: ExperimentDef;
  /** The installed deflector, named in the interface language. */
  deflectorName: string;
  deflectorId: number;
  momentumFactor: number;
  rows: readonly RecordRow[];
  pumpFlowLMin: number;
  /** Answers by question index, as the monitor holds them. */
  quizAnswers: Readonly<Record<number, number>>;
  /** When the report was generated. Passed in so the output is testable. */
  generatedAt: Date;
}

/** Escapes text for HTML. Every string below is data, and some of it is Arabic. */
const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const REPORT_BOX: ChartBox = { paddingX: 52, paddingY: 20, width: 420, height: 230 };

/** `(F_ac − F_th) / F_th`, as a percentage. Zero when there is no theoretical force. */
export const errorPercent = (row: RecordRow): number =>
  row.theoreticalForceN > 0
    ? ((row.measuredForceN - row.theoreticalForceN) / row.theoreticalForceN) * 100
    : 0;

const signed = (value: number, digits: number): string =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;

/** The force law, written out with the constants this build actually used. */
const theory = (momentumFactor: number): { en: string; ar: string } =>
  PHYSICS_MODEL === 'momentumFlux'
    ? {
        en: `F_th = k · ρ · Q · V_impact, with k = ${momentumFactor.toFixed(3)}`,
        ar: `F_th = k · ρ · Q · V_impact حيث k = ${momentumFactor.toFixed(3)}`,
      }
    : {
        en: `F_th = k · ρ · A · V_impact², with k = ${momentumFactor.toFixed(3)}`,
        ar: `F_th = k · ρ · A · V_impact² حيث k = ${momentumFactor.toFixed(3)}`,
      };

function chartSvg(input: ReportInput): string {
  const chart = buildForceChart({
    rows: input.rows,
    deflectorId: input.deflectorId,
    pumpFlowLMin: input.pumpFlowLMin,
    box: REPORT_BOX,
  });
  const { paddingX, paddingY, width, height } = chart.box;

  const grid = chart.ticks
    .map(({ ratio, flow, force }) => {
      const y = paddingY + height * ratio;
      const x = paddingX + width * ratio;
      return `
        <line x1="${paddingX}" y1="${y}" x2="${paddingX + width}" y2="${y}" class="grid"/>
        <line x1="${x}" y1="${paddingY}" x2="${x}" y2="${paddingY + height}" class="grid"/>
        <text x="${paddingX - 8}" y="${y + 4}" class="tick" text-anchor="end">${force.toFixed(1)}</text>
        <text x="${x}" y="${paddingY + height + 16}" class="tick" text-anchor="middle">${Math.round(flow)}</text>`;
    })
    .join('');

  const measuredMarks = chart.measured
    .map((p) => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4.5" class="ac"/>`)
    .join('');
  const theoreticalMarks = chart.theoretical
    .map((p) => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" class="th-dot"/>`)
    .join('');

  return `
    <svg viewBox="0 0 ${paddingX + width + 20} ${paddingY + height + 44}" class="chart" role="img"
         aria-label="Force against flow rate">
      ${grid}
      <line x1="${paddingX}" y1="${paddingY}" x2="${paddingX}" y2="${paddingY + height}" class="axis"/>
      <line x1="${paddingX}" y1="${paddingY + height}" x2="${paddingX + width}" y2="${paddingY + height}" class="axis"/>
      <text x="${paddingX + width / 2}" y="${paddingY + height + 36}" class="axis-label" text-anchor="middle">Q (L/min)</text>
      <text x="14" y="${paddingY + height / 2}" class="axis-label" text-anchor="middle"
            transform="rotate(-90 14 ${paddingY + height / 2})">F (N)</text>
      <path d="${pathThrough(chart.curve)}" class="th"/>
      ${chart.measured.length > 1 ? `<path d="${pathThrough(chart.measured)}" class="ac-line"/>` : ''}
      ${theoreticalMarks}
      ${measuredMarks}
    </svg>`;
}

function readingsTable(rows: readonly RecordRow[], isAr: boolean): string {
  if (rows.length === 0) {
    return `<p class="empty">${
      isAr ? 'لم تُسجَّل أي قراءات في هذه الجلسة.' : 'No readings were recorded in this session.'
    }</p>`;
  }
  const head = isAr
    ? ['#', 'Q (L/min)', 'Q (m³/s)', 'V_nozzle', 'V_impact', 'الكتلة (g)', 'F_th (N)', 'F_ac (N)', 'الخطأ %']
    : ['#', 'Q (L/min)', 'Q (m³/s)', 'V_nozzle', 'V_impact', 'Mass (g)', 'F_th (N)', 'F_ac (N)', 'Error %'];

  const body = rows
    .map(
      (row, i) => `<tr>
        <td>${i + 1}</td>
        <td>${row.flowRateLMin.toFixed(3)}</td>
        <td>${row.flowRateM3S.toExponential(3)}</td>
        <td>${row.nozzleVelocityMS.toFixed(3)}</td>
        <td>${row.impactVelocityMS.toFixed(3)}</td>
        <td>${row.loadedMassG}</td>
        <td>${row.theoreticalForceN.toFixed(4)}</td>
        <td>${row.measuredForceN.toFixed(4)}</td>
        <td>${signed(errorPercent(row), 2)}</td>
      </tr>`
    )
    .join('');

  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

function assessmentBlock(input: ReportInput, isAr: boolean): string {
  const { quiz } = input.experiment;
  const answered = quiz.filter((_, i) => i in input.quizAnswers).length;
  const correct = quiz.filter((q, i) => input.quizAnswers[i] === q.answer).length;

  const items = quiz
    .map((q, i) => {
      const chosen = input.quizAnswers[i];
      const done = i in input.quizAnswers;
      const right = done && chosen === q.answer;
      const options = isAr ? q.optionsAr : q.optionsEn;
      const mark = !done ? '—' : right ? '✓' : '✗';
      const given = done ? esc(options[chosen] ?? '') : isAr ? 'لم يُجب' : 'not answered';
      return `<li class="${right ? 'right' : done ? 'wrong' : 'skipped'}">
        <span class="mark">${mark}</span>
        <span class="q">${esc(isAr ? q.promptAr : q.promptEn)}</span>
        <span class="a">${given}</span>
      </li>`;
    })
    .join('');

  return `
    <p class="score">${
      isAr ? 'النتيجة' : 'Score'
    }: <strong>${correct} / ${quiz.length}</strong> (${
      isAr ? 'أُجيب عن' : 'answered'
    } ${answered})</p>
    <ul class="answers">${items}</ul>`;
}

/** One language's worth of the report. Both are emitted, on separate printed pages. */
function section(input: ReportInput, isAr: boolean): string {
  const { experiment } = input;
  const law = theory(input.momentumFactor);
  const t = isAr
    ? {
        title: 'تقرير التجربة',
        subject: 'قياس قوة نفث الماء — VL-FM009',
        experiment: 'التجربة',
        deflector: 'العاكس',
        date: 'التاريخ',
        theory: 'الأساس النظري',
        readings: 'القراءات المسجلة',
        chart: 'القوة مقابل معدل التدفق',
        assessment: 'التقييم',
        constants: 'الثوابت',
      }
    : {
        title: 'Experiment report',
        subject: 'Measurement of Jet Forces — VL-FM009',
        experiment: 'Experiment',
        deflector: 'Deflector',
        date: 'Date',
        theory: 'Theory',
        readings: 'Recorded readings',
        chart: 'Force against flow rate',
        assessment: 'Assessment',
        constants: 'Constants',
      };

  return `
  <section dir="${isAr ? 'rtl' : 'ltr'}" lang="${isAr ? 'ar' : 'en'}" class="page">
    <header>
      <h1>${t.title}</h1>
      <p class="subject">${t.subject}</p>
    </header>

    <dl class="meta">
      <dt>${t.experiment}</dt><dd>${esc(isAr ? experiment.nameAr : experiment.nameEn)}</dd>
      <dt>${t.deflector}</dt><dd>${esc(input.deflectorName)} (${input.deflectorId}°)</dd>
      <dt>${t.date}</dt><dd>${input.generatedAt.toISOString().slice(0, 10)}</dd>
    </dl>

    <h2>${t.theory}</h2>
    <p>${esc(isAr ? experiment.objectiveAr : experiment.objectiveEn)}</p>
    <p class="formula" dir="ltr">${esc(isAr ? law.ar : law.en)}</p>
    <p class="formula" dir="ltr">V_nozzle = Q / A &nbsp;·&nbsp; V_impact = √(V_nozzle² − 2gs)</p>

    <h3>${t.constants}</h3>
    <p class="constants" dir="ltr">
      A = ${NOZZLE_AREA_M2.toExponential(3)} m² &nbsp;·&nbsp;
      s = ${TRAVEL_HEIGHT_M} m &nbsp;·&nbsp;
      ρ = ${WATER_DENSITY_KG_M3} kg/m³ &nbsp;·&nbsp;
      g = ${GRAVITY_MS2} m/s² &nbsp;·&nbsp;
      Q<sub>max</sub> = ${input.pumpFlowLMin} L/min
    </p>

    <h2>${t.readings}</h2>
    ${readingsTable(input.rows, isAr)}

    <h2>${t.chart}</h2>
    <div class="chart-wrap" dir="ltr">
      ${chartSvg(input)}
      <p class="legend">
        <span class="key th-key"></span> F_th &nbsp;&nbsp;
        <span class="key ac-key"></span> F_ac
      </p>
    </div>

    <h2>${t.assessment}</h2>
    ${assessmentBlock(input, isAr)}
  </section>`;
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f4f6f7;
    color: #16202a;
    font: 13px/1.6 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  [dir='rtl'] {
    font-family: 'IBM Plex Sans Arabic', 'Cairo', 'Noto Sans Arabic', 'Segoe UI', 'Geeza Pro',
      system-ui, sans-serif;
    line-height: 1.85;
    font-size: 14px;
  }
  .page {
    background: #fff;
    max-width: 780px;
    margin: 20px auto;
    padding: 34px 40px 44px;
    box-shadow: 0 2px 14px rgba(0, 0, 0, 0.09);
  }
  header { border-bottom: 2px solid #f58220; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 22px; margin: 0; }
  .subject { margin: 4px 0 0; color: #5a6b78; font-size: 13px; }
  h2 { font-size: 15px; margin: 26px 0 8px; color: #0f4c63; }
  h3 { font-size: 12.5px; margin: 16px 0 4px; color: #5a6b78; text-transform: uppercase; letter-spacing: .05em; }
  .meta { display: grid; grid-template-columns: max-content 1fr; gap: 3px 14px; margin: 0; }
  .meta dt { color: #5a6b78; }
  .meta dd { margin: 0; font-weight: 600; }
  .formula, .constants {
    background: #f0f4f6; border-inline-start: 3px solid #0f4c63;
    padding: 8px 12px; margin: 8px 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
  }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #d5dde2; padding: 5px 7px; text-align: center; }
  th { background: #eef3f5; font-weight: 600; }
  td { font-variant-numeric: tabular-nums; direction: ltr; }
  .empty { color: #7b8b96; font-style: italic; }
  .chart-wrap { margin-top: 6px; }
  .chart { width: 100%; height: auto; max-width: 520px; }
  .grid { stroke: #e2e9ed; stroke-width: 1; }
  .axis { stroke: #9fb0bb; stroke-width: 1; }
  .tick { fill: #6d7f8b; font-size: 9px; }
  .axis-label { fill: #46555f; font-size: 10px; }
  .th { fill: none; stroke: #0f7fa8; stroke-width: 2; stroke-dasharray: 5 3; }
  .th-dot { fill: #fff; stroke: #0f7fa8; stroke-width: 1.5; }
  .ac { fill: #f58220; }
  .ac-line { fill: none; stroke: #f58220; stroke-width: 2; }
  .legend { font-size: 11px; color: #5a6b78; margin: 4px 0 0; }
  .key { display: inline-block; width: 16px; height: 3px; vertical-align: middle; }
  .th-key { background: #0f7fa8; }
  .ac-key { background: #f58220; }
  .score { font-size: 14px; }
  .answers { list-style: none; padding: 0; margin: 8px 0 0; }
  .answers li {
    display: grid; grid-template-columns: 20px 1fr; gap: 2px 8px;
    padding: 7px 0; border-top: 1px solid #e6ecef;
  }
  .answers .mark { font-weight: 700; }
  .answers .a { grid-column: 2; color: #5a6b78; font-size: 12px; }
  .right .mark { color: #0f8f5f; }
  .wrong .mark { color: #c8351f; }
  .skipped .mark { color: #9fb0bb; }
  .toolbar {
    position: sticky; top: 0; z-index: 1; display: flex; gap: 10px; justify-content: center;
    padding: 10px; background: #16202a;
  }
  .toolbar button {
    font: inherit; font-weight: 600; padding: 7px 18px; border-radius: 7px;
    border: 1px solid #f58220; background: #f58220; color: #fff; cursor: pointer;
  }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .page { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    /* Each language on its own sheet, so the report can be handed in in either. */
    .page + .page { break-before: page; }
  }
  @page { size: A4; margin: 16mm; }
`;

/**
 * The whole report, as one self-contained HTML document.
 *
 * Both languages, English first and Arabic second, each on its own printed page — the
 * brief's own suggestion, and simpler than a language toggle in a document that has no
 * scripts in it.
 */
export function buildReportHtml(input: ReportInput): string {
  const title = `VL-FM009 — ${input.experiment.nameEn} — ${input.generatedAt
    .toISOString()
    .slice(0, 10)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()">Print / Save as PDF &nbsp;·&nbsp; طباعة أو حفظ PDF</button>
</div>
${section(input, false)}
${section(input, true)}
</body>
</html>`;
}

/** A stable filename for the saved document. */
export const reportFilename = (input: ReportInput): string =>
  `jet-forces-${input.experiment.id}-${input.generatedAt.toISOString().slice(0, 10)}.html`;
