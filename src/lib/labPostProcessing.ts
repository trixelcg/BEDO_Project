// The frame: render → ambient occlusion → tone mapping and output (BEDO-LOOK-01/04).
//
// ## Colour pipeline
//
// The scene is rendered into a half-float, 4× MSAA target in linear working space. three
// applies neither tone mapping nor the output transfer when rendering to a target, so the
// GTAO pass reads and blends linear radiance, and the single `OutputPass` at the end applies
// the renderer's tone mapping (with its exposure) and the sRGB output conversion exactly
// once. Nothing is gamma-corrected twice: material shaders still `#include
// <colorspace_fragment>`, but with a linear target that is the identity.
//
// ## Ambient occlusion
//
// three's GTAO with its Poisson denoise, at a small world radius so it reads as contact
// shading in recesses — collars, bracket feet, the discs on the tray — rather than as a
// dirty halo on the walls. The pass renders its own normal/depth buffer with an override
// material, which would make every mesh an occluder, so `LabGTAOPass` hides the see-through
// objects for that one pre-pass: the tank glass, the water and hose shaders, the room
// glass, the transmissive labels and the outline hulls. A weight disc ships alpha-blended
// at opacity 1 and is kept, because it does rest on the tray.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** AO settings, in world metres. */
export const AO_PARAMETERS = {
  radius: 0.14,
  distanceExponent: 1,
  thickness: 1,
  scale: 1,
  samples: 16,
  distanceFallOff: 1,
  screenSpaceRadius: false,
};

export const AO_DENOISE = {
  lumaPhi: 10,
  depthPhi: 2,
  normalPhi: 3,
  radius: 4,
  radiusExponent: 1,
  rings: 2,
  samples: 16,
};

/** How much of the occlusion is applied. */
export const AO_INTENSITY = 0.75;

function seeThrough(material: THREE.Material): boolean {
  const physical = material as THREE.MeshPhysicalMaterial;
  if ((physical.transmission ?? 0) > 0) return true;
  if ((material as THREE.ShaderMaterial).isShaderMaterial) return true;
  if (material.transparent && material.opacity < 0.999) return true;
  return false;
}

/**
 * Make a GTAO pass hide glass, water and highlight hulls for its normal/depth pre-pass.
 *
 * Patched on the instance rather than subclassed: the installed type declarations name
 * the hook `overrideVisibility` while the shipped module calls `_overrideVisibility`.
 */
export function excludeSeeThroughFromAO(pass: GTAOPass): void {
  const self = pass as unknown as {
    _overrideVisibility?: () => void;
    overrideVisibility?: () => void;
    _visibilityCache: THREE.Object3D[];
    scene: THREE.Scene;
  };
  const base = (self._overrideVisibility ?? self.overrideVisibility)?.bind(pass);
  const hide = () => {
    base?.();
    self.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some((m) => m && seeThrough(m))) {
        mesh.visible = false;
        self._visibilityCache.push(mesh);
      }
    });
  };
  self._overrideVisibility = hide;
  self.overrideVisibility = hide;
}

export interface LabComposer {
  composer: EffectComposer;
  ao: GTAOPass;
  setSize(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}

export function createLabComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number
): LabComposer {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, width, height);
  excludeSeeThroughFromAO(ao);
  ao.output = GTAOPass.OUTPUT.Default;
  ao.updateGtaoMaterial(AO_PARAMETERS);
  ao.updatePdMaterial(AO_DENOISE);
  ao.blendIntensity = AO_INTENSITY;
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  return {
    composer,
    ao,
    setSize(w, h, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}
