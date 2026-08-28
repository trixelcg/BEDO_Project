/**
 * The scene configuration the simulator ships with (BEDO-003).
 *
 * These values are not tuning knobs any more — they are the look of the product, and this
 * is the only source of them.
 *
 * ## What this replaced
 *
 * The app used to hold `SceneConfig` in React state, seeded with the literals below, then
 * `fetch('/config.json')` on mount and overwrite them if that file existed. A developer
 * panel (`MenuSettings`) edited every field live and a `POST /api/save-config` wrote the
 * result to `public/config.json` **and to a public GCS bucket** — so any visitor to the
 * deployed site could permanently restyle the scene for everyone (`ARCH-13`). The panel
 * was a modelling tool that shipped by accident; nothing in the training product needs it.
 *
 * ## Where these numbers come from
 *
 * They are the values that were already in force. `/config.json` has never existed in
 * this repository, so the fetch always failed and the literals below were always what the
 * scene ran on. That was not taken on trust: `scripts/scene-fingerprint.mjs` read the
 * live three.js scene graph before the removal and again after, and the two fingerprints
 * are identical — same renderer exposure, same four lights, same apparatus transform,
 * same 33 mesh world transforms, same 16 click hotspots, same camera. See `docs/26`.
 *
 * ## Changing them
 *
 * Edit this file, rebuild, and re-run the fingerprint to see exactly what moved.
 * `tests/unit/scene-config.spec.ts` pins every value that places geometry or affects
 * where a click lands, so a slip shows up as a failing test rather than as a scene that
 * quietly drifted.
 */

/** Tone mapping, lighting, materials and the apparatus transform. */
export interface SceneConfig {
  /** Renderer tone-mapping exposure. */
  exposure: number;
  /** Ambient light intensity, before the contrast trim. */
  selfIllumination: number;
  /** Environment map intensity, applied to both `scene.environment` and the background. */
  hdrLight: number;
  /** Environment rotation about Y, in degrees. */
  hdrRotation: number;
  /** `envMapIntensity` written onto every model material. */
  reflection: number;
  /** Scales the key light up and the fill lights down. */
  contrast: number;
  /** Ambient light colour. */
  ambientColor: string;
  /** Apparatus position in world units. */
  characterPosition: [number, number, number];
  /** Apparatus rotation in **degrees** — converted to radians by `Scene3D`. */
  characterRotation: [number, number, number];
  /** Apparatus scale. Every anchor, hotspot radius and jet dimension is divided by this. */
  characterScale: [number, number, number];
  /** Tank cover glass: specular intensity. */
  glassSpecular: number;
  /** Tank cover glass: surface roughness. Clearcoat roughness is half of it. */
  glassRoughness: number;
  /** Tank cover glass: index of refraction. Water is 1.33; this is the acrylic lid. */
  glassIor: number;

  /**
   * The sun, as it comes through the laboratory window.
   *
   * Azimuth is degrees about Y measured from +X, elevation is degrees above the horizon.
   * The window is the aperture in the wall mass that occupies x -10.6..-0.1, so the sun sits
   * outside that wall and shines inward: the wall itself is the shadow mask and the window
   * opening is what shapes the beam. That is why the room needs a single strong source
   * rather than several corrective ones — the architecture does the shaping.
   *
   * Derived from the reference render: the sunlit floor patch falls to the +Z side of the
   * apparatus with the window mullions crossing it, which puts the sun low enough to throw a
   * long beam into the room and off to one side rather than straight down it.
   */
  sunAzimuth: number;
  sunElevation: number;
  sunIntensity: number;
  sunColor: string;
}

/**
 * Frozen so that a stray write fails loudly in development instead of producing a scene
 * that differs from the one in this file.
 */
export const SCENE_CONFIG: Readonly<SceneConfig> = Object.freeze({
  sunAzimuth: 40,
  sunElevation: 32,
  sunIntensity: 2.4,
  // Daylight, very slightly warm. Sunlight is not white, but it is not orange either; the
  // fills this replaces were #f58220 and had no physical basis at all.
  sunColor: '#fff4e6',

  // 1.3, not 1.0. The environment is now the laboratory's own baked surfaces rather than a
  // 4k outdoor panorama, and a room is a far dimmer thing to stand in than an open field —
  // the scene lost about 15% of its luminance the moment the lighting became correct. This
  // is the camera compensating, which is the honest lever: it re-exposes the whole frame
  // uniformly instead of re-introducing fill lights the room does not contain. Measured
  // against the pre-change baseline it restores mean luminance (90.9 -> 92.2) and improves
  // contrast (34.7 -> 38.7) with no highlight clipping.
  exposure: 1.3,
  selfIllumination: 0.15,
  hdrLight: 1.0,
  hdrRotation: 0,
  reflection: 1.0,
  contrast: 1.0,
  ambientColor: '#d1f2f7',
  characterPosition: Object.freeze([0, -1.8, 0]) as [number, number, number],
  characterRotation: Object.freeze([0, 0, 0]) as [number, number, number],
  characterScale: Object.freeze([1.8, 1.8, 1.8]) as [number, number, number],
  glassSpecular: 1.0,
  glassRoughness: 0.02,
  glassIor: 1.52,
});
