// What each surface in the apparatus is actually made of.
//
// ## The problem this fixes
//
// The model's authored materials carry physically impossible combinations, and the runtime
// then applied one blanket `envMapIntensity` over all of them. Audited from the GLB itself:
//
//   | material | metalness | roughness | on | wrong because |
//   |---|---|---|---|---|
//   | `MergedBake_Baked` | **1** | 1 | 18 room meshes: floor, wall panels, frame | walls and floors are not metal |
//   | `General_plastic` | **0.5** | 0.59 | 11 bench parts | nothing is half-metal |
//   | `08 - Default` | **0.5** | 0.9 | the sink | same |
//   | `Material #27568` | **0.8** + transmission 1 | 0.5 | 6 pump sight-glasses | glass is never metallic |
//   | `dirty metal.001` | 0.8 | 0.5 | `Tank_cover` | reference shows matte black, not metal |
//
// Metalness is not a slider between "shiny" and "dull": it selects whether a surface has a
// coloured specular and no diffuse (a conductor) or a white specular over a diffuse body (an
// insulator). A value of 0.5 describes nothing real, and it is the single biggest reason
// every object in the scene read as the same substance.
//
// ## How a family is chosen
//
// By the authored material's own name and texture, which are descriptive in this model
// ("steels crews", "General_plastic", "Galss_Material", "dirty metal"). Nothing is matched
// on mesh names, so re-exporting geometry cannot silently change how a surface responds.
//
// Authored maps are always kept. This adjusts the handful of scalar factors that are
// physically impossible; it does not repaint the model.

import * as THREE from 'three';

export type MaterialFamily =
  | 'exposedMetal'
  | 'paintedMetal'
  | 'plastic'
  | 'rubber'
  | 'glass'
  | 'roomSurface'
  | 'water'
  | 'unknown';

/** Physically coherent targets per family. Only these scalars are ever written. */
export interface FamilyResponse {
  metalness: number;
  /** Left undefined where the authored roughness is already sensible for the family. */
  roughness?: number;
  envMapIntensity: number;
}

/**
 * ## On `envMapIntensity`, and why these numbers are not what they look like
 *
 * This factor only exists once a material has an `envMap` of its own. When a material leaves
 * `envMap` null and relies on `scene.environment`, three lights it from the scene and ignores
 * `envMapIntensity` altogether — so every value in this table was inert, and every surface was
 * silently receiving the environment at exactly 1.0 no matter what was written here. That was
 * measured, not assumed: raising one material to 20 changed nothing, while assigning the same
 * texture to `material.envMap` made the identical value bite immediately.
 *
 * `RoomLighting` now assigns the captured environment to each material, so these are live.
 *
 * The two levels below are the ones the scene actually needs:
 *
 *   * **Apparatus surfaces get 2.0.** The probe photographs the room *flat-lit at unity*,
 *     which reproduces the bake's albedo rather than its radiance — a real wall under real
 *     fixtures is brighter than its own albedo. The apparatus is not baked and has nothing
 *     else lighting it, so at 1.0 it stands in a room dimmer than the one it is standing in.
 *     That is what drove the control panel to true black across 6% of its view: the front
 *     faces catch almost nothing from the key light, so the environment is nearly all they
 *     get, and a 1.9%-albedo panel under a half-strength room has nowhere to go but zero.
 *   * **Baked room surfaces get 0.8**, because their albedo already carries most of their
 *     lighting and they must not be lit twice.
 *
 * `glass` and `water` are pinned at 1.0 — the value they were already receiving while this
 * factor was inert. Both were tuned by eye against `Bedo_Mesu_J.mp4`, and making the factor
 * live must not quietly retune them.
 */
export const APPARATUS_ENV = 2.0;
export const BAKED_ROOM_ENV = 0.8;

