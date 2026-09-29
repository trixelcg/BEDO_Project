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
import type { ReadingStatus } from '../simulation/selectors';

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
  /**
   * What each row is (F15). Absent means every row is a recorded reading — how free
   * readings, and older callers, export.
   */
  statuses?: readonly ReadingStatus[];
}

/**
 * The columns a row that was never measured still carries: which row, at what Q_total and
 * which scheduled opening. Everything else is a measurement or derived from one.
 */
const SCHEDULE_COLUMNS = new Set(['Row', 'Q_total (L/min)', 'n']);

/**
 * Renders the readings as the CSV file the app has always produced — same columns, same
 * order, same formatting, one line per table row.
 *
 * What changed in F15 (`docs/62`) is which *values* a row may carry. A row not recorded —
 * the one being balanced, or one the lesson never takes (row 4, `BUG-14`) — exports its
 * schedule and blanks: it used to export a full theoretical force and an F_ac of zero, as
 * if measured. F_ac is written only for a recorded reading, and only once recorded
 * (Calculate). The valve-shut reference row keeps its zeros, which are true, and no F_ac.
 */
export function toCsv(rows: RecordRow[], { title, isCalculated, statuses }: ExportContext): string {
  const header = EXPORT_COLUMNS.map((column) => column.header).join(',');
  const body = rows.map((row, index) => {
    const status: ReadingStatus = statuses?.[index] ?? 'recorded';
    return EXPORT_COLUMNS.map((column) => {
      if (column.header === 'F_ac (N)') {
        return status === 'recorded' ? column.value(row, index, isCalculated) : '';
      }
      if (status === 'live' || status === 'pending') {
        return SCHEDULE_COLUMNS.has(column.header) ? column.value(row, index, isCalculated) : '';
      }
      return column.value(row, index, isCalculated);
    }).join(',');
  });
  return [`# ${title}`, header, ...body].join('\n');
}

/** `jet-forces-flat.csv` — the filename the browser is handed. */
export const csvFilename = (experimentId: string): string => `jet-forces-${experimentId}.csv`;
