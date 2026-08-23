import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  RIPPLE_TILES,
  WATER_UV_ATTRIBUTE,
  buildWaterUv,
  flowAxisOf,
} from '../../src/lib/waterUv';
import { WATER_SHAPES, type WaterShapeKey } from '../../src/domain/apparatus';
import { REPO_ROOT, assetPath } from '../helpers/glb';

/**
 * The water's surface coordinate, and the banding it replaces (BUG-03's other half).
 *
 * The shader sampled its ripple texture at `vWPos.xz` and `vWPos.y` — a world-space planar
 * projection. Across the water's cross-section `xz` barely moves, so the lookup collapsed to
 * a function of height and drew horizontal stripes. `BEDO-017` sharpened that by a factor of
 * seventeen when it corrected the jet from 172 mm to its true 10 mm bore.
 *
 * The obvious repair — "the assets have UVs, use them" — does not work, and the tests below
 * record why rather than asserting it: the authored channels address no texture at all, are
 * laid out as a per-primitive atlas, reverse direction between primitives of the same shape,
 * and on one primitive do not track the flow at all.
 */

interface Prim {
  asset: WaterShapeKey;
  positions: Float32Array;
  uvSets: string[];
}

const prims: Prim[] = [];

const ensureGlobals = () => {
  const g = globalThis as unknown as { self?: unknown };
  g.self ??= globalThis;
};

const loadWater = (url: string): Promise<THREE.Group> =>
  new Promise((resolve, reject) => {
    ensureGlobals();
    const bytes = readFileSync(assetPath(path.join('public', url)));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const error = console.error;
    console.error = (...a: unknown[]) => {
      if (typeof a[0] === 'string' && a[0].includes("Couldn't load texture")) return;
      error(...a);
    };
    new GLTFLoader().parse(
      buffer as ArrayBuffer,
      '',
      (g) => {
        console.error = error;
        resolve(g.scene);
      },
      (c) => {
        console.error = error;
        reject(c instanceof Error ? c : new Error(String(c)));
      }
    );
  });

beforeAll(async () => {
  for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
    const scene = await loadWater(WATER_SHAPES[key].url);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      prims.push({
        asset: key,
        positions: mesh.geometry.getAttribute('position').array as Float32Array,
        uvSets: Object.keys(mesh.geometry.attributes)
          .filter((a) => a.startsWith('uv'))
          .sort(),
      });
    });
  }
});

describe('the authored UV channels, and why they cannot be used', () => {
  it('exist on every asset, so their absence is not the reason', () => {
    expect(prims.length).toBeGreaterThanOrEqual(8);
    for (const p of prims) {
      expect(p.uvSets, `${p.asset} has no UVs`).toContain('uv');
    }
  });

  it('has a second channel on exactly three assets', () => {
    // `docs/41` recorded two. Re-inspecting the accessors for this task found three:
    // Water45_Oblique carries TEXCOORD_1 as well. Pinned so the inventory stays honest.
    const withUv1 = new Set(prims.filter((p) => p.uvSets.includes('uv1')).map((p) => p.asset));
    expect([...withUv1].sort()).toEqual(['d180', 'd45', 'd90']);
  });

  it('addresses no texture at all — the channels are authoring leftovers', () => {
    // Every shipped water GLB declares zero textures and zero images. Whatever these UVs
    // were laid out for was never shipped with them.
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      const raw = readFileSync(assetPath(path.join('public', WATER_SHAPES[key].url)));
      const jsonLength = raw.readUInt32LE(12);
      const json = JSON.parse(raw.subarray(20, 20 + jsonLength).toString('utf8'));
      expect(json.textures ?? [], `${key} has textures`).toHaveLength(0);
      expect(json.images ?? [], `${key} has images`).toHaveLength(0);
    }
  });
});

