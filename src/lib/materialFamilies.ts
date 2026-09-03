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

/**
 * The band of finishes a family can plausibly have.
 *
 * A single target value cannot express what is actually known about these surfaces. A powder
 * coat is not one roughness — it runs from a satin 0.45 to a flat 0.7 depending on the
 * coating — but it is never 0.9, and 0.9 is what several of them are authored at. So the
 * family states the range the finish must fall inside and the authored value is clamped into
 * it, which keeps every artist choice that was physically possible and corrects only the ones
 * that were not.
 */
export interface RoughnessBand {
  min: number;
  max: number;
}

/** Physically coherent targets per family. Only these scalars are ever written. */
export interface FamilyResponse {
  metalness: number;
  /** Left undefined where any authored roughness is acceptable for the family. */
  roughness?: RoughnessBand;
  envMapIntensity: number;
  /**
   * How much specular reflection an insulator of this family has, as a scale on the F0
   * implied by its index of refraction. See `DIELECTRIC_SPECULAR`.
   */
  specularIntensity?: number;
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
/**
 * 0.45, down from 0.8, because the room is now lit twice.
 *
 * The baked albedo already carries the room's indirect light, and a directional sun now
 * carries its direct light. Leaving the environment response where it was simply added the
 * sun on top of a room that was already fully lit — the floor and walls climbed together and
 * the beam stopped reading as a beam. Pulling the ambient half of the pair back is what turns
 * two overlapping solutions into one: the bake supplies the fill, the sun supplies the
 * direction and the shadows, and their sum lands near the reference rather than above it.
 *
 * This changes only how much environment the baked surfaces *receive*. The MergedBake
 * textures themselves are untouched, as is the frozen GLB.
 */
export const BAKED_ROOM_ENV = 0.45;

/**
 * The environment a dark coating receives, which is not the one the rest of the apparatus
 * receives.
 *
 * `APPARATUS_ENV` is 2.0 for a stated reason, and the reason is entirely about **diffuse
 * fill**: the probe photographs the room flat-lit at unity, so it reproduces the bake's
 * albedo rather than its radiance, and an unbaked surface standing in that captured room is
 * standing somewhere dimmer than the real one. Its own note says so in the language of
 * diffuse — *"a 1.9%-albedo panel under a half-strength room has nowhere to go but zero"*.
 *
 * three applies one factor to both lobes. On most of the apparatus that is harmless, because
 * diffuse dominates and the specular is a few percent on top. On a **powder coat it inverts**:
 * `black metal` has an albedo of 0.02, so there is almost no diffuse there to restore, and
 * the 2x lands almost entirely on the specular — where it makes the coating reflect a room
 * twice as bright as the room actually is. At grazing angles, where Fresnel drives
 * reflectance toward 1 and the lobe is effectively a mirror, that doubling is the whole of
 * what you see.
 *
 * That is measurable and it is what the reference caught. Against the approved reference
 * render, whose powder-coated legs sit at a median of 13 of 255, Stage B put them at 40 —
 * they read as dark grey rather than black. Returning the coating's environment to unity
 * takes them to 29 while every plane and edge Stage B recovered stays visible, because the
 * specular is still there; it is reflecting a room of the right brightness.
 *
 * Scoped to `paintedMetal`, which is three materials. In particular the **control panel is
 * not one of them** — it classifies as `unknown` and keeps `APPARATUS_ENV`, so the black
 * clipping that 2.0 exists to prevent is unchanged at 0.342% of its view.
 */
export const COATING_ENV = 1.0;

/**
 * ## The specular reflection this model does not have
 *
 * Every insulator has one. Light arriving at a boundary between air and anything else is
 * partly reflected at the surface before any of it reaches the pigment underneath, and how
 * much is decided by the index of refraction alone — about 4% head-on for the IOR 1.5 that
 * paint, plastic and concrete all sit near, rising toward 100% at grazing angles. It is not
 * an artistic flourish. It is the reason a painted panel has a sheen, the reason a black
 * surface still shows its edges, and the reason a wall lit from one side has a gradient
 * across it rather than one flat value.
 *
 * **31 of this model's 68 materials switch it off.** They carry `KHR_materials_specular`
 * with `specularFactor: 0`, which three's loader faithfully applies as
 * `specularIntensity = 0`, and a dielectric at zero specular is a pure Lambertian surface:
 * no sheen, no Fresnel, no grazing highlight, no view dependence of any kind. That is a
 * physically impossible material in exactly the same way `metalness: 0.5` is, and it is on
 * the white bench, the powder-coated frame, the control panel and most of the apparatus.
 *
 * It measures as clearly as it sounds. Across the whole white bench panel — a large surface
 * spanning several orientations — the baseline render's luminance runs from 221 to 222, a
 * standard deviation of 0.31 in 255. There is no lighting fix for that, because nothing
 * about the lighting is wrong; the surface simply has no term that could respond to it.
 *
 * A further 32 materials carry the opposite error, `specularColorFactor` of 1.7 to 2.0,
 * which puts F0 near 8% — brighter than any common dielectric.
 *
 * ## The correction, and the one it is not
 *
 * `specularIntensity` is *lifted* to full strength, because zero is not a finish.
 * `specularColor` is *clamped down to 1*, because a factor above 1 is F0 above every
 * dielectric — but it is **not raised**, and that distinction is the whole of Stage B.1.
 *
 * Stage B set the colour to exactly 1 in both directions, and the census says why that was
 * wrong. Of the 64 materials carrying the extension, 32 sit above 1 and 32 at or below it,
 * and of those 32 exactly **one** is meaningfully below: `Material #35`, authored at 0.173.
 * A factor below 1 is not the exporter's error — it is a suppressed specular, which is a
 * real finish for an absorptive matte coating, and this model uses it exactly once.
 *
 * Raising that one material to 1.0 multiplied its F0 by 5.8, from 0.7% to 4.3%. It is a
 * near-black surface (`#161616`) on the tank-base assembly, seen in the review framing at
 * `N·V` of 0.15 to 0.19 — that is 80 degrees off its normal, where Fresnel drives
 * reflectance toward 1 and a 5.8x F0 goes straight to white. Every clipped pixel in the
 * Stage B tank-collar crop was traced to it, and none of them to the white ring they were
 * assumed to be.
 *
 * So the rule is one-sided in each direction, and each direction has its own reason:
 * an impossible zero comes up, an impossible excess comes down, and an authored choice
 * that is physically possible is left alone.
 */
export const DIELECTRIC_SPECULAR = 1.0;

/** The most F0 a dielectric can have, as a factor on the IOR-derived value. */
export const MAX_SPECULAR_COLOUR = 1.0;

/**
 * How much environment glass reflects — the same 2.0 the rest of the apparatus receives.
 *
 * It was pinned at 1.0, and the note said why: the factor had been inert, glass had been
 * receiving the environment at 1.0 all along, and making it live must not quietly retune an
 * appearance that had been signed off. That was a preservation decision, not a physical one,
 * and it is the reason the tank has no rim.
 *
 * The physics is the argument already made for `APPARATUS_ENV`: the probe photographs the
 * room *flat-lit at unity*, so it holds the room's albedo rather than its radiance, and a
 * surface reflecting it therefore shows a room dimmer than the one it stands in. That
 * argument is *strongest* for glass. A painted panel reflects a few percent of the
 * environment and the shortfall is invisible; a glass cylinder at grazing incidence
 * reflects essentially all of it, so the same shortfall is the whole of what is missing.
 *
 * Measured on the tank's silhouette, against a render of the same frame with the tank
 * hidden — which isolates the glass's own contribution from the background behind it:
 *
 *   | glass `envMapIntensity` | rim gain | rim band |
 *   |---|---|---|
 *   | 1.0 | +4.5 | 2 px |
 *   | **2.0** | **+17.5** | **11 px** |
 *   | 3.0 | +26.4 | 15 px |
 *   | 4.0 | +32.1 | 16 px |
 *
 * 2.0 rather than the 3.0 or 4.0 that read brighter still, because 2.0 is the level every
 * other unbaked surface in this scene already receives and needs no separate justification.
 * Above it, glass would be reflecting a brighter room than the apparatus standing in it.
 */
export const GLASS_ENV = APPARATUS_ENV;

/**
 * The dimmest reflectance a real conductor can have, in linear light.
 *
 * `MIN_CONDUCTOR_LUMINANCE` below decides whether something *is* a conductor. This decides
 * what a conductor that survives that test must look like, and it is the same physics from
 * the other side: a metal's base colour is its reflectance, that reflectance is a measured
 * constant, and the darkest common metals — iron, titanium — sit near 0.55. Nothing in
 * nature reflects like a conductor at 0.16, which is what `steels crews` is authored at.
 *
 * Only untextured conductors are lifted. A mapped one gets its brightness from the map.
 */
export const CONDUCTOR_MIN_REFLECTANCE = 0.55;

export const FAMILY_RESPONSE: Record<MaterialFamily, FamilyResponse> = {
  // Bare machined steel: rods, screws, deflectors, valve bodies. A true conductor.
  //
  // The band is a guard rather than a correction — every conductor in this model is authored
  // between 0.2 and 0.5, which is the right range for machined and brushed stock — and it
  // exists so that nothing here can become a mirror or a chalk stick. What these surfaces
  // actually needed was `CONDUCTOR_MIN_REFLECTANCE` and `neutraliseConductorTint`.
  // No `specularIntensity`: at `metalness: 1` three mixes it entirely out in favour of the
  // base colour, so it would be an inert number sitting in the table pretending to matter.
  exposedMetal: { metalness: 1.0, roughness: { min: 0.18, max: 0.5 }, envMapIntensity: APPARATUS_ENV },
  // Paint sits *on* the metal, and paint is an insulator. The panel underneath being steel
  // changes nothing about how light leaves the surface.
  //
  // 0.45 to 0.68 is powder coat: satin at the smooth end, flat at the rough end. The frame's
  // `black metal` is authored at 0.9, which is closer to unfinished plaster than to a coating
  // and is most of why the legs read as a silhouette rather than as an object.
  paintedMetal: {
    metalness: 0.0,
    roughness: { min: 0.45, max: 0.68 },
    envMapIntensity: COATING_ENV,
    specularIntensity: DIELECTRIC_SPECULAR,
  },
  plastic: {
    metalness: 0.0,
    roughness: { min: 0.3, max: 0.6 },
    envMapIntensity: APPARATUS_ENV,
    specularIntensity: DIELECTRIC_SPECULAR,
  },
  rubber: {
    metalness: 0.0,
    roughness: { min: 0.7, max: 0.95 },
    envMapIntensity: APPARATUS_ENV,
    specularIntensity: DIELECTRIC_SPECULAR,
  },
  // Never metallic. Transmission and IOR carry the look; see `applyGlass`.
  glass: { metalness: 0.0, roughness: { min: 0.0, max: 0.1 }, envMapIntensity: GLASS_ENV },
  // Walls, floor, bench surfaces — all baked, all insulators.
  //
  // No band: these are the only materials in the model carrying a roughness *map*, so their
  // `roughness` is a multiplier on it rather than a finish, and clamping a multiplier into a
  // range of finishes would mean nothing. The floor's own response is set separately —
  // see `FLOOR_RESPONSE`.
  roomSurface: { metalness: 0.0, envMapIntensity: BAKED_ROOM_ENV },
  // Owned by the water material itself; listed so nothing here touches it.
  water: { metalness: 0.0, envMapIntensity: 1.0 },
  // An insulator whose finish is not identified — which, in this model, is 36 of the 68
  // materials, because most of them are named `08 - Default` or `Material #27601`.
  //
  // Audited one by one, every surface that lands here is a manufactured coated part: the
  // white bench and sink, the powder-coated instrument panels, the printed deflector labels,
  // the control panel. So the response is the conservative one for a coated surface rather
  // than the null response it used to be, which left over half the apparatus with no
  // specular at all and no roughness discipline.
  unknown: {
    metalness: 0.0,
    roughness: { min: 0.4, max: 0.68 },
    envMapIntensity: APPARATUS_ENV,
    specularIntensity: DIELECTRIC_SPECULAR,
  },
};

/**
 * ## The laboratory floor, and why nothing here changes it
 *
 * It reads flat, and the obvious reading of that — a floor authored too rough, with its
 * detail maps ignored — is wrong on every count. Sampled over its own triangles in the
 * running scene, area-weighted:
 *
 *   | channel | what is actually there |
 *   |---|---|
 *   | albedo | **exactly 102, 102, 102 at every sample** — uniform, neutral, no variation |
 *   | normal map | **exactly (128, 128, 255) at every sample** — the flat normal |
 *   | roughness map | **a constant 0.502** — 5th, 50th and 95th percentiles all identical |
 *
 * So there is no authored surface detail to preserve, and nothing to add procedural detail
 * *instead of*: the normal map is flat and the roughness map is a single value. The floor
 * is also not too rough — 0.502 is semi-gloss already — and its albedo is not tinted, so
 * the warm cast it renders with comes from the light, not the surface.
 *
 * What makes it flat is the light. Both of the sources reaching a floor in shade — the
 * ambient light and the captured room environment — are close to isotropic, and a surface
 * lit equally from every direction has no gradient to show whatever it is made of. Its
 * specular reflects the upper hemisphere, which in this room is the dark ceiling and walls.
 *
 * That was not assumed. Four changes were built, rendered and measured against the shaded
 * floor's baseline of mean 83.1, standard deviation 2.59:
 *
 *   | change | mean | sd | sun-shadow floor (p05) |
 *   |---|---|---|---|
 *   | baseline, as authored | 83.1 | **2.59** | 32 |
 *   | `emissiveIntensity` 1.0 -> 0.6 | 78.4 | 1.86 | 30 |
 *   | + `envMapIntensity` 0.45 -> 1.0, albedo x0.72 | 72.5 | 2.17 | 52 |
 *   | `envMapIntensity` 0.45 -> 1.0 alone | 86.0 | 1.22 | **63** |
 *   | roughness 0.502 -> 0.35 alone | 79.0 | 1.23 | 39 |
 *
 * Every one of them makes the floor *flatter*, and the two that raise the environment fill
 * the sun's own shadow — p05 climbing from 32 to 63 is the mullion bars washing out, which
 * is the Stage A result being undone. The authored values win, so they are kept.
 *
 * The one thing that would deliver a floor reflecting the apparatus is a second environment
 * probe that includes it; `captureRoomEnvironment` deliberately excludes the apparatus, so
 * today the floor has nothing of it to reflect and no material parameter can invent one.
 * That is an architecture change and is left for a decision rather than taken here.
 */

/**
 * The brightest a painted surface can be, in linear light.
 *
 * A dielectric's albedo is the fraction of light it diffusely returns, and paint does not
 * reach 1. The brightest real coatings — fresh titanium-dioxide enamel — sit near 0.85,
 * and that is a laboratory reference standard rather than a bench that has been in a
 * teaching workshop; industrial coated equipment sits nearer 0.7.
 *
 * The bench and sink are authored at 0.847, and the cost of that is not mainly that they
 * are too bright. It is that under ACES tone mapping they land on the shoulder of the
 * curve, where a 20% change in the light falling on a panel moves the displayed value by
 * about 7 of 255. That is the difference between a surface that shows its form and one
 * that reads as a cut-out, and it is why the white bench measures a standard deviation of
 * 0.31 across an entire multi-panel crop. Bringing the albedo to a physical value moves it
 * off the shoulder, which is what gives the restored specular somewhere to be seen.
 *
 * 0.55 rather than something nearer the top of the range, because it was measured. Across
 * the bench panel the restored gradient goes 0.46 at a cap of 0.68 and 0.58 at 0.55, while
 * the panel stays plainly white at 209 of 255 — so the lower value reads as coated paint
 * on both counts. Two materials in this model exceed the cap, and only untextured ones are
 * eligible at all.
 */
export const MAX_INSULATOR_ALBEDO = 0.55;

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
 * Lift an untextured conductor to a reflectance a metal can actually have.
 *
 * Preserves hue and only ever brightens, so a metal authored at a plausible value is left
 * exactly as it is. See `CONDUCTOR_MIN_REFLECTANCE`.
 */
/**
 * Bring a painted surface down to a reflectance paint can have. See `MAX_INSULATOR_ALBEDO`.
 *
 * Only ever darkens, preserves hue, and skips anything with an albedo map — where a map
 * supplies the colour, a white base colour means "use the texture", not "this is white".
 */
function capInsulatorAlbedo(material: THREE.MeshStandardMaterial): void {
  if (material.map || !material.color) return;
  const { r, g, b } = material.color;
  const peak = Math.max(r, g, b);
  if (peak <= MAX_INSULATOR_ALBEDO) return;
  material.color.multiplyScalar(MAX_INSULATOR_ALBEDO / peak);
}

function liftConductorReflectance(material: THREE.MeshStandardMaterial): void {
  if (material.map || !material.color) return;
  const { r, g, b } = material.color;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance <= 0 || luminance >= CONDUCTOR_MIN_REFLECTANCE) return;
  material.color.multiplyScalar(CONDUCTOR_MIN_REFLECTANCE / luminance);
}

