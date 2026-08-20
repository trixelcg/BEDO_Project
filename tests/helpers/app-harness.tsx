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

export const renderApp = (): RenderResult => render(<App />);

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

/** The guided panel's confirm button, distinct from a popup's own OK. */
export const okButton = () => document.querySelector('.ok-confirm-btn');

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
  const row = [...sidebar().querySelectorAll('div')].find((d) =>
    d.textContent?.startsWith('Tank cover:')
  );
  return row?.textContent?.includes('Open') ? 'Open' : 'Closed';
};

export const loadedWeightG = (): number => {
  const row = [...sidebar().querySelectorAll('div')].find((d) =>
    d.textContent?.startsWith('Added weights:')
  );
  const match = row?.textContent?.match(/(\d+)\s*g/);
  return match ? Number(match[1]) : 0;
};

/**
 * Walks the guided lesson from `from` up to and including `to`, asserting the step number
 * before each action. Shared by the lesson-flow spec and the export-contract spec so
 * there is exactly one description of how the lesson is driven.
 */
export const walkLesson = (from: number, to: number) => {
  const actions: Record<number, () => void> = {
    1: () => clickMesh('scene-cover'),
    2: () => clickOk(),
    3: () => clickMesh('scene-cover'),
    4: () => click(/Turn On Pump/),
    5: () => {
      click('Open volumetric valve');
      clickOk();
    },
    6: () => {
      setValve(0.4);
      clickOk();
    },
    7: () => {
      click('+50g');
      click('+20g');
      click('+10g');
      clickOk();
    },
    8: () => {
      setValve(0.5);
      clickOk();
    },
    9: () => {
      click('+200g');
      click('+50g');
      click('+10g');
      clickOk();
    },
    10: () => click('Open Data Monitor'),
    11: () => click(/^Calculate$/),
  };

  for (let step = from; step <= to; step++) {
    expect(currentStep(), `expected to start step ${step}`).toBe(step);
    actions[step]();
    dismissPopup();
  }
};

export const powerLabel = (): string =>
  screen.getByRole('button', { name: /Turn (On|Off) Pump/ }).textContent ?? '';
