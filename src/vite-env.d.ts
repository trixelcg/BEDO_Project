/// <reference types="vite/client" />

/**
 * Build-time constants, substituted by `define` in `vite.config.ts` (and by the matching
 * block in `vitest.config.ts`, so the test runner sees the same literals).
 *
 * Declared globally rather than read from `import.meta.env` because they are literals the
 * bundler inlines: `__APP_VERSION__` becomes the string itself, so nothing ships a copy of
 * `package.json` and there is no runtime fetch that can fail.
 *
 * Inside `declare global` with an `export {}` below it: `moduleDetection: "force"` is on,
 * and a bare top-level `declare const` in this file would be scoped to the file rather
 * than visible to the application.
 */
declare global {
  /** The application's version, from `package.json`. */
  const __APP_VERSION__: string;
  /** The asset generation this build was made against. See `vite.config.ts`. */
  const __BUILD_GEN__: string;
}

export {};