/**
 * Give a material its family's response, keeping everything the artist authored.
 *
 * Maps, colours and normals are untouched, with the two exceptions the physics forces:
 * a conductor too dark to be a conductor is lifted, and an insulator with its specular
 * switched off has it switched back on.
 *
 * Roughness is clamped into the family's band rather than overwritten, so every authored
 * value that a surface of that family could really have survives untouched.
 */
export function applyFamily(
  material: THREE.Material,
  family: MaterialFamily,
  envScale = 1
): void {
  const response = FAMILY_RESPONSE[family];
  const standard = material as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial) return;

  standard.metalness = response.metalness;

  // Only where the roughness is a finish. With a roughness *map* the scalar is a multiplier
  // on it, and clamping a multiplier into a range of finishes would be meaningless.
  if (response.roughness && !standard.roughnessMap) {
    const authored = standard.roughness ?? 1;
    standard.roughness = Math.min(response.roughness.max, Math.max(response.roughness.min, authored));
  }

  if (response.metalness < 1) {
    liftConductorSpecular(standard, response);
    capInsulatorAlbedo(standard);
  }
  if (family === 'exposedMetal') liftConductorReflectance(standard);

  standard.envMapIntensity = response.envMapIntensity * envScale;
  standard.needsUpdate = true;
}

