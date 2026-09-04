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
const SIMULATION = path.join(REPO_ROOT, 'src', 'simulation');
const LESSON = path.join(REPO_ROOT, 'src', 'lesson');

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
    expect(files.sort()).toEqual([
      'apparatus.ts',
      'experiments.ts',
      'physics.ts',
      'physicsConfig.ts',
      'spring.ts',
      'stateMachine.ts',
      'units.ts',
    ]);
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
    const machine = await import('../../src/domain/stateMachine');

    expect(typeof document).toBe('undefined');
    expect(physics.computeRow(1, physics.FIRST_READING_VALVE, 90, [50, 20, 10]).isBalanced).toBe(true);
    expect(apparatus.getDeflector(90).momentumFactor).toBe(1);
    expect(experiments.EXPERIMENTS).toHaveLength(4);
    expect(machine.attempt(machine.restingState(90), { type: 'POWER_ON' }).ok).toBe(true);

    const spring = await import('../../src/domain/spring');
    expect(spring.springDeflectionMm(0.8199, 0, 25.38)).toBeCloseTo(4.0995, 3);
  });
});

/**
 * The simulation layer's dependency rule (BEDO-008 §30).
 *
 * `src/simulation/` owns simulation state and may reach *down* into the domain. It may
 * not reach sideways or up: no React, no store library, no renderer, no DOM. That is what
 * makes the rig drivable from a test, a script, or a future Zustand store without any of
 * them being installed.
 */
