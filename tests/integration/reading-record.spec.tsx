// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  balanceHint,
  click,
  loadedWeightG,
  okButton,
  renderFreshApp,
  setValve,
  stubConfigFetch,
  walkLesson,
} from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The reading-recording defects reported against the live build.
 *
 * Each `it` here is one of them, reproduced as it was reported and then pinned shut. They
 * share a single cause — the results table was *generated* from `ROW_VALVE_SETTINGS` and
 * the row being balanced followed the tray, so a row existed before anyone had taken it
 * and moved while they were still taking it.
 */

const readingsCounter = (): string =>
  Array.from(document.querySelectorAll('.guided-cover-state'))
    .find((el) => el.textContent?.includes('Recorded readings'))
    ?.textContent?.replace(/\s+/g, ' ')
    .trim() ?? '';

const tableRows = () => [...document.querySelectorAll('.data-table tbody tr')];

/** Every button in the weights panel, in document order, by accessible name. */
const weightPanelButtons = (): string[] => {
  const panel = document.querySelector('.weights-panel');
  return Array.from(panel?.querySelectorAll('button') ?? []).map(
    (b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? ''
  );
};

beforeEach(() => {
  stubConfigFetch();
  renderFreshApp();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the recorded-readings counter', () => {
  it('does not move while the tray is being loaded', () => {
    // Reported: the counter reached 2 / 2 at 200 g with the panel still showing
    // "Unbalanced (target ≈ 260 g)". It counted table rows carrying any mass at all, and
    // the row being balanced was one of them.
    walkLesson(1, 5);
    expect(readingsCounter()).toContain('0 / 2');

    click('Add 50 g');
    expect(readingsCounter()).toContain('0 / 2');
    click('Add 20 g');
    expect(readingsCounter()).toContain('0 / 2');
    click('Add 10 g'); // 80 g — balanced, but not yet recorded
    expect(screen.getByText('Pointer balanced')).toBeDefined();
    expect(readingsCounter()).toContain('0 / 2');
  });

  it('moves once, on the record, and stays', () => {
    walkLesson(1, 5);
    for (const disc of ['Add 50 g', 'Add 20 g', 'Add 10 g']) click(disc);

    click('Record reading');

    // One reading, and the lesson has moved on to the flow step — so the weights panel and
    // its Record button are no longer on screen to press again.
    expect(readingsCounter()).toContain('1 / 2');
    expect(screen.queryByRole('button', { name: 'Record reading' })).toBeNull();

    // Reaching the second balance step and loading more does not record a second reading
    // until it is recorded.
    walkLesson(7, 7);
    click('Add 100 g');
    expect(readingsCounter()).toContain('1 / 2');
  });

  it('offers no way to record an unbalanced tray', () => {
    walkLesson(1, 5);
    const record = () => screen.getByRole('button', { name: 'Record reading' }) as HTMLButtonElement;
    expect(record().disabled).toBe(true);

    click('Add 50 g'); // 50 g against 83.6 g
    expect(record().disabled).toBe(true);

    click('Add 20 g');
    click('Add 10 g');
    expect(record().disabled).toBe(false);
  });
});

describe('the readings table', () => {
  it('starts empty, with no zero row', () => {
    walkLesson(1, 4);
    click('Free Mode');
    click('Open Data Monitor');

    expect(tableRows()).toHaveLength(1);
    expect(tableRows()[0].querySelector('td')?.getAttribute('colspan')).toBe('9');
  });

  it('gains no row from dragging the flow valve', () => {
    // Reported as a phantom row at "Q = 43.457 L/min, mass = 0", blamed on the slider
    // passing through 62 % during a drag. The real cause was a table generated at four
    // fixed openings — of which 0.6 gives exactly 43.457 L/min. Either way, dragging the
    // valve must not write a reading, and this drags it across the whole range.
    click('Free Mode');
    click(/Turn On Pump/);
    for (const n of [0.1, 0.25, 0.4, 0.5, 0.62, 0.75, 0.9, 1.0, 0.3]) setValve(n);

    click('Open Data Monitor');
    expect(tableRows()).toHaveLength(1); // the empty-state row, and nothing else
    expect(document.body.textContent).not.toContain('43.457');
  });

  it('holds exactly the readings that were recorded', () => {
    walkLesson(1, 9);
    const rows = tableRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.querySelectorAll('td')[1].textContent)).toEqual(['15.714', '27.024']);
  });
});