/**
 * Restore an insulator's surface reflection. See `DIELECTRIC_SPECULAR`.
 *
 * Both halves matter and they fail in opposite directions: `specularIntensity: 0` removes
 * the reflection entirely, and a `specularColor` of 2 doubles it. Neither is a finish an
 * artist chose — they are what the exporter wrote — so both are set to the physical value
 * and F0 is left to come from the material's own index of refraction.
 *
 * `MeshStandardMaterial` has neither property and needs neither: it has no way to express
 * the error, and its fixed 4% dielectric F0 is already the right answer.
 */
function liftConductorSpecular(
  material: THREE.MeshStandardMaterial,
  response: FamilyResponse
): void {
  const physical = material as THREE.MeshPhysicalMaterial;
  if (!physical.isMeshPhysicalMaterial || response.specularIntensity === undefined) return;
  // Up only. A surface authored with *less* specular than the family's nominal strength is
  // describing a finish; one authored with none is describing nothing.
  if ((physical.specularIntensity ?? 1) < response.specularIntensity) {
    physical.specularIntensity = response.specularIntensity;
  }
  // Down only, and preserving hue. See `MAX_SPECULAR_COLOUR`.
  const specular = physical.specularColor;
  if (specular) {
    const peak = Math.max(specular.r, specular.g, specular.b);
    if (peak > MAX_SPECULAR_COLOUR) specular.multiplyScalar(MAX_SPECULAR_COLOUR / peak);
  }
}

