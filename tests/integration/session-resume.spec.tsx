// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click,
  currentStep,
  loadedWeightG,
  renderIntro,
  renderFreshApp,
  stubConfigFetch,
  walkLesson,
} from '../helpers/app-harness';
import {
  SESSION_KEY,
  SCHEMA_VERSION,
  isSavedSession,
  readSession,
} from '../../src/lib/sessionStore';
import { CURRENT_LESSON } from '../../src/lesson/currentLesson';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * Picking up where a visit left off (brief §7).
 *
 * A student four steps into an eleven-step procedure has done real work, and none of it
 * used to survive a refresh. These are the two halves of that: what is written while they
 * work, and what comes back when they return.
 */

const STEP_IDS = CURRENT_LESSON.steps.map((step) => step.id);
const stored = () => readSession(STEP_IDS);

beforeEach(() => {
  stubConfigFetch();
  try {
    localStorage.clear();
  } catch {
    // A storage-less environment is already clear.
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('what is written while the learner works', () => {
  it('writes nothing while the learner is still at the first step', () => {
    // An intro screen is not progress, and neither is a rig at rest on step 1 — a Resume
    // back to where Start already goes is worse than no offer at all.
    renderFreshApp();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('follows the rig, the step and the answers', () => {
    renderFreshApp();
    walkLesson(1, 5);

    const session = stored();
    expect(session).not.toBeNull();
    expect(session!.version).toBe(SCHEMA_VERSION);
    expect(session!.stepId).toBe('balance-reading-1');
    expect(session!.experimentId).toBe('flat');
    expect(session!.simulation.apparatus.isPowerOn).toBe(true);
  });

  it('keeps the readings that were recorded', () => {
    renderFreshApp();
    walkLesson(1, 8);
    const session = stored();
    expect(session!.simulation.recordedReadings).toHaveLength(2);
    expect(session!.simulation.recordedReadings[0].loadedWeightsG).toEqual([50, 20, 10]);
  });

  it('is forgotten on Reset, so the next visit is not offered a discarded run', () => {
    renderFreshApp();
    walkLesson(1, 5);
    expect(stored()).not.toBeNull();

    click('Reset simulator');
    expect(stored()).toBeNull();
  });
});

describe('what comes back on the next visit', () => {
  /** Works through to the middle of the lesson, then closes the tab. */
  const leaveMidRun = () => {
    renderFreshApp();
    walkLesson(1, 5); // through to the first balance step
    click('Add 50 g'); // ...and part-way through balancing it
    const session = stored();
    cleanup();
    return session!;
  };

  it('offers Resume, saying which step it would return to', () => {
    leaveMidRun();
    renderIntro();

    const offer = screen.getByTestId('intro-resume');
    expect(offer.textContent).toContain('step 6 of 11');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDefined();
    // And Start is relabelled, because next to Resume it is the destructive choice.
    expect(screen.getByRole('button', { name: 'Start again' })).toBeDefined();
  });

  it('does not offer Resume to a first-time visitor', () => {
    renderFreshApp();
    cleanup();
    renderIntro();
    expect(screen.queryByTestId('intro-resume')).toBeNull();
  });

  it('puts the learner back on their step, with their rig and their readings', () => {
    leaveMidRun();
    // Stopping at the intro, because that is where a returning learner arrives.
    renderIntro();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    expect(currentStep()).toBe(6);
    // Mid-balance, exactly as they left it.
    expect(loadedWeightG()).toBe(50);
  });

  it('starting again discards the saved run rather than leaving it to reappear', () => {
    leaveMidRun();
    renderIntro();

    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(stored()).toBeNull();
    expect(currentStep()).toBe(1);
  });
});

describe('a stored session is validated, never trusted', () => {
  const valid = () => {
    renderFreshApp();
    walkLesson(1, 5);
    const session = stored();
    cleanup();
    return session!;
  };

  it('accepts what the app itself wrote', () => {
    expect(isSavedSession(valid(), STEP_IDS)).toBe(true);
  });

  it.each([
    ['a different schema version', (s: Record<string, unknown>) => ({ ...s, version: 99 })],
    ['a step this build does not have', (s: Record<string, unknown>) => ({ ...s, stepId: 'gone' })],
    ['an unknown experiment', (s: Record<string, unknown>) => ({ ...s, experimentId: 'other' })],
    ['no simulation at all', (s: Record<string, unknown>) => ({ ...s, simulation: null })],
    [
      'a rig and a sheet that disagree',
      (s: Record<string, unknown>) => ({ ...s, experimentId: 'semi' }),
    ],
    [
      'a valve outside its range',
      (s: Record<string, unknown>) => ({
        ...s,
        simulation: {
          ...(s.simulation as Record<string, unknown>),
          apparatus: {
            ...((s.simulation as Record<string, unknown>).apparatus as Record<string, unknown>),
            valveOpening: 4,
          },
        },
      }),
    ],
    [
      'a negative weight on the pan',
      (s: Record<string, unknown>) => ({
        ...s,
        simulation: {
          ...(s.simulation as Record<string, unknown>),
          apparatus: {
            ...((s.simulation as Record<string, unknown>).apparatus as Record<string, unknown>),
            loadedWeightsG: [-50],
          },
        },
      }),
    ],
  ])('refuses %s', (_name, corrupt) => {
    const broken = corrupt(valid() as unknown as Record<string, unknown>);
    expect(isSavedSession(broken, STEP_IDS)).toBe(false);
  });

  it('refuses anything that is not a session at all', () => {
    for (const value of [null, undefined, 42, 'session', [], {}]) {
      expect(isSavedSession(value, STEP_IDS)).toBe(false);
    }
  });

  it('reads null rather than throwing on unparseable storage', () => {
    localStorage.setItem(SESSION_KEY, '{not json');
    expect(readSession(STEP_IDS)).toBeNull();
  });

  it('reads null rather than throwing when storage itself throws', () => {
    // Blocked site data does not return null, it raises — which is why every access is
    // inside a try, as `languagePreference` already does.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    expect(readSession(STEP_IDS)).toBeNull();
  });

  it('ignores a corrupt session and offers no Resume', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ version: 99 }));
    renderIntro();
    expect(screen.queryByTestId('intro-resume')).toBeNull();
  });
});
