import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {
  APPARATUS_ENV,
  BAKED_ROOM_ENV,
  COATING_ENV,
  CONDUCTOR_MIN_REFLECTANCE,
  CONDUCTOR_TINT_LIMIT,
  DIELECTRIC_SPECULAR,
  FAMILY_RESPONSE,
  MAX_INSULATOR_ALBEDO,
  MAX_SPECULAR_COLOUR,
  MIN_CONDUCTOR_LUMINANCE,
  applyFamily,
  applyGlass,
  chromaOf,
  classifyMaterial,
  neutraliseConductorTint,
} from '../../src/lib/materialFamilies';
import { MISMATERIALLED_HOSE, HOSE_MATERIAL_DONOR } from '../../src/domain/apparatus';

/**
 * The physical invariants the apparatus is rendered under (Stage B).
 *
 * Every case here is a material that exists in `Bedo_baked_v2.glb`, reconstructed from the
 * values the GLB actually carries — so a test that fails is either a real regression or a
 * genuine change of mind about physics, never a disagreement with an invented fixture.
 *
 * The GLB itself is frozen at
 * `f1836e3b0af22f9090df2136899b69e77e455b7dd19d9b3aa3ccf2f6cf24d6f4`, and nothing here or
 * in `materialFamilies.ts` writes to it.
 */

/** A material as the loader hands it over, with the authored values named. */
const authored = (
  name: string,
  {
    metalness = 1,
    roughness = 1,
    colour,
    specularIntensity,
    specularColour,
    map = false,
    physical = true,
  }: {
    metalness?: number;
    roughness?: number;
    colour?: number[];
    specularIntensity?: number;
    specularColour?: number;
    map?: boolean;
    physical?: boolean;
  } = {}
): THREE.MeshStandardMaterial => {
  const material = physical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  material.name = name;
  material.metalness = metalness;
  material.roughness = roughness;
  if (colour) material.color.setRGB(colour[0], colour[1], colour[2]);
  if (map) material.map = new THREE.Texture();
  if (physical) {
    const p = material as THREE.MeshPhysicalMaterial;
    if (specularIntensity !== undefined) p.specularIntensity = specularIntensity;
    if (specularColour !== undefined) p.specularColor.setScalar(specularColour);
  }
  return material;
};

describe('classification', () => {
  it('catches the room bake before its authored metalness can read as metal', () => {
    // `MergedBake_Baked` ships at metalness 1 on 18 meshes including the floor and walls.
    expect(classifyMaterial(authored('MergedBake_Baked', { metalness: 1 }))).toBe('roomSurface');
    expect(classifyMaterial(authored('MergedBake_Baked.002', { metalness: 1 }))).toBe('roomSurface');
  });

  it('demotes a material named as metal but too dark to be one', () => {
    // `black metal`, on the frame legs: #262626, which is 0.15 in sRGB luminance.
    const legs = authored('black metal', { metalness: 0, colour: [0.0196, 0.0196, 0.0196] });
    expect(classifyMaterial(legs)).toBe('paintedMetal');
  });

  it('keeps a mapped metal a conductor however dark its base colour factor is', () => {
    const mapped = authored('steel plate', { metalness: 1, colour: [0.02, 0.02, 0.02], map: true });
    expect(classifyMaterial(mapped)).toBe('exposedMetal');
  });

  it('believes an unnamed material authored as a full conductor', () => {
    // `base.001` — the bench tread plate — is named nothing useful and authored at 1.
    expect(classifyMaterial(authored('base.001', { metalness: 1, map: true }))).toBe('exposedMetal');
  });

  it('files an unidentified insulator as unknown rather than as metal', () => {
    // `08 - Default`, the white bench and sink, is authored at the impossible 0.5.
    expect(classifyMaterial(authored('08 - Default', { metalness: 0.5 }))).toBe('unknown');
  });
});

