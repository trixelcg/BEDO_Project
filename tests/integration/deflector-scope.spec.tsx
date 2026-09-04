// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click,
  clickMesh,
  clickOk,
  currentStep,
  dismissPopup,
  loadedWeightG,
  okButton,
  renderApp,
  setValve,
  stubConfigFetch,
  walkLesson,
  warningText,
} from '../helpers/app-harness';

import { SECOND_READING_VALVE } from '../../src/domain/physics';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * BUG-05 and individual weight removal, in the running app (BEDO-022).
 *
 * > Exp. 1 silently runs with k = 2.0 while every label says F = ρAV².
 *
 * The panel scoped the deflector list to the loaded experiment by rendering a shorter
 * list. The 3D tray carries all seven discs whatever sheet is open, so it could not, and
 * nothing else did — the same shape as `BUG-04`, one layer down: `BEDO-020` made the gate
 * ask *"may I touch the deflectors?"*, and this is *"which one?"*.
 */

const openExperiment = (name: string) => {
  click('Experiments');
  click(name);
  click('Steps');
};

/** The pan's live total, as the panel reports it. Only visible where the panel shows it. */
const pan = () => loadedWeightG();

/**
 * The discs on the holder, counted in the scene.
 *
 * Independent of the panel, which hides the whole weights card — the total included — at
 * a guided step that is not about the pan.
 */
const discsInScene = () => screen.queryAllByTestId(/^scene-loaded-weight-/).length;

beforeEach(() => {
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BUG-05 — the tray cannot install another experiment’s deflector', () => {
  it('refuses the 180° hemisphere while Exp. 1 is loaded, and says why', () => {
    clickMesh('scene-cover'); // step 1 → 2, the deflector step
    expect(currentStep()).toBe(2);

    clickMesh('scene-deflector-180');

    expect(warningText()).toBe('This experiment uses a different deflector.');
    // Still Exp. 1's own plate, so the physics still matches the printed formula.
    expect(screen.getByText(/Drag the Flat surface \(90°\) onto the rod/)).toBeDefined();
    expect(currentStep()).toBe(2);
  });

  it('refuses every out-of-scope disc on the tray, not just one', () => {
    clickMesh('scene-cover');
    for (const angle of [30, 45, 60, 120, 135, 180]) {
      clickMesh(`scene-deflector-${angle}`);
      expect(warningText(), `${angle}°`).toBe('This experiment uses a different deflector.');
      dismissPopup();
      expect(screen.getByText(/Drag the Flat surface \(90°\) onto the rod/)).toBeDefined();
    }
  });

  it('accepts the disc the sheet names', () => {
    clickMesh('scene-cover');
    clickMesh('scene-deflector-90');

    expect(warningText()).toBeNull();
    expect(currentStep()).toBe(2);
    clickOk();
    expect(currentStep()).toBe(3);
  });

  it('honours the two angles Exp. 2’s sheet offers, and refuses the rest', () => {
    // "Drag the 120° or 180° semi-circular deflector" — a genuine choice, so the scope is
    // a set and not a single required id.
    openExperiment('Exp. 2 — Semi-circular deflector');
    clickMesh('scene-cover');

    clickMesh('scene-deflector-120');
    expect(warningText()).toBeNull();
    expect(screen.getByText(/Drag the Semi-circular \(120°\) onto the rod/)).toBeDefined();

    clickMesh('scene-deflector-180');
    expect(warningText()).toBeNull();
    expect(screen.getByText(/Drag the Semi-circular \(180°\) onto the rod/)).toBeDefined();

    clickMesh('scene-deflector-90');
    expect(warningText()).toBe('This experiment uses a different deflector.');
  });

  it('reaches a force that matches the experiment’s own formula', () => {
    // The end of the BUG-05 path: run Exp. 1 through to the table and check the number.
    // F_th at n = 0.4 with k = 1.0 is 0.8199 N; with the 180° disc it would read 1.6398.
    clickMesh('scene-cover');
    clickMesh('scene-deflector-180'); // refused
    dismissPopup();
    walkLesson(2, 9);

    // Row 1 is now the first reading itself, not the generated zero row above it.
    const cells = [...document.querySelectorAll('.data-table tbody tr')][0]?.querySelectorAll('td');
    expect(cells?.[6].textContent).toBe('0.8199');
  });

  it('keeps the panel and the tray offering the same discs', () => {
    // Neither surface may offer what the other refuses. The panel used to be the only one
    // that knew.
    clickMesh('scene-cover');
    expect(screen.getByRole('button', { name: 'Flat surface (90°)' })).toBeDefined();
    for (const name of ['Semi-circular (180°)', 'Conical surface (135°)', 'Oblique surface (45°)']) {
      expect(screen.queryByRole('button', { name }), name).toBeNull();
    }
  });
});

