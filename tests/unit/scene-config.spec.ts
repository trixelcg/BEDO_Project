import { describe, expect, it } from 'vitest';
import { SCENE_CONFIG } from '../../src/lib/sceneConfig';

/**
 * The frozen production scene configuration (BEDO-003 §7).
 *
 * Until BEDO-003 these values lived in React state, were seeded from literals in
 * `App.tsx`, and could be overwritten at runtime by whatever `/config.json` happened to
 * contain. They are now a checked-in constant, which is only an improvement if the
 * constant is the *same* one the scene was already running on.
 *
 * So this pins the values that were verified live, with `scripts/scene-fingerprint.mjs`,
 * against the three.js scene graph immediately before the removal — each assertion below
 * names the observable it was read from. Values that place geometry or decide where a
 * click lands are pinned exactly; there is no snapshot, because a snapshot would not say
 * which number mattered or why.
 */

describe('apparatus placement', () => {
  // These three decide where every mesh, every anchor and every click hotspot ends up.
  // The fingerprint read them back off the loaded group as
  // position [0, -1.8, 0], quaternion [0, 0, 0, 1], scale [1.8, 1.8, 1.8].
  it('sits 1.8 units below the origin, unrotated', () => {
    expect(SCENE_CONFIG.characterPosition).toEqual([0, -1.8, 0]);
    expect(SCENE_CONFIG.characterRotation).toEqual([0, 0, 0]);
  });

  it('is uniformly scaled 1.8x', () => {
    expect(SCENE_CONFIG.characterScale).toEqual([1.8, 1.8, 1.8]);
    const [x, y, z] = SCENE_CONFIG.characterScale;
    // Hotspot radii, anchor offsets and the jet's dimensions are all divided by
    // scale[0]; a non-uniform scale would silently distort every one of them.
    expect(x).toBe(y);
    expect(y).toBe(z);
    expect(x).toBeGreaterThan(0);
  });

  it('states rotation in degrees, which Scene3D converts to radians', () => {
    // A value that is already radians would look like a tiny rotation and be nearly
    // invisible in review, so the unit is pinned by its documented meaning.
    for (const angle of SCENE_CONFIG.characterRotation) {
      expect(Math.abs(angle)).toBeLessThanOrEqual(360);
    }
  });
});

describe('renderer and environment', () => {
  it('exposes above unity, to compensate for lighting the scene with a room', () => {
    // The environment is the laboratory's own baked surfaces, not an outdoor panorama, and
    // an interior is a much dimmer thing to stand in. Exposure carries that difference so
    // the scene does not need fill lights the room does not contain — so the meaningful
    // assertion is that it is *lifted*, not that it holds one particular number.
    expect(SCENE_CONFIG.exposure).toBeGreaterThan(1.0);
    // Bounded: past roughly 1.6 the highlights on the steel start to clip.
    expect(SCENE_CONFIG.exposure).toBeLessThanOrEqual(1.6);
    expect(SCENE_CONFIG.exposure).toBe(1.3);
  });

  it('lights the environment at 1.0 with no rotation', () => {
    // Read back as scene.environmentIntensity = 1, backgroundIntensity = 1,
    // background.rotation = 0.
    expect(SCENE_CONFIG.hdrLight).toBe(1.0);
    expect(SCENE_CONFIG.hdrRotation).toBe(0);
  });

  it('writes envMapIntensity 1.0 onto the model materials', () => {
    // The fingerprint counted 183 model materials at exactly 1.
    expect(SCENE_CONFIG.reflection).toBe(1.0);
  });
});