/**
 * ## The blue steel
 *
 * The checker plate reads violet, and so — less obviously — do the deflectors, the tank
 * fittings and the iron parts around them. It is worth being exact about where that comes
 * from, because there are four plausible sources and only one of them is the real one.
 *
 * It is **the base colour texture**, and nothing else. Measured:
 *
 *   | map | mean RGB | blue over red |
 *   |---|---|---|
 *   | `ground_uv_3` (checker plate) | 119.5, 119.3, 129.5 | +8.4% |
 *   | `iron basic` | 164.4, 169.4, 176.5 | +7.4% |
 *   | `steel1` (deflectors) | 160.3, 163.3, 167.7 | +4.6% |
 *
 * and the rendered plate comes out at 61.5, 61.4, 66.5 — **+8.1%**, which is the map's own
 * +8.4% arriving essentially unchanged. That rules the other three suspects out by
 * arithmetic. The environment is not adding a cast, or the rendered ratio would exceed the
 * map's. The base colour *factor* is white. There is no emissive on these materials. And
 * the colour space is right, or a neutral map would have come out tinted too.
 *
 * ## Why it matters more here than it would anywhere else
 *
 * On an insulator an 8% blue albedo is a faintly cool grey and nobody would notice. These
 * are conductors, and a conductor has no diffuse term at all — its base colour *is* the
 * colour of its specular reflection. So the cast is not a tint sitting under the
 * reflection, it multiplies the reflection, and every highlight the plate produces comes
 * out violet however neutral the light was.
 *
 * ## The rule
 *
 * A conductor's reflectance is a measured physical constant, and for the ferrous and
 * aluminium stock this apparatus is made of it is neutral. So a conductor whose map is
 * *nearly* neutral is meant to be neutral, and the residual cast is an authoring artefact:
 * it is measured once and divided out, preserving the map's luminance and every bit of its
 * pattern. A conductor whose map is *strongly* coloured is a coloured metal and is left
 * alone — `dirty copper` measures 0.62 saturation against the checker plate's 0.08, so the
 * two populations are not close to each other and the threshold is not a fine judgement.
 */