describe('free mode explores, and says what is installed', () => {
  beforeEach(() => click('Free Mode'));

  it('allows any deflector on the rod', () => {
    clickMesh('scene-cover');
    clickMesh('scene-deflector-180');
    expect(warningText()).toBeNull();
  });

  it('offers all seven on the panel, so the installed one is never hidden', () => {
    // BEDO-022 §5: free mode may diverge from the sheet, but not silently. In guided mode
    // the panel showed one disc and the tray seven; now each mode shows the same set on
    // both surfaces, and the selected disc is always among them.
    clickMesh('scene-cover');
    for (const name of [
      'Flat surface (90°)',
      'Semi-circular (120°)',
      'Semi-circular (180°)',
      'Conical surface (135°)',
      'Oblique surface (30°)',
      'Oblique surface (45°)',
      'Oblique surface (60°)',
    ]) {
      expect(screen.getByRole('button', { name }), name).toBeDefined();
    }
  });
});

describe('the lesson will not confirm a mismatched deflector', () => {
  it('withholds OK after free-mode exploration leaves the wrong disc on the rod', () => {
    // The one route the gate does not cover, because in free mode there is nothing to
    // refuse: explore, install the hemisphere, then go back to the guided procedure.
    click('Free Mode');
    clickMesh('scene-cover');
    clickMesh('scene-deflector-180');
    click('Guided Mode');

    clickMesh('scene-cover'); // the tank is already open, so this closes it…
    dismissPopup();
    expect(currentStep()).toBe(1);
  });
});

describe('taking one disc off the holder', () => {
  const reachBalanceStep = () => {
    walkLesson(1, 5);
    expect(currentStep()).toBe(6);
  };

  it('removes only the disc that was clicked, from the panel', () => {
    reachBalanceStep();
    click('Add 50 g');
    click('Add 20 g');
    expect(pan()).toBe(70);

    click('Remove 50 g');

    expect(pan()).toBe(20);
  });

  it('removes only the disc that was clicked, from the scene', () => {
    reachBalanceStep();
    click('Add 50 g');
    click('Add 20 g');

    clickMesh('scene-loaded-weight-0'); // the 50 g disc, at the bottom of the stack

    expect(pan()).toBe(20);
  });

  it('takes exactly one of two identical discs', () => {
    reachBalanceStep();
    click('Add 50 g');
    click('Add 50 g');
    expect(pan()).toBe(100);

    clickMesh('scene-loaded-weight-1');

    expect(pan()).toBe(50);
  });

  it('lets the learner correct an overload and go on to balance', () => {
    // The recovery the gate has to allow: overshoot the 80 g target, take the excess off,
    // and finish the step.
    reachBalanceStep();
    click('Add 200 g');
    click('Add 50 g');
    expect(okButton()).toBeNull();

    click('Remove 200 g');
    click('Add 20 g');
    click('Add 10 g');

    expect(pan()).toBe(80);
    expect(screen.getByText('Pointer balanced')).toBeDefined();
    clickOk();
    dismissPopup();
    expect(currentStep()).toBe(7);
  });

  it('keeps clear-all working alongside it', () => {
    reachBalanceStep();
    click('Add 50 g');
    click('Add 20 g');
    click('Clear pan');
    expect(pan()).toBe(0);
  });

  it('disables, rather than hides, the remove buttons when the pan is empty', () => {
    // The panel's layout is fixed now: every denomination keeps its row whatever is on the
    // pan, because a row that appears on the first click moves every button under the
    // pointer. So the minus is present and disabled rather than absent.
    reachBalanceStep();
    const remove50 = screen.getByRole('button', { name: 'Remove 50 g' }) as HTMLButtonElement;
    expect(remove50.disabled).toBe(true);

    click('Add 50 g');
    expect((screen.getByRole('button', { name: 'Remove 50 g' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('does not disturb a reading that is already recorded', () => {
    // Reading 1 is settled at 80 g. Taking a disc off *during reading 2* must not touch
    // it — recorded rows are snapshots (BEDO-022 §19). The pan is cumulative, so it still
    // carries reading 1's 80 g throughout.
    walkLesson(1, 6);
    expect(currentStep()).toBe(7);
    setValve(SECOND_READING_VALVE);
    clickOk();
    dismissPopup();
    expect(currentStep()).toBe(8);

    click('Add 500 g');
    click('Remove 500 g'); // a wrong disc, taken back off
    expect(pan()).toBe(80);

    click('Add 100 g');
    click('Add 50 g');
    click('Add 20 g');
    click('Add 10 g');
    clickOk();
    dismissPopup();
    click('Open Data Monitor');

    const rows = [...document.querySelectorAll('.data-table tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('td')[5].textContent).toBe('80'); // reading 1, intact
    expect(rows[1].querySelectorAll('td')[5].textContent).toBe('260'); // reading 2
  });

  it('is refused at a step that is not about the pan', () => {
    // The guided procedure clears the holder between readings, so the reachable way to
    // stand at a non-weight step with discs loaded is to load them in free mode first.
    click('Free Mode');
    click('Add 50 g');
    click('Add 20 g');
    expect(pan()).toBe(70);
    click('Guided Mode');
    expect(currentStep()).toBe(1); // step 1 is about the cover
    expect(discsInScene()).toBe(2);

    clickMesh('scene-loaded-weight-0');

    expect(warningText()).toBe('Follow the highlighted step first.');
    expect(discsInScene()).toBe(2);
  });
});
