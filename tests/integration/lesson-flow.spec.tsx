// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOTAL_STEPS } from '../../src/domain/experiments';
import {
  click,
  clickMesh,
  coverState,
  clickOk,
  currentStep,
  expectStep,
  loadedWeightG,
  okButton,
  renderApp,
  setValve,
  stubConfigFetch,
  walkLesson as walk,
  warning,
} from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The current twelve-step lesson, end to end in jsdom (BEDO-002 §6).
 *
 * This is the fast, deterministic twin of the Playwright walkthrough: same engine, same
 * transitions, no browser. Playwright then proves the same path works against a real
 * page; this proves it step by step, and is where a regression is diagnosed.
 *
 * The step count is deliberately pinned at today's twelve. The reference material
 * describes eleven instructional steps, and reconciling the two is tracked separately
 * (docs/23, BEDO-041) — BEDO-002 protects what ships today.
 */

beforeEach(() => {
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the guided lesson', () => {
  it('starts on step 1 of 12, in guided mode, with the rig at rest', () => {
    expect(document.querySelector('.step-badge')?.textContent).toBe(`Step 1 / ${TOTAL_STEPS}`);
    expectStep(1, 'Unscrew the upper plate');
    expect(loadedWeightG()).toBe(0);
    expect(warning()).toBeNull();
  });

  it('completes all twelve steps and reaches the closing question', () => {
    walk(1, 11);

    expectStep(12, 'You finished!');

    // The monitor is open, F_ac has been recorded, and the quiz is answerable.
    const question = screen.getByText('If the flow velocity doubles, how does the force change?');
    expect(question).toBeDefined();

    click('It quadruples');
    expect(screen.getByText(/Correct\./)).toBeDefined();
    expect(
      screen.getByText(/Force is proportional to the square of the velocity/)
    ).toBeDefined();
  });

  it('records exactly the two readings the student balanced', () => {
    walk(1, 11);

    const rows = [...document.querySelectorAll('.data-table tbody tr')];
    expect(rows).toHaveLength(4);

    const massCell = (row: Element) => row.querySelectorAll('td')[5].textContent;
    expect(massCell(rows[0])).toBe('0'); // closed-valve row
    expect(massCell(rows[1])).toBe('80'); // reading 1, n = 0.4
    expect(massCell(rows[2])).toBe('260'); // reading 2, n = 0.5
    expect(massCell(rows[3])).toBe('0'); // untaken row

    // F_th for the flat plate at n = 0.4 and n = 0.5, from BEDO's model.
    const theoreticalForceN = (row: Element) => Number(row.querySelectorAll('td')[6].textContent);
    expect(theoreticalForceN(rows[1])).toBeCloseTo(0.8199, 4);
    expect(theoreticalForceN(rows[2])).toBeCloseTo(2.5303, 4);

    // F_ac is the loaded mass x g, and only appears after Calculate.
    const fac = (row: Element) => Number(row.querySelectorAll('td')[7].textContent);
    expect(fac(rows[1])).toBeCloseTo(0.7848, 4);
    expect(fac(rows[2])).toBeCloseTo(2.5506, 4);
  });
});

describe('the progression rules the lesson enforces', () => {
  it('will not confirm step 2 until the tank is actually open', () => {
    expect(okButton()).toBeNull();
    clickMesh('scene-cover');
    expectStep(2, 'Install the deflector');
    expect(okButton()).not.toBeNull();
  });

  it('will not confirm step 5 until the volumetric valve is open', () => {
    walk(1, 4);
    expectStep(5, 'Volumetric valve');
    expect(okButton()).toBeNull();

    click('Open volumetric valve');
    expect(okButton()).not.toBeNull();
  });

  it('will not confirm step 6 until the valve reaches the reading setpoint', () => {
    walk(1, 5);
    expectStep(6, 'Adjust the flow valve');

    setValve(0.1);
    expect(okButton()).toBeNull();

    setValve(0.38); // inside the snap margin
    expect(okButton()).not.toBeNull();
    expect(screen.getByText('40%')).toBeDefined(); // snapped to the setpoint
  });

  it('will not confirm a balance step until the pointer is actually balanced', () => {
    walk(1, 6);
    expectStep(7, 'Balance the pointer (reading 1)');

    expect(screen.getByText(/Unbalanced \(target ≈ 80 g\)/)).toBeDefined();
    expect(okButton()).toBeNull();

    click('+50g');
    expect(okButton()).toBeNull();

    click('+20g');
    click('+10g');
    expect(screen.getByText('Pointer balanced!')).toBeDefined();
    expect(okButton()).not.toBeNull();
  });

  it('clears the tray between the two readings', () => {
    walk(1, 7);
    expectStep(8, 'Increase the flow rate');
    expect(loadedWeightG()).toBe(0);
  });

  it('asks for a heavier balance at the higher flow', () => {
    walk(1, 8);
    expectStep(9, 'Balance the pointer (reading 2)');
    expect(screen.getByText(/Unbalanced \(target ≈ 260 g\)/)).toBeDefined();

    // The reading-1 mass is no longer enough now the flow has been increased.
    click('+50g');
    click('+20g');
    click('+10g');
    expect(okButton()).toBeNull();
  });

  it('does not advance when the pump is switched off again', () => {
    walk(1, 4);
    expectStep(5, 'Volumetric valve');

    // The panel only shows the step-5 control, so the pump is switched off the way a
    // student would at that point: by clicking the switch on the rig.
    clickMesh('scene-power');
    // Power off is legal, but it is not the step 5 action, so the lesson holds.
    expect(currentStep()).toBe(5);
  });

  it('refuses to open the valve before the pump is running', () => {
    // Free mode reaches the valve without the guided sequence.
    click('Free Mode');
    setValve(0.5);

    expect(document.querySelector('.warning-popup')?.textContent).toContain(
      'Turn on the power switch before opening the valve.'
    );
    expect(screen.getByText('0%')).toBeDefined();
  });
});

describe('the observations the experiment sheets specify', () => {
  it('raises the jet-push notice when the flow valve is first set', () => {
    walk(1, 5);
    setValve(0.4);
    clickOk();

    expect(document.querySelector('.warning-popup')?.textContent).toContain(
      'the water jet pushes the deflector upward'
    );
  });

  it('raises the impingement notice after the first balance', () => {
    walk(1, 6);
    click('+50g');
    click('+20g');
    click('+10g');
    clickOk();

    expect(document.querySelector('.warning-popup')?.textContent).toContain(
      'shape of water impinging the deflector'
    );
  });

  it('raises no notice in free mode', () => {
    click('Free Mode');
    click(/Turn On Pump/);
    setValve(0.4);
    expect(warning()).toBeNull();
  });
});

describe('reset', () => {
  it('returns the lesson to step 1 with the rig at rest', () => {
    walk(1, 6);
    click('+50g');
    expect(loadedWeightG()).toBe(50);

    click('Reset simulator');

    expectStep(1, 'Unscrew the upper plate');
    expect(loadedWeightG()).toBe(0);
    expect(coverState()).toBe('Closed');
    // Step 1 shows no controls other than the plate in the scene, so the pump button is
    // gone again too.
    expect(screen.queryByRole('button', { name: /Turn (On|Off) Pump/ })).toBeNull();
  });
});
