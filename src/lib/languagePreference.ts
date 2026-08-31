import type { Language } from '../types/index';

/**
 * The interface language the user last chose, remembered across loads.
 *
 * This exists because the language is decided *before* anything is on screen: the
 * BEDO-UX-01 loading overlay is the first thing rendered, and it has to be in the right
 * language on its first paint rather than flipping once an effect runs. So the read is
 * synchronous and feeds `useState`'s initializer, not a `useEffect`.
 *
 * It lives in `src/lib` deliberately. `tests/unit/domain-boundary.spec.ts` forbids
 * `localStorage` — along with `document.`, `window.` and `fetch(` — anywhere under
 * `src/domain`, because the domain has to run without a browser. Storage is presentation.
 *
 * Nothing else is stored here. This is one preference, not a settings system.
 */

/** One stable, namespaced key. Changing it silently forgets every user's choice. */
export const LANGUAGE_PREFERENCE_KEY = 'bedo.language';

const isLanguage = (value: unknown): value is Language => value === 'en' || value === 'ar';

/**
 * The stored preference, or `null` when there isn't a usable one.
 *
 * `null` rather than a default on purpose: "no preference yet" and "chose English" are
 * different facts, and only the caller should decide what absence means. The application
 * applies the default — `readLanguagePreference() ?? 'en'` — so this helper never invents
 * a choice the user did not make.
 *
 * Every failure mode collapses to `null`: absent key, malformed or unknown value, and
 * storage that is unavailable or throws. Reading `localStorage` is not merely null-safe —
 * it *throws* when site data is blocked or in some private-browsing modes, so the whole
 * access sits inside the try, including the property lookup itself.
 */
export function readLanguagePreference(): Language | null {
  try {
    const stored = globalThis.localStorage?.getItem(LANGUAGE_PREFERENCE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Remember an explicit choice.
 *
 * Failure is swallowed by design: if storage is full, blocked or throwing, the user's
 * language must still change for this session. Losing the preference is a smaller harm
 * than refusing to switch language.
 */
export function writeLanguagePreference(language: Language): void {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_PREFERENCE_KEY, language);
  } catch {
    // Ignored: see above.
  }
}