describe('the dielectric specular that 31 of the 68 authored materials switch off', () => {
  it('restores full strength where the exporter wrote zero', () => {
    const bench = authored('08 - Default', {
      metalness: 0.5,
      roughness: 0.9,
      specularIntensity: 0,
      specularColour: 0.9,
    }) as THREE.MeshPhysicalMaterial;
    applyFamily(bench, 'unknown');
    expect(bench.specularIntensity).toBe(DIELECTRIC_SPECULAR);
    expect(bench.specularIntensity).toBe(1);
  });

  it('pulls a doubled specular colour back to the dielectric maximum', () => {
    // `General_plastic` carries specularColorFactor 1.8, which is F0 near 8%.
    const plastic = authored('General_plastic ', {
      metalness: 0.5,
      roughness: 0.59,
      specularColour: 1.8,
    }) as THREE.MeshPhysicalMaterial;
    applyFamily(plastic, 'plastic');
    expect(plastic.specularColor.r).toBeCloseTo(MAX_SPECULAR_COLOUR, 5);
  });

  // Stage B.1. Getting this direction wrong is what blew the tank-base highlight: the
  // blanket `setRGB(1,1,1)` raised this material's F0 by 5.8x, and at 80 degrees off its
  // normal Fresnel took it straight to white.
  it('leaves a suppressed specular alone, because that is a finish and not an error', () => {
    // `Material #35`, the one material in this GLB authored below 1.
    const matte = authored('Material #35', {
      metalness: 0.8,
      roughness: 0.5,
      colour: [0.0078, 0.0078, 0.0078],
      specularColour: 0.1725,
    }) as THREE.MeshPhysicalMaterial;
    applyFamily(matte, 'unknown');
    expect(matte.specularColor.r).toBeCloseTo(0.1725, 5);
    // …while the impossible half is still corrected.
    expect(matte.metalness).toBe(0);
    expect(matte.specularIntensity).toBe(DIELECTRIC_SPECULAR);
  });

  it('never lowers a specular intensity that is already at full strength', () => {
    const painted = authored('paint', {
      metalness: 0,
      specularIntensity: 1,
      specularColour: 0.9,
    }) as THREE.MeshPhysicalMaterial;
    applyFamily(painted, 'paintedMetal');
    expect(painted.specularIntensity).toBe(1);
    expect(painted.specularColor.r).toBeCloseTo(0.9, 5);
  });

  it('leaves a standard material alone, which has no way to express the error', () => {
    const room = authored('MergedBake_Baked', { physical: false });
    expect(() => applyFamily(room, 'roomSurface')).not.toThrow();
    expect((room as THREE.MeshPhysicalMaterial).specularIntensity).toBeUndefined();
  });
});

describe('roughness bands', () => {
  it('pulls a powder coat authored at plaster roughness into a coating range', () => {
    const legs = authored('black metal', { metalness: 0, roughness: 0.9 });
    applyFamily(legs, 'paintedMetal');
    expect(legs.roughness).toBe(FAMILY_RESPONSE.paintedMetal.roughness!.max);
    expect(legs.roughness).toBeLessThan(0.9);
  });

  it('leaves an authored finish that is already plausible exactly where it is', () => {
    const plastic = authored('General_plastic ', { metalness: 0.5, roughness: 0.59 });
    applyFamily(plastic, 'plastic');
    expect(plastic.roughness).toBe(0.59);
  });

  it('stops a surface authored glossier than its material can be', () => {
    const paint = authored('paint', { metalness: 0, roughness: 0.02 });
    applyFamily(paint, 'paintedMetal');
    expect(paint.roughness).toBe(FAMILY_RESPONSE.paintedMetal.roughness!.min);
  });

  it('never clamps a roughness that is a multiplier on a map', () => {
    // The room bake is the only family carrying a roughness map, and there `roughness` is
    // a factor on it rather than a finish.
    const room = authored('MergedBake_Baked', { physical: false, roughness: 1 });
    room.roughnessMap = new THREE.Texture();
    applyFamily(room, 'roomSurface');
    expect(room.roughness).toBe(1);
  });
});

describe('conductors', () => {
  it('lifts an untextured metal too dark to be any real metal', () => {
    // `steels crews` is authored at 0.157 linear, where iron — the darkest common metal —
    // is 0.55.
    const screws = authored('steels crews', { metalness: 1, colour: [0.157, 0.157, 0.157] });
    applyFamily(screws, 'exposedMetal');
    const lifted = screws.color;
    expect(lifted.r).toBeCloseTo(CONDUCTOR_MIN_REFLECTANCE, 3);
    expect(screws.metalness).toBe(1);
  });

  it('leaves a metal already at a plausible reflectance untouched', () => {
    const spring = authored('spring1.001', { metalness: 1, colour: [0.588, 0.588, 0.588] });
    applyFamily(spring, 'exposedMetal');
    expect(spring.color.r).toBeCloseTo(0.588, 3);
  });

  it('never lifts a mapped metal, whose brightness comes from the map', () => {
    const weight = authored('weight 500.001', {
      metalness: 1,
      colour: [0.1, 0.1, 0.1],
      map: true,
    });
    applyFamily(weight, 'exposedMetal');
    expect(weight.color.r).toBeCloseTo(0.1, 4);
  });
});

