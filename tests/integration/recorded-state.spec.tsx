// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click,
  currentStep,
  loadedWeightG,
  renderApp,
  setValve,
  stubConfigFetch,
  trayWeightG,
  walkLesson,
} from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/** F15, rendered: counters, row states, Calculate's prerequisites and the reset dialog. */

const footerCount = () =>
  [...document.querySelectorAll('.guided-cover-state')]
    .map((el) => el.textContent ?? '')
    .find((text) => text.includes('Recorded readings'));
const monitorCount = () => document.querySelector('[data-bedo-recorded-count]')?.textContent;
const statuses = () =>
  [...document.querySelectorAll('.data-table tbody tr')].map((tr) => (tr as HTMLElement).dataset.status);
const calculate = () => screen.queryByRole('button', { name: 'Calculate' }) as HTMLButtonElement | null;
const resetDialog = () => document.querySelector('[data-bedo-reset-dialog]') as HTMLElement | null;

beforeEach(() => {
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('counters equal the recorded rows', () => {
  it('a disc on the carrier during reading 1 is not a recorded reading', () => {
    walkLesson(1, 5);
    click('+50g');
    expect(footerCount()).toContain('0 / 2'); // it used to read 1 / 2
    click('Open Data Monitor');
    expect(monitorCount()).toBe('0 of 2');
    expect(statuses()).toEqual(['reference', 'live', 'pending', 'pending']);
  });

  it('counts each reading as it is recorded, on the panel and in the monitor alike', () => {
    walkLesson(1, 6);
    expect(footerCount()).toContain('1 / 2');
    walkLesson(7, 9);
    expect(footerCount()).toContain('2 / 2');
    expect(monitorCount()).toBe('2 of 2');
    expect(statuses()).toEqual(['reference', 'recorded', 'recorded', 'pending']);
  });

  it('the live row shows no numbers: they are in the Live section', () => {
    walkLesson(1, 5);
    click('+50g');
    click('Open Data Monitor');
    const live = document.querySelector('.data-table tbody tr[data-status="live"]')!;
    const cells = [...live.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells.slice(1, 8)).toEqual(['—', '—', '—', '—', '—', '—', '—']);
    expect(cells[8]).toBe('● Balancing now — see Live');
    expect(document.querySelector('[data-bedo-live-section]')).not.toBeNull();
    expect(document.querySelector('[data-bedo-recorded-section]')).not.toBeNull();
  });
});

describe('F_ac is recorded only when its prerequisites hold', () => {
  it('Calculate is disabled, with the reason, until both readings are recorded', () => {
    walkLesson(1, 6);
    click('Open Data Monitor');
    expect(calculate()?.disabled).toBe(true);
    expect(document.querySelector('[data-bedo-calc-blocker]')?.textContent).toBe(
      'Record both readings first — 1 of 2 recorded.'
    );
    walkLesson(7, 8);
    expect(calculate()?.disabled).toBe(false);
    expect(document.querySelector('[data-bedo-calc-blocker]')).toBeNull();
  });

  it('F_ac appears on the recorded rows only', () => {
    walkLesson(1, 10);
    const facs = [...document.querySelectorAll('.data-table tbody tr')].map(
      (tr) => tr.querySelectorAll('td')[7].textContent
    );
    expect(facs).toEqual(['—', '0.7848', '2.5506', '—']);
  });

  it('free mode: Record is disabled until the carrier balances, and says why', () => {
    click('Free Mode');
    click('Open tank cover');
    click('Flat surface (90°)');
    click('Close tank cover');
    click('Open Data Monitor');
    const record = () => screen.getByRole('button', { name: 'Record reading' }) as HTMLButtonElement;
    const blocker = () =>
      (document.querySelector('[data-bedo-record-blocker]') as HTMLElement).dataset.bedoRecordBlocker;
    expect(record().disabled).toBe(true);
    expect(blocker()).toBe('NO_FLOW');
    click(/Turn On Pump/);
    setValve(0.4);
    expect(blocker()).toBe('NO_LOAD');
    click('+50g');
    expect(blocker()).toBe('NOT_BALANCED');
    click('+20g');
    click('+10g');
    expect(blocker()).toBe('none');
    expect(record().disabled).toBe(false);
    click('Record reading');
    expect(monitorCount()).toBe('1 of 10');
  });
});

describe('reset says what it clears', () => {
  it('asks when there is something to lose, lists it, and Cancel keeps everything', () => {
    walkLesson(1, 6);
    click('Reset simulator');
    const dialog = resetDialog()!;
    expect(dialog).not.toBeNull();
    const clears = [...dialog.querySelectorAll('[data-bedo-reset-clears] li')].map((li) => li.textContent);
    expect(clears).toEqual([
      'The rig: cover, pump, valve, weights and deflector',
      'Guided progress: step 7 (back to step 1)',
      '1 recorded lesson reading',
    ]);
    const keeps = [...dialog.querySelectorAll('[data-bedo-reset-keeps] li')].map((li) => li.textContent);
    expect(keeps[0]).toBe('Q_total 120 L/min and the custom weight 25 g');

    click('Cancel');
    expect(resetDialog()).toBeNull();
    expect(currentStep()).toBe(7);
    // Step 7 hides the weights card; reading 1's discs are still on the carrier (F14).
    expect(trayWeightG()).toBe(80);
  });

  it('"Yes, reset" clears it all', () => {
    walkLesson(1, 6);
    click('Reset simulator');
    click('Yes, reset');
    expect(currentStep()).toBe(1);
    expect(loadedWeightG()).toBe(0);
    expect(footerCount()).toContain('0 / 2');
  });

  it('does not ask when there is nothing to lose', () => {
    click('Reset simulator');
    expect(resetDialog()).toBeNull();
    expect(currentStep()).toBe(1);
  });

  it('the monitor has no second, unlabelled Reset', () => {
    walkLesson(1, 9);
    const monitor = document.querySelector('.monitor-docked') as HTMLElement;
    expect([...monitor.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('Reset');
  });
});
