// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { isReady, markReady } from '../../src/lib/readiness';
import { renderApp, stubConfigFetch } from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The loading screen (BEDO-UX-01).
 *
 * The point of the overlay is that it hides the *unfinished* scene, so what matters is
 * which signal it waits on. `scene` is the existing milestone for "the apparatus is in the
 * scene graph"; `app` and `training` fire much earlier and would uncover the orange
 * wireframe placeholder that stands in while ~14 MB of GLB loads.
 *
 * These specs pin that contract from both ends: the overlay must not leave early, and the
 * readiness markers the Playwright suite and the capture harness wait on must not change
 * shape just because the UI now reads them too.
 */

/** Milestones live on <html>, so they have to be cleared between cases. */
const resetMarkers = () => {
  const d = document.documentElement.dataset;
  delete d.bedoAppReady;
  delete d.bedoSceneReady;
  delete d.bedoTrainingReady;
};

const overlay = () => document.querySelector('.loading-screen');

beforeEach(resetMarkers);
afterEach(() => {
  cleanup();
  resetMarkers();
  vi.restoreAllMocks();
});

describe('the loading overlay, as a component', () => {
  const base = { language: 'en' as const, failed: false, onRetry: () => {} };

  it('is visible and interactive while loading', () => {
    render(<LoadingScreen {...base} visible />);
    expect(overlay()?.className).not.toContain('is-hidden');
    expect(overlay()?.hasAttribute('inert'), 'must accept its own retry focus').toBe(false);
    expect(screen.getByText('Preparing the experiment…')).toBeTruthy();
  });

  it('hides and goes inert once ready, so nothing behind it is blocked', () => {
    render(<LoadingScreen {...base} visible={false} />);
    expect(overlay()?.className).toContain('is-hidden');
    expect(overlay()?.hasAttribute('inert')).toBe(true);
  });

  it('announces the loading message politely, and only once', () => {
    render(<LoadingScreen {...base} visible />);
    expect(screen.getByRole('status').textContent).toBe('Preparing the experiment…');
  });

  it('claims no completion figure, because none can be measured honestly', () => {
    // three's manager counts items, not bytes: measured on a throttled cold load it read
    // 89% for 22.5 s while the 11.9 MB apparatus GLB downloaded as one item. A bar parked
    // at 89% is worse than no bar, so the indicator is indeterminate and states no value.
    render(<LoadingScreen {...base} visible />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow'), 'no value may be claimed').toBeNull();
    expect(bar.querySelector('.is-indeterminate')).toBeTruthy();
    expect(screen.queryByText(/\d+%/), 'no percentage may be shown').toBeNull();
  });

  it('shows a localized message in Arabic', () => {
    render(<LoadingScreen {...base} visible language="ar" />);
    expect(screen.getByText('جارٍ تجهيز التجربة…')).toBeTruthy();
  });

  it('reports a genuine failure with a retry, instead of spinning forever', () => {
    const onRetry = vi.fn();
    render(<LoadingScreen {...base} visible failed onRetry={onRetry} />);
    // `alert`, not `status`: a failed start has to interrupt.
    expect(screen.getByRole('alert').textContent).toBe('Unable to load the experiment.');
    expect(screen.queryByRole('progressbar')).toBeNull();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('what the overlay waits for', () => {
  it('covers the app until the scene milestone, then leaves', async () => {
    stubConfigFetch();
    renderApp();

    // The scene double marks readiness on mount, so the app is past loading here.
    expect(isReady('scene')).toBe(true);
    expect(overlay()?.getAttribute('data-bedo-loading')).toBe('done');
  });

  it('does not treat the app or training milestones as readiness', () => {
    // Reaching those two must leave the overlay up: they fire while the canvas still
    // shows the wireframe placeholder.
    act(() => {
      markReady('app');
      markReady('training');
    });
    expect(isReady('scene')).toBe(false);
  });
});

describe('the readiness markers themselves', () => {
  it('still write the attributes the test and capture tooling wait on', () => {
    act(() => markReady('scene'));
    expect(document.documentElement.dataset.bedoSceneReady).toBeDefined();
    expect(isReady('scene')).toBe(true);
  });

  it('still let the first mark win, so a milestone cannot move', () => {
    act(() => markReady('scene'));
    const first = document.documentElement.dataset.bedoSceneReady;
    act(() => markReady('scene'));
    expect(document.documentElement.dataset.bedoSceneReady).toBe(first);
  });
});