export const FAMILY_RESPONSE: Record<MaterialFamily, FamilyResponse> = {
  // Bare machined steel: rods, screws, deflectors, valve bodies. A true conductor.
  exposedMetal: { metalness: 1.0, envMapIntensity: APPARATUS_ENV },
  // Paint sits *on* the metal, and paint is an insulator. The panel underneath being steel
  // changes nothing about how light leaves the surface.
  paintedMetal: { metalness: 0.0, roughness: 0.45, envMapIntensity: APPARATUS_ENV },
  plastic: { metalness: 0.0, roughness: 0.42, envMapIntensity: APPARATUS_ENV },
  rubber: { metalness: 0.0, roughness: 0.85, envMapIntensity: APPARATUS_ENV },
  // Never metallic. Transmission and IOR carry the look; see `applyGlass`.
  glass: { metalness: 0.0, roughness: 0.05, envMapIntensity: 1.0 },
  // Walls, floor, bench surfaces — all baked, all insulators, all rough.
  roomSurface: { metalness: 0.0, roughness: 0.88, envMapIntensity: BAKED_ROOM_ENV },
  // Owned by the water material itself; listed so nothing here touches it.
  water: { metalness: 0.0, envMapIntensity: 1.0 },
  unknown: { metalness: 0.0, envMapIntensity: APPARATUS_ENV },
};

/**
 * Which family an authored material belongs to.
 *
 * Ordered most specific first. `MergedBake_*` is the room bake and has to be caught before
 * anything else, because its authored metalness of 1 would otherwise read as metal.
 */
/**
 * The dimmest base colour a real conductor can have, as sRGB luminance.
 *
 * Metals have no diffuse term: their whole appearance is a coloured specular reflection whose
 * strength is the base colour. That colour is a measured physical constant per metal, and it
 * is always bright — iron and titanium, the darkest common ones, sit near 0.55 linear, and
 * gold, copper, aluminium and steel are brighter still. Nothing in nature reflects like a
 * conductor at 15% grey.
 *
 * So an authored material named "metal" with a very dark base colour is not describing metal;
 * it is describing paint or a powder coat over metal, where the darkness comes from pigment.
 * Rendering it as a conductor is what produced the control-panel clipping: with no diffuse to
 * fall back on, `black metal` (#262626) showed only the room reflected at 15% strength, and
 * wherever the room was dim those pixels went to true black. Ambient could not lift them,
 * because ambient light feeds diffuse and a conductor has none.
 *
 * Materials carrying an albedo map are exempt — the map supplies the brightness, so a white
 * base colour there means "use the texture", not "this surface is white".
 */
export const MIN_CONDUCTOR_LUMINANCE = 0.35;