describe('the surface coordinate is derived from the geometry', () => {
  it('finds the axis each shape actually flows along', () => {
    // Three shapes are authored lying down, so this cannot be assumed to be Y.
    const axes = new Set(prims.map((p) => flowAxisOf(p.positions)));
    expect(axes.size).toBeGreaterThan(1);
    for (const p of prims) {
      const axis = flowAxisOf(p.positions);
      const size = [0, 1, 2].map((k) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = k; i < p.positions.length; i += 3) {
          if (p.positions[i] < lo) lo = p.positions[i];
          if (p.positions[i] > hi) hi = p.positions[i];
        }
        return hi - lo;
      });
      expect(size[axis]).toBe(Math.max(...size));
    }
  });

  it('spans the full 0..1 along the flow for every shipped primitive', () => {
    // The old vertex code used clamp(position.y * 0.05 + 0.5, 0, 1), which is pinned at 1
    // for anything authored above y = 10 — which is most of these. Normalising by each
    // mesh's own bounds is what fixes that.
    for (const p of prims) {
      const { uv } = buildWaterUv(p.positions);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 1; i < uv.length; i += 2) {
        if (uv[i] < lo) lo = uv[i];
        if (uv[i] > hi) hi = uv[i];
      }
      expect(lo, `${p.asset} v does not start at 0`).toBeCloseTo(0, 6);
      expect(hi, `${p.asset} v does not reach 1`).toBeCloseTo(1, 6);
    }
  });

  it('varies across the flow as well as along it — the whole point', () => {
    // The defect was a coordinate that only changed with height. Every shipped primitive
    // must now vary in *both* directions, or it can still stripe.
    for (const p of prims) {
      const { uv } = buildWaterUv(p.positions);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < uv.length; i += 2) {
        if (uv[i] < lo) lo = uv[i];
        if (uv[i] > hi) hi = uv[i];
      }
      expect(hi - lo, `${p.asset} u does not vary`).toBeGreaterThan(0.5);
    }
  });

  it('stays inside 0..1 so the ripple tiles predictably', () => {
    for (const p of prims) {
      const { uv } = buildWaterUv(p.positions);
      for (let i = 0; i < uv.length; i++) {
        expect(uv[i]).toBeGreaterThanOrEqual(-1e-6);
        expect(uv[i]).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it('is object space, so nothing about it can depend on the camera', () => {
    // Same vertices in, same coordinate out — no view, no projection, no time.
    const a = buildWaterUv(prims[0].positions);
    const b = buildWaterUv(prims[0].positions);
    expect(Array.from(a.uv)).toEqual(Array.from(b.uv));
  });

  it('degrades to zeros rather than NaNs on a degenerate mesh', () => {
    expect(buildWaterUv(new Float32Array([])).uv).toHaveLength(0);
    const flat = buildWaterUv(new Float32Array([1, 2, 3, 1, 2, 3]));
    expect([...flat.uv].every(Number.isFinite)).toBe(true);
  });
});

describe('the shader samples the surface, not the world', () => {
  const source = () =>
    readFileSync(path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'), 'utf8');
  const shader = () => {
    const s = source();
    return s.slice(s.indexOf('mat.onBeforeCompile'), s.indexOf('return mat;'));
  };

  /**
   * Every ripple lookup's coordinate, with local `vec2` variables resolved to their
   * definitions — two of the four are built a line above the lookup that uses them.
   */
  const lookupCoords = (): string[] => {
    const block = shader();
    const locals = new Map<string, string>();
    for (const m of block.matchAll(/vec2\s+(\w+)\s*=([\s\S]*?);/g)) {
      locals.set(m[1], m[2]);
    }
    return [...block.matchAll(/texture2D\(uWaterTex,([\s\S]*?)\)\.[rgb]/g)].map((m) => {
      const arg = m[1].trim();
      const named = locals.get(arg);
      return named ? `${arg} = ${named}` : arg;
    });
  };

  it('no longer uses world position as a texture coordinate', () => {
    // The literal defect: texture2D(uWaterTex, vWPos.xz * 6.0 + ...).
    const coords = lookupCoords();
    expect(coords.length).toBeGreaterThanOrEqual(4);
    for (const arg of coords) {
      expect(arg, 'a ripple lookup still reads world position').not.toMatch(/vWPos/);
      expect(arg, 'a ripple lookup reads the camera').not.toMatch(/cameraPosition/);
      expect(arg).toMatch(/vWaterUv/);
    }
  });

  it('still animates, and animates only through time', () => {
    // §5: the coordinate is spatial, the motion is uTime. Changing the sampling space must
    // not stop the water moving.
    for (const arg of lookupCoords()) expect(arg).toMatch(/uTime/);
  });

  it('keeps world position only for the view vector it is actually needed for', () => {
    const block = shader();
    expect(block).toMatch(/normalize\(cameraPosition - vWPos\)/);
  });

  it('binds the coordinate as an attribute the geometry carries', () => {
    expect(shader()).toMatch(/attribute vec2 aWaterUv/);
    // Set through the exported constant, so the shader and the geometry cannot drift apart.
    expect(source()).toMatch(/setAttribute\(WATER_UV_ATTRIBUTE,/);
    expect(WATER_UV_ATTRIBUTE).toBe('aWaterUv');
  });

  it('treats the ripple map as data, not colour', () => {
    // §12. It is a height/gradient field the shader does arithmetic on; decoding it as sRGB
    // would bend its response.
    expect(source()).toMatch(/tex\.colorSpace = THREE\.NoColorSpace/);
  });

  it('never falls back to tank or viewport dimensions', () => {
    const s = source();
    expect(s).not.toMatch(/tankBounds/);
    const uv = readFileSync(path.join(REPO_ROOT, 'src/lib/waterUv.ts'), 'utf8');
    const code = uv
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/tank|viewport|innerWidth|camera/i);
  });
});

describe('ripple density', () => {
  it('keeps the along-flow density the old projection produced', () => {
    // Over the jet — 0.331 world units — the old multipliers gave 2.98 and 4.14 tiles.
    expect(RIPPLE_TILES.normal.along).toBe(3);
    expect(RIPPLE_TILES.highlight.along).toBe(4);
  });

  it('gives the across-flow direction a density it can actually vary at', () => {
    // The defect: 0.11 and 0.09 tiles across the jet's 18 mm width — less than a tenth of a
    // repeat, so the lookup could not vary and drew stripes.
    expect(RIPPLE_TILES.normal.around).toBeGreaterThanOrEqual(2);
    expect(RIPPLE_TILES.highlight.around).toBeGreaterThanOrEqual(2);
  });

  it('keeps the two layers from beating into a pattern of their own', () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    expect(gcd(RIPPLE_TILES.normal.along, RIPPLE_TILES.highlight.along)).toBe(1);
    expect(gcd(RIPPLE_TILES.normal.around, RIPPLE_TILES.highlight.around)).toBe(1);
  });

  it('stays near the authored density rather than getting denser', () => {
    // A first attempt at 7 and 11 along the flow read as a stack of rings. Denser is not
    // less banded.
    expect(RIPPLE_TILES.normal.along).toBeLessThan(5);
    expect(RIPPLE_TILES.highlight.along).toBeLessThan(6);
  });
});

describe('the shipped assets still load', () => {
  it('has eight of them, all parseable, all with geometry', () => {
    expect(readdirSync(path.join(REPO_ROOT, 'public', 'WaterShapes')).filter((f) => f.endsWith('.glb'))).toHaveLength(8);
    const byAsset = new Set(prims.map((p) => p.asset));
    expect(byAsset.size).toBe(8);
    for (const p of prims) expect(p.positions.length).toBeGreaterThan(0);
  });
});
