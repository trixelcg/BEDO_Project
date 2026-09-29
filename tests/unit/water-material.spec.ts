import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  REFRACTION_DEPTH_SCALE,
  WATER_ABSORPTION_PER_M,
  WATER_SEGMENT,
  WATER_WAVE_AMPLITUDE,
  WATER_WAVE_LENGTHS_M,
  WATER_WAVE_WEIGHTS,
  createWaterMaterial,
  createWaterUniforms,
  type WaterKind,
} from '../../src/lib/waterMaterial';
import { FILM_OFFSET_M, type JetPath, type PathPoint } from '../../src/lib/jetFlow';
import { createJetFlowGeometry, createPoolMesh, createPoolUniforms, writeJetPath } from '../../src/lib/jetFlowMesh';
import { readFileSync } from 'node:fs';

/**
 * The shared water material (product-owner request, 2026-09-28): the jet, its sheets and
 * the hose are one substance — reflection on top, absorption by thickness underneath, and a
 * surface carried along at the water's own speed. The shader cannot run under vitest; what
 * is checked here is the optics it is built from and the way it is configured.
 */

const transmit = (pathM: number) => WATER_ABSORPTION_PER_M.map((k) => Math.exp(-k * pathM));

describe('Beer–Lambert by thickness', () => {
  it('a 10 mm jet is a clear rod with a faint cyan core', () => {
    const [r, g, b] = transmit(0.01);
    expect(r).toBeGreaterThan(0.5);
    expect(g).toBeGreaterThan(0.75);
    expect(b).toBeGreaterThan(0.9);
    // Blue passes best, red worst: water's own order.
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  it('a 0.2 mm sheet is next to invisible — it shows by its highlights', () => {
    for (const t of transmit(0.0002)) expect(t).toBeGreaterThan(0.98);
  });

  it('a hose bore reads blue-green through the middle', () => {
    const [r, , b] = transmit(0.016);
    expect(r).toBeLessThan(0.45);
    expect(b).toBeGreaterThan(0.85);
  });
});

describe('the material', () => {
  const texture = new THREE.Texture();

  it('adds its reflection and attenuates the background — premultiplied, not tinted plastic', () => {
    for (const kind of ['stream-body', 'stream-sheet', 'conduit'] as const) {
      const m = createWaterMaterial(texture, createWaterUniforms(), kind);
      expect(m.premultipliedAlpha).toBe(true);
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      // Water's own index, and a near-mirror surface: its look is what it reflects.
      expect(m.ior).toBeCloseTo(1.333, 3);
      expect(m.roughness).toBeLessThan(0.1);
      expect(m.metalness).toBe(0);
    }
  });

  it('the jet and the hose share it; the jet’s segment codes are the material’s', () => {
    expect(WATER_SEGMENT).toEqual({ column: 0, film: 1, free: 2, runoff: 3, conduit: 4 });
  });

  it('shares the uniforms it is given, so one clock drives it', () => {
    const uniforms = createWaterUniforms();
    const m = createWaterMaterial(texture, uniforms, 'stream-body');
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <begin_vertex>',
      fragmentShader:
        'void main() {\n#include <normal_fragment_maps>\n#include <opaque_fragment>\n#include <premultiplied_alpha_fragment>\n}',
      defines: {},
    };
    m.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms.uClock).toBe(uniforms.uClock);
    expect(shader.uniforms.uHead).toBe(uniforms.uHead);
    // The premultiplied chunk is removed: the colour written is already premultiplied.
    expect(shader.fragmentShader).not.toMatch(/premultiplied_alpha_fragment/);
    expect(shader.fragmentShader).toMatch(/float parcel = uClock - vFlowUv\.y;/);
  });

  const KINDS: WaterKind[] = ['stream-body', 'stream-sheet', 'conduit'];

  it('each kind compiles to its own program — they share one onBeforeCompile source', () => {
    // three keys programs by `customProgramCacheKey()`, which defaults to the
    // onBeforeCompile source. Shared, the first kind compiled was reused for the others: the
    // jet drew with the hose's shader, refracting the whole tank with black rings.
    const keys = KINDS.map((k) => createWaterMaterial(texture, createWaterUniforms(), k).customProgramCacheKey());
    expect(new Set(keys).size).toBe(KINDS.length);
    for (const k of KINDS) {
      const m = createWaterMaterial(texture, createWaterUniforms(), k);
      expect(m.defines?.WATER_CONDUIT).toBe(k === 'conduit' ? 1 : 0);
      expect(m.defines?.WATER_SHEET).toBe(k === 'stream-sheet' ? 1 : 0);
      // three's own physical defines survive.
      expect(m.defines).toHaveProperty('PHYSICAL');
    }
  });

  it('refracts through bodies of water, not through a thin sheet', () => {
    expect(createWaterMaterial(texture, createWaterUniforms(), 'stream-body').transmission).toBe(1);
    // The hose is blended, not refracted: its refraction across the tank's collar broke into
    // black and white speckle (QA, 2026-09-29).
    expect(createWaterMaterial(texture, createWaterUniforms(), 'conduit').transmission).toBe(0);
    expect(createWaterMaterial(texture, createWaterUniforms(), 'stream-sheet').transmission).toBe(0);
  });

  it('the refraction depth is exaggerated; the colour is still the real depth’s', () => {
    const m = createWaterMaterial(texture, createWaterUniforms(), 'stream-body');
    // three: attenuationColor is what is left after attenuationDistance of (refraction) depth.
    // That distance stands for attenuationDistance / scale of real water.
    const real = m.attenuationDistance / REFRACTION_DEPTH_SCALE;
    const expected = WATER_ABSORPTION_PER_M.map((k) => Math.exp(-k * real));
    expect(m.attenuationColor.r).toBeCloseTo(expected[0], 5);
    expect(m.attenuationColor.g).toBeCloseTo(expected[1], 5);
    expect(m.attenuationColor.b).toBeCloseTo(expected[2], 5);
  });
});

