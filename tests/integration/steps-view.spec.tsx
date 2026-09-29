// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click,
  currentStep,
  dismissPopup,
  okButton,
  renderApp,
  stubConfigFetch,
  walkLesson,
} from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The guided Steps view (F14), driven through the real App.
 *
 * The list's statuses are read from `data-status`; the words and icons that carry them
 * visually are pinned in `tests/unit/f14-guided-progress.spec.ts`.
 */

const statuses = () =>
  [...document.querySelectorAll('[data-bedo-step-progress] li')].map(
    (li) => (li as HTMLElement).dataset.status
  );
const rowOf = (stepId: string) =>
  document.querySelector(`[data-bedo-step-progress] li[data-step-id="${stepId}"]`) as HTMLElement;

let scrolls: number;

beforeEach(() => {
  scrolls = 0;
  // jsdom has no layout; count the list's scroll requests instead.
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: () => {
      scrolls += 1;
    },
  });
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo;
  vi.unstubAllGlobals();
});

describe('a live progress view', () => {
  it('opens with step 1 current and the rest upcoming', () => {
    expect(statuses()).toEqual(['current', ...Array(10).fill('upcoming')]);
    expect(rowOf('unscrew-cover').getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('0 of 11 done')).toBeDefined();
  });

  it('marks a balance done the moment the tray balances, with no OK', () => {
    walkLesson(1, 5);
    expect(rowOf('balance-reading-1').dataset.status).toBe('current');
    click('+50g');
    click('+20g');
    expect(rowOf('balance-reading-1').dataset.status).toBe('current');
    click('+10g'); // 80 g
    expect(rowOf('balance-reading-1').dataset.status).toBe('completed');
    expect(rowOf('increase-flow-reading-2').dataset.status).toBe('current');
    expect(currentStep()).toBe(7);
    expect(okButton()).toBeNull();
    // The card and the list say the same thing.
    expect(screen.getByRole('heading', { name: 'Increase the flow rate' })).toBeDefined();
  });

  it('scrolls only when the current step changes', () => {
    walkLesson(1, 5);
    const before = scrolls;
    click('+50g'); // not balanced: the current step is unchanged
    click('+20g');
    expect(scrolls).toBe(before);
    click('+10g'); // balanced: step 7 becomes current
    expect(scrolls).toBe(before + 1);
    dismissPopup(); // closing a note is not a step change
    expect(scrolls).toBe(before + 1);
  });

  it('rows are not controls: clicking one changes nothing', () => {
    const row = rowOf('power-on');
    expect(row.tagName).toBe('LI');
    expect(row.querySelector('button, a, [tabindex]')).toBeNull();
    fireEvent.click(row);
    expect(currentStep()).toBe(1);
    expect(statuses()[0]).toBe('current');
  });

  it('ends in a completed state, not a twelfth step', () => {
    walkLesson(1, 11);
    fireEvent.click(within(screen.getByTestId('answer-sheet')).getByRole('button', { name: 'Close' }));
    expect(statuses()).toEqual([...Array(11).fill('completed'), 'finished']);
    expect(screen.getByText('11 of 11 done')).toBeDefined();
    expect(screen.getByTestId('lesson-complete')).toBeDefined();
    expect(okButton()).toBeNull();
  });

  it('can be put away and brought back; the step card stays either way', () => {
    click('Hide steps');
    expect(document.querySelector('[data-bedo-step-progress]')).toBeNull();
    expect(document.querySelector('[data-bedo-step-card]')).not.toBeNull();
    const toggle = document.querySelector('[data-bedo-steps-toggle]') as HTMLElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(document.querySelector('[data-bedo-step-progress]')).not.toBeNull();
  });

  it('is not shown in Free Mode, which has no procedure', () => {
    click('Free Mode');
    expect(document.querySelector('[data-bedo-step-progress]')).toBeNull();
  });
});

describe('Guided takes back only the rig it left', () => {
  it('returns silently when nothing changed in Free Mode', () => {
    walkLesson(1, 3);
    click('Free Mode');
    click('Guided Mode');
    expect(document.querySelector('[data-bedo-mode-dialog]')).toBeNull();
    expect(currentStep()).toBe(4);
  });

  it('asks to reset when Free Mode changed the rig, and offers no "keep"', () => {
    walkLesson(1, 3);
    click('Free Mode');
    click(/Turn On Pump/);
    click('Guided Mode');
    expect(document.querySelector('[data-bedo-mode-dialog]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Keep/ })).toBeNull();
    click('Reset the rig and start at step 1');
    expect(currentStep()).toBe(1);
    expect(statuses()[0]).toBe('current');
  });
});
