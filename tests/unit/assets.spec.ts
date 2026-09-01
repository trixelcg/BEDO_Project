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

/**
 * Assets are also named indirectly, through `assetUrl()` / `assetDirUrl()`.
 *
 * PERF-06 gave every versioned runtime asset a content-addressed URL
 * (`/runtime/<hash>/Bedo_baked_v2.glb`) so that two releases can coexist during a Cloud
 * Run traffic split. The literal path therefore no longer appears in the component that
 * loads it — only the logical name does. Scanning for that name as well keeps this suite
 * as strong as it was: a moved or misspelled asset is still caught here rather than by a
 * student loading the page.
 */
const LOGICAL = /\bassetUrl\((['"`])\/?([\w./-]+\.(?:glb|webp|png|jpe?g|svg|mp4|pdf|hdr|exr))\1\)/g;
const LOGICAL_DIR = /\bassetDirUrl\((['"`])([\w./-]+)\1\)/g;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });

const referenced = [
  ...new Set(
    sources(path.join(REPO_ROOT, 'src')).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [
        ...[...text.matchAll(MEDIA)].map((m) => m[2]),
        ...[...text.matchAll(LOGICAL)].map((m) => `/${m[2]}`),
      ];
    })
  ),
].sort();

/** Directories handed to a loader that appends its own filenames — currently `basis/`. */
const referencedDirs = [
  ...new Set(
    sources(path.join(REPO_ROOT, 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(LOGICAL_DIR)].map((m) => m[2])
    )
  ),
];

describe('every media file the source asks for', () => {
  it('finds the references it expects to find', () => {
    // A guard on the scan itself: if the regex ever stops matching, the test below would
    // pass vacuously.
    expect(referenced).toContain('/Bedo_baked_v2.glb');
    expect(referenced).toContain('/rosendal_plains_2_4k.webp');
    expect(referenced).toContain('/WaterShapes/Water_low.glb');
    // The transcoder directory is named through assetDirUrl(), not as a file path.
    expect(referencedDirs).toContain('basis');
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
    // Branding. The logo is referenced by both the boot shell and the React overlay; the
    // favicon set is referenced by index.html only. All are stable-name assets — see the
    // note on VERSIONED_FILES in scripts/release/asset-manifest.mjs for why branding is
    // not content-addressed. Generated by scripts/brand/build-icons.py.
    //
    // Only the dark derivative ships: the loader is the one surface that shows the mark and
    // it is dark, so the light-background original would be a file nothing requests — which
    // is exactly what the closed-set test below exists to prevent. It stays in
    // assets-source/brand/, untouched.
    'apple-touch-icon.png',
    'bedo-logo-dark.png',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'favicon.ico',
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
  // Generated by scripts/release/asset-manifest.mjs. It ships on purpose: server.ts reads
  // it at boot to map this generation's content-addressed URLs back to local files, so a
  // revision can serve its own assets without a bucket round-trip.
  'runtime-manifest.json',
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
    // The favicon set is declared in index.html's <head>, not by src/ — it has to resolve
    // on a direct page load, before any bundle runs. `bedo-logo.png` needs no exception:
    // LoadingScreen.tsx names it literally, so the scan above already found it.
    fromSource.add('favicon.ico');
    fromSource.add('favicon-16x16.png');
    fromSource.add('favicon-32x32.png');
    fromSource.add('apple-touch-icon.png');
    fromSource.add('answer-sheets/README.txt'); // provenance note, not loaded by the app
    // KTX2Loader is given the directory (`/basis/`) and appends these filenames itself, so
    // neither appears literally in src/. They are fetched at runtime for every user.
    fromSource.add('basis/basis_transcoder.js');
    fromSource.add('basis/basis_transcoder.wasm');
    fromSource.add('runtime-manifest.json'); // read by server.ts, not by the bundle
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

  it('declares the favicon in static HTML, so it resolves without React', () => {
    // The tab icon must be right on a direct page load and on the error page — neither
    // runs the bundle. Declaring it in <head> is what makes that true, so the contract is
    // that these live in index.html and not in a component.
    const html = readFileSync(assetPath('index.html'), 'utf8');
    // The whole tag, not just up to `href` — attribute order differs between these links
    // and a truncated match would silently drop whichever attribute came last.
    const icons = [...html.matchAll(/<link\s+rel="(icon|apple-touch-icon)"([^>]*)\/?>/g)].map(
      (m) => ({ rel: m[1], href: /href="([^"]+)"/.exec(m[2])?.[1], sizes: /sizes="([^"]+)"/.exec(m[2])?.[1] })
    );
    expect(icons.map((i) => i.href).sort()).toEqual([
      '/apple-touch-icon.png',
      '/favicon-16x16.png',
      '/favicon-32x32.png',
      '/favicon.ico',
    ]);
    // Every declared icon has to exist, or the tab silently falls back to a blank page
    // glyph with nothing in the console.
    for (const { href } of icons) {
      expect(fileSize(`public${href}`), `${href} is declared but not in public/`).toBeGreaterThan(0);
    }
    // No two `rel="icon"` entries may claim the same slot: the .ico is the multi-resolution
    // fallback (`any`) and the PNGs are exact sizes, so the browser's choice is unambiguous.
    const slots = icons.filter((i) => i.rel === 'icon').map((i) => i.sizes);
    expect(slots).toEqual(['any', '16x16', '32x32']);
    expect(new Set(slots).size, 'two icon links claim the same size').toBe(slots.length);
    // The superseded purple template asset must not linger alongside them.
    expect(html).not.toContain('favicon.svg');
    expect(fileSize('public/favicon.svg'), 'the superseded favicon is back').toBe(-1);
  });

  it('paints the brand mark before the bundle runs, at the same size the overlay uses', () => {
    // BEDO-UX-04's boot shell and the React overlay draw the same logo; if they disagree on
    // size, or on which file they draw, the handover reads as a jump or a second request.
    // Both are pinned here because they live in different files and nothing else would
    // catch them drifting apart.
    const html = readFileSync(assetPath('index.html'), 'utf8');
    const overlay = readFileSync(assetPath('src/components/LoadingScreen.tsx'), 'utf8');
    const MARK = '/bedo-logo-dark.png';
    expect(html, 'the boot shell must draw the mark').toContain(`src="${MARK}"`);
    expect(overlay, 'the overlay must draw the same file as the boot shell').toContain(
      `src="${MARK}"`
    );
    expect(fileSize(`public${MARK}`), 'the dark variant is missing').toBeGreaterThan(0);
    // It must be the dark derivative, never the light-background original: on #141517 half
    // of the authored artwork measures 1.77:1 and effectively disappears (BEDO-UX-16). The
    // original is preserved in assets-source/ and must not be served.
    expect(html).not.toContain('"/bedo-logo.png"');
    expect(overlay).not.toContain('"/bedo-logo.png"');
    expect(fileSize('public/bedo-logo.png'), 'the light-background logo is being served').toBe(-1);
    expect(fileSize('assets-source/brand/BEDOLogo.png'), 'the authored logo was lost').toBeGreaterThan(0);
    expect(html).toContain('alt="BEDO"');
    // Intrinsic dimensions, so the bar below the mark does not shift when the PNG lands.
    expect(html).toContain('width="447"');
    expect(html).toContain('height="447"');
    const SIZE = 'clamp(84px, 18vmin, 128px)';
    expect(html, 'the boot shell must size the mark').toContain(SIZE);
    expect(
      readFileSync(assetPath('src/index.css'), 'utf8'),
      'the overlay mark must match the boot shell'
    ).toContain(SIZE);
    // The typographic stand-in it replaced is gone from both frames.
    expect(html).not.toContain('>BEDO<');
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
