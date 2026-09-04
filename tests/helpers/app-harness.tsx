import { fireEvent, render, screen, within, type RenderResult } from '@testing-library/react';
import { expect, vi } from 'vitest';
import App from '../../src/App';

/**
 * Shared setup for the jsdom integration specs.
 *
 * The app is rendered whole — real `App`, real `UIOverlay`, real `SoftwareMonitor` — with
 * only `Scene3D` replaced (see `scene3d-mock.tsx`).
 */

/** `/config.json` is optional: the app falls back to its built-in scene config. */
export function stubConfigFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('not found', { status: 404 }))
  );
}

/**
 * Renders the app and begins the experiment.
 *
 * BEDO-UX-06 puts an information panel in front of the experiment, so "the app is on
 * screen" and "the experiment has started" are now two different states. The suite is
 * about the experiment, so it presses Start exactly as a learner does rather than
 * disabling the panel. `loading-screen.spec` renders `<App />` directly when it needs the
 * pre-start state.
 */
export const renderApp = (): RenderResult => {
  const result = render(<App />);
  const start = screen.queryByRole('button', { name: /^(Start|ابدأ)$/ });
  if (start) fireEvent.click(start);
  return result;
};

export const sidebar = () => document.querySelector('.sidebar-panel') as HTMLElement;

/** The blocking guard popup, or null when no guard is raised. */
export const warning = () => document.querySelector('.warning-popup');

export const warningText = () => warning()?.querySelector('span')?.textContent ?? null;

/** Clicks OK on whichever popup is showing. */
export const dismissPopup = () => {
  const popup = warning();
  if (!popup) return;
  fireEvent.click(within(popup as HTMLElement).getByRole('button'));
};

/** Clicks a button by its accessible name. */
export const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('button', { name }));

/** Clicks one of the mock scene's meshes. */
export const clickMesh = (testId: string) => fireEvent.click(screen.getByTestId(testId));

/**
 * The control that finishes the current step, or null when the step cannot be finished.
 *
 * Usually the card's OK. On a balance step it is the weights panel's "Record reading" —
 * confirming the step *is* recording the reading, so there is one button for it and it
 * sits beside the balance bar that says whether it may be pressed.
 */
export const okButton = (): Element | null => {
  const card = document.querySelector('.ok-confirm-btn');
  if (card) return card;
  const record = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.weights-actions button')
  ).find((b) => /Record reading|تسجيل القراءة/.test(b.textContent ?? ''));
  return record && !record.disabled ? record : null;
};

export const clickOk = () => {
  const button = okButton();
  if (!button) throw new Error('the guided OK button is not on screen');
  fireEvent.click(button);
};

/** Drives the flow-valve slider the way a student drags it. */
export const setValve = (value: number) => {
  const slider = document.querySelector(
    '.valve-slider-container input[type="range"]'
  ) as HTMLInputElement | null;
  if (!slider) throw new Error('the flow valve slider is not on screen');
  fireEvent.change(slider, { target: { value: String(value) } });
};

/** Reads the "Step n / 12" badge the guided panel shows. */
export const currentStep = (): number => {
  const badge = document.querySelector('.step-badge');
  if (!badge) throw new Error('no guided step badge on screen');
  const match = badge.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) throw new Error(`unreadable step badge: "${badge.textContent}"`);
  return Number(match[1]);
};

export const expectStep = (step: number, title?: string) => {
  expect(currentStep(), `expected to be on step ${step}`).toBe(step);
  if (title) expect(screen.getByRole('heading', { name: title })).toBeDefined();
};

export const coverState = (): 'Open' | 'Closed' => {
  // Read the state attribute, not the words. The old text match looked for the first div
  // whose text began "Tank cover:" and then asked whether it contained "Open" — which the
  // adjacent "Open tank cover" button also satisfies, so a closed cover reported as open.
  // Document-scoped: the guided experience (BEDO-UX-06) renders this in the bottom footer
  // rather than the sidebar, which only exists in free mode now.
  const flag = document.querySelector('[data-bedo-cover-state]');
  return flag?.getAttribute('data-bedo-cover-state') === 'open' ? 'Open' : 'Closed';
};

export const loadedWeightG = (): number => {
  // Reads the value attribute rather than the visible words: the row moved into the guided
  // dock, and the English label never matched in Arabic anyway.
  const flag = document.querySelector('[data-bedo-loaded-weight]');
  return Number(flag?.getAttribute('data-bedo-loaded-weight') ?? 0);
};

/**
 * Walks the guided lesson from `from` up to and including `to`, asserting the step number
 * before each action.
 *
 * The canonical eleven-step sequence (BEDO-019). The volumetric valve is no longer a step,
 * so the walk goes straight from powering the pump to opening the flow valve; steps 5-11
 * are what used to be 6-12.
 */
export const walkLesson = (from: number, to: number) => {
  const actions: Record<number, () => void> = {
    1: () => clickMesh('scene-cover'),
    2: () => clickOk(),
    3: () => clickMesh('scene-cover'),
    4: () => click(/Turn On Pump/),
    5: () => {
      setValve(0.4);
      clickOk();
    },
    6: () => {
      click('Add 50 g');
      click('Add 20 g');
      click('Add 10 g');
      clickOk();
    },
    7: () => {
      setValve(0.5);
      clickOk();
    },
    // The pan is cumulative now — it still carries the 80 g from reading 1, and the second
    // reading needs 257.9 g in total, so this adds 180 g rather than starting from empty.
    8: () => {
      click('Add 100 g');
      click('Add 50 g');
      click('Add 20 g');
      click('Add 10 g');
      clickOk();
    },
    9: () => click('Open Data Monitor'),
    10: () => click(/^Calculate$/),
    11: () => click('Open the answer sheet'),
  };

  for (let step = from; step <= to; step++) {
    expect(currentStep(), `expected to start step ${step}`).toBe(step);
    actions[step]();
    dismissPopup();
  }
};

/**
 * The balance readout's figures — "−16.2 % · add 14 g".
 *
 * Read from the element rather than by matching the whole sentence: the deviation, the
 * direction and the grams are one string, and a test that asserts on a rounded target
 * cannot see any of them.
 */
export const balanceHint = (): string =>
  document.querySelector('.balance-bar-figures')?.textContent ?? '';

export const powerLabel = (): string =>
  screen.getByRole('button', { name: /Turn (On|Off) Pump/ }).textContent ?? '';
