// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, renderApp, setValve, stubConfigFetch, walkLesson } from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The Board view (BEDO-UX-14B).
 *
 * The printed board carries the live experiment values, but the guided step framings are
 * composed around the apparatus and the board is out of shot at every working step —
 * measured: in frame at step 1 only. Rather than widen those approved compositions, a
 * secondary utility parks the camera at the board and puts it back.
 *
 * It is a camera and interface change and nothing else, so what is pinned here is mostly
 * what must *not* happen: the lesson does not move, the rig does not change, and the
 * readings do not change.
 */

const cameraView = (): string =>
  document.querySelector('[data-bedo-camera-view]')?.getAttribute('data-bedo-camera-view') ?? '';

const stepNow = (): number =>
  Number(/(\d+)/.exec(document.querySelector('.step-badge')?.textContent ?? '')?.[1] ?? 0);

const loadedMass = (): number =>
  Number(
    document.querySelector('[data-bedo-loaded-weight]')?.getAttribute('data-bedo-loaded-weight') ??
      NaN
  );

const tableRow = (oneBased: number): string[] =>
  Array.from(
    document.querySelectorAll('.data-table tbody tr')[oneBased - 1]?.querySelectorAll('td') ?? []
  ).map((td) => td.textContent?.trim() ?? '');

beforeEach(() => {
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // No storage in this environment; nothing to clear.
  }
  vi.restoreAllMocks();
});

describe('the Board view', () => {
  it('is offered at the flow step', () => {
    walkLesson(1, 4);
    expect(screen.getByRole('button', { name: /^Board$/ })).toBeDefined();
  });

  it('is offered at the weight step', () => {
    walkLesson(1, 5);
    expect(screen.getByRole('button', { name: /^Board$/ })).toBeDefined();
  });

  it('sends the camera to the board without moving the lesson on', () => {
    walkLesson(1, 4);
    const before = stepNow();
    expect(cameraView()).not.toBe('board');

    click(/^Board$/);
    expect(cameraView(), 'the camera is parked at the board').toBe('board');
    expect(stepNow(), 'the lesson must not advance').toBe(before);
  });

  it('leaves the tray exactly as it was', () => {
    walkLesson(1, 5);
    click('+50g');
    const mass = loadedMass();

    click(/^Board$/);
    expect(loadedMass()).toBe(mass);
    click(/Back to Step/);
    expect(loadedMass()).toBe(mass);
  });

  it('leaves the valve exactly as it was', () => {
    // Read at the flow step: each guided step renders only its own control, so the slider
    // does not exist at the weight step.
    walkLesson(1, 4);
    setValve(0.35);
    const valve = () =>
      (document.querySelector('.valve-slider-container input[type="range"]') as HTMLInputElement)
        .value;
    const before = valve();

    click(/^Board$/);
    click(/Back to Step/);
    expect(valve()).toBe(before);
  });

  it('restores the current step framing on the way back', () => {
    walkLesson(1, 4);
    const stepFraming = cameraView();
    click(/^Board$/);
    expect(cameraView()).toBe('board');
    click(/Back to Step/);
    expect(cameraView(), 'the step gets its own framing back').toBe(stepFraming);
    expect(stepNow()).toBe(5);
  });

  it('returns to the step on Escape', () => {
    walkLesson(1, 4);
    const stepFraming = cameraView();
    click(/^Board$/);
    expect(cameraView()).toBe('board');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(cameraView()).toBe(stepFraming);
  });

  it('leaves recorded readings untouched', () => {
    walkLesson(1, 8);
    const recorded = tableRow(2);
    click(/^Board$/);
    click(/Back to Step/);
    expect(tableRow(2)).toEqual(recorded);
  });

  it('closes the docked board while focusing the panel, and restores it after', () => {
    walkLesson(1, 4);
    click(/Open Data Monitor/i);
    expect(document.querySelector('.monitor-docked')).not.toBeNull();

    // Nothing may compete with the panel being read.
    click(/^Board$/);
    expect(document.querySelector('.monitor-docked')).toBeNull();

    click(/Back to Step/);
    expect(document.querySelector('.monitor-docked'), 'the dock comes back').not.toBeNull();
  });

  it('does not reopen a dock that was never open', () => {
    walkLesson(1, 4);
    click(/^Board$/);
    click(/Back to Step/);
    expect(document.querySelector('.monitor-docked')).toBeNull();
  });

  it('is labelled in Arabic', () => {
    walkLesson(1, 4);
    click('العربية');
    expect(screen.getByRole('button', { name: /^اللوحة$/ })).toBeDefined();
    click(/^اللوحة$/);
    expect(cameraView()).toBe('board');
    expect(screen.getByRole('button', { name: /العودة للخطوة/ })).toBeDefined();
  });
});