describe('src/simulation imports only the domain', () => {
  const files = () => readdirSync(SIMULATION).filter((f) => f.endsWith('.ts'));

  it('has the modules it is supposed to have', () => {
    expect(files().sort()).toEqual(['runtime.ts', 'selectors.ts', 'state.ts']);
  });

  it.each(readdirSync(SIMULATION).filter((f) => f.endsWith('.ts')))(
    '%s reaches only downwards',
    (file) => {
      const source = readFileSync(path.join(SIMULATION, file), 'utf8');
      for (const specifier of imports(source)) {
        for (const { pattern, why } of FORBIDDEN) {
          // `../lib/` and `../types` are forbidden for the domain; for simulation the
          // same rule holds, and `../domain/` is the one relative path allowed out.
          if (pattern.source.includes('domain')) continue;
          expect(
            pattern.test(specifier),
            `src/simulation/${file} imports "${specifier}" — ${why}`
          ).toBe(false);
        }
        if (specifier.startsWith('.')) {
          expect(
            specifier.startsWith('../') && !specifier.startsWith('../domain/'),
            `src/simulation/${file} imports "${specifier}", which is neither simulation nor domain`
          ).toBe(false);
        }
      }
    }
  );

  it.each(readdirSync(SIMULATION).filter((f) => f.endsWith('.ts')))(
    '%s touches no browser global and stays deterministic',
    (file) => {
      const code = readFileSync(path.join(SIMULATION, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const global of FORBIDDEN_GLOBALS) {
        expect(code.includes(global), `src/simulation/${file} uses ${global}`).toBe(false);
      }
      expect(code).not.toMatch(/Math\.random\(|Date\.now\(|new Date\(/);
    }
  );

  it('runs with no DOM present', async () => {
    const { createSimulationRuntime } = await import('../../src/simulation/runtime');
    const { selectReadings } = await import('../../src/simulation/selectors');
    const { FIRST_READING_VALVE } = await import('../../src/domain/physics');

    expect(typeof document).toBe('undefined');
    const runtime = createSimulationRuntime();
    runtime.dispatch({ type: 'POWER_ON' });
    runtime.dispatch({ type: 'SET_VALVE', opening: FIRST_READING_VALVE });
    runtime.dispatch({ type: 'ADD_WEIGHT', massG: 80 });
    runtime.dispatch({ type: 'RECORD_READING' });
    expect(selectReadings(runtime.getState())[0].loadedMassG).toBe(80);
  });

  it('is not imported by the domain — the dependency runs one way', () => {
    for (const file of domainFiles()) {
      const source = readFileSync(path.join(DOMAIN, file), 'utf8');
      expect(source, `src/domain/${file} imports the simulation`).not.toContain('simulation/');
    }
  });
});

/**
 * The lesson layer's dependency rule (BEDO-018 §30).
 *
 * `src/lesson/` may read the domain and the simulation's types and selectors. It may not
 * touch React, a renderer or the DOM — the runner has to be walkable in a plain test,
 * which is what `lesson-runner.spec.ts` does.
 */
describe('src/lesson imports only downwards', () => {
  const lessonFiles = () => readdirSync(LESSON).filter((f) => f.endsWith('.ts'));

  it('has the modules it is supposed to have', () => {
    expect(lessonFiles().sort()).toEqual(['currentLesson.ts', 'runner.ts', 'schema.ts']);
  });

  it.each(readdirSync(LESSON).filter((f) => f.endsWith('.ts')))(
    '%s imports no framework, renderer or DOM',
    (file) => {
      const source = readFileSync(path.join(LESSON, file), 'utf8');
      for (const specifier of imports(source)) {
        for (const { pattern, why } of FORBIDDEN) {
          // The lesson may read the domain and the simulation; it may not read src/lib,
          // components or app types.
          if (pattern.source.includes('domain')) continue;
          expect(
            pattern.test(specifier),
            `src/lesson/${file} imports "${specifier}" — ${why}`
          ).toBe(false);
        }
        if (specifier.startsWith('.')) {
          const allowed =
            !specifier.startsWith('../') ||
            specifier.startsWith('../domain/') ||
            specifier.startsWith('../simulation/');
          expect(allowed, `src/lesson/${file} imports "${specifier}", which is out of bounds`).toBe(
            true
          );
        }
      }
    }
  );

  it.each(readdirSync(LESSON).filter((f) => f.endsWith('.ts')))(
    '%s touches no browser global and stays deterministic',
    (file) => {
      const code = readFileSync(path.join(LESSON, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const global of FORBIDDEN_GLOBALS) {
        expect(code.includes(global), `src/lesson/${file} uses ${global}`).toBe(false);
      }
      expect(code).not.toMatch(/Math\.random\(|Date\.now\(|new Date\(/);
    }
  );

  it('runs with no DOM present', async () => {
    const { createLessonRunner } = await import('../../src/lesson/runner');
    const { CURRENT_LESSON } = await import('../../src/lesson/currentLesson');
    expect(typeof document).toBe('undefined');
    expect(createLessonRunner(CURRENT_LESSON).getCurrentStep().id).toBe('unscrew-cover');
  });
});

/**
 * No step-number business logic (BEDO-018 §6, §25, §26).
 *
 * Three files used to decide things by comparing `currentStep` against a literal, and two
 * of them disagreed about when a step was finished. This is the ratchet that stops that
 * coming back: numbers may be *displayed* and may sit in the schema as metadata, but no
 * code may branch on one.
 */
describe('lesson progression is semantic', () => {
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const read = (relative: string) => strip(readFileSync(path.join(REPO_ROOT, relative), 'utf8'));

  const PRODUCTION = [
    'src/App.tsx',
    'src/components/UIOverlay.tsx',
    'src/components/DeviceModel.tsx',
    'src/components/Scene3D.tsx',
    'src/lesson/runner.ts',
    'src/lesson/schema.ts',
    'src/lesson/currentLesson.ts',
    'src/simulation/runtime.ts',
    'src/simulation/state.ts',
    'src/simulation/selectors.ts',
  ];

  it.each(PRODUCTION)('%s branches on no step number', (file) => {
    const code = read(file);
    // `step === 7`, `currentStep >= 2`, `switch (currentStep)`, `{ 7: 1, 9: 2 }`.
    expect(code, 'compares a step against a number').not.toMatch(
      /\b(currentStep|step|stepId)\s*(===|!==|>=|<=|>|<)\s*\d/
    );
    expect(code, 'switches on a step number').not.toMatch(/switch\s*\(\s*\w*[sS]tep\w*\s*\)/);
    expect(code, 'maps step numbers to values').not.toMatch(/Record<number,\s*number>/);
  });

  it('no component keeps its own copy of "is this step finished"', () => {
    // The three predicates that used to drift. Each of these components now asks the
    // runner; none of them reconstructs the answer from apparatus state plus a number.
    for (const file of ['src/components/UIOverlay.tsx', 'src/components/DeviceModel.tsx']) {
      const code = read(file);
      expect(code, `${file} still computes valve readiness itself`).not.toContain(
        'VALVE_SNAP_MARGIN'
      );
      expect(code, `${file} still decides balance itself`).not.toMatch(
        /recordedRows\[\d\]\?\.isBalanced/
      );
    }
  });

  it('the simulation still knows nothing about lessons', () => {
    for (const file of ['src/simulation/runtime.ts', 'src/simulation/state.ts', 'src/simulation/selectors.ts']) {
      const code = read(file);
      expect(code, `${file} mentions a lesson step`).not.toMatch(/currentStep|lesson|StepId/i);
    }
  });
});

/**
 * The interaction gate's boundary, and the no-bypass audit (BEDO-020 §2, §29).
 *
 * `BUG-04` existed because two surfaces reached the simulation by two paths and only one
 * of them consulted the lesson. The fix is worth exactly as much as the guarantee that a
 * third path cannot appear, so this is the ratchet: components are handed callbacks, never
 * the runtime, and `App` is the only module allowed to commit a command.
 */
describe('src/interaction is a pure policy layer', () => {
  const INTERACTION = path.join(REPO_ROOT, 'src', 'interaction');

  it('has the modules it is supposed to have', () => {
    // `drag.ts` and `transfer.ts` joined the gate in BEDO-021: what a gesture *means* and
    // how long a physical transfer takes are both policy-adjacent and both entirely
    // framework-free, so they are held to the same import rule as the gate below.
    expect(readdirSync(INTERACTION).filter((f) => f.endsWith('.ts')).sort()).toEqual([
      'drag.ts',
      'gate.ts',
      'transfer.ts',
    ]);
  });

  it.each(readdirSync(INTERACTION).filter((f) => f.endsWith('.ts')))(
    '%s imports no framework, renderer or DOM',
    (file) => {
      const source = readFileSync(path.join(INTERACTION, file), 'utf8');
      for (const specifier of imports(source)) {
        for (const { pattern, why } of FORBIDDEN) {
          if (pattern.source.includes('domain')) continue;
          expect(
            pattern.test(specifier),
            `src/interaction/${file} imports "${specifier}" — ${why}`
          ).toBe(false);
        }
        if (specifier.startsWith('.')) {
          const allowed =
            !specifier.startsWith('../') ||
            specifier.startsWith('../domain/') ||
            specifier.startsWith('../simulation/') ||
            specifier.startsWith('../lesson/');
          expect(
            allowed,
            `src/interaction/${file} imports "${specifier}", which is out of bounds`
          ).toBe(true);
        }
      }
    }
  );

  it.each(readdirSync(INTERACTION).filter((f) => f.endsWith('.ts')))(
    '%s touches no browser global and stays deterministic',
    (file) => {
      const code = readFileSync(path.join(INTERACTION, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const global of FORBIDDEN_GLOBALS) {
        expect(code.includes(global), `src/interaction/${file} uses ${global}`).toBe(false);
      }
      expect(code).not.toMatch(/Math\.random\(|Date\.now\(|new Date\(/);
    }
  );
});

describe('nothing bypasses the interaction gate', () => {
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const componentFiles = readdirSync(path.join(REPO_ROOT, 'src', 'components')).filter((f) =>
    /\.tsx?$/.test(f)
  );

  it.each(componentFiles)('%s never holds the simulation runtime', (file) => {
    const code = strip(readFileSync(path.join(REPO_ROOT, 'src', 'components', file), 'utf8'));
    // A component that can reach `runtime.dispatch` can reach the rig without asking
    // anyone. They receive callbacks from `App` instead — which is why the mock scene in
    // the integration suite is a faithful stand-in for the real hotspots.
    expect(code, `${file} imports the runtime`).not.toMatch(
      /from '\.\.\/simulation\/runtime'|useSimulationRuntime|createSimulationRuntime/
    );
    expect(code, `${file} dispatches a simulation command`).not.toMatch(/\.dispatch\s*\(/);
  });

  it('App commits a command in only the places that have been audited', () => {
    const code = strip(readFileSync(path.join(REPO_ROOT, 'src', 'App.tsx'), 'utf8'));
    const sites = code.match(/runtime\.dispatch\s*\(/g) ?? [];
    // 1. inside `interact`, after the gate has answered — the authorised commit point
    // 2. `applyAdvance`, replaying the commands a *finished step* asks for (the lesson is
    //    the author of those, not the learner)
    // 3. `handleCalculate`, immediately after `interact` returned true
    // 4. `SELECT_EXPERIMENT` — session setup, resets the lesson, not an apparatus action
    // 5. `SET_PUMP_FLOW` — a Custom Parameters value, likewise not an apparatus action
    // 6. `handleRecordReading` off a balance step — taking a reading is not an apparatus
    //    action either, and the runtime refuses an unbalanced tray on its own
    // Each is recorded in `docs/36 §9`. If this number moves, the new call site needs an
    // entry there before this expectation is updated.
    expect(sites.length).toBe(6);
  });

  it('no component writes the rig’s state for itself', () => {
    // BEDO-022 §28. The two pieces of apparatus state this task touches are the ones a
    // component is most tempted to edit in place — a selected id and an array of discs.
    for (const file of componentFiles) {
      const code = strip(readFileSync(path.join(REPO_ROOT, 'src', 'components', file), 'utf8'));
      expect(code, `${file} assigns selectedDeflectorId`).not.toMatch(
        /selectedDeflectorId\s*=[^=]/
      );
      expect(code, `${file} assigns loadedWeightsG`).not.toMatch(/loadedWeightsG\s*=[^=]/);
      // Array mutators on the tray, which would change the rig behind the runtime's back.
      expect(code, `${file} mutates loadedWeightsG`).not.toMatch(
        /loadedWeightsG\.(push|pop|shift|unshift|splice|sort|reverse)\s*\(/
      );
    }
  });

  it('never commits an apparatus intent without the gate', () => {
    const code = strip(readFileSync(path.join(REPO_ROOT, 'src', 'App.tsx'), 'utf8'));
    const APPARATUS_INTENTS = [
      'OPEN_COVER',
      'CLOSE_COVER',
      'POWER_ON',
      'POWER_OFF',
      'SET_VALVE',
      'OPEN_VOLUMETRIC_VALVE',
      'CLOSE_VOLUMETRIC_VALVE',
      'SELECT_DEFLECTOR',
      'ADD_WEIGHT',
      'REMOVE_WEIGHT',
      'REMOVE_ALL_WEIGHTS',
    ];
    for (const intent of APPARATUS_INTENTS) {
      // The gate's whole value is that there is no second way in. A literal apparatus
      // command handed straight to the runtime is that second way.
      expect(
        code,
        `App.tsx dispatches ${intent} directly instead of through the gate`
      ).not.toMatch(new RegExp(`runtime\\.dispatch\\(\\s*\\{\\s*type: '${intent}'`));
    }
  });
});
