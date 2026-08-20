/**
 * The instructor-facing data schema (BEDO-005 §13).
 *
 * The CSV a student exports is the only artefact of this app that leaves it, and someone
 * downstream may have a spreadsheet or a marking script built on its columns. So it is a
 * **published interface**, and it is deliberately written out here rather than derived
 * from whatever the domain happens to call its fields today.
 *
 * That separation is the whole point: `RecordRow` was renamed field by field in BEDO-005
 * (`fth` → `theoreticalForceN`, `springhW` → `springDeflectionMm`, …) and not one
 * character of the file below changed. `tests/integration/export-contract.spec.tsx` pins
 * it, headers, column order, formatting and all.
 *
 * If the schema ever *should* change, that is a decision with an audience — it belongs in
 * its own task, with the reference sheets in hand.
 */

import type { RecordRow } from '../domain/physics';

/** One CSV column: its published header and how a row is rendered into it. */
interface ExportColumn {
  header: string;
  value: (row: RecordRow, index: number, isCalculated: boolean) => string | number;
}

/**
 * The published column set, in order.
 *
 * Two headers do not say quite what the value is, and both are preserved as they stand:
 *  - `Balanced mass (g)` carries the mass the student **loaded**, not the mass that would
 *    balance the jet exactly (`balancingMassG`). When a reading is balanced the two agree
 *    within 10 g, which is presumably why it was never noticed.
 *  - the reference simulator's own table orders `V_th` before `V_o` and has no mass
 *    column at all, so this file is not a copy of BEDO's layout.
 * Recorded in `docs/29`; changing either is a schema change, not a refactor.
 */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Row', value: (_row, index) => index + 1 },
  { header: 'Q_total (L/min)', value: (row) => row.pumpFlowLMin.toFixed(1) },
  { header: 'n', value: (row) => row.valveOpening.toFixed(2) },
  { header: 'Q (L/min)', value: (row) => row.flowRateLMin.toFixed(3) },
  { header: 'Q (m3/s)', value: (row) => row.flowRateM3S.toExponential(4) },
  { header: 'Vo (m/s)', value: (row) => row.nozzleVelocityMS.toFixed(3) },
  { header: 'V (m/s)', value: (row) => row.impactVelocityMS.toFixed(3) },
  { header: 'Balanced mass (g)', value: (row) => row.loadedMassG },
  { header: 'Spring defl. (mm)', value: (row) => row.springDeflectionMm.toFixed(2) },
  { header: 'F_th (N)', value: (row) => row.theoreticalForceN.toFixed(4) },
  {
    header: 'F_ac (N)',
    // F_ac exists only once the student has pressed Calculate.
    value: (row, _index, isCalculated) => (isCalculated ? row.measuredForceN.toFixed(4) : ''),
  },
];

export interface ExportContext {
  /** Free-text first line: which experiment and which deflector produced these readings. */
  title: string;
  isCalculated: boolean;
}

/** Renders the readings as the CSV file the app has always produced. */
export function toCsv(rows: RecordRow[], { title, isCalculated }: ExportContext): string {
  const header = EXPORT_COLUMNS.map((column) => column.header).join(',');
  const body = rows.map((row, index) =>
    EXPORT_COLUMNS.map((column) => column.value(row, index, isCalculated)).join(',')
  );
  return [`# ${title}`, header, ...body].join('\n');
}

/** `jet-forces-flat.csv` — the filename the browser is handed. */
export const csvFilename = (experimentId: string): string => `jet-forces-${experimentId}.csv`;
