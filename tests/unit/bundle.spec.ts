import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../helpers/glb';

/**
 * What the production bundle must and must not contain (BEDO-002 §7).
 *
 * The E2E suite drives the tank cover through a dev-only adapter on `window`. That is a
 * seam in production source, so this is the test that keeps it out of production output:
 * `vite build` compiles `import.meta.env.DEV` to `false` and drops the block, and if that
 * ever stops being true the build turns red here rather than shipping a remote-control
 * handle to every visitor.
 *
 * Requires a build. `npm run test:ci` builds first; a bare `vitest run` on a clean
 * checkout reports these as skipped rather than passing vacuously.
 */

const DIST = path.join(REPO_ROOT, 'dist');
const bundles = () => {
  const assets = path.join(DIST, 'assets');
  if (!existsSync(assets)) return [];
  return readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(assets, f));
};

const built = existsSync(path.join(DIST, 'index.html')) && bundles().length > 0;
const describeBuilt = built ? describe : describe.skip;

if (!built) {
  console.warn('[bundle.spec] dist/ not built — run `npm run build` to include these checks.');
}

describeBuilt('the production bundle', () => {
  const sources = () => bundles().map((file) => readFileSync(file, 'utf8'));

  it('contains no test adapter', () => {
    for (const source of sources()) {
      expect(source).not.toContain('__bedoTest');
    }
  });

  it('keeps the readiness instrumentation, which is not dev-only', () => {
    // Data attributes and performance marks are how loading is measured; they ship.
    const combined = sources().join('');
    expect(combined).toContain('-ready`');
  });

  it('emits a single entry chunk, as docs/11 §3.4 records', () => {
    // Not a target — a pin. Code splitting is BEDO-011's job, and when it lands this
    // number changes deliberately rather than by accident.
    expect(bundles()).toHaveLength(1);
  });

  it('ships the apparatus model and the plumes', () => {
    expect(existsSync(path.join(DIST, 'Bedo_baked_v2.glb'))).toBe(true);
    expect(readdirSync(path.join(DIST, 'WaterShapes')).filter((f) => f.endsWith('.glb'))).toHaveLength(8);
  });
});