export const CONDUCTOR_TINT_LIMIT = 0.25;

/** Side of the square the tint is measured over. */
const TINT_SAMPLE_SIZE = 32;

/** Measured mean colour per texture, so a map shared by several materials is read once. */
const measuredTints = new WeakMap<THREE.Texture, THREE.Color | null>();
/** Materials already corrected, so a re-run of the material pass cannot double-correct. */
const neutralised = new WeakSet<THREE.Material>();

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * The mean linear colour of a texture's used area, or null if it cannot be read.
 *
 * Pixels at or near black are skipped. These are atlas maps and a third to two thirds of
 * each one is empty gutter — `weight_500_uv` is 66% black — so averaging the whole image
 * would measure the padding rather than the material.
 */
function measureTint(texture: THREE.Texture): THREE.Color | null {
  if (measuredTints.has(texture)) return measuredTints.get(texture) ?? null;
  let result: THREE.Color | null = null;
  const image = texture.image as CanvasImageSource & { width?: number; height?: number };
  if (typeof document !== 'undefined' && image?.width && image.height) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = TINT_SAMPLE_SIZE;
      canvas.height = TINT_SAMPLE_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.drawImage(image, 0, 0, TINT_SAMPLE_SIZE, TINT_SAMPLE_SIZE);
        const { data } = context.getImageData(0, 0, TINT_SAMPLE_SIZE, TINT_SAMPLE_SIZE);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] < 24) continue;
          r += srgbToLinear(data[i] / 255);
          g += srgbToLinear(data[i + 1] / 255);
          b += srgbToLinear(data[i + 2] / 255);
          n++;
        }
        if (n > 0) result = new THREE.Color(r / n, g / n, b / n);
      }
    } catch {
      // A texture the canvas will not accept — a compressed upload, a tainted source —
      // leaves the material exactly as authored, which is the safe outcome.
      result = null;
    }
  }
  measuredTints.set(texture, result);
  return result;
}

