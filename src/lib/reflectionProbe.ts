// What the glass and the water reflect: the laboratory itself, photographed once.
//
// ## Why they looked like nothing
//
// Every material without an `envMap` of its own reflects `scene.environment` — the neutral
// studio of `studioEnvironment.ts` — and three then *overrides* its `envMapIntensity` with
// `scene.environmentIntensity` (0.45). So the tank, the windows, the partitions and all of
// the water reflected a small synthetic grey room at 45 % strength, whatever reflection
// strength their own materials asked for. Glass and water are almost nothing *but* their
// reflection; with a dim, generic one they read as flat tints.
//
// ## What this is
//
// A cube map of the actual room, rendered from just above the tank after the scene has
// loaded, prefiltered into a PMREM pyramid, and given as `envMap` to the glass and the
// water only. The studio keeps lighting everything else exactly as approved: the probe
// changes what the see-through surfaces *reflect*, nothing about how the room is lit.
//
// Cost: six renders of the room, once, at load (plus the PMREM filter). Nothing per frame.
// The see-through surfaces themselves are hidden while it is taken, so no glass reflects a
// copy of itself and no transmission pass runs inside the capture.

import * as THREE from 'three';

/** The probe's cube faces, px. The reflections are glossy; this is sharp enough. */
export const PROBE_RESOLUTION = 256;

/**
 * How strongly each family reflects the room, on the material's own `envMapIntensity`
 * (which three honours once the material has an `envMap` of its own). Physically 1: the
 * Fresnel term inside three's shading already decides how much a surface reflects.
 */
export const PROBE_INTENSITY = { glass: 1, water: 1 } as const;

export type ReflectiveFamily = keyof typeof PROBE_INTENSITY;

/**
 * Which family a material belongs to, or null. Water is tagged where it is built
 * (`userData.bedoReflect`); glass is recognised by name — the tank, the windows, the doors
 * and partitions, the campus glazing — or by being clear and transmissive.
 */
export function reflectiveFamily(material: THREE.Material): ReflectiveFamily | null {
  const tagged = material.userData?.bedoReflect as ReflectiveFamily | undefined;
  if (tagged && tagged in PROBE_INTENSITY) return tagged;
  if (/glass|galss|glaz/i.test(material.name)) return 'glass';
  const physical = material as THREE.MeshPhysicalMaterial;
  // Clear, smooth and see-through, with no picture of its own: glass. (The deflector and
  // scale labels are transmissive too, but printed and rough — not glass.)
  if (physical.isMeshPhysicalMaterial && physical.transmission > 0.5 && physical.roughness < 0.1 && !physical.map) {
    return 'glass';
  }
  return null;
}

/** Hidden while the probe is taken: everything see-through, which is what receives it. */
const seeThrough = (object: THREE.Object3D) => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return false;
  return ([] as THREE.Material[]).concat(mesh.material).some(
    (m) => !!m && (m.transparent || (m as THREE.MeshPhysicalMaterial).transmission > 0 || reflectiveFamily(m) !== null)
  );
};

export interface ReflectionProbe {
  texture: THREE.Texture;
  dispose(): void;
}

/** Photograph the scene from `at` into a prefiltered environment map. */
export function captureReflectionProbe(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  at: THREE.Vector3
): ReflectionProbe {
  const cubeTarget = new THREE.WebGLCubeRenderTarget(PROBE_RESOLUTION, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
  });
  const cubeCamera = new THREE.CubeCamera(0.05, 60, cubeTarget);
  cubeCamera.position.copy(at);

  const hidden: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object.visible && seeThrough(object)) {
      object.visible = false;
      hidden.push(object);
    }
  });
  const autoUpdate = renderer.shadowMap.autoUpdate;
  // The shadow maps are already drawn for the frame; six more copies would only cost time.
  renderer.shadowMap.autoUpdate = false;
  try {
    scene.add(cubeCamera);
    cubeCamera.update(renderer, scene);
  } finally {
    scene.remove(cubeCamera);
    renderer.shadowMap.autoUpdate = autoUpdate;
    for (const object of hidden) object.visible = true;
  }

  // The capture is linear HDR, untouched by tone mapping, and a sun highlight on a polished
  // part is tens of thousands of times brighter than the room. Blurred into the rougher
  // levels it overflowed half float to Inf, and every surface sampling the probe drew
  // black. Clamped first, to a ceiling still well above the room's brightest light.
  const clamped = clampCube(renderer, cubeTarget);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromCubemap(clamped.texture);
  pmrem.dispose();
  cubeTarget.dispose();
  clamped.dispose();
  return {
    texture: target.texture,
    dispose() {
      target.dispose();
    },
  };
}