describe('surface waves', () => {
  const peak = WATER_WAVE_WEIGHTS[0] + WATER_WAVE_WEIGHTS[1];

  it('only the long trains move the surface, and they stay inside the film gaps', () => {
    // Films ride 0.6 mm off the deflector and the glass: the waves must not reach through.
    expect(WATER_WAVE_AMPLITUDE.film * peak).toBeLessThan(FILM_OFFSET_M / 2);
    expect(WATER_WAVE_AMPLITUDE.runoff * peak).toBeLessThan(FILM_OFFSET_M / 2);
    // The 180° curtain passes the nozzle tube 1.0 mm clear (docs/57 §3).
    expect(WATER_WAVE_AMPLITUDE.free * peak).toBeLessThan(0.001);
    // A 5 mm column ripples by a fraction of a millimetre: wavy, not a different jet.
    expect(0.005 * WATER_WAVE_AMPLITUDE.column).toBeLessThan(0.0005);
  });

  it('are laid out on distance along the path, finer than the jet is long', () => {
    for (const l of WATER_WAVE_LENGTHS_M) {
      expect(l).toBeGreaterThan(0.001);
      expect(l).toBeLessThan(0.024);
    }
    const m = createWaterMaterial(new THREE.Texture(), createWaterUniforms(), 'stream-body');
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: 'void main() {\n#include <begin_vertex>\n}',
      fragmentShader:
        'void main() {\n#include <normal_fragment_maps>\n#include <opaque_fragment>\n#include <premultiplied_alpha_fragment>\n}',
      defines: {},
    };
    m.onBeforeCompile(shader as never, {} as never);
    // The vertex stage moves the surface along its normal by the waves; the fragment stage
    // tilts the normal by their slope, which is what the refraction and reflection use.
    expect(shader.vertexShader).toMatch(/transformed \+= objectNormal \* vWAmp \* wave\.x;/);
    expect(shader.vertexShader).toMatch(/waterWaves\(aRun\.y,/);
    expect(shader.fragmentShader).toMatch(/normal = normalize\(normal - faceDirection \* \(viewMatrix \* vec4\(slope, 0\.0\)\)\.xyz\);/);
  });

  it('the mesh carries what they are laid out on: time on the stretch, distance, radius', () => {
    const pt = (r: number, y: number, t: number, segment: PathPoint['segment']): PathPoint => ({
      r, y, t, speed: 3, thickness: 0.005, segment,
    });
    const points = [
      pt(0.005, 0, 0, 'column'),
      pt(0.005, 0.03, 0.01, 'column'),
      pt(0.02, 0.03, 0.015, 'film'),
      pt(0.05, 0.03, 0.025, 'free'),
      pt(0.09, 0.03, 0.04, 'free'),
    ];
    const path: JetPath = { points, contact: null, landingRadius: 0.09, release: null, poolY: 0 };
    const geometry = createJetFlowGeometry();
    const rings = writeJetPath(geometry, Array(40).fill(path), { x: 0, z: 0 });
    expect(rings).toBe(points.length);
    const run = geometry.getAttribute('aRun');
    const at = (i: number) => [run.getX(i * 41), run.getY(i * 41), run.getZ(i * 41)];
    // Time since the stretch began: the column from the nozzle, the sheet from the rim.
    expect(at(1)[0]).toBeCloseTo(0.01, 6);
    expect(at(3)[0]).toBeCloseTo(0.01, 6);
    expect(at(4)[0]).toBeCloseTo(0.025, 6);
    // Distance along the path, and radius from the axis.
    expect(at(2)[1]).toBeCloseTo(0.03 + 0.015, 6);
    expect(at(4)[1]).toBeCloseTo(0.03 + 0.085, 6);
    expect(at(4)[2]).toBeCloseTo(0.09, 6);
  });
});

