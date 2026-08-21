// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, renderApp, stubConfigFetch, walkLesson } from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The instructor-facing data contract (BEDO-005 §1, §13).
 *
 * The CSV a student exports and the table an instructor reads are the only artefacts of
 * this app that leave it. Their column set, order, headers, units and number formatting
 * are a published interface: a spreadsheet or a marking script built against them breaks
 * silently if a column moves.
 *
 * This is pinned **before** the domain rename, so the rename has to prove it changed
 * nothing. `RecordRow` fields are internal and free to be renamed; these strings are not.
 * The adapter in `src/lib/exportSchema.ts` is what keeps the two apart.
 */

/** Captures whatever the component hands to `URL.createObjectURL`. */
const captureDownload = () => {
  const captured: { blob?: Blob; filename?: string; type?: string } = {};
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      captured.blob = blob;
      captured.type = blob.type;
      return 'blob:captured';
    },
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    captured.filename = this.download;
  });
  return captured;
};

beforeEach(() => {
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the exported CSV', () => {
  /** Runs the whole lesson, exports, and returns the file as lines. */
  const exportCsv = async () => {
    walkLesson(1, 10);
    const captured = captureDownload();
    click('Export Data');
    expect(captured.blob, 'Export Data produced no file').toBeDefined();
    const text = await captured.blob!.text();
    return { captured, text, lines: text.split('\n') };
  };

  it('is a text/csv file named for the experiment', async () => {
    const { captured } = await exportCsv();
    expect(captured.type).toBe('text/csv;charset=utf-8;');
    expect(captured.filename).toBe('jet-forces-flat.csv');
  });

  it('opens with a comment naming the experiment and the deflector', async () => {
    const { lines } = await exportCsv();
    expect(lines[0]).toBe('# Exp. 1 — Flat surface deflector — Flat surface (90°)');
  });

  it('has exactly these eleven columns, in this order', async () => {
    const { lines } = await exportCsv();
    expect(lines[1].split(',')).toEqual([
      'Row',
      'Q_total (L/min)',
      'n',
      'Q (L/min)',
      'Q (m3/s)',
      'Vo (m/s)',
      'V (m/s)',
      'Balanced mass (g)',
      'Spring defl. (mm)',
      'F_th (N)',
      'F_ac (N)',
    ]);
  });

  it('states a unit for every column that carries one', async () => {
    const { lines } = await exportCsv();
    const columns = lines[1].split(',');
    // `Row` and `n` are dimensionless; everything else must name its unit.
    for (const column of columns.filter((c) => c !== 'Row' && c !== 'n')) {
      expect(column, `${column} has no unit`).toMatch(/\((L\/min|m3\/s|m\/s|g|mm|N)\)$/);
    }
  });

  it('writes one row per table row, four of them', async () => {
    const { lines } = await exportCsv();
    expect(lines).toHaveLength(6); // comment + header + 4 rows
    expect(lines.slice(2).every((l) => l.split(',').length === 11)).toBe(true);
  });

  it('formats the two readings exactly as they stand today', async () => {
    const { lines } = await exportCsv();

    // Reading 1 — n = 0.4, 80 g of weights on the tray.
    expect(lines[3]).toBe('2,120.0,0.40,15.714,2.6191e-4,3.336,3.232,80,3.92,0.8199,0.7848');
    // Reading 2 — n = 0.5, 260 g.
    expect(lines[4]).toBe('3,120.0,0.50,27.024,4.5040e-4,5.738,5.677,260,12.75,2.5303,2.5506');
  });

  it('keeps the zero row and the untaken row', async () => {
    const { lines } = await exportCsv();
    expect(lines[2]).toBe('1,120.0,0.00,0.000,0.0000e+0,0.000,0.000,0,0.00,0.0000,0.0000');
    // Row 4 is never measured by the lesson, yet it is exported with a full theoretical
    // force computed at n = 0.6 and an F_ac of zero. That is `BUG-14`; BEDO-005 pins it
    // as it stands and BEDO-009 is where it changes.
    expect(lines[5]).toBe('4,120.0,0.60,43.457,7.2428e-4,9.227,9.189,0,0.00,6.6287,0.0000');
  });

  it('pins the numeric precision of every column', async () => {
    const { lines } = await exportCsv();
    const [row, qTotal, n, q, qM3, vo, v, mass, spring, theoreticalForceN, fac] = lines[3].split(',');
    expect(row).toMatch(/^\d+$/); // integer index, 1-based
    expect(qTotal).toMatch(/^\d+\.\d$/); // 1 dp
    expect(n).toMatch(/^\d\.\d{2}$/); // 2 dp
    expect(q).toMatch(/^\d+\.\d{3}$/); // 3 dp
    expect(qM3).toMatch(/^\d\.\d{4}e[+-]\d$/); // 4 significant, exponential
    expect(vo).toMatch(/^\d+\.\d{3}$/); // 3 dp
    expect(v).toMatch(/^\d+\.\d{3}$/); // 3 dp
    expect(mass).toMatch(/^\d+$/); // integer grams, unformatted
    expect(spring).toMatch(/^\d+\.\d{2}$/); // 2 dp
    expect(theoreticalForceN).toMatch(/^\d+\.\d{4}$/); // 4 dp
    expect(fac).toMatch(/^\d+\.\d{4}$/); // 4 dp
  });

  it('leaves F_ac empty until the student presses Calculate', async () => {
    // Everything except step 11.
    walkLesson(1, 9);
    const captured = captureDownload();
    click('Export Data');
    const lines = (await captured.blob!.text()).split('\n');
    expect(lines[3].split(',')).toHaveLength(11);
    expect(lines[3].split(',')[10]).toBe('');
    expect(lines[3].split(',')[9]).toBe('0.8199'); // F_th is always present
  });

  it('names the deflector of whichever experiment is loaded', async () => {
    // Free mode reaches the monitor without balancing: Exp. 2 runs the 180 deg deflector,
    // whose momentum factor is 2.0, so the guided walk's weights would not balance it.
    click('Experiments');
    click('Exp. 2 — Semi-circular deflector');
    click('Free Mode');
    click('Steps'); // back from the Experiments tab to the controls
    click('Open Data Monitor');

    const captured = captureDownload();
    click('Export Data');
    const lines = (await captured.blob!.text()).split('\n');

    expect(lines[0]).toBe('# Exp. 2 — Semi-circular deflector — Semi-circular (180°)');
    expect(captured.filename).toBe('jet-forces-semi.csv');
    // The header never varies by experiment or language.
    expect(lines[1].split(',')).toHaveLength(11);
    expect(lines[1].startsWith('Row,Q_total (L/min),n,')).toBe(true);
    // ...and the theoretical force follows that experiment's deflector, not Exp. 1's.
    expect(lines[3].split(',')[9]).toBe('1.6398'); // 2.0 x the flat plate at n = 0.4
  });
});