/** sRGB luminance of a material's base colour, or null if it has none. */
export function baseColourLuminance(material: THREE.Material): number | null {
  const standard = material as THREE.MeshStandardMaterial;
  if (!standard.color) return null;
  const hex = standard.color.getHex(THREE.SRGBColorSpace);
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Is this named-as-metal material actually a coated surface?
 *
 * Only ever demotes an untextured material whose own authored colour is too dark to be a
 * conductor. It cannot promote anything, and it cannot touch a mapped metal.
 */
function isCoatedRatherThanConductor(material: THREE.Material): boolean {
  const standard = material as THREE.MeshStandardMaterial;
  if (standard.map) return false;
  const luminance = baseColourLuminance(material);
  return luminance !== null && luminance < MIN_CONDUCTOR_LUMINANCE;
}

export function classifyMaterial(material: THREE.Material): MaterialFamily {
  const name = (material.name || '').toLowerCase();
  const physical = material as THREE.MeshPhysicalMaterial;

  if (name.includes('galss') || name.includes('glass')) return 'glass';
  if ((physical.transmission ?? 0) > 0.5) return 'glass';
  if (name.startsWith('mergedbake')) return 'roomSurface';
  if (name.includes('rubber') || name.includes('hose') || name.includes('tube')) return 'rubber';
  if (name.includes('plastic')) return 'plastic';
  // "dirty metal" is the tank cover: the reference shows a matte black coated disc with
  // brass bolts, and its own base texture is `DIRTY PLASTIC`. Coated, therefore not a
  // conductor.
  if (name.includes('dirty metal')) return 'paintedMetal';
  if (name.includes('paint') || name.includes('coat')) return 'paintedMetal';
  if (
    name.includes('steel') ||
    name.includes('crews') ||
    name.includes('aluminum') ||
    name.includes('aluminium') ||
    name.includes('chrome') ||
    name.includes('metal') ||
    name.includes('cone') ||
    name.includes('copper')
  ) {
    // Named metal, but too dark to be one. See `MIN_CONDUCTOR_LUMINANCE`.
    return isCoatedRatherThanConductor(material) ? 'paintedMetal' : 'exposedMetal';
  }
  // Authored as a full conductor with no contrary evidence: believe it.
  if ((physical.metalness ?? 0) >= 0.95) return 'exposedMetal';
  return 'unknown';
}

/**
 * Give a material its family's response, keeping everything the artist authored.
 *
 * Maps, colours and normals are untouched. Roughness is only overwritten where the family
 * defines one *and* the authored value is implausible for it — a painted panel authored at
 * 0.4 is left alone, a room surface authored at 1.0 with metalness 1 is not.
 */
export function applyFamily(
  material: THREE.Material,
  family: MaterialFamily,
  envScale = 1
): void {
  const response = FAMILY_RESPONSE[family];
  const standard = material as THREE.MeshStandardMaterial;
  if (standard.isMeshStandardMaterial) {
    standard.metalness = response.metalness;
    if (response.roughness !== undefined && !standard.roughnessMap) {
      // One-sided, deliberately. The failure this corrects is a surface authored *glossier*
      // than its material can be — mirror-finish plastic, paint with a chrome highlight. A
      // finish rougher than the family default is just a matte variant of it, and flattening
      // a matte black panel to semi-gloss because the family's nominal value is 0.45 would be
      // inventing a sheen the artist did not author.
      const authored = standard.roughness ?? 1;
      if (authored < response.roughness - 0.35) standard.roughness = response.roughness;
    }
    standard.envMapIntensity = response.envMapIntensity * envScale;
    standard.needsUpdate = true;
  }
}

/**
 * Clear glass, as the reference shows it.
 *
 * In `Bedo_Mesu_J.mp4` the tank reads as a distinct cylinder: you see its edges, a bright
 * highlight along the top rim, and everything behind it. Not chrome, not milky, not absent.
 * Transmission with a thin wall gets that; `metalness` would destroy it outright, which is
 * what six of the pump's sight-glasses were doing at 0.8.
 */
export interface GlassTuning {
  /** Surface polish. The tank is smooth glass, so this stays very low. */
  roughness?: number;
  ior?: number;
  /** Scales the family's environment response, from the scene config. */
  envScale?: number;
  /** Strength of the rim highlight along the tank's edges. */
  specularIntensity?: number;
}

export function applyGlass(material: THREE.Material, tuning: GlassTuning = {}): void {
  const physical = material as THREE.MeshPhysicalMaterial;
  // Not every glass in this model was exported as a physical material — `Galss_Material` is
  // a plain `MeshStandardMaterial` authored at `metalness: 1`. Returning early here left it
  // rendering as a mirror-finish conductor, which is the single worst material error in the
  // scene: a metallic tank cannot be seen through at all. Transmission needs the physical
  // material, but *not being metal* does not, so apply what the material can carry.
  if (!physical.isMeshPhysicalMaterial) {
    const standard = material as THREE.MeshStandardMaterial;
    if (standard.isMeshStandardMaterial) {
      standard.metalness = 0;
      standard.roughness = tuning.roughness ?? 0.05;
      standard.envMapIntensity = FAMILY_RESPONSE.glass.envMapIntensity * (tuning.envScale ?? 1);
      standard.needsUpdate = true;
    }
    return;
  }
  physical.metalness = 0;
  physical.roughness = tuning.roughness ?? 0.05;
  physical.transmission = 0.95;
  physical.thickness = 0.01;
  physical.ior = tuning.ior ?? 1.52;
  physical.transparent = true;
  physical.opacity = 1;
  physical.envMapIntensity = FAMILY_RESPONSE.glass.envMapIntensity * (tuning.envScale ?? 1);
  // Edge definition without a mirror: a light clearcoat gives the rim highlight the
  // reference shows along the top of the tank.
  physical.specularIntensity = tuning.specularIntensity ?? 1;
  physical.clearcoat = 0.25;
  physical.clearcoatRoughness = 0.08;
  physical.needsUpdate = true;
}
