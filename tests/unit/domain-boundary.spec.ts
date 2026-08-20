import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../helpers/glb';

/**
 * The domain layer's dependency rule (BEDO-005 §4, §16).
 *
 * `src/domain/` is the verified engineering core: the physics BEDO's spreadsheet was
 * checked against, what the apparatus is, and what the four experiments teach. Its value
 * comes from being *ordinary code* — pure, synchronous, and runnable anywhere, so it can
 * be read, reviewed and tested without a browser or a renderer in the way.
 *
 * That property is easy to lose by accident: one `import * as THREE` for a Vector3, one
 * `useMemo` for convenience, and the core needs a React tree to execute. This test is the
 * ratchet. It is a plain string check rather than an architecture framework, because the
 * rule is simple enough to state in one list.
 */

const DOMAIN = path.join(REPO_ROOT, 'src', 'domain');

/** Packages and paths the domain must never reach for. */
const FORBIDDEN = [
  { pattern: /^react(-dom)?(\/|$)/, why: 'React — the domain must run without a component tree' },
  { pattern: /^three(\/|$)/, why: 'three.js — geometry here is maths, not scene objects' },
  { pattern: /^@react-three\//, why: 'R3F/drei — rendering belongs to the scene layer' },
  { pattern: /^@?[\w@/-]*(zustand|redux)/, why: 'a state store — the domain holds no state' },
  { pattern: /\.css$/, why: 'styling' },
  { pattern: /\.\.\/components\//, why: 'UI components' },
  { pattern: /\.\.\/lib\//, why: 'the presentation-side helpers in src/lib' },
  { pattern: /\.\.\/types/, why: 'app state types — the dependency runs the other way' },
];

/** Browser and platform globals a pure domain has no business touching. */
const FORBIDDEN_GLOBALS = [
  'document.',
  'window.',
  'localStorage',
  'sessionStorage',
  'navigator.',
  'fetch(',
  'performance.',
  'process.',
  'require(',
];

const domainFiles = (): string[] =>
  readdirSync(DOMAIN, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? readdirSync(path.join(DOMAIN, entry.name)).map((f) => path.join(entry.name, f))
      : [entry.name]
  );

const imports = (source: string): string[] => [
  ...[...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]),
  ...[...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
];

describe('src/domain imports nothing from the outside world', () => {
  const files = domainFiles();

  it('has the domain modules it is supposed to have', () => {
    // Guards the guard: if the directory is empty or renamed, the checks below would
    // pass by doing nothing.
    expect(files.sort()).toEqual(['apparatus.ts', 'experiments.ts', 'physics.ts', 'units.ts']);
  });

  it.each(domainFiles())('%s imports only other domain modules', (file) => {
    const source = readFileSync(path.join(DOMAIN, file), 'utf8');
    for (const specifier of imports(source)) {
      for (const { pattern, why } of FORBIDDEN) {
        expect(
          pattern.test(specifier),
          `src/domain/${file} imports "${specifier}" — ${why}`
        ).toBe(false);
      }
      // Anything relative must stay inside src/domain.
      if (specifier.startsWith('.')) {
        expect(
          specifier.startsWith('..'),
          `src/domain/${file} imports "${specifier}", which leaves the domain`
        ).toBe(false);
      }
    }
  });

  it.each(domainFiles())('%s touches no browser or platform global', (file) => {
    // Comments describe the rig and the reference material; only code is checked.
    const code = readFileSync(path.join(DOMAIN, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const global of FORBIDDEN_GLOBALS) {
      expect(code.includes(global), `src/domain/${file} uses ${global}`).toBe(false);
    }
  });

  it.each(domainFiles())('%s is deterministic — no clock, no randomness', (file) => {
    const code = readFileSync(path.join(DOMAIN, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // A reading computed twice from the same inputs must be the same reading.
    expect(code).not.toMatch(/Math\.random\(/);
    expect(code).not.toMatch(/Date\.now\(/);
    expect(code).not.toMatch(/new Date\(/);
  });
});

describe('the dependency direction', () => {
  it('runs from the app into the domain, never back', () => {
    // src/lib holds the presentation-side helpers — gltfName, the camera framing, the
    // export schema. They may read the domain; the domain may not read them.
    const libFiles = readdirSync(path.join(REPO_ROOT, 'src', 'lib'));
    const importsDomain = libFiles.filter((f) =>
      readFileSync(path.join(REPO_ROOT, 'src', 'lib', f), 'utf8').includes('../domain/')
    );
    expect(importsDomain.length, 'no lib module reads the domain — is the split real?').toBeGreaterThan(0);
  });

  it('lets the domain be imported with no DOM present', async () => {
    // The strongest form of the rule: load every domain module in a node environment and
    // compute a reading. If anything reached for a browser API, this throws.
    const physics = await import('../../src/domain/physics');
    const apparatus = await import('../../src/domain/apparatus');
    const experiments = await import('../../src/domain/experiments');

    expect(typeof document).toBe('undefined');
    expect(physics.computeRow(1, 0.4, 90, [50, 20, 10]).isBalanced).toBe(true);
    expect(apparatus.getDeflector(90).momentumFactor).toBe(1);
    expect(experiments.EXPERIMENTS).toHaveLength(4);
  });
});