describe('insulator albedo', () => {
  it('brings a paint brighter than any real coating down to one', () => {
    const bench = authored('08 - Default', { metalness: 0.5, colour: [0.847, 0.847, 0.847] });
    applyFamily(bench, 'unknown');
    expect(Math.max(bench.color.r, bench.color.g, bench.color.b)).toBeCloseTo(
      MAX_INSULATOR_ALBEDO,
      4
    );
  });

  it('preserves hue while capping', () => {
    const tinted = authored('coat', { metalness: 0, colour: [0.9, 0.6, 0.3] });
    applyFamily(tinted, 'paintedMetal');
    expect(tinted.color.g / tinted.color.r).toBeCloseTo(0.6 / 0.9, 4);
    expect(tinted.color.b / tinted.color.r).toBeCloseTo(0.3 / 0.9, 4);
  });

  it('never brightens a dark coating, which is the whole point of keeping black black', () => {
    const legs = authored('black metal', { metalness: 0, colour: [0.0196, 0.0196, 0.0196] });
    applyFamily(legs, 'paintedMetal');
    expect(legs.color.r).toBeCloseTo(0.0196, 5);
  });

  it('is idempotent, because the material pass re-runs', () => {
    const bench = authored('08 - Default', { metalness: 0.5, colour: [0.847, 0.847, 0.847] });
    applyFamily(bench, 'unknown');
    const once = bench.color.r;
    applyFamily(bench, 'unknown');
    applyFamily(bench, 'unknown');
    expect(bench.color.r).toBeCloseTo(once, 6);
  });
});

describe('conductor colour casts', () => {
  it('separates a neutral map with a cast from a genuinely coloured metal', () => {
    // Measured from the GLB's own textures: the checker plate against dirty copper.
    const checkerPlate = new THREE.Color(0.1845, 0.1839, 0.2195);
    const dirtyCopper = new THREE.Color(0.1946, 0.1214, 0.0273);
    expect(chromaOf(checkerPlate)).toBeLessThan(CONDUCTOR_TINT_LIMIT);
    expect(chromaOf(dirtyCopper)).toBeGreaterThan(CONDUCTOR_TINT_LIMIT);
  });

  it('reports a neutral as having no chroma however dark or bright it is', () => {
    expect(chromaOf(new THREE.Color(0.02, 0.02, 0.02))).toBe(0);
    expect(chromaOf(new THREE.Color(0.9, 0.9, 0.9))).toBe(0);
  });

  it('leaves a material it cannot measure exactly as authored', () => {
    // No DOM here, so the texture cannot be sampled — which is also what happens in the
    // browser for a compressed upload. The material must come through untouched.
    const plate = authored('base.001', { metalness: 1, map: true });
    const before = plate.color.getHex();
    expect(neutraliseConductorTint(plate)).toBe('unmeasurable');
    expect(plate.color.getHex()).toBe(before);
  });

  it('does not attempt to neutralise an unmapped conductor', () => {
    expect(neutraliseConductorTint(authored('steels crews', { metalness: 1 }))).toBe(
      'unmeasurable'
    );
  });
});

