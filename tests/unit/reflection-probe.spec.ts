import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PROBE_INTENSITY,
  SHEET_GLASS,
  applyReflectionProbe,
  reflectiveFamily,
} from '../../src/lib/reflectionProbe';
import { createPreviousTankGlass } from '../../src/lib/modelAdapter';
import { createWaterMaterial, createWaterUniforms } from '../../src/lib/waterMaterial';
import { createBasinWater } from '../../src/lib/measuringTank';

/**
 * Glass and water reflect the laboratory (QA, 2026-09-30: "the glass of the tank, the
 * windows and the partitions has no reflections"). Without an `envMap` of their own, three
 * reflected the neutral studio at `scene.environmentIntensity`, whatever the material asked
 * for; the probe is the room itself, given to the see-through surfaces only.
 */

const physical = (name: string, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
  new THREE.MeshPhysicalMaterial({ name, ...extra });

describe('who reflects the room', () => {
  it('the tank, the windows, the doors and partitions, the campus glazing: glass', () => {
    for (const name of ['Galss_Material', 'Windows_Glass', 'glass_doors & partitions', 'Campus - clear internal glazing']) {
      expect(reflectiveFamily(physical(name))).toBe('glass');
    }
  });

  it('every piece of water, tagged where it is built', () => {
    const texture = new THREE.Texture();
    for (const kind of ['stream-body', 'stream-sheet', 'conduit'] as const) {
      expect(reflectiveFamily(createWaterMaterial(texture, createWaterUniforms(), kind))).toBe('water');
    }
    const basin = createBasinWater({ floorY: 0, min: new THREE.Vector2(0, 0), max: new THREE.Vector2(1, 1) }, texture);
    expect(reflectiveFamily(basin.material as THREE.Material)).toBe('water');
  });

  it('not the printed labels, not the room', () => {
    // Transmissive but rough and printed: the deflector and scale labels.
    const label = physical('45', { transmission: 1, roughness: 0.38, map: new THREE.Texture() });
    expect(reflectiveFamily(label)).toBeNull();
    expect(reflectiveFamily(physical('Laboratory washable paint'))).toBeNull();
  });
});

describe('applying the probe', () => {
  const probe = new THREE.Texture();
  const scene = () => {
    const root = new THREE.Group();
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(), physical('Windows_Glass', { transmission: 1, roughness: 0.035 }));
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(), physical('Laboratory washable paint'));
    const tank = new THREE.Mesh(new THREE.PlaneGeometry(), createPreviousTankGlass());
    root.add(pane, wall, tank);
    return { root, pane, wall, tank };
  };

  it('gives it to the glass and the water only, at the material’s own intensity', () => {
    const { root, pane, wall, tank } = scene();
    expect(applyReflectionProbe(root, probe)).toBe(2);
    expect((pane.material as THREE.MeshPhysicalMaterial).envMap).toBe(probe);
    expect((tank.material as THREE.MeshStandardMaterial).envMap).toBe(probe);
    expect((pane.material as THREE.MeshPhysicalMaterial).envMapIntensity).toBe(PROBE_INTENSITY.glass);
    // The room keeps the approved studio lighting.
    expect((wall.material as THREE.MeshPhysicalMaterial).envMap).toBeNull();
    // Idempotent: nothing is given it twice.
    expect(applyReflectionProbe(root, probe)).toBe(0);
  });

  it('makes a transmissive pane read as float glass: flat, tinted, reflective enough to see', () => {
    const { root, pane } = scene();
    applyReflectionProbe(root, probe);
    const glass = pane.material as THREE.MeshPhysicalMaterial;
    expect(glass.roughness).toBe(0);
    expect(glass.specularIntensity).toBe(SHEET_GLASS.specularIntensity);
    expect(glass.thickness).toBeGreaterThan(0);
    // Green-blue, as soda-lime glass is: green passes best, red least.
    expect(glass.attenuationColor.g).toBeGreaterThan(glass.attenuationColor.r);
  });
});

describe('the tank wall adds its reflection instead of dimming it', () => {
  it('is premultiplied, and writes the specular term unscaled by its alpha', () => {
    const glass = createPreviousTankGlass();
    expect(glass.premultipliedAlpha).toBe(true);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '',
      fragmentShader: '#include <common>\nvoid main() {\n#include <opaque_fragment>\n#include <premultiplied_alpha_fragment>\n}',
    };
    glass.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toMatch(/gl_FragColor = vec4\(totalSpecular \+ bedoBody, bedoA\);/);
    // No second multiply by alpha after it.
    expect(shader.fragmentShader).not.toMatch(/premultiplied_alpha_fragment/);
  });
});

describe('the measuring tank tints what is seen through it', () => {
  it('multiplies the floor by the water’s transmittance before adding its own light', () => {
    // A single alpha has no colour: however opaque, the white floor came through grey.
    const water = createBasinWater({ floorY: 0, min: new THREE.Vector2(0, 0), max: new THREE.Vector2(1, 1) }, new THREE.Texture());
    const absorption = water.children.find((c) => c.name === 'bedo-measuring-tank-water-absorption') as THREE.Mesh;
    expect(absorption).toBeTruthy();
    const material = absorption.material as THREE.ShaderMaterial;
    expect(material.blending).toBe(THREE.MultiplyBlending);
    expect(material.premultipliedAlpha).toBe(true);
    // Drawn before the water's own layer, on the same box, so it rides the level.
    expect(absorption.renderOrder).toBeLessThan(water.renderOrder);
    expect(absorption.geometry).toBe(water.geometry);
    // Red absorbed first, blue last.
    expect(material.fragmentShader).toMatch(/exp\(-vec3\(20\.0, 7\.0, 3\.0\) \* path\)/);
  });
});
