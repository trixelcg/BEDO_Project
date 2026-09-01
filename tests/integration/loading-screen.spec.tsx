// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
  const base = { language: 'en' as const, phase: 'app' as const, failed: false, onRetry: () => {} };

  it('is visible and interactive while loading', () => {
    render(<LoadingScreen {...base} visible />);
    expect(overlay()?.className).not.toContain('is-hidden');
    expect(overlay()?.hasAttribute('inert'), 'must accept its own retry focus').toBe(false);
    expect(screen.getByText('Preparing application…')).toBeTruthy();
    // The brand mark is what makes this read as a loading state rather than a blank page.
    // It is BEDO's logo now rather than a typographic stand-in, but its accessible name is
    // deliberately unchanged, so a screen reader still hears exactly "BEDO".
    const mark = screen.getByAltText('BEDO') as HTMLImageElement;
    expect(mark.getAttribute('src')).toBe('/bedo-logo-dark.png');
    // Intrinsic dimensions must be declared, or the card reflows when the PNG arrives.
    expect(mark.getAttribute('width')).toBe('447');
    expect(mark.getAttribute('height')).toBe('447');
  });

  it('hides and goes inert once ready, so nothing behind it is blocked', () => {
    render(<LoadingScreen {...base} visible={false} />);
    expect(overlay()?.className).toContain('is-hidden');
    expect(overlay()?.hasAttribute('inert')).toBe(true);
  });

  it('announces the phase politely, and only when it actually changes', () => {
    const { rerender } = render(<LoadingScreen {...base} visible />);
    expect(screen.getByRole('status').textContent).toBe('Preparing application…');
    rerender(<LoadingScreen {...base} visible phase="apparatus" />);
    expect(screen.getByRole('status').textContent).toBe('Loading 3D experiment…');
  });

  it('fills a segment only once its milestone has actually been reached', () => {
    const segs = () => document.querySelectorAll('.loading-seg');
    const done = () => document.querySelectorAll('.loading-seg.is-done').length;
    const { rerender } = render(<LoadingScreen {...base} visible />);
    expect(segs()).toHaveLength(2);
    expect(done(), 'nothing is complete yet').toBe(0);
    rerender(<LoadingScreen {...base} visible phase="apparatus" />);
    expect(done(), 'the application phase is genuinely finished').toBe(1);
    rerender(<LoadingScreen {...base} visible phase="ready" />);
    // Full only at the reveal condition — 100% cannot mean anything else.
    expect(done()).toBe(2);
  });

  it('reports phases, never a byte percentage', () => {
    // three's manager counts items, not bytes: measured on a throttled cold load it read
    // 89% for 22.5 s while the 11.9 MB apparatus GLB downloaded as one item. Segments
    // describe milestones that demonstrably happened instead.
    render(<LoadingScreen {...base} visible />);
    const bar = screen.getByRole('progressbar');
    expect(screen.queryByText(/\d+%/), 'no percentage may be shown').toBeNull();
    expect(bar.getAttribute('aria-valuetext')).toBe('Preparing application…');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
  });

  it('shows a localized phase and title in Arabic', () => {
    render(<LoadingScreen {...base} visible language="ar" />);
    expect(screen.getByText('جارٍ تجهيز التطبيق…')).toBeTruthy();
    expect(screen.getByText('قياس قوة نفث الماء')).toBeTruthy();
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

    // The scene double marks readiness on mount, so readiness itself is already satisfied.
    expect(isReady('scene')).toBe(true);

    // Readiness alone does not reveal: a short presentation floor (BEDO-UX-04) keeps the
    // overlay on screen so a fast load cannot flash it for a couple of frames. It only
    // ever postpones a reveal that has already been earned.
    expect(overlay()?.getAttribute('data-bedo-loading')).toBe('active');

    await waitFor(
      () => expect(overlay()?.getAttribute('data-bedo-loading') ?? 'gone').not.toBe('active'),
      { timeout: 2000 }
    );
  });

  it('holds an already-complete bar during the floor, rather than advancing anything', () => {
    stubConfigFetch();
    renderApp();

    // The milestone has genuinely fired, so the phase and the segments are already at
    // their final state. The presentation floor only postpones the reveal — it is not
    // progress, and it must never be what fills a segment.
    const overlayEl = overlay();
    expect(overlayEl?.getAttribute('data-bedo-loading'), 'still held').toBe('active');
    expect(overlayEl?.getAttribute('data-bedo-loading-phase'), 'phase is real, not timed').toBe(
      'ready'
    );
    expect(document.querySelectorAll('.loading-seg.is-done')).toHaveLength(2);
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
