// The orange safety stripe on the laboratory walls, and why it is drawn analytically at
// its two edges.
//
// ## The defect
//
// Seen from the bench, the stripe's top and bottom edges step up and down along the wall —
// a staircase of small jumps every 60 cm or so — and the top of the dark dado band steps
// with it. It reads as broken paint, or as wall panels at different heights.
//
// It is neither. Measured in the running scene rather than read off a screenshot:
//
//   * **Geometry.** The wall behind the apparatus is one flat plane. Rendered with a
//     normal-visualising material it is a single uniform colour from end to end.
//   * **UVs and the source.** Rasterising every wall triangle's texels through its own
//     UV-to-world mapping puts the orange band at world y = 0.188–0.345 m and the dado
//     top at 0.181 m in *every* island of *both* wall atlases, external and partition,
//     to within one texel. The islands agree on where the stripe is.
//   * **The texel grid.** The partition atlas maps the 7.5 m wall behind the bench to a
//     parallelogram of texels that is rotated 0.77° against the pixel grid (its bottom
//     edge runs from (803, 992) to (1550, 1002)). The stripe is therefore a *slanted* band
//     in the atlas, and the bake rasterised it with essentially hard edges: one texel of
//     transition, then a one-texel jump every ~74 texels. At 8.9 mm per texel, each jump is
//     a 9 mm step on the wall, and at the learner's distance 9 mm is several pixels.
//
// So the cause is the source texture: an axis-aligned band rasterised into a rotated
// island at 2048 px without anti-aliasing. It cannot be filtered away — trilinear
// filtering blurs the step, it does not remove it, and at close range there is no mip to
// blur with — and the source bake is not in this repository.
//
// ## The correction
//
// The intended stripe is known exactly: a horizontal band between two world heights, in
// three flat colours that the atlas itself supplies. So in a narrow window around each
// edge (±2 cm, which covers the two-texel stagger with room to spare) the wall's two
// materials evaluate the band from the fragment's own height instead of from the texel
// that happens to cover it, with a one-pixel anti-aliased transition. Everywhere else the
// authored texture is sampled exactly as before, and a texel inside the window that is not
// one of the three band colours — a door frame, a skirting — is left alone too. Nothing
// about the GLB, its atlas or its UVs is changed.
//
// The heights are expressed in the apparatus's own frame (model units), so the scene's
// placement and scale of the model do not move them.

import * as THREE from 'three';

/** The two wall materials that carry the stripe, by their authored names. */
export const WALL_PAINT_MATERIALS: readonly string[] = [
  'Laboratory washable paint - blue grey and warm white.001',
  'Laboratory washable paint - blue grey and warm white.002',
  'Material.002',
];

/**
 * Where the band edges are, in model units (world height + 1.8, over 1.8).
 *
 * Measured off the atlases through the wall UVs: the dado's last dark texel row centres at
 * world y = 0.181 and the first orange row at 0.188, so the edge between them is at
 * 0.1845; the last orange row at 0.345 and the first light row at 0.352 put the upper edge
 * at 0.3485. Both to ±1 mm at 8.9 mm per texel.
 */
export const STRIPE_BOTTOM_MODEL = (0.1845 + 1.8) / 1.8;
export const STRIPE_TOP_MODEL = (0.3485 + 1.8) / 1.8;

/** Half-height of the correction window around each edge, model units (≈ 2 cm world). */
export const STRIPE_WINDOW_MODEL = 0.02 / 1.8;

/** The three flat colours of the band, as authored (sRGB 8-bit), read from the atlas. */
export const STRIPE_COLOURS = {
  dark: [39, 37, 35],
  orange: [201, 113, 38],
  light: [221, 222, 217],
} as const;

/**
 * How far (linear RGB distance) a texel may sit from the nearest band colour and still be
 * treated as part of the band inside the window. The bake's own edge texels are blends of
 * two band colours and must be included; a white frame or a black gutter must not be.
 */
export const STRIPE_COLOUR_TOLERANCE = 0.4;

const linear = ([r, g, b]: readonly [number, number, number]) =>
  new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);

export const isWallPaint = (material: THREE.Material): boolean =>
  WALL_PAINT_MATERIALS.includes(material.name);

const PATCHED = 'bedoWallStripe';

/**
 * Patch a wall material so the band edges come from height rather than from the texel.
 *
 * `rigInverse` is the inverse world matrix of the group the apparatus is placed in, so the
 * heights above are compared in that frame. Idempotent per material.
 */
export function applyWallStripe(material: THREE.Material, rigInverse: THREE.Matrix4): void {
  const standard = material as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial || !standard.map) return;
  if (material.userData[PATCHED]) return;
  material.userData[PATCHED] = true;

  const uniforms = {
    uBedoWorldToRig: { value: rigInverse.clone() },
    uBedoStripeEdges: { value: new THREE.Vector2(STRIPE_BOTTOM_MODEL, STRIPE_TOP_MODEL) },
    uBedoStripeWindow: { value: STRIPE_WINDOW_MODEL },
    uBedoStripeDark: { value: linear(STRIPE_COLOURS.dark) },
    uBedoStripeOrange: { value: linear(STRIPE_COLOURS.orange) },
    uBedoStripeLight: { value: linear(STRIPE_COLOURS.light) },
    uBedoStripeTolerance: { value: STRIPE_COLOUR_TOLERANCE },
  };

  standard.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform mat4 uBedoWorldToRig;
         varying float vBedoRigY;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vBedoRigY = (uBedoWorldToRig * modelMatrix * vec4(transformed, 1.0)).y;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec2 uBedoStripeEdges;
         uniform float uBedoStripeWindow;
         uniform vec3 uBedoStripeDark;
         uniform vec3 uBedoStripeOrange;
         uniform vec3 uBedoStripeLight;
         uniform float uBedoStripeTolerance;
         varying float vBedoRigY;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         {
           float y = vBedoRigY;
           float dBottom = abs(y - uBedoStripeEdges.x);
           float dTop = abs(y - uBedoStripeEdges.y);
           float near = min(dBottom, dTop);
           // Only within the window; fades out over its outer third so nothing pops.
           float window = 1.0 - smoothstep(uBedoStripeWindow * 0.66, uBedoStripeWindow, near);
           if (window > 0.0) {
             vec3 texel = diffuseColor.rgb;
             float dist = min(distance(texel, uBedoStripeDark),
                          min(distance(texel, uBedoStripeOrange), distance(texel, uBedoStripeLight)));
             float isBand = 1.0 - step(uBedoStripeTolerance, dist);
             // One pixel of anti-aliasing, from the height's own screen-space derivative.
             float aa = max(fwidth(y), 1e-5) * 0.7;
             float aboveBottom = smoothstep(uBedoStripeEdges.x - aa, uBedoStripeEdges.x + aa, y);
             float aboveTop = smoothstep(uBedoStripeEdges.y - aa, uBedoStripeEdges.y + aa, y);
             vec3 band = mix(mix(uBedoStripeDark, uBedoStripeOrange, aboveBottom), uBedoStripeLight, aboveTop);
             diffuseColor.rgb = mix(texel, band, window * isBand);
           }
         }`
      );
  };
  // The cache key must differ from the unpatched program, or three reuses it.
  standard.customProgramCacheKey = () => PATCHED;
  standard.needsUpdate = true;
}
