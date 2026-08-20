import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WATER_SHAPES } from '../../src/lib/apparatus';
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

describe('every media file the source asks for', () => {
  // The app resolves these at runtime from absolute URLs, so a typo or a moved file is
  // only discovered when a student loads the page and something is silently absent.
  const MEDIA = /(['"`])(\/[\w./-]+\.(?:glb|webp|png|jpe?g|svg|mp4|hdr|exr))\1/g;

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