describe('lighting', () => {
  it('produces the four lights the scene had, at the same intensities', () => {
    // Scene3D derives each intensity from these two numbers; the fingerprint read the
    // results back as 0.15 / 0.8 / 0.3 / 0.4.
    const { selfIllumination, contrast } = SCENE_CONFIG;
    expect(selfIllumination).toBe(0.15);
    expect(contrast).toBe(1.0);

    expect(selfIllumination * (2.0 - contrast)).toBeCloseTo(0.15, 10); // ambient
    expect(0.8 * contrast).toBeCloseTo(0.8, 10); // key light
    expect(0.3 * (2.0 - contrast)).toBeCloseTo(0.3, 10); // orange fill
    expect(0.4 * contrast).toBeCloseTo(0.4, 10); // rim
  });

  it('keeps the ambient colour the scene was lit with', () => {
    expect(SCENE_CONFIG.ambientColor).toBe('#d1f2f7');
    expect(SCENE_CONFIG.ambientColor).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('tank cover glass', () => {
  it('keeps the material the cover was made of', () => {
    // Read back off Tank_cover's MeshPhysicalMaterial: roughness 0.02, ior 1.52,
    // specularIntensity 1, clearcoatRoughness 0.01.
    expect(SCENE_CONFIG.glassRoughness).toBe(0.02);
    expect(SCENE_CONFIG.glassIor).toBe(1.52);
    expect(SCENE_CONFIG.glassSpecular).toBe(1.0);
    expect(SCENE_CONFIG.glassRoughness * 0.5).toBeCloseTo(0.01, 10);
  });

  it('stays inside the ranges three.js accepts', () => {
    expect(SCENE_CONFIG.glassRoughness).toBeGreaterThanOrEqual(0);
    expect(SCENE_CONFIG.glassRoughness).toBeLessThanOrEqual(1);
    expect(SCENE_CONFIG.glassSpecular).toBeGreaterThanOrEqual(0);
    expect(SCENE_CONFIG.glassSpecular).toBeLessThanOrEqual(1);
    expect(SCENE_CONFIG.glassIor).toBeGreaterThanOrEqual(1);
    expect(SCENE_CONFIG.glassIor).toBeLessThanOrEqual(2.333);
  });
});

describe('the configuration itself', () => {
  // Seventeen since the window sun landed: the four `sun*` fields replaced a directional
  // light that was hard-coded in `Scene3D`, which is what put its placement under this pin
  // along with everything else that decides how the scene looks.
  it('has exactly the seventeen fields the scene consumes', () => {
    expect(Object.keys(SCENE_CONFIG).sort()).toEqual(
      [
        'ambientColor',
        'characterPosition',
        'characterRotation',
        'characterScale',
        'contrast',
        'exposure',
        'glassIor',
        'glassRoughness',
        'glassSpecular',
        'hdrLight',
        'hdrRotation',
        'reflection',
        'selfIllumination',
        'sunAzimuth',
        'sunColor',
        'sunElevation',
        'sunIntensity',
      ].sort()
    );
  });

  // The approved Stage A.1 sun. Azimuth and elevation place the beam, and the intensity is
  // paired with `BAKED_ROOM_ENV` in `materialFamilies.ts` — the bake supplies the fill, the
  // sun supplies the direction, and moving either alone unbalances the pair.
  it('keeps the window sun where it was approved', () => {
    expect(SCENE_CONFIG.sunAzimuth).toBe(40);
    expect(SCENE_CONFIG.sunElevation).toBe(32);
    expect(SCENE_CONFIG.sunIntensity).toBe(2.4);
    expect(SCENE_CONFIG.sunColor).toBe('#fff4e6');
  });

  it('is frozen, so nothing can restyle the scene at runtime', () => {
    // The point of BEDO-003: the scene is no longer mutable from anywhere.
    expect(Object.isFrozen(SCENE_CONFIG)).toBe(true);
    expect(Object.isFrozen(SCENE_CONFIG.characterPosition)).toBe(true);
    expect(Object.isFrozen(SCENE_CONFIG.characterScale)).toBe(true);
    expect(Object.isFrozen(SCENE_CONFIG.characterRotation)).toBe(true);
  });

  it('carries no numbers that are not finite', () => {
    for (const [key, value] of Object.entries(SCENE_CONFIG)) {
      const numbers = Array.isArray(value) ? value : typeof value === 'number' ? [value] : [];
      for (const n of numbers) {
        expect(Number.isFinite(n), `${key} is not finite`).toBe(true);
      }
    }
  });
});
