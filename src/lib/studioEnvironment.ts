// Image-based lighting for the apparatus: a neutral studio, built once.
//
// ## What was here before
//
// `roomEnvironment.ts` photographed the laboratory's own baked surfaces into a cube map
// and prefiltered that. It was written for the previous export, whose walls carried a
// lightmap and a `MergedBake_*` material name. The re-authored model (BEDO-MODEL-02 and
// the 2026-09-24 asset swap) has neither: its walls are flat-albedo paint materials named
// "Laboratory washable paint …", nothing in it is baked, and the probe found no room
// surface at all. It then hid every mesh and captured only `scene.background` — the 8-bit
// outdoor panorama — so every reflection in the scene was a dim, lossy field, and the
// apparatus stood in a room that lit it from nowhere in particular. That is the flat,
// cut-out look the review screenshots show: chrome without highlights, black hardware
// with no edge, white panels with no gradient.
//
// ## What this is
//
// three's `RoomEnvironment`: a small synthetic interior with area-light panels, rendered
// once into a PMREM roughness pyramid. It is HDR (the panels exceed 1.0), so a satin rod
// gets a real highlight to reflect and a glass wall gets a rim; it is neutral white, so
// nothing is tinted; and it is deterministic and costs nothing at runtime beyond a
// one-off build of a few hundred milliseconds. The visible background stays the panorama —
// backdrop and lighting are decoupled, as they were meant to be.
//
// Direction and shadow still come from the window sun in `Scene3D`; this supplies the
// diffuse fill and the specular environment, in place of the room the model no longer
// carries a bake for.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * How strongly the studio lights the scene, on `scene.environmentIntensity`.
 *
 * 0.45, after review. 0.8 at exposure 1.3 read as a white product studio — walls and bench
 * top climbed to a 95th percentile of 235 with no gradient left. At 0.45 with unity
 * exposure the chrome keeps its highlight structure, the black hardware keeps its shape,
 * and the white surfaces sit near 210 with their shading intact (BEDO-LOOK-01b).
 */
export const STUDIO_ENV_INTENSITY = 0.45;

export interface StudioEnvironment {
  texture: THREE.Texture;
  dispose(): void;
}

export function buildStudioEnvironment(renderer: THREE.WebGLRenderer): StudioEnvironment {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  try {
    const target = pmrem.fromScene(room, 0.04);
    return {
      texture: target.texture,
      dispose() {
        target.dispose();
      },
    };
  } finally {
    pmrem.dispose();
    room.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material)?.dispose?.();
      }
    });
  }
}
