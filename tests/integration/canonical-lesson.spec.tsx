// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click,
  clickMesh,
  clickOk,
  currentStep,
  dismissPopup,
  renderApp,
  setValve,
  stubConfigFetch,
  walkLesson,
} from '../helpers/app-harness';
import { fireEvent } from '@testing-library/react';
import { CURRENT_LESSON } from '../../src/lesson/currentLesson';
import { TOTAL_STEPS } from '../../src/domain/experiments';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The canonical structure, as a learner meets it (BEDO-019).
 *
 * Three things this migration must not have broken, each of which a future "cleanup"
 * could plausibly undo:
 *
 *   - the volumetric valve is gone from the *procedure*, not from the *rig*
 *   - the assessment survives, outside the numbered flow
 *   - the lesson ends at eleven, with a completion state rather than a twelfth step
 */

beforeEach(() => {
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the volumetric valve is an affordance, not a step', () => {
  it('has no numbered step', () => {
    expect(CURRENT_LESSON.steps.map((s) => s.id)).not.toContain('open-volumetric-valve');
    expect(CURRENT_LESSON.steps.some((s) => s.highlight.includes('volumetricValve'))).toBe(false);
  });

  it('is still on the panel, at every step', () => {
    // BEDO's state machine gives it a transition in every state: it turns, and nothing
    // changes. Removing the step must not remove the control.
    expect(CURRENT_LESSON.alwaysAvailable).toContain('volumetricValve');
    expect(screen.getByRole('button', { name: 'Open volumetric valve' })).toBeDefined();

    walkLesson(1, 3);
    expect(screen.getByRole('button', { name: 'Open volumetric valve' })).toBeDefined();
  });

  it('still works — the rig responds', () => {
    click('Open volumetric valve');
    expect(screen.getByRole('button', { name: 'Volumetric valve open' })).toBeDefined();
  });

  it('is still clickable in the 3D scene', () => {
    clickMesh('scene-volumetric-valve');
    expect(screen.getByRole('button', { name: 'Volumetric valve open' })).toBeDefined();
  });

  it('does not advance the lesson on its own', () => {
    // The heart of the change: operating it is legal and inert, exactly as the state
    // machine specifies. It must not push the learner forward.
    expect(currentStep()).toBe(1);
    click('Open volumetric valve');
    expect(currentStep()).toBe(1);

    walkLesson(1, 4);
    expect(currentStep()).toBe(5);
    click('Volumetric valve open'); // close it
    click('Open volumetric valve'); // and open it again
    expect(currentStep()).toBe(5);
  });
});

describe('the assessment survives, unnumbered', () => {
  it('is not a step', () => {
    const ids: string[] = CURRENT_LESSON.steps.map((s) => s.id);
    expect(ids).not.toContain('assessment');
    // No step expects the learner to answer a question: the type union no longer even has
    // the expectation, which is the strongest form of the guarantee.
    const expectations = CURRENT_LESSON.steps
      .map((s) => s.expectation?.type)
      .filter((type) => type !== undefined) as string[];
    expect(expectations).not.toContain('ANSWER_QUESTION');
  });

  it('is reachable once the actual force is recorded, and still marks answers', () => {
    walkLesson(1, 10);

    expect(
      screen.getByText('If the flow velocity doubles, how does the force change?')
    ).toBeDefined();
    click('It quadruples');
    expect(screen.getByText(/Correct\./)).toBeDefined();
  });

  it('answering does not disturb the step numbering', () => {
    walkLesson(1, 10);
    expect(currentStep()).toBe(11);
    click('It quadruples');
    expect(currentStep()).toBe(11);
  });
});

describe('the lesson ends at eleven', () => {
  it('counts eleven steps everywhere a learner can see', () => {
    expect(TOTAL_STEPS).toBe(11);
    expect(CURRENT_LESSON.steps).toHaveLength(11);
    expect(document.querySelector('.step-badge')?.textContent).toBe('Step 1 / 11');
  });

  it('has no twelfth step, real or implied', () => {
    walkLesson(1, 10);
    expect(document.querySelector('.step-badge')?.textContent).toBe('Step 11 / 11');
    expect(CURRENT_LESSON.steps.map((s) => s.displayNumber)).not.toContain(12);
  });

  it('closes by opening the answer sheet, and says so', () => {
    walkLesson(1, 10);
    expect(screen.getByRole('heading', { name: 'You finished!' })).toBeDefined();

    click('Open the answer sheet');

    const sheet = screen.getByTestId('answer-sheet');
    expect(sheet).toBeDefined();
    expect(sheet.querySelector('iframe')?.getAttribute('src')).toBe('/answer-sheets/flat.pdf');
  });

  it('reaches a completion state without inventing a step', () => {
    walkLesson(1, 10);
    expect(screen.queryByTestId('lesson-complete')).toBeNull();

    click('Open the answer sheet');

    expect(screen.getByTestId('lesson-complete')).toBeDefined();
    expect(currentStep()).toBe(11); // still eleven — completion is a state, not a step
  });

  it('lets the learner close the sheet and get back', () => {
    // The walkthrough video modal cannot be closed (`docs/28 §11`); this surface must not
    // repeat that. It renders outside `.ui-container`, so it never inherits the problem.
    walkLesson(1, 10);
    click('Open the answer sheet');
    expect(screen.getByTestId('answer-sheet')).toBeDefined();

    // Scoped: the software monitor is open behind the sheet and has a Close of its own.
    fireEvent.click(within(screen.getByTestId('answer-sheet')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('answer-sheet')).toBeNull();
    expect(screen.getByTestId('lesson-complete')).toBeDefined();
  });

  it('opens each experiment’s own sheet', () => {
    // Exp. 2 runs the 180 deg deflector, whose momentum factor is 2.0, so it balances at
    // twice the flat plate's masses — the shared walk's weights would not balance it.
    click('Experiments');
    click('Exp. 2 — Semi-circular deflector');
    click('Steps');

    clickMesh('scene-cover'); //        1 unscrew
    clickOk(); //                       2 install
    clickMesh('scene-cover'); //        3 mount
    click(/Turn On Pump/); //           4 power
    setValve(0.4); //                   5 flow
    clickOk();
    dismissPopup();
    click('Add 100 g'); //                  6 balance 1 — needs 167.2 g, 170 g is inside
    click('Add 50 g');
    click('Add 20 g');
    clickOk();
    dismissPopup();
    setValve(0.5); //                   7 flow again
    clickOk();
    dismissPopup();
    // 8 balance 2 — needs 515.9 g in total, and the pan already carries 170 g.
    click('Add 200 g');
    click('Add 100 g');
    click('Add 50 g');
    clickOk();
    dismissPopup();
    click('Open Data Monitor'); //      9 monitor
    click(/^Calculate$/); //           10 record
    dismissPopup();

    expect(currentStep()).toBe(11);
    click('Open the answer sheet');
    expect(
      screen.getByTestId('answer-sheet').querySelector('iframe')?.getAttribute('src')
    ).toBe('/answer-sheets/semi.pdf');
  });

  it('resets to step 1 of 11', () => {
    walkLesson(1, 10);
    click('Open the answer sheet');
    fireEvent.click(within(screen.getByTestId('answer-sheet')).getByRole('button', { name: 'Close' }));

    click('Reset simulator');

    expect(document.querySelector('.step-badge')?.textContent).toBe('Step 1 / 11');
    expect(screen.queryByTestId('lesson-complete')).toBeNull();
  });
});
