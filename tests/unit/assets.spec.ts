import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WATER_SHAPES } from '../../src/domain/apparatus';
import { EXPERIMENTS, answerSheetFor, type ExperimentId } from '../../src/domain/experiments';
import { REPO_ROOT, assetPath, fileSize } from '../helpers/glb';

/**
 * Production asset sanity (BEDO-002 §6).
 *
 * Deliberately lightweight: existence, size and file magic. Anything that needs a GPU
 * belongs in the Playwright suite, and the geometry of the model is covered by
 * `glb-contract.spec.ts`.
 */

const GLB_MAGIC = 0x46546c67; // "glTF"

const readMagic = (relative: string) => {
  const buffer = Buffer.alloc(4);
  const fd = readFileSync(assetPath(relative)).subarray(0, 4);
  buffer.set(fd);
  return buffer.readUInt32LE(0);
};

describe('the apparatus model', () => {
  const MODEL = 'public/Bedo_baked_v2.glb';

  it('exists and is not a placeholder', () => {
    expect(fileSize(MODEL), `${MODEL} is missing or empty`).toBeGreaterThan(1_000_000);
  });

  it('is a binary glTF', () => {
    expect(readMagic(MODEL)).toBe(GLB_MAGIC);
  });
});

describe('the water plume models', () => {
  it.each(Object.entries(WATER_SHAPES))('%s exists, is non-empty, and is a GLB', (key, shape) => {
    const relative = `public${shape.url}`;
    expect(fileSize(relative), `${key}: ${relative} is missing or empty`).toBeGreaterThan(1000);
    expect(readMagic(relative), `${key} is not a binary glTF`).toBe(GLB_MAGIC);
  });

  it('ships one file per declared plume, all eight of them', () => {
    const shipped = readdirSync(assetPath('public/WaterShapes')).filter((f) => f.endsWith('.glb'));
    expect(shipped).toHaveLength(8);
    for (const shape of Object.values(WATER_SHAPES)) {
      expect(shipped).toContain(path.basename(shape.url));
    }
  });
});