describe('the on-screen readings table', () => {
  const headers = () =>
    [...document.querySelectorAll('.data-table thead th')].map((th) => th.textContent);
  const cells = (row: number) =>
    [...document.querySelectorAll('.data-table tbody tr')[row].querySelectorAll('td')].map(
      (td) => td.textContent
    );

  it('has exactly these eight columns, in this order', () => {
    walkLesson(1, 9);
    expect(headers()).toEqual([
      'Row',
      'Q (L/min)',
      'Q (m³/s)',
      'V₀ (m/s)',
      'V (m/s)',
      'Mass (g)',
      'F_th (N)',
      'F_ac (N)',
    ]);
  });

  it('shows the readings with their current formatting', () => {
    walkLesson(1, 10);
    expect(cells(1)).toEqual(['2', '15.714', '2.619e-4', '3.336', '3.232', '80', '0.8199', '0.7848']);
    expect(cells(2)).toEqual(['3', '27.024', '4.504e-4', '5.738', '5.677', '260', '2.5303', '2.5506']);
  });

  it('shows a dash for F_ac until Calculate is pressed', () => {
    walkLesson(1, 9);
    expect(cells(1)[7]).toBe('—');
  });

  it('prints the total loaded weight in grams and newtons', () => {
    walkLesson(1, 10);
    expect(screen.getByText('340 g × g = 3.335 N')).toBeDefined();
  });

  it('uses the Arabic headers when the lesson is in Arabic', () => {
    walkLesson(1, 9);
    click('العربية');
    expect(headers()).toEqual([
      'القراءة',
      'Q (L/min)',
      'Q (m³/s)',
      'V₀ (m/s)',
      'V (m/s)',
      'الكتلة (g)',
      'F_th (N)',
      'F_ac (N)',
    ]);
  });
});