/** HSV saturation of a colour: 0 for any neutral, however bright or dark. */
export function chromaOf(colour: THREE.Color): number {
  const max = Math.max(colour.r, colour.g, colour.b);
  if (max <= 0) return 0;
  return (max - Math.min(colour.r, colour.g, colour.b)) / max;
}

/**
 * Remove a conductor's colour cast, if it has one and is not a coloured metal.
 *
 * Applied through `material.color`, which three multiplies into the map — so the map itself
 * is untouched, as is the frozen GLB, and the plate keeps every bit of its pattern. The
 * factor preserves luminance rather than only darkening: the blue channel comes down, the
 * red and green go up very slightly, and the plate stays as bright as it was.
 *
 * Returns what it decided, which is what the audit script reports.
 */
export function neutraliseConductorTint(
  material: THREE.Material
): 'neutralised' | 'coloured-metal' | 'unmeasurable' | 'already-neutral' {
  if (neutralised.has(material)) return 'already-neutral';
  const standard = material as THREE.MeshStandardMaterial;
  if (!standard.map || !standard.color) return 'unmeasurable';
  const tint = measureTint(standard.map);
  if (!tint) return 'unmeasurable';
  const chroma = chromaOf(tint);
  if (chroma > CONDUCTOR_TINT_LIMIT) return 'coloured-metal';
  neutralised.add(material);
  const luminance = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b;
  if (luminance <= 0) return 'unmeasurable';
  standard.color.setRGB(
    (standard.color.r * luminance) / Math.max(tint.r, 1e-6),
    (standard.color.g * luminance) / Math.max(tint.g, 1e-6),
    (standard.color.b * luminance) / Math.max(tint.b, 1e-6)
  );
  standard.needsUpdate = true;
  return 'neutralised';
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

/**
 * ## The tank is authored as a standard material, and what that costs
 *
 * `Galss_Material` — the cylinder `JET_Force_2_205`, and nominally `Line010` — is the
 * only glass in this model authored with **no material extensions at all**. No
 * `Line010` was described here as the tank's "base ring". It is not, and the description
 * was never measured: it is the bent supply hose, 288 mm to the side of the tank axis and
 * 408 mm below its floor. The reference recording shows it translucent with water inside,
 * so `DeviceModel` gives it a hose material of its own (BEDO-WATER-12). Only the cylinder
 * below is really glass; the paragraph is about that material's authoring, which both
 * meshes happened to share.
 *
 * `KHR_materials_transmission`, no `KHR_materials_ior`, and no `KHR_materials_specular`
 * either, so unlike almost everything else in Stage B it inherits no bad specular value to
 * correct. What it inherits instead is a *type*: with no transmission extension the loader
 * builds a `MeshStandardMaterial`, whose only route to transparency is `opacity`, and the
 * GLB duly sets `baseColorFactor` alpha to 0.10 with a base colour of
 * [0.499, 0.652, 0.801] — a blue filter.
 *
 * Two consequences, and only one of them is fixable here.
 *
 * **The tint is.** Glass is not blue, and a clear vessel's colour is the glass itself, so
 * `applyGlass` sets the base colour neutral — the same correction Stage B made for
 * conductors carrying a cast in their maps.
 *
 * **The attenuated reflection is not.** Alpha blending multiplies the entire shaded result
 * — the environment reflection included — by the opacity, so at 0.10 the Fresnel term
 * arrives at a tenth of its strength. The mechanism that fixes that is `transmission`,
 * which takes light out of the diffuse path and leaves the specular alone; it needs a
 * `MeshPhysicalMaterial`, and rebuilding the tank as one does work — measured, the rim gain
 * goes from −14.9 to +17.5 and the face-on veil from −15.2 to +4.0.
 *
 * It is **not enabled**, and the reason is a rendering artifact rather than a material one.
 * With transmission on, a black stippled band appears where the tank's bottom rim meets the
 * collar. It was isolated to three's transmission resolve: hide the neighbouring opaque
 * geometry and it is clean, clone the same tank into empty space and it is clean, and it
 * scales with `transmissionResolutionScale` — 4.27% of the crop at 1.0, 1.99% at 3.0, never
 * zero. It is independent of shadows, depth writing, render order, `polygonOffset`,
 * `thickness` and `side`. So it is the renderer sampling a displaced UV across a
 * high-contrast silhouette in a limited-resolution buffer, triggered by geometry that sits
 * immediately behind the glass — and neither half is ours to change while the GLB is frozen.
 *
 * ## Whether it can be had another way — checked, and no
 *
 * three r184 exposes exactly **one** public control over that pass,
 * `renderer.transmissionResolutionScale`. Everything else is fixed where the target is
 * constructed: MSAA at `max(4, capabilities.samples)`, `resolveDepthBuffer: false`,
 * half-float, mipmapped, working colour space, and tone mapping forced off for the duration.
 * There is no per-object exclusion hook — the pass calls `renderObjects(opaqueObjects, …)`
 * with no filter — so the collar cannot be kept out of the buffer that the glass samples
 * without hiding it per frame around the render call, which is a custom rendering
 * architecture and out of scope.
 *
 * drei's `MeshTransmissionMaterial` is a genuinely different acquisition path — its own FBO
 * plus a full `gl.render(scene, camera)` every frame — but not a different *sampling* path,
 * and its buffer holds the whole scene minus the parent mesh. That is a superset of what
 * three's pass holds, so the collar silhouette that triggers the artifact is still in it.
 * The extra scene render was measured in this scene at **+3.6 ms p50, +43%** — 8.4 ms to
 * 12.0 ms — and a walled tube would want its `backside` buffer too, making that two.
 *
 * And the artifact does not fall away with resolution. Near-black pixels across the rim
 * crop measure 8.9% at device pixel ratio 1.0, 6.7% at 1.25, 5.3% at 1.5 and 3.9% at 2.0,
 * against a scene floor of 0.55% — still a plainly visible broken black outline at every
 * ratio a desktop actually runs, and this app renders at whatever `devicePixelRatio` gives,
 * which on an ordinary external monitor is 1.0, the worst case.
 *
 * What is kept is everything that carries no artifact: the neutral colour, and the glass
 * environment response at `GLASS_ENV`.
 */
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
      // Neutral. The tank is authored as a blue filter — [0.499, 0.652, 0.801] — and a clear
      // vessel has no colour of its own to impose on the room behind it. Alpha is left
      // exactly as authored; only the hue is corrected.
      standard.color.setRGB(1, 1, 1);
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
