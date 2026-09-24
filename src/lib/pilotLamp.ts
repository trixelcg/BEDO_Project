// The pilot lamp beside the power switch (BEDO-LOOK-05).
//
// It is a red lens — the authored material is `red_light_off`, a photograph of a red
// indicator with its dark bezel — and it used to be lit **green** (`#26ff7a` at 1.6),
// flat across the whole mesh, bezel included. The apparatus has no green lamp: power on
// is the same red lens, self-illuminated.
//
// Two things make that read as a lit lens rather than a red blob:
//
//   * The emissive term is masked by the lens's own texture (`emissiveMap = map`), so the
//     bezel stays dark and the lens keeps its photographed shading while it glows. The
//     emissive colour is a saturated red on top of that, so the red of the map is pushed
//     toward the light's own hue rather than toward white.
//   * The intensity is modest. Under ACES at exposure 1.3 a strongly saturated emissive
//     stays red up to well past this value, but a much larger one would flatten the lens
//     to a white centre, which is exactly the failure the review named.
//
// The lamp answers `isPowerOn` and nothing else: the valve position and the flow do not
// exist as far as it is concerned. `red_light_off` has exactly one user in the model, so
// lighting it touches no other red part.

import * as THREE from 'three';

export const PILOT_LAMP_EMISSIVE = '#ff2a18';
export const PILOT_LAMP_ON_INTENSITY = 1.4;

const PREPARED = 'bedoPilotLamp';

/** Give the lamp its lit-lens response, once. Safe to call again. */
export function preparePilotLamp(material: THREE.Material): void {
  const standard = material as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial || material.userData[PREPARED]) return;
  material.userData[PREPARED] = true;
  if (standard.map) standard.emissiveMap = standard.map;
  standard.emissive.set(PILOT_LAMP_EMISSIVE);
  standard.emissiveIntensity = 0;
  standard.needsUpdate = true;
}

/** The emissive intensity the lamp should settle at. */
export const pilotLampIntensity = (isPowerOn: boolean): number =>
  isPowerOn ? PILOT_LAMP_ON_INTENSITY : 0;
