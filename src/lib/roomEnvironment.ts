// Image-based lighting derived from the laboratory itself.
//
// ## What was wrong
//
// The scene lit itself with `/rosendal_plains_2_4k.webp` — a 4096x2048 **lossy 8-bit WebP
// of an outdoor plains landscape**. Two separate faults:
//
//   * **It is not HDR.** Nothing in an 8-bit WebP exceeds 1.0, so image-based lighting from
//     it has no bright sources at all. Metal picks up no highlight structure and glass has
//     nothing to reflect, which is most of why every surface read as the same CG plastic.
//   * **It is the wrong room.** An arid outdoor panorama lighting an indoor laboratory
//     gives the whole scene a flat daylight cast that matches nothing in the model.
//
// ## What replaces it
//
// The room. `Bedo_baked_v2.glb` already carries a baked lighting solution — its albedo is
// `MergedBake_..._Diffuse` with a companion `..._Lightmap` — so the walls, floor and bench
// already *are* correctly lit indoor surfaces. Rendering them into a cube map and
// prefiltering it produces exactly what the apparatus should be reflecting: this room, at
// this brightness, from this direction.
//
// That keeps the whole solution inside the project. Nothing is downloaded, nothing is
// invented, and it is deterministic — the same model always yields the same environment.
//
// The visible background is left alone and stays whatever the scene sets it to. Lighting
// and backdrop are decoupled: the window can still show the outdoors, because a window
// showing the outdoors is correct, while the *lighting* comes from the room.

import * as THREE from 'three';

/**
 * Where to stand the probe.
 *
 * At the apparatus, not at the origin: an environment captured metres away would reflect
 * the wrong parallax onto the very parts the learner looks at closely. Lifted slightly so
 * the probe sits above the bench rather than inside it.
 */
export const PROBE_LIFT = 0.35;

/**
 * Cube face size for the capture.
 *
 * The result is prefiltered into a roughness pyramid immediately, so face resolution buys
 * very little beyond the sharpest mip — and this is rendered once, at load, on whatever GPU
 * the learner has. 256 is comfortably enough for a room with no small bright fixtures.
 */
export const PROBE_SIZE = 256;

export interface RoomEnvironment {
  texture: THREE.Texture;
  dispose(): void;
}

/**
 * Render the room into a prefiltered environment map.
 *
 * `isRoomSurface` decides, per mesh, what counts as the room. Everything else is hidden for
 * the duration of the capture so the apparatus stays out of its own reflection — capturing
 * it would bake the bench and the tank into every metal surface on the bench and the tank.
 * Visibility is restored before returning, whatever happens.
 *
 * Returns null when there is nothing to capture, so a stripped or stubbed model falls back
 * to whatever the caller had rather than to a black environment.
 */
export function captureRoomEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  origin: THREE.Vector3,
  isRoomSurface: (mesh: THREE.Mesh) => boolean
): RoomEnvironment | null {
  // Hide everything that is *not* the room.
  //
  // This must be decided per mesh, not per group. The apparatus and the 27 baked room
  // meshes are siblings under one shared GLB root, so excluding "the apparatus group"
  // excluded the room along with it and the probe captured nothing but `scene.background`
  // — turning this function into an elaborate way of lighting the lab with the outdoor
  // panorama it exists to replace. Metal at `metalness: 1` has no diffuse term, so wherever
  // that sky was dark those surfaces resolved to pure black.
  const hidden: THREE.Object3D[] = [];
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    if (isRoomSurface(mesh)) return;
    mesh.visible = false;
    hidden.push(mesh);
  });
  if (hidden.length === 0) return null;

  // Capture the room **flat-lit at unity**.
  //
  // Without this the probe renders whatever the dynamic lights happen to be doing, which at
  // capture time is a low ambient and one key light — a nearly black room, yielding a dim
  // environment and crushed shadows. The room's albedo already *is* its lighting: it ships
  // as `MergedBake_..._Diffuse` with a companion lightmap, so reproducing it means lighting
  // it flatly at 1.0 and letting the bake speak for itself. Directional structure is not
  // lost, because the bake already contains it.
  const dimmed: { light: THREE.Light; intensity: number }[] = [];
  scene.traverse((o) => {
    const light = o as THREE.Light;
    if (light.isLight) {
      dimmed.push({ light, intensity: light.intensity });
      light.intensity = 0;
    }
  });
  const flat = new THREE.AmbientLight(0xffffff, 1);
  scene.add(flat);

  const previousBackground = scene.background;
  const cubeTarget = new THREE.WebGLCubeRenderTarget(PROBE_SIZE, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
  });
  const cubeCamera = new THREE.CubeCamera(0.1, 60, cubeTarget);
  cubeCamera.position.copy(origin);
  cubeCamera.position.y += PROBE_LIFT;

  let pmrem: THREE.PMREMGenerator | null = null;
  try {
    cubeCamera.update(renderer, scene);
    pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileCubemapShader();
    const prefiltered = pmrem.fromCubemap(cubeTarget.texture);
    return {
      texture: prefiltered.texture,
      dispose() {
        prefiltered.dispose();
        cubeTarget.dispose();
      },
    };
  } catch {
    cubeTarget.dispose();
    return null;
  } finally {
    pmrem?.dispose();
    scene.background = previousBackground;
    scene.remove(flat);
    flat.dispose();
    for (const { light, intensity } of dimmed) light.intensity = intensity;
    for (const object of hidden) object.visible = true;
  }
}

/**
 * How strongly the room lights the apparatus.
 *
 * One, deliberately. The capture is of correctly-exposed baked surfaces, so scaling it up
 * would be re-lighting an already-lit room — the double-lighting this whole change exists
 * to remove. If the scene looks dark after this, the fix is exposure or a real fixture, not
 * a multiplier on the environment.
 */
export const ROOM_ENV_INTENSITY = 1.0;
