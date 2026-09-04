// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setValve,
  balanceHint,
  click,
  clickMesh,
  coverState,
  loadedWeightG,
  renderApp,
  stubConfigFetch,
  walkLesson,
} from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * That React observes the runtime rather than keeping its own copy (BEDO-008 §27, §28).
 *
 * The failure this guards against is subtle and expensive: a migration that leaves two
 * authoritative copies of the same field, drifting apart in the cases nobody clicks. So
 * rather than inspecting internals, these drive the UI and check that the rig's condition
 * and everything derived from it stay consistent across the seams — the panel, the 3D
 * scene, the results table and the monitor all agreeing because they read one source.
 */

beforeEach(() => {
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('one source of truth', () => {
  it('a 3D click and a panel click move the same rig', () => {
    // The cover has no DOM control; the scene drives it. The panel's status line reads
    // the same state back.
    click('Free Mode');
    expect(coverState()).toBe('Closed');

    clickMesh('scene-cover');
    expect(coverState()).toBe('Open');

    clickMesh('scene-cover');
    expect(coverState()).toBe('Closed');
  });

  it('weights added from the scene and from the panel land on one tray', () => {
    click('Free Mode');
    clickMesh('scene-weight-100'); // 3D
    click('Add 50 g'); //                 panel
    expect(loadedWeightG()).toBe(150);

    click('Clear pan');
    expect(loadedWeightG()).toBe(0);
  });

  it('the balance readout follows the tray without a second copy of the weights', () => {
    walkLesson(1, 5); // through to the first balance step
    click('Add 50 g');
    expect(screen.getByText('Unbalanced')).toBeDefined();
    expect(balanceHint()).toMatch(/add 34 g/);
    click('Add 20 g');
    click('Add 10 g');
    expect(screen.getByText('Pointer balanced')).toBeDefined();
  });

  it('a refused action changes nothing anywhere', () => {
    click('Free Mode');
    click(/Turn On Pump/);
    const before = coverState();

    clickMesh('scene-cover'); // refused: the pump is running

    expect(coverState()).toBe(before);
    expect(document.querySelector('.warning-popup')?.textContent).toContain(
      'You can’t open the tank while the power is on.'
    );
  });

  it('the monitor reads the same readings the panel is balancing', () => {
    walkLesson(1, 10);
    const rows = [...document.querySelectorAll('.data-table tbody tr')];
    const mass = (row: number) => rows[row].querySelectorAll('td')[5].textContent;
    expect(rows).toHaveLength(2);
    expect(mass(0)).toBe('80');
    expect(mass(1)).toBe('260');
  });

  it('reset returns the rig, the lesson and the table together', () => {
    walkLesson(1, 5);
    click('Add 50 g');
    expect(loadedWeightG()).toBe(50);

    click('Reset simulator');

    expect(document.querySelector('.step-badge')?.textContent).toBe('Step 1 / 11');
    expect(coverState()).toBe('Closed');
    // The table is derived from the recorded readings, so it empties with the rig rather
    // than needing its own clear — and an empty table now prints nothing at all.
    click('Free Mode');
    click('Open Data Monitor');
    expect(document.querySelectorAll('.data-table tbody tr td[colspan]')).toHaveLength(1);
  });

  it('switching experiment reloads the rig and the readings', () => {
    walkLesson(1, 5);
    click('Add 50 g');

    click('Experiments');
    click('Exp. 3 — Conical surface deflector');
    click('Steps');

    expect(document.querySelector('.step-badge')?.textContent).toBe('Step 1 / 11');
    expect(coverState()).toBe('Closed');
    // The conical sheet's deflector is on the rod, so step 2 names it.
    clickMesh('scene-cover');
    expect(screen.getByText(/Drag the Conical surface \(135°\) onto the rod/)).toBeDefined();
  });

  it('the pump-flow parameter reaches the physics through the runtime', () => {
    click('Free Mode');
    click('Parameters');
    const slider = [...document.querySelectorAll('input[type="range"]')].find((input) =>
      (input as HTMLInputElement).max === '200'
    ) as HTMLInputElement;

    // 60 L/min is half the default, so every flow figure halves.
    fireEvent.change(slider, { target: { value: '60' } });

    click('Steps');
    click(/Turn On Pump/);
    setValve(0.4);
    click('Open Data Monitor');
    // Read from the live panel rather than the table: the table now holds only readings
    // the student recorded, and this is a question about the physics, not about recording.
    const q = Array.from(document.querySelectorAll('.mon-cell')).find(
      (el) => el.querySelector('.mon-lbl')?.textContent?.trim() === 'Q'
    );
    expect(q?.querySelector('.mon-val')?.textContent).toContain('7.857'); // 15.714 / 2
  });
});