/** The brightest radiance the probe keeps, linear. */
export const PROBE_RADIANCE_MAX = 16;

/** A copy of `source` with every texel's radiance held to `PROBE_RADIANCE_MAX`. */
function clampCube(renderer: THREE.WebGLRenderer, source: THREE.WebGLCubeRenderTarget): THREE.WebGLCubeRenderTarget {
  const target = new THREE.WebGLCubeRenderTarget(source.width, { type: THREE.HalfFloatType, generateMipmaps: false });
  const material = new THREE.ShaderMaterial({
    uniforms: { uSource: { value: source.texture } },
    vertexShader: `varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform samplerCube uSource;
      varying vec3 vDir;
      void main() {
        vec3 c = textureCube(uSource, vDir).rgb;
        // NaN fails every comparison; replace it outright.
        if (!(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0)) c = vec3(0.0);
        float peak = max(max(c.r, c.g), c.b);
        if (peak > ${PROBE_RADIANCE_MAX.toFixed(1)}) c *= ${PROBE_RADIANCE_MAX.toFixed(1)} / peak;
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), material);
  const scene = new THREE.Scene();
  scene.add(box);
  const camera = new THREE.CubeCamera(0.1, 100, target);
  scene.add(camera);
  camera.update(renderer, scene);
  box.geometry.dispose();
  material.dispose();
  return target;
}

/**
 * Give every glass and water material in the scene the probe, once each. Returns how many
 * materials took it. Safe to call again: materials built later (the hose water, the
 * measuring tank) are picked up, the rest are left alone.
 */
export function applyReflectionProbe(scene: THREE.Object3D, texture: THREE.Texture): number {
  let count = 0;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of ([] as THREE.Material[]).concat(mesh.material)) {
      const standard = material as THREE.MeshStandardMaterial;
      if (!standard?.isMeshStandardMaterial) continue;
      const family = reflectiveFamily(material);
      if (!family) continue;
      // Every time: a material pass elsewhere (the tank's `applyGlass`) may have reset it.
      standard.envMapIntensity = PROBE_INTENSITY[family];
      if (standard.envMap === texture) continue;
      standard.envMap = texture;
      if (family === 'glass') tuneSheetGlass(standard);
      standard.needsUpdate = true;
      count++;
    }
  });
  return count;
}

/**
 * Windows, doors, partitions and the campus glazing as float glass (QA, 2026-09-30: "no
 * reflections, not realistic").
 *
 * Face-on, clear glass reflects 4 % of the room, and against this bright room that is
 * nothing: the panes vanished entirely, leaving frames around air. Real sheet glass is
 * read by three things, all given here:
 *
 *   * a reflection strong enough to see, especially obliquely: F0 raised to ~0.08, the
 *     reflectance of a glazed pane with its two faces (and the coatings architectural
 *     glass carries);
 *   * the faint green-blue of soda-lime glass in what is seen through it;
 *   * that colour deepening at an angle, where the light crosses more glass: a 6 mm pane
 *     with iron-oxide absorption (`attenuationColor` / `attenuationDistance`).
 *
 * Only transmissive panes: the tank is blended glass with its own treatment
 * (`modelAdapter.applyGlassRim`).
 */
export const SHEET_GLASS = {
  specularIntensity: 2,
  tint: [0.95, 0.985, 0.975],
  thicknessM: 0.006,
  attenuationColor: [0.78, 0.92, 0.88],
  attenuationDistanceM: 0.2,
} as const;

function tuneSheetGlass(material: THREE.MeshStandardMaterial): void {
  const glass = material as THREE.MeshPhysicalMaterial;
  if (!glass.isMeshPhysicalMaterial || glass.transmission < 0.5) return;
  // Float glass is optically flat: the authored 0.025–0.035 blurred both the reflection
  // and the view through the pane.
  glass.roughness = 0;
  glass.specularIntensity = SHEET_GLASS.specularIntensity;
  glass.specularColor.setRGB(1, 1, 1);
  glass.color.setRGB(...SHEET_GLASS.tint);
  glass.thickness = SHEET_GLASS.thicknessM;
  glass.attenuationColor.setRGB(...SHEET_GLASS.attenuationColor);
  glass.attenuationDistance = SHEET_GLASS.attenuationDistanceM;
}
