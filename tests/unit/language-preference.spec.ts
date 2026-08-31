// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LANGUAGE_PREFERENCE_KEY,
  readLanguagePreference,
  writeLanguagePreference,
} from '../../src/lib/languagePreference';

/**
 * The language preference helper (BEDO-UX-02).
 *
 * Two properties matter more than the happy path. First, `null` means "no preference
 * yet", which is not the same fact as "chose English" — only the application may turn
 * absence into a default, so the helper must never invent one. Second, reading
 * `localStorage` can *throw* rather than return null (blocked site data, some private
 * modes), and a training app must still start when it does.
 */

afterEach(() => {
  // Unstub FIRST: several cases replace `localStorage` with a throwing object or with
  // `undefined`, and clearing before restoring it throws inside the hook, which then
  // leaks the broken global into every following test.
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('reading the preference', () => {
  it('returns null when nothing has been stored', () => {
    expect(readLanguagePreference()).toBeNull();
  });

  it.each(['en', 'ar'] as const)('returns %s when %s is stored', (lang) => {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, lang);
    expect(readLanguagePreference()).toBe(lang);
  });

  it.each(['fr', 'EN', '', 'null', '{"language":"ar"}'])(
    'rejects the unsupported value %j rather than passing it through',
    (value) => {
      localStorage.setItem(LANGUAGE_PREFERENCE_KEY, value);
      expect(readLanguagePreference()).toBeNull();
    }
  );

  it('returns null when storage throws instead of letting it escape', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      setItem: () => {},
    });
    expect(() => readLanguagePreference()).not.toThrow();
    expect(readLanguagePreference()).toBeNull();
  });

  it('returns null when storage is not available at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readLanguagePreference()).toBeNull();
  });
});

describe('writing the preference', () => {
  it.each(['en', 'ar'] as const)('stores %s under the BEDO key', (lang) => {
    writeLanguagePreference(lang);
    expect(localStorage.getItem(LANGUAGE_PREFERENCE_KEY)).toBe(lang);
  });

  it('round-trips through the reader', () => {
    writeLanguagePreference('ar');
    expect(readLanguagePreference()).toBe('ar');
  });

  it('swallows a storage failure, because losing a preference beats refusing to switch', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      },
    });
    expect(() => writeLanguagePreference('ar')).not.toThrow();
  });

  it('does not write anything merely by being imported or read', () => {
    readLanguagePreference();
    expect(localStorage.getItem(LANGUAGE_PREFERENCE_KEY)).toBeNull();
  });
});
