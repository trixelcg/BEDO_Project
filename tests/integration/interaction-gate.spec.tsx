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
  renderApp,
  setValve,
  stubConfigFetch,
  walkLesson,
  warningText,
} from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * BUG-04, and the gate that closes it (BEDO-020).
 *
 * > Guided UI respects lesson progression, but 3D hotspots can still dispatch apparatus
 * > actions outside the current lesson step.
 *
 * The panel enforced the lesson by *not rendering* the wrong buttons. That is a
 * presentation choice standing in for a rule, and the scene — which cannot hide a rig —
 * had no equivalent, so every hotspot dispatched at every step. The two surfaces run
 * through `App`'s handlers, and the mock scene here calls exactly the handlers the real
 * `DeviceModel` hotspots call, which is what makes the parity claim testable in jsdom.
 *
 * These specs are about *decisions*, not pixels: what the rig does, what the lesson does,
 * and whether the two surfaces agree.
 */

/** The volumetric valve's panel button says which way it is. */
const volumetricValveIsOpen = () =>
  screen.queryByRole('button', { name: 'Volumetric valve open' }) !== null;

const valvePercent = (): number => {
  const readout = document.querySelector('.valve-slider-container .slider-val');
  return readout ? Number(readout.textContent?.replace('%', '')) : 0;
};

beforeEach(() => {
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BUG-04 — a 3D hotspot cannot run ahead of the lesson', () => {
  it('refuses a future-step action from the scene, and changes nothing', () => {
    expect(currentStep()).toBe(1);

    // Powering the pump is step 4's business. The switch is a mesh in the scene at step 1
    // and the rig is perfectly happy to do it — before BEDO-020 this turned the pump on.
    clickMesh('scene-power');

    expect(currentStep()).toBe(1); // the lesson did not move
    expect(warningText()).toBe('Follow the highlighted step first.');
    dismissPopup();

    // The pump has no readout in guided mode until step 4 offers the switch, so the proof
    // that nothing was committed is that the switch still has a pump to turn *on* when
    // the lesson finally arrives there.
    walkLesson(1, 3);
    expect(currentStep()).toBe(4);
    expect(powerLabel()).toContain('Turn On Pump');
  });

  it('refuses several different action classes, not just one control', () => {
    // §27: the gate is a policy, so it has to hold across the classes of interaction —
    // a toggle, a value setpoint, a selection and an accumulation.
    clickMesh('scene-power'); // toggle
    dismissPopup();
    clickMesh('scene-flow-valve'); // setpoint
    dismissPopup();
    clickMesh('scene-deflector-90'); // selection
    dismissPopup();
    clickMesh('scene-weight-50'); // accumulation
    dismissPopup();

    expect(loadedWeightG()).toBe(0);
    expect(coverState()).toBe('Closed');
    expect(currentStep()).toBe(1);

    // Walking on proves the two states with no step-1 readout were untouched as well:
    // `walkLesson` asserts the step number before every action, the switch still reads
    // "on", and the valve is still shut when the lesson reaches it.
    walkLesson(1, 3);
    expect(powerLabel()).toContain('Turn On Pump');
    walkLesson(4, 4);
    expect(valvePercent()).toBe(0);
  });

  it('accepts the step’s own action from the very same surface', () => {
    clickMesh('scene-cover');

    expect(coverState()).toBe('Open');
    expect(currentStep()).toBe(2);
  });

  it('refuses a *past*-step action once the lesson has moved on', () => {
    clickMesh('scene-cover');
    expect(currentStep()).toBe(2);

    // Closing the tank is step 3's action and mechanically legal right now. Step 2 is
    // asking for a deflector, so it waits.
    clickMesh('scene-cover');

    expect(coverState()).toBe('Open');
    expect(currentStep()).toBe(2);
    expect(warningText()).toBe('Follow the highlighted step first.');
  });

  it('holds at a later step too, where the rig is running', () => {
    walkLesson(1, 4);
    expect(currentStep()).toBe(5);

    // The power switch is still a mesh, and POWER_OFF is mechanically legal. Before the
    // gate this stopped the pump in the middle of the first reading.
    clickMesh('scene-power');
    expect(currentStep()).toBe(5);
    dismissPopup();

    // Step 5 hides the power button, so the pump's state is read from its effect: the
    // flow valve only passes water the pump is delivering, and it opens.
    setValve(0.4);
    expect(valvePercent()).toBe(40);
  });

  it('lets the whole eleven-step lesson through unchanged', () => {
    walkLesson(1, 11);
    expect(screen.getByTestId('answer-sheet')).toBeDefined();
  });
});

