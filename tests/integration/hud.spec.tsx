// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click,
  clickMesh,
  renderFreshApp,
  stubConfigFetch,
  walkLesson,
} from '../helpers/app-harness';
import { GUIDE_ARROW_ENABLED } from '../../src/lib/guidance';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The HUD, and the things a keyboard has to be able to do with it (brief §4.1, §4.4,
 * §4.9, §4.10).
 */

const dock = () => document.querySelector('.guided-dock');
const footer = () => document.querySelector('.guided-footer');
const container = () => document.querySelector('.ui-container');

beforeEach(() => {
  stubConfigFetch();
  renderFreshApp();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    // A storage-less environment is fine.
  }
});

describe('the HUD stands down behind an overlay', () => {
  it('is on screen while the learner is working', () => {
    expect(dock()).not.toBeNull();
    expect(footer()).not.toBeNull();
    expect(container()?.className).not.toContain('has-overlay');
  });

  it('marks itself when the data monitor is open', () => {
    // The toolbar used to run underneath the docked monitor's own readings row.
    walkLesson(1, 8);
    click('Open Data Monitor');
    expect(container()?.className).toContain('has-overlay');
  });

  it('marks itself when the walkthrough video is open', () => {
    click(/^(Video|فيديو)$/);
    expect(container()?.className).toContain('has-overlay');
  });

  it('keeps the footer in the Board view, because Back to Step lives there', () => {
    // The one exception, and the reason the rule is written as it is: hiding the toolbar
    // in the Board view would remove the only way back out of it.
    click(/^(Board|اللوحة)$/);
    expect(container()?.className).toContain('has-overlay');
    expect(container()?.className).toContain('is-board-view');
    expect(screen.getByRole('button', { name: /Back to Step/i })).toBeDefined();
  });
});

describe('the walkthrough video is a dialog, not a trap', () => {
  const openVideo = () => {
    click(/^(Video|فيديو)$/);
    return screen.getByTestId('video-modal');
  };

  it('is a labelled modal dialog', () => {
    const modal = openVideo();
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    const labelledBy = modal.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toContain('Walkthrough');
  });

  it('closes on Escape', () => {
    const modal = openVideo();
    fireEvent.keyDown(modal, { key: 'Escape' });
    expect(screen.queryByTestId('video-modal')).toBeNull();
  });

  it('closes on its own Close button', () => {
    // `docs/28 §11`: the old modal rendered inside `.ui-container`, which withholds
    // pointer events, so this button could not be clicked at all.
    const modal = openVideo();
    fireEvent.click(within(modal).getByRole('button', { name: /Close|إغلاق/ }));
    expect(screen.queryByTestId('video-modal')).toBeNull();
  });

  it('plays a native video with captions offered in both languages', () => {
    const modal = openVideo();
    const video = modal.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.hasAttribute('controls')).toBe(true);
    // Not autoplaying: a dialog that starts making noise as it opens is the complaint.
    expect(video?.hasAttribute('autoplay')).toBe(false);
    const langs = Array.from(modal.querySelectorAll('track')).map((t) => t.getAttribute('srclang'));
    expect(langs.sort()).toEqual(['ar', 'en']);
  });

  it('moves focus into the dialog and gives it back on close', () => {
    const opener = screen.getByRole('button', { name: /^(Video|فيديو)$/ });
    opener.focus();
    fireEvent.click(opener);
    const modal = screen.getByTestId('video-modal');
    expect(modal.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(modal, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('traps Tab inside itself', () => {
    // Without the trap, Tab walks out onto the controls behind the dialog — covered, but
    // still in the tab order.
    const modal = openVideo();
    // The same selector the trap uses, so the test cannot pass against a different list.
    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])'
      )
    );
    expect(focusable.length).toBeGreaterThan(0);

    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(modal, { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0]);
  });
});

describe('the step card', () => {
  it('announces itself politely, so a step change is heard', () => {
    const card = document.querySelector('[data-bedo-step-card]');
    expect(card?.getAttribute('aria-live')).toBe('polite');
    expect(card?.getAttribute('role')).toBe('region');
  });

  it('shows progress across the procedure', () => {
    const fill = () =>
      (document.querySelector('.step-progress-fill') as HTMLElement | null)?.style.width;
    const atStart = fill();
    walkLesson(1, 4);
    expect(fill()).not.toBe(atStart);
  });

  it('offers a hint rather than a permanent arrow', () => {
    // §4.4: the arrow is behind a flag and the flag is off — the scene lights the part
    // itself instead. The button must exist for that to be reachable at all.
    expect(GUIDE_ARROW_ENABLED).toBe(false);
    const hint = screen.getByRole('button', { name: /Hint|تلميح/ });
    expect(hint).toBeDefined();
    // Pressing it changes nothing a learner has to undo.
    const before = document.querySelector('.step-badge')?.textContent;
    fireEvent.click(hint);
    expect(document.querySelector('.step-badge')?.textContent).toBe(before);
  });
});

describe('the answer sheet is the same dialog', () => {
  it('closes on Escape, like every other overlay', () => {
    walkLesson(1, 10);
    click('Open the answer sheet');
    const sheet = screen.getByTestId('answer-sheet');
    expect(sheet.getAttribute('role')).toBe('dialog');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByTestId('answer-sheet')).toBeNull();
  });
});

describe('the printed board can be opened from the scene', () => {
  it('clicking it takes the camera to the board', () => {
    // §4.7: the in-world print is registered to the artwork's own boxes and is therefore
    // unreadable at any framing that also holds the apparatus. So it is a surface you go
    // to, and the 2D monitor stays the readable copy.
    expect(container()?.className).not.toContain('is-board-view');
    clickMesh('scene-board');
    expect(container()?.className).toContain('is-board-view');
  });
});