describe('the response table', () => {
  it('keeps the two environment levels Stage A approved', () => {
    expect(APPARATUS_ENV).toBe(2.0);
    expect(BAKED_ROOM_ENV).toBe(0.45);
    expect(FAMILY_RESPONSE.roomSurface.envMapIntensity).toBe(BAKED_ROOM_ENV);
    expect(FAMILY_RESPONSE.exposedMetal.envMapIntensity).toBe(APPARATUS_ENV);
  });

  // Stage B.1. The 2x is a diffuse-fill compensation and a 2%-albedo coating has no diffuse
  // to compensate, so on a powder coat it lands entirely on the specular. See `COATING_ENV`.
  it('gives a dark coating the environment at unity, and only a dark coating', () => {
    expect(COATING_ENV).toBe(1.0);
    expect(FAMILY_RESPONSE.paintedMetal.envMapIntensity).toBe(COATING_ENV);
    // The control panel classifies as `unknown`; the level that keeps it off true black
    // must not have moved with it.
    expect(FAMILY_RESPONSE.unknown.envMapIntensity).toBe(APPARATUS_ENV);
    expect(FAMILY_RESPONSE.plastic.envMapIntensity).toBe(APPARATUS_ENV);
  });

  it('has no half-metals anywhere in it', () => {
    for (const [family, response] of Object.entries(FAMILY_RESPONSE)) {
      expect(`${family}: ${response.metalness}`).toMatch(/: (0|1)$/);
    }
  });

  it('gives every insulator family a specular and metal none', () => {
    for (const family of ['paintedMetal', 'plastic', 'rubber', 'unknown'] as const) {
      expect(FAMILY_RESPONSE[family].specularIntensity).toBe(DIELECTRIC_SPECULAR);
    }
    expect(FAMILY_RESPONSE.exposedMetal.specularIntensity).toBeUndefined();
  });

  it('states a coherent band wherever it states one at all', () => {
    for (const response of Object.values(FAMILY_RESPONSE)) {
      if (!response.roughness) continue;
      expect(response.roughness.min).toBeLessThan(response.roughness.max);
      expect(response.roughness.min).toBeGreaterThanOrEqual(0);
      expect(response.roughness.max).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the conductor thresholds in the order the physics needs', () => {
    // Below MIN_CONDUCTOR_LUMINANCE a "metal" is demoted to paint; above it, whatever
    // survives has to be at least as bright as the darkest real metal.
    expect(MIN_CONDUCTOR_LUMINANCE).toBeLessThan(CONDUCTOR_MIN_REFLECTANCE);
  });
});

describe('glass is not touched by any of this', () => {
  it('stays transmissive and non-metallic', () => {
    // `Galss_Material` is authored at metalness 1, which would make the tank a mirror.
    const tank = authored('Galss_Material', { metalness: 1, roughness: 0.3 });
    applyGlass(tank, { roughness: 0.02, ior: 1.52, specularIntensity: 1 });
    const physical = tank as THREE.MeshPhysicalMaterial;
    expect(physical.metalness).toBe(0);
    expect(physical.transmission).toBe(0.95);
    expect(physical.roughness).toBe(0.02);
    expect(physical.ior).toBe(1.52);
  });
});

describe('the bench hose does not wear the tank glass (MODEL-01)', () => {
  const REPO_ROOT = path.resolve(__dirname, '../..');
  const deviceModel = readFileSync(
    path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'),
    'utf8'
  );

  /**
   * `Galss_Material` has two users in the GLB and only one of them is glass.
   *
   * `JET Force 2_205` is the tank cylinder. `Line010` is a J-shaped hose in the bench
   * plumbing — measured 288 mm off the tank axis, 408 mm below its floor, and alone among
   * the material's users it carries no UVs. Sharing the material meant sharing its
   * `baseColorFactor` alpha of 0.10, so the hose rendered as a large faint ellipse lying
   * across the white bench panel; hiding it in a debug run removed that ghost and nothing
   * else.
   *
   * The GLB is frozen, so the correction is at runtime and per-mesh. These lock the two
   * properties that make it safe.
   */
  it('the classifier still sends the material itself to the glass family', () => {
    // The fix must not weaken the rule the tank depends on — the tank is genuinely glass,
    // and it is the same material instance.
    expect(classifyMaterial(authored('Galss_Material', {}))).toBe('glass');
  });

  it('the hose is reassigned per-mesh, never by editing the shared material', () => {
    // The loader hands both meshes one instance, so mutating it would turn the tank opaque.
    // The correction has to replace the mesh's material reference and nothing else.
    expect(deviceModel).toMatch(
      /if \(child\.name === hoseName && hoseMaterial\) child\.material = hoseMaterial;/
    );
    // And it must not reach for the glass material's own fields.
    const block = deviceModel.slice(
      deviceModel.indexOf('const hoseName'),
      deviceModel.indexOf('child.castShadow =')
    );
    expect(block).not.toMatch(/Galss|\.opacity\s*=|\.transparent\s*=/);
  });

  it('it borrows an existing material rather than creating one', () => {
    // Reuse keeps the draw-call and material count unchanged. The donor is looked up in the
    // scene by mesh name; nothing is constructed.
    expect(deviceModel).toMatch(/const donorName = gltfName\(HOSE_MATERIAL_DONOR\)/);
    const block = deviceModel.slice(
      deviceModel.indexOf('const hoseName'),
      deviceModel.indexOf('child.castShadow =')
    );
    expect(block).not.toMatch(/new THREE\.[A-Za-z]*Material/);
  });

  it('names the two meshes in the domain rather than inline', () => {
    expect(MISMATERIALLED_HOSE).toBe('Line010');
    expect(HOSE_MATERIAL_DONOR).toBe('Object297');
  });
});
