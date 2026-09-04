// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click,
  clickMesh,
  coverState,
  currentStep,
  dismissPopup,
  loadedWeightG,
  powerLabel,
  renderFreshApp,
  stubConfigFetch,
  warning,
  warningText,
} from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The five safety guards (BEDO-002 §4).
 *
 * From BEDO's state-machine document, implemented in `src/App.tsx:22-40`. Every control
 * stays clickable at all times — these are what stop an unsafe action, and they apply in
 * both Free and Guided mode.
 *
 * Each guard is checked four ways, as the task specifies: the invalid action is refused,
 * the state it would have changed is left alone, the documented message is produced, and
 * the same action succeeds once the apparatus is in a state that allows it.
 *
 * Free mode is used throughout so that every control is on the panel at once; the guards
 * themselves are mode-independent, which the last block asserts.
 */

const enterFreeMode = () => click('Free Mode');

/** Opens the tank the way step 1 does — by clicking the plate in the scene. */
const openCover = () => clickMesh('scene-cover');

beforeEach(() => {
  stubConfigFetch();
  renderFreshApp();
  enterFreeMode();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('error 1 — no weights while the tank is open', () => {
  it('refuses the weight, leaves the tray empty, and says why', () => {
    openCover();
    expect(coverState()).toBe('Open');

    click('Add 50 g');

    expect(warningText()).toBe('You can’t add weights while the tank is open.');
    expect(loadedWeightG()).toBe(0);
  });

  it('refuses a weight disc clicked in the 3D scene too', () => {
    openCover();
    clickMesh('scene-weight-100');
    expect(warningText()).toBe('You can’t add weights while the tank is open.');
    expect(loadedWeightG()).toBe(0);
  });

  it('accepts the weight once the tank is closed', () => {
    click('Add 50 g');
    expect(warning()).toBeNull();
    expect(loadedWeightG()).toBe(50);
  });
});

describe('error 2 — the cover has to come off before a deflector goes on', () => {
  it('refuses the selection while the tank is closed, and the lesson does not move', () => {
    click('Guided Mode');
    expect(coverState()).toBe('Closed');

    clickMesh('scene-deflector-180');

    expect(warningText()).toBe('Remove the tank cover first.');
    expect(currentStep()).toBe(1);
    // Step 2 still names the deflector the experiment loaded with.
    openCover();
    expect(screen.getByText(/Drag the Flat surface \(90°\) onto the rod/)).toBeDefined();
  });

  it('accepts the selection once the tank is open', () => {
    // Exp. 2, because it is the one experiment BEDO's sheet gives a genuine choice in —
    // *"Drag the 120° or 180° semi-circular deflector"* — so there is an in-scope
    // selection that actually changes something. This spec used to install the 180° disc
    // while Exp. 1 was loaded and assert that the app took it, which was `BUG-05` written
    // down as an expectation; the deflector's *scope* is now covered by
    // `tests/integration/deflector-scope.spec.tsx` and guard 2 is what is left here.
    click('Experiments');
    click('Exp. 2 — Semi-circular deflector');
    click('Steps');
    click('Guided Mode');
    openCover();

    clickMesh('scene-deflector-120');

    expect(warning()).toBeNull();
    expect(screen.getByText(/Drag the Semi-circular \(120°\) onto the rod/)).toBeDefined();
  });
});

describe('error 3 — the tank stays shut while the pump runs', () => {
  it('refuses to open the cover, and the tank stays closed', () => {
    click(/Turn On Pump/);
    expect(powerLabel()).toContain('Turn Off Pump');

    openCover();

    expect(warningText()).toBe('You can’t open the tank while the power is on.');
    expect(coverState()).toBe('Closed');
  });

  it('opens once the pump is off', () => {
    click(/Turn On Pump/);
    openCover();
    dismissPopup();
    click(/Turn Off Pump/);

    openCover();

    expect(warning()).toBeNull();
    expect(coverState()).toBe('Open');
  });
});

describe('error 4 — the pump stays off while the tank is open', () => {
  it('refuses to start the pump, and the pump stays off', () => {
    openCover();

    click(/Turn On Pump/);

    expect(warningText()).toBe('You can’t turn on the power while the tank is open.');
    expect(powerLabel()).toContain('Turn On Pump');
  });

  it('starts once the tank is closed again', () => {
    openCover();
    click(/Turn On Pump/);
    dismissPopup();
    openCover(); // closes it again

    click(/Turn On Pump/);

    expect(warning()).toBeNull();
    expect(powerLabel()).toContain('Turn Off Pump');
  });

  it('never blocks switching the pump off', () => {
    click(/Turn On Pump/);
    click(/Turn Off Pump/);
    expect(warning()).toBeNull();
    expect(powerLabel()).toContain('Turn On Pump');
  });
});

describe('error 5 — weights come off before the tank is opened', () => {
  it('refuses to open the cover while the tray is loaded', () => {
    click('Add 100 g');
    expect(loadedWeightG()).toBe(100);

    openCover();

    expect(warningText()).toBe('Remove all weights first before opening the tank.');
    expect(coverState()).toBe('Closed');
    expect(loadedWeightG()).toBe(100);
  });

  it('opens once the tray is cleared', () => {
    click('Add 100 g');
    openCover();
    dismissPopup();
    click('Clear pan');

    openCover();

    expect(warning()).toBeNull();
    expect(coverState()).toBe('Open');
  });
});

describe('guard precedence and behaviour', () => {
  it('reports the running pump before the loaded tray', () => {
    // Both conditions hold; App checks power first, and the message must match.
    click('Add 100 g');
    click(/Turn On Pump/);

    openCover();

    expect(warningText()).toBe('You can’t open the tank while the power is on.');
  });

  it('clears the previous warning when the next action is legal', () => {
    openCover();
    click(/Turn On Pump/);
    expect(warning()).not.toBeNull();

    openCover(); // closing the tank is always allowed

    expect(warning()).toBeNull();
    expect(coverState()).toBe('Closed');
  });

  it('is dismissible, and dismissing it changes nothing else', () => {
    openCover();
    click('Add 50 g');
    expect(warning()).not.toBeNull();

    dismissPopup();

    expect(warning()).toBeNull();
    expect(coverState()).toBe('Open');
    expect(loadedWeightG()).toBe(0);
  });

  it('applies in guided mode as well as free mode', () => {
    click('Guided Mode');
    // Step 1 asks for the cover; opening it is legal and advances the lesson.
    openCover();
    expect(coverState()).toBe('Open');

    // Adding a weight is not part of step 2, but it is the guard that refuses it.
    clickMesh('scene-weight-50');

    expect(warningText()).toBe('You can’t add weights while the tank is open.');
    expect(loadedWeightG()).toBe(0);
  });
});

describe('the guard messages are bilingual', () => {
  it('shows the Arabic text when the lesson is in Arabic', () => {
    click('العربية');
    openCover();
    clickMesh('scene-weight-50');

    expect(warningText()).toBe('لا يمكن إضافة الأوزان أثناء فتح الخزان.');
  });
});