describe('the two surfaces agree', () => {
  it('accepts the same action from panel and scene at the step that asks for it', () => {
    walkLesson(1, 5);
    expect(currentStep()).toBe(6); // weights

    click('+50g');
    expect(loadedWeightG()).toBe(50);

    clickMesh('scene-weight-50');
    expect(loadedWeightG()).toBe(100);
  });

  it('refuses the same action from panel and scene at a step that does not', () => {
    walkLesson(1, 4);
    expect(currentStep()).toBe(5); // the flow valve

    // The panel does not render a weights section here at all...
    expect(screen.queryByRole('button', { name: '+50g' })).toBeNull();
    // ...and the scene, which cannot hide a weight, is refused instead of dispatching.
    clickMesh('scene-weight-50');

    expect(loadedWeightG()).toBe(0);
    expect(currentStep()).toBe(5);
  });

  it('refuses a panel handler invoked programmatically at the wrong step', () => {
    // §8: a hidden control is not a rule. `App` exposes the cover handler in dev builds
    // for the Playwright suite, which makes it a convenient stand-in for any caller that
    // reaches a stale handler — the gate refuses it just the same.
    walkLesson(1, 4);
    expect(currentStep()).toBe(5);

    const hook = (window as unknown as { __bedoTest?: { coverClick: () => void } }).__bedoTest;
    expect(hook, 'the dev handler hook should be present in tests').toBeDefined();
    hook!.coverClick();

    expect(coverState()).toBe('Closed');
    expect(currentStep()).toBe(5);
  });
});

describe('safety is still the apparatus’s job', () => {
  it('answers with the safety guard when an action is both unsafe and off-script', () => {
    clickMesh('scene-cover'); // step 1 -> tank open, now on step 2
    expect(coverState()).toBe('Open');

    // Weights are off-script at step 2 *and* unsafe with the tank open. The learner is
    // told the rule about the rig, not the rule about the software — docs/36 §5.
    clickMesh('scene-weight-50');

    expect(warningText()).toBe('You can’t add weights while the tank is open.');
    expect(loadedWeightG()).toBe(0);
  });

  it('prefers the safety guard even when the lesson would also refuse', () => {
    // Step 3 asks the learner to re-seat the cover, and the tank is open. Powering up is
    // both off-script *and* guard 4. The learner is told about the tank.
    clickMesh('scene-cover');
    click('OK');
    dismissPopup();
    expect(currentStep()).toBe(3);
    expect(coverState()).toBe('Open');

    clickMesh('scene-power');

    expect(warningText()).toBe('You can’t turn on the power while the tank is open.');
    expect(currentStep()).toBe(3);
  });

  it('keeps the red banner and the blue notice apart', () => {
    // A safety refusal carries an error code and paints the blocking banner; a lesson
    // refusal is a notice. `BEDO-020 §10`: the distinction has to stay visible.
    clickMesh('scene-cover');
    clickMesh('scene-weight-50');
    expect(document.querySelector('.warning-popup')).not.toBeNull();
    const safety = warningText();
    dismissPopup();

    clickMesh('scene-cover'); // legal, wrong step
    expect(warningText()).not.toBe(safety);
  });
});

describe('the volumetric valve survives having no step number', () => {
  it('is operable at step 1, from the scene', () => {
    expect(currentStep()).toBe(1);
    expect(volumetricValveIsOpen()).toBe(false);

    clickMesh('scene-volumetric-valve');

    expect(volumetricValveIsOpen()).toBe(true);
  });

  it('does not advance the lesson by being operated', () => {
    clickMesh('scene-volumetric-valve');
    expect(currentStep()).toBe(1);
    clickMesh('scene-volumetric-valve');
    expect(currentStep()).toBe(1);
  });

  it('is on the panel at every step, and works from there too', () => {
    click('Open volumetric valve');
    expect(volumetricValveIsOpen()).toBe(true);

    walkLesson(1, 4);
    expect(currentStep()).toBe(5);
    expect(screen.getByRole('button', { name: 'Volumetric valve open' })).toBeDefined();
  });
});

describe('free mode stays exploratory', () => {
  beforeEach(() => click('Free Mode'));

  it('runs the pump without any lesson standing in the way', () => {
    clickMesh('scene-power');
    expect(powerLabel()).toContain('Turn Off Pump');
  });

  it('lets the scene reach every affordance, in any order', () => {
    clickMesh('scene-cover');
    expect(coverState()).toBe('Open');
    clickMesh('scene-deflector-90');
    clickMesh('scene-cover');
    expect(coverState()).toBe('Closed');
    clickMesh('scene-power');
    expect(powerLabel()).toContain('Turn Off Pump');
    clickMesh('scene-weight-50');
    expect(loadedWeightG()).toBe(50);
  });

  it('still refuses what the rig refuses', () => {
    clickMesh('scene-cover');
    clickMesh('scene-weight-50');
    expect(warningText()).toBe('You can’t add weights while the tank is open.');
    expect(loadedWeightG()).toBe(0);
  });
});
