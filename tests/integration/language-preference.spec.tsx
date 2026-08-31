// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, renderApp, stubConfigFetch } from '../helpers/app-harness';
import { LANGUAGE_PREFERENCE_KEY } from '../../src/lib/languagePreference';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * Persisted interface language (BEDO-UX-02).
 *
 * The acceptance criterion that actually drives the design is the *first* render. The
 * loading overlay is on screen before anything else, so a returning Arabic user must get
 * Arabic immediately — if the language were applied by an effect they would see an English
 * overlay flip to Arabic. That is why the preference is read in `useState`'s initializer,
 * and why this suite records every language the overlay is rendered with rather than only
 * inspecting the final DOM.
 */

/** Every `language` the loading overlay has been rendered with, in order. */
const seen = vi.hoisted(() => [] as string[]);

vi.mock('../../src/components/LoadingScreen', () => ({
  LoadingScreen: ({ language }: { language: string }) => {
    seen.push(language);
    return <div data-testid="loading-screen">{language}</div>;
  },
}));

const root = () => ({
  lang: document.documentElement.lang,
  dir: document.documentElement.dir,
});

const resetMarkers = () => {
  const d = document.documentElement.dataset;
  delete d.bedoAppReady;
  delete d.bedoSceneReady;
  delete d.bedoTrainingReady;
};

beforeEach(() => {
  seen.length = 0;
  localStorage.clear();
  resetMarkers();
  stubConfigFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetMarkers();
  vi.restoreAllMocks();
});

describe('what the app starts in', () => {
  it('defaults to English when nothing has been stored', () => {
    renderApp();
    expect(root()).toEqual({ lang: 'en', dir: 'ltr' });
  });

  it('starts in English when English was chosen', () => {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'en');
    renderApp();
    expect(root()).toEqual({ lang: 'en', dir: 'ltr' });
    expect(seen[0]).toBe('en');
  });

  it('starts in Arabic when Arabic was chosen', () => {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'ar');
    renderApp();
    expect(root()).toEqual({ lang: 'ar', dir: 'rtl' });
  });

  it('renders the loading screen in Arabic on its very first render', () => {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'ar');
    renderApp();
    expect(seen[0], 'the first overlay render must already be Arabic').toBe('ar');
  });

  it('never shows an English loading screen before the Arabic one', () => {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'ar');
    renderApp();
    // The whole point: not one English frame, at any point during startup.
    expect(seen).not.toContain('en');
  });

  it('falls back to English on an unsupported stored value', () => {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'fr');
    renderApp();
    expect(root()).toEqual({ lang: 'en', dir: 'ltr' });
  });

  it('starts normally when reading storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      setItem: () => {},
    });
    expect(() => renderApp()).not.toThrow();
    expect(root()).toEqual({ lang: 'en', dir: 'ltr' });
  });
});

describe('what the app remembers', () => {
  it('stores Arabic when the user selects it', () => {
    renderApp();
    click('العربية');
    expect(localStorage.getItem(LANGUAGE_PREFERENCE_KEY)).toBe('ar');
    expect(root()).toEqual({ lang: 'ar', dir: 'rtl' });
  });

  it('stores English when the user switches back', () => {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'ar');
    renderApp();
    click('English');
    expect(localStorage.getItem(LANGUAGE_PREFERENCE_KEY)).toBe('en');
    expect(root()).toEqual({ lang: 'en', dir: 'ltr' });
  });

  it('writes nothing merely by starting up', () => {
    renderApp();
    expect(localStorage.getItem(LANGUAGE_PREFERENCE_KEY)).toBeNull();
  });

  it('still switches language when the write fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      },
    });
    renderApp();
    expect(() => click('العربية')).not.toThrow();
    // Losing the preference is acceptable; refusing to change language is not.
    expect(root()).toEqual({ lang: 'ar', dir: 'rtl' });
  });

  it('keeps the current language across a simulator reset', () => {
    renderApp();
    click('العربية');
    click('إعادة تشغيل المعمل');
    expect(root()).toEqual({ lang: 'ar', dir: 'rtl' });
    expect(screen.getByText('قياس قوة نفث الماء')).toBeTruthy();
  });
});