describe('Total Weight has one source', () => {
  it('agrees between the step panel and the monitor', () => {
    walkLesson(1, 5);
    for (const disc of ['Add 50 g', 'Add 20 g', 'Add 10 g']) click(disc);
    expect(loadedWeightG()).toBe(80);

    click('Open Data Monitor');
    const card = Array.from(document.querySelectorAll('.indicator-card')).find((el) =>
      el.textContent?.includes('Total Weight')
    );
    // The monitor used to sum the results table, which reported 0 g here.
    expect(card?.textContent).toContain('80 g × g = 0.785 N');
  });

  it('keeps the pan loaded across a reading, so the two never diverge', () => {
    walkLesson(1, 6);
    expect(loadedWeightG()).toBe(80);
    walkLesson(7, 9);
    expect(loadedWeightG()).toBe(260);
  });
});

describe('the weights panel never reflows', () => {
  it('offers the same buttons, in the same order, loaded or empty', () => {
    // Reported: adding the first weight made a "−" row appear, pushing the panel up about
    // 56 px, so a click aimed at 20 g landed on 500 g and 50 + 20 + 10 became 750 g. Every
    // denomination now keeps its row from the first paint.
    walkLesson(1, 5);
    const empty = weightPanelButtons();

    click('Add 50 g');
    expect(weightPanelButtons()).toEqual(empty);

    click('Add 500 g');
    click('Add 500 g');
    expect(weightPanelButtons()).toEqual(empty);

    click('Clear pan');
    expect(weightPanelButtons()).toEqual(empty);
  });

  it('shows a count per denomination rather than one button per disc', () => {
    walkLesson(1, 5);
    click('Add 50 g');
    click('Add 50 g');
    const row = Array.from(document.querySelectorAll('.weight-row')).find((el) =>
      el.querySelector('.weight-row-mass')?.textContent?.startsWith('50')
    );
    expect(row?.querySelector('.weight-row-count')?.textContent).toBe('×2');
  });
});

describe('the balance readout', () => {
  it('states the deviation and the grams that close it', () => {
    walkLesson(1, 5);
    expect(balanceHint()).toMatch(/^−100\.0 % · add 84 g$/);

    click('Add 100 g');
    // 100 g against 83.58 g — over, and it says by how much.
    expect(balanceHint()).toMatch(/^\+19\.6 % · remove 16 g$/);
  });

  it('rejects the 250 g that used to pass for a 257.9 g reading', () => {
    walkLesson(1, 7);
    // The pan carries 80 g; 170 g more makes 250 g, which is 3.1 % light.
    click('Add 100 g');
    click('Add 50 g');
    click('Add 20 g');
    expect(balanceHint()).toMatch(/−3\.1 % · add 8 g/);
    expect(okButton()).toBeNull();

    click('Add 10 g'); // 260 g, 0.8 % over
    expect(okButton()).not.toBeNull();
  });

  it('says nothing is loaded when there is no jet to balance', () => {
    click('Free Mode');
    expect(document.querySelector('.balance-bar.is-idle')).not.toBeNull();
  });
});

describe('the force-vs-flow chart', () => {
  it('draws the theoretical curve as soon as the monitor is open', () => {
    // Reported as "only a title and legend, no plot". The section rendered, but
    // `.monitor-docked .plot-canvas` was `display: none` and the monitor always opens
    // docked — and the curve was a polyline through the table, which is now empty at open.
    walkLesson(1, 4);
    click('Free Mode');
    click('Open Data Monitor');

    const curve = document.querySelector('[data-testid="chart-theoretical"]');
    expect(curve).not.toBeNull();
    const d = curve?.getAttribute('d') ?? '';
    expect(d.startsWith('M ')).toBe(true);
    // 41 samples across the valve's range, so 40 line segments.
    expect(d.split('L')).toHaveLength(41);
  });

  it('marks the recorded readings on it once they are calculated', () => {
    walkLesson(1, 10);
    expect(document.querySelectorAll('[data-testid="chart-measured-point"]')).toHaveLength(2);
  });
});
