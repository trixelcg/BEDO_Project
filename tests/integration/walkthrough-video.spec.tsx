// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click,
  loadedWeightG,
  powerLabel,
  renderApp,
  setValve,
  stubConfigFetch,
} from '../helpers/app-harness';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The walkthrough video player (QA F13).
 *
 * jsdom has no media pipeline, so the element's playback surface is replaced with a small
 * fake that keeps `paused`/`currentTime` and fires the same events a browser does. The
 * player is driven only through those events, which is what these specs check.
 */

const DURATION = 120;
let paused = true;
let current = 0;
const saved: Record<string, PropertyDescriptor | undefined> = {};
const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;

beforeEach(() => {
  paused = true;
  current = 0;
  for (const key of ['paused', 'duration', 'currentTime', 'play', 'pause']) {
    saved[key] = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, key);
  }
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => paused });
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => DURATION });
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get: () => current,
    set(this: HTMLMediaElement, v: number) {
      current = v;
      this.dispatchEvent(new Event('seeked'));
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value(this: HTMLMediaElement) {
      paused = false;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    writable: true,
    value(this: HTMLMediaElement) {
      paused = true;
      this.dispatchEvent(new Event('pause'));
    },
  });
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  for (const [key, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(HTMLMediaElement.prototype, key, d);
    else delete proto[key];
  }
  vi.unstubAllGlobals();
});

const dialog = () => document.querySelector('[data-bedo-video]');
const video = () => document.querySelector('[data-bedo-video] video') as HTMLVideoElement;
const openVideo = () => {
  fireEvent.click(screen.getAllByRole('button', { name: /^Video$/ })[0]);
  fireEvent.loadedMetadata(video());
};
const timeLabel = () => document.querySelector('.walkthrough-time')?.textContent;

describe('F13-AC01 — Close always exits the player', () => {
  it('Close returns to the simulator', () => {
    openVideo();
    expect(dialog()).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Experiment Walkthrough Video' })).toBeDefined();
    click('Close');
    expect(dialog()).toBeNull();
  });

  it('Escape closes it — and only it, not the Data Monitor underneath', () => {
    click('Free Mode');
    click('Open Data Monitor');
    const monitorOpen = () => document.querySelector('.monitor-docked');
    expect(monitorOpen()).not.toBeNull();
    openVideo();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(monitorOpen(), 'the monitor stays open').not.toBeNull();
  });

  it('closes even when the video fails to load', () => {
    openVideo();
    fireEvent.error(video());
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/);
    click('Close');
    expect(dialog()).toBeNull();
  });

  it('pauses the video as it closes', () => {
    openVideo();
    click('Play');
    expect(paused).toBe(false);
    click('Close');
    expect(paused).toBe(true);
  });

  it('opens with focus on Close, and hands focus back to the Video button', () => {
    const opener = screen.getAllByRole('button', { name: /^Video$/ })[0];
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement?.textContent).toBe('Close');
    click('Close');
    expect(document.activeElement).toBe(opener);
  });
});

describe('F13-AC02 — the timeline seeks forward and backward', () => {
  it('+10 s, −10 s and the slider all move the playhead', () => {
    openVideo();
    click('Forward 10 seconds');
    expect(current).toBe(10);
    click('Forward 10 seconds');
    expect(current).toBe(20);
    click('Back 10 seconds');
    expect(current).toBe(10);
    fireEvent.change(document.querySelector('[data-bedo-video-timeline]')!, { target: { value: '95.5' } });
    expect(current).toBe(95.5);
    expect(timeLabel()).toBe('1:35 / 2:00');
    fireEvent.change(document.querySelector('[data-bedo-video-timeline]')!, { target: { value: '3' } });
    expect(current).toBe(3);
    expect(timeLabel()).toBe('0:03 / 2:00');
  });

  it('never seeks outside the video', () => {
    openVideo();
    click('Back 10 seconds');
    expect(current).toBe(0);
    fireEvent.change(document.querySelector('[data-bedo-video-timeline]')!, { target: { value: '115' } });
    click('Forward 10 seconds');
    expect(current).toBe(DURATION);
  });

  it('the arrow keys skip 5 s', () => {
    openVideo();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowRight' });
    expect(current).toBe(10);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowLeft' });
    expect(current).toBe(5);
  });
});

describe('F13-AC03 — Play/Pause works after seeking', () => {
  it('pause, seek, play, pause', () => {
    openVideo();
    click('Play');
    expect(paused).toBe(false);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDefined();
    click('Pause');
    expect(paused).toBe(true);
    click('Forward 10 seconds');
    click('Play');
    expect(paused).toBe(false);
    expect(current).toBe(10);
    fireEvent.change(document.querySelector('[data-bedo-video-timeline]')!, { target: { value: '40' } });
    click('Pause');
    expect(paused).toBe(true);
    expect(current).toBe(40);
  });

  it('Space toggles when focus is not on a button', () => {
    openVideo();
    (document.querySelector('[data-bedo-video-timeline]') as HTMLElement).focus();
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect(paused).toBe(false);
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect(paused).toBe(true);
  });
});

describe('F13-AC04 — the apparatus is as it was left', () => {
  it('free mode: pump, valve and weights survive open → seek → close', () => {
    click('Free Mode');
    click(/Turn On Pump/);
    setValve(0.5);
    click('+50g');
    const before = { power: powerLabel(), weight: loadedWeightG(), valve: screen.getByText('50%').textContent };

    openVideo();
    click('Forward 10 seconds');
    click('Play');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowLeft' });
    click('Close');

    expect({ power: powerLabel(), weight: loadedWeightG(), valve: screen.getByText('50%').textContent }).toEqual(before);
    expect(screen.getByRole('button', { name: 'Guided Mode' })).toBeDefined();
  });
});
