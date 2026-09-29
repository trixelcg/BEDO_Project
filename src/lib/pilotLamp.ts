// The pilot lamp beside the power switch (BEDO-LOOK-05; lit green on request, 2026-09-29).
//
// The authored material is `red_light_off`, a photograph of a red indicator lens with its
// dark bezel. Off, it is left exactly as authored. On, it lights **green** — the product
// owner's call: green for "pump running", the common panel convention.
//
// A green glow cannot simply be masked by the lens's own texture, as the red one was: the
// emissive term is multiplied by that texture, and green × a red photograph is black. So:
//
//   * The glow is masked by the texture's *brightness*, not its colour: the lens is bright
//     and the bezel dark, so the bezel stays dark and the lens keeps its shading.
//   * While lit, the lens's own red is faded to dark neutral glass (`uLampOn`), so what shows
//     is the green light — not red plus green, and not green washed out by lit grey.
//   * The intensity is modest, so ACES keeps it green rather than flattening it to white.
//
// The lamp answers `isPowerOn` and nothing else. `red_light_off` has exactly one user in the
// model, so lighting it touches no other part.

import * as THREE from 'three';

export const PILOT_LAMP_EMISSIVE = '#00ff2a';
export const PILOT_LAMP_ON_INTENSITY = 1.1;

const PREPARED = 'bedoPilotLamp';

/** Give the lamp its lit-lens response, once. Safe to call again. */
export function preparePilotLamp(material: THREE.Material): void {
  const standard = material as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial || material.userData[PREPARED]) return;
  material.userData[PREPARED] = true;
  if (standard.map) standard.emissiveMap = standard.map;
  standard.emissive.set(PILOT_LAMP_EMISSIVE);
  standard.emissiveIntensity = 0;
  const uLampOn = { value: 0 };
  material.userData.lampOn = uLampOn;
  standard.onBeforeCompile = (shader) => {
    shader.uniforms.uLampOn = uLampOn;
    shader.fragmentShader = 'uniform float uLampOn;\n' + shader.fragmentShader
      // Lit, the red of the lens fades to neutral glass under the green light.
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18 * dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), uLampOn);`
      )
      // Masked by brightness, not colour: green times a red photograph would be black.
      .replace(
        '#include <emissivemap_fragment>',
        `#ifdef USE_EMISSIVEMAP
           vec4 lampTexel = texture2D( emissiveMap, vEmissiveMapUv );
           totalEmissiveRadiance *= smoothstep( 0.12, 0.55, max( lampTexel.r, max( lampTexel.g, lampTexel.b ) ) );
         #endif`
      );
  };
  standard.customProgramCacheKey = () => 'bedo-pilot-lamp';
  standard.needsUpdate = true;
}

/** How lit the lamp is, 0..1 — fades the lens's red while it glows. */
export function setPilotLampLevel(material: THREE.Material, level: number): void {
  const uniform = material.userData.lampOn as { value: number } | undefined;
  if (uniform) uniform.value = Math.min(1, Math.max(0, level));
}

/** The emissive intensity the lamp should settle at. */
export const pilotLampIntensity = (isPowerOn: boolean): number =>
  isPowerOn ? PILOT_LAMP_ON_INTENSITY : 0;