describe('no black in the water (QA, 2026-09-29: black jagged patches round the jet at the 45° deflector)', () => {
  const texture = new THREE.Texture();
  const compiled = (kind: WaterKind) => {
    const m = createWaterMaterial(texture, createWaterUniforms(), kind);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: 'void main() {\n#include <begin_vertex>\n}',
      fragmentShader:
        'void main() {\n#include <normal_fragment_maps>\n#include <transmission_fragment>\n#include <opaque_fragment>\n#include <premultiplied_alpha_fragment>\n}',
      defines: {},
    };
    m.onBeforeCompile(shader as never, {} as never);
    return shader.fragmentShader;
  };

  it('the ambient-occlusion pre-pass leaves every piece of water out', () => {
    // It draws with an override material, which ignores the segments the water shader
    // discards: the sheet layer (opacity 1, no transmission) drew the whole path into the
    // depth buffer and was shaded with a dark halo.
    for (const kind of ['stream-body', 'stream-sheet', 'conduit'] as const) {
      expect(createWaterMaterial(texture, createWaterUniforms(), kind).userData.seeThrough).toBe(true);
    }
    const pool = createPoolMesh(0.02, 0.1, { x: 0, z: 0 }, 0, texture, createPoolUniforms());
    expect((pool.material as THREE.Material).userData.seeThrough).toBe(true);
    const post = readFileSync('src/lib/labPostProcessing.ts', 'utf8');
    expect(post).toMatch(/if \(material\.userData\?\.seeThrough === true\) return true;/);
  });

  it('the water is not drawn into its own refraction buffer', () => {
    // three draws a double-sided refracting material's back faces (as BackSide, so
    // FLIP_SIDED) into the buffer that same material then samples.
    expect(compiled('stream-body')).toMatch(/#ifdef FLIP_SIDED\s+discard;\s+#endif/);
  });

  it('refraction follows the surface and its long waves, not the fine ripples', () => {
    const fs = compiled('stream-body');
    expect(fs).toMatch(/vec3 n = inverseTransformDirection\( waterRefractN, viewMatrix \);/);
    expect(fs).not.toMatch(/vec3 n = inverseTransformDirection\( normal, viewMatrix \);/);
    // Absorption in the same units as the ray three traces (scaled by the model).
    expect(fs).toMatch(/material\.attenuationDistance = attenuationDistance \* length\( vec3\( modelMatrix\[ 0 \]\.xyz \) \);/);
    // Where the buffer is empty, what is behind the water fills in.
    expect(fs).toMatch(/transmitted\.rgb \+= \( 1\.0 - clamp\( wCover, 0\.0, 1\.0 \) \) \* through \* fill;/);
    // No normal is left facing away from the camera.
    expect(fs).toMatch(/if \(facing < 0\.08\) normal = normalize/);
  });
});

describe('realism terms declare before they are used (QA, 2026-09-29: the impact ring broke compilation when it was declared after the aeration sum)', () => {
  it('every fragment identifier is declared above its first use, for each kind', () => {
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    for (const kind of ['stream-body', 'stream-sheet', 'conduit'] as WaterKind[]) {
      const m = createWaterMaterial(texture, createWaterUniforms(), kind);
      const shader = {
        uniforms: {} as Record<string, unknown>,
        vertexShader: '#include <begin_vertex>',
        fragmentShader:
          'void main() {\n#include <normal_fragment_maps>\n#include <opaque_fragment>\n#include <premultiplied_alpha_fragment>\n}',
        defines: {},
      };
      m.onBeforeCompile(shader as never, {} as never);
      // Comments mention the terms freely; only code counts.
      const fs = shader.fragmentShader.replace(/\/\/[^\n]*/g, '');
      for (const name of ['lig', 'impactRing', 'rivulet', 'churn', 'sheetK', 'aeration', 'droplet']) {
        const decl = fs.indexOf(`float ${name}`);
        const use = fs.search(new RegExp(`[^floatA-Za-z_.]${name}[^A-Za-z_]`));
        if (decl < 0) continue; // a kind may compile the term out
        expect(decl, `${name} declared (${kind})`).toBeGreaterThanOrEqual(0);
        // No use of the identifier before its declaration line.
        const before = fs.slice(0, decl);
        expect(new RegExp(`[^A-Za-z_.]${name}[^A-Za-z_]`).test(before), `${name} used before declared (${kind})`).toBe(false);
        expect(use).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
