// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click, coverState, currentStep, renderFreshApp, stubConfigFetch, walkLesson, warningText,
} from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * Keyboard access to the tank cover.
 *
 * The cover's only real control was the plate mesh inside the WebGL canvas. A canvas mesh
 * cannot be focused or activated from a keyboard, so step 1 of the lesson — and with it
 * the whole guided sequence — was unreachable without a pointer. The
 * `window.__bedoTest.coverClick` adapter is not a counter-example: it is dev-only and
 * `vite build` compiles it out, so production had no path at all.
 *
 * The DOM control added for it must be a real equivalent, not a shortcut around the rules:
 * it raises the same intent through the same gate, so the safety interlocks and the lesson
 * expectations still decide what happens. That is what these tests pin.
 */

const coverButton = () => screen.getByRole('button', { name: /tank cover/i });

beforeEach(() => {
  stubConfigFetch();
  renderFreshApp();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the tank cover has a control outside the canvas', () => {
  it('offers a labelled button, not just a status line', () => {
    expect(coverButton()).toBeTruthy();
    expect(coverState()).toBe('Closed');
  });

  it('opens the cover and advances the lesson, exactly as the mesh does', () => {
    expect(currentStep()).toBe(1);
    click(/open tank cover/i);
    expect(coverState()).toBe('Open');
    expect(currentStep()).toBe(2);
  });

  it('re-labels itself to name the next action, and does not also claim a pressed state', () => {
    expect(coverButton().textContent).toMatch(/open tank cover/i);
    click(/open tank cover/i);
    // The same control now closes it: one button, two intents, as with the mesh.
    expect(screen.getByRole('button', { name: /close tank cover/i })).toBeTruthy();
    // Naming the action AND exposing aria-pressed is the contradiction the ARIA toggle
    // pattern warns about — "Close tank cover, pressed" reads as though closing were the
    // active state. The label carries the action; the status line carries the state.
    expect(coverButton().hasAttribute('aria-pressed')).toBe(false);
  });

  it('is still subject to the safety interlock, not a way around it', () => {
    // Steps 1-4 end with the cover refitted and the pump running, which is the state the
    // rig refuses to open into (COVER_BLOCKED_BY_POWER).
    walkLesson(1, 4);
    expect(coverState()).toBe('Closed');

    click(/open tank cover/i);

    expect(coverState(), 'the button must not bypass the interlock').toBe('Closed');
    expect(warningText()).toBeTruthy();
    // The refusal is this control's only feedback, so it has to reach assistive
    // technology: nothing else on screen changes when the press is rejected.
    expect(document.querySelector('.warning-popup')?.getAttribute('role')).toBe('alert');
  });
});