// The app resolves these at runtime from absolute URLs, so a typo or a moved file is only
// discovered when a student loads the page and something is silently absent. Scanned once,
// at module scope, because two suites below check it from opposite directions: every
// reference resolves to a file, and every served file has a reference.
const MEDIA = /(['"`])(\/[\w./-]+\.(?:glb|webp|png|jpe?g|svg|mp4|pdf|hdr|exr))\1/g;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });

const referenced = [
  ...new Set(
    sources(path.join(REPO_ROOT, 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(MEDIA)].map((m) => m[2])
    )
  ),
].sort();

describe('every media file the source asks for', () => {
  it('finds the references it expects to find', () => {
    // A guard on the scan itself: if the regex ever stops matching, the test below would
    // pass vacuously.
    expect(referenced).toContain('/Bedo_baked_v2.glb');
    expect(referenced).toContain('/rosendal_plains_2_4k.webp');
    expect(referenced.length).toBeGreaterThanOrEqual(10);
  });

  it.each(referenced)('%s is present in public/', (url) => {
    const relative = `public${url}`;
    expect(fileSize(relative), `${url} is referenced in src/ but not in public/`).toBeGreaterThan(0);
  });
});

describe('the served asset set is closed', () => {
  // BEDO-004. `public/` is copied wholesale into `dist/` and from there into the
  // container image, so anything that lands in it ships to production whether or not a
  // single line of code can reach it. Before BEDO-004 that was 39 MB of Alembic caches
  // and superseded model exports. This test is what stops them coming back: every file
  // in public/ must be one the application actually requests.
  const PRODUCTION_ASSETS = [
    'Bedo_Mesu_J.mp4',
    'Bedo_baked_v2.glb',
    'WaterShapes/Water120_HemiSphere.glb',
    'WaterShapes/Water135_Conical.glb',
    'WaterShapes/Water180_HemiSphere.glb',
    'WaterShapes/Water30.glb',
    'WaterShapes/Water45_Oblique.glb',
    'WaterShapes/Water60_Cone.glb',
    'WaterShapes/Water90_Flat.glb',
    'WaterShapes/Water_low.glb',
    'favicon.svg',
    'rosendal_plains_2_4k.webp',
    // The worksheets the closing step opens, added by BEDO-019. Fetched on demand, never
    // at boot — `README.txt` records their provenance beside them.
    'answer-sheets/README.txt',
    'answer-sheets/flat.pdf',
    'answer-sheets/semi.pdf',
    'answer-sheets/conical.pdf',
    'answer-sheets/oblique.pdf',
  // Self-hosted Basis transcoder for KHR_texture_basisu in the apparatus GLB. Kept in the
  // repository deliberately: KTX2Loader must fetch these at runtime and a CDN would add an
  // external dependency to first load.
  'basis/basis_transcoder.js',
  'basis/basis_transcoder.wasm',
];

  const served = (dir: string, prefix = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? served(path.join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`]
    );

  it('contains exactly the assets the app can request, and nothing else', () => {
    const actual = served(assetPath('public')).sort();
    expect(
      actual,
      'a file in public/ is shipped to every user — if it is not requested, it belongs in assets-source/'
    ).toEqual([...PRODUCTION_ASSETS].sort());
  });

  it('every one of them is reachable from the source', () => {
    // Cross-check against the independent scan above: the two lists must agree, so a
    // stale entry in PRODUCTION_ASSETS cannot keep a dead file alive.
    const fromSource = new Set(referenced.map((url) => url.replace(/^\//, '')));
    fromSource.add('favicon.svg'); // referenced by index.html, not by src/
    fromSource.add('answer-sheets/README.txt'); // provenance note, not loaded by the app
    // KTX2Loader is given the directory (`/basis/`) and appends these filenames itself, so
    // neither appears literally in src/. They are fetched at runtime for every user.
    fromSource.add('basis/basis_transcoder.js');
    fromSource.add('basis/basis_transcoder.wasm');
    for (const asset of PRODUCTION_ASSETS) {
      expect(fromSource.has(asset), `${asset} is served but nothing references it`).toBe(true);
    }
  });

  it('pins the frozen behavioural fixture, and keeps it out of the served set', () => {
    // tests/e2e/fixture.ts serves this file in place of the production apparatus GLB for
    // the behavioural suite, because that suite runs on SwiftShader where compressed
    // texture sampling is emulated. It must stay byte-identical to the pre-KTX2 production
    // asset (dc8b4c8) or the functional baseline silently becomes the candidate.
    const fixture = 'tests/fixtures/Bedo_baked_v2.functional.glb';
    expect(fileSize(fixture), 'the frozen functional fixture is missing').toBe(11_948_588);
    expect(
      createHash('sha256').update(readFileSync(assetPath(fixture))).digest('hex'),
      'the frozen functional fixture no longer matches the dc8b4c8 production GLB'
    ).toBe('f1836e3b0af22f9090df2136899b69e77e455b7dd19d9b3aa3ccf2f6cf24d6f4');
    // It is test-only: it must never be served.
    expect(served(assetPath('public'))).not.toContain('Bedo_baked_v2.functional.glb');
  });

  it('keeps the source assets out of the served directory', () => {
    // These were moved to assets-source/ by BEDO-004; they are preserved, not deleted.
    for (const gone of [
      'public/Bedo_M.glb',
      'public/Bedo_model_optimized.glb',
      'public/icons.svg',
      'public/WaterShapes/Water30.abc',
      'public/WaterShapes/Water_low.abc',
    ]) {
      expect(fileSize(gone), `${gone} is back in public/`).toBe(-1);
    }
    expect(readdirSync(assetPath('public/WaterShapes')).filter((f) => f.endsWith('.abc'))).toEqual(
      []
    );
  });

  it('preserves them in assets-source/, where nothing serves them', () => {
    // The point of BEDO-004 was to stop shipping these, not to lose them: they are the
    // input to the asset-pipeline work in docs/23.
    expect(fileSize('assets-source/models/Bedo_M.glb')).toBeGreaterThan(1_000_000);
    expect(fileSize('assets-source/models/Bedo_model_optimized.glb')).toBeGreaterThan(100_000);
    expect(fileSize('assets-source/images/icons.svg')).toBeGreaterThan(0);
    expect(
      readdirSync(assetPath('assets-source/WaterShapes')).filter((f) => f.endsWith('.abc'))
    ).toHaveLength(8);
    expect(fileSize('assets-source/README.md')).toBeGreaterThan(0);
  });
});

describe('the app shell', () => {
  it('boots from src/main.tsx and mounts into #root', () => {
    const html = readFileSync(assetPath('index.html'), 'utf8');
    expect(html).toContain('id="root"');
    expect(html).toContain('/src/main.tsx');
  });

  it('keeps the reference material out of the shipped bundle directory', () => {
    // docs/reference holds BEDO's own documents; they must never be served.
    expect(statSync(assetPath('docs/reference')).isDirectory()).toBe(true);
    expect(fileSize('public/Storyboard.pptx')).toBe(-1);
  });
});

describe('the answer sheets', () => {
  // BEDO-019. The closing step opens one worksheet per experiment, chosen by stable id
  // rather than by file order — getting this wrong would hand a student the wrong sheet
  // with no obvious symptom.
  const EXPECTED: Record<string, string> = {
    flat: '/answer-sheets/flat.pdf',
    semi: '/answer-sheets/semi.pdf',
    conical: '/answer-sheets/conical.pdf',
    oblique: '/answer-sheets/oblique.pdf',
  };

  it.each(Object.entries(EXPECTED))('%s maps to %s, and the file is there', (id, url) => {
    expect(answerSheetFor(id as ExperimentId)).toBe(url);
    expect(fileSize(`public${url}`), `${url} is missing`).toBeGreaterThan(100_000);
  });

  it('covers every experiment, with no sheet shared between two', () => {
    const ids = EXPERIMENTS.map((experiment) => experiment.id);
    const urls = ids.map((id) => answerSheetFor(id));
    expect(urls.every((url) => url !== null)).toBe(true);
    expect(new Set(urls).size).toBe(ids.length);
  });

  it('every sheet is a PDF', () => {
    for (const url of Object.values(EXPECTED)) {
      const header = readFileSync(assetPath(`public${url}`)).subarray(0, 5).toString('latin1');
      expect(header, `${url} is not a PDF`).toBe('%PDF-');
    }
  });

  it('records where they came from', () => {
    const readme = readFileSync(assetPath('public/answer-sheets/README.txt'), 'utf8');
    expect(readme).toContain('Exp.{1..4} (Answer sheet).pdf');
    expect(readme).toContain('not answer keys');
  });

  it('is small enough to stay off the critical path', () => {
    // Roughly 1 MB in total, and none of it is fetched until a learner asks for it.
    const total = Object.values(EXPECTED).reduce((sum, url) => sum + fileSize(`public${url}`), 0);
    expect(total).toBeLessThan(2 * 1024 * 1024);
  });
});
