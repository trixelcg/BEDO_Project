/**
 * KTX2 support for the apparatus GLB, wired once.
 *
 * `Bedo_baked_v3_optionA.glb` declares `KHR_texture_basisu`, so GLTFLoader needs a
 * `KTX2Loader` before it can resolve those textures. This is the single place that is
 * configured; the eight WaterShapes GLBs carry no textures at all and are untouched.
 *
 * ## Why support is detected from a probe context rather than from the renderer
 *
 * `KTX2Loader.detectSupport()` only reads `renderer.extensions`, but the renderer is not
 * reachable where it would be needed: `useGLTF` is called before `useThree` in
 * `DeviceModel`, and `useGLTF.preload` runs at module scope with no React tree at all.
 * Waiting for the renderer would leave `preload` racing an unconfigured transcoder, which
 * throws. A throwaway WebGL2 context answers the same question — it is the same GPU and the
 * same context type — and the real renderer re-runs detection through `setKTX2Renderer` as
 * soon as one exists, so nothing is left resting on the probe.
 */
import * as THREE from 'three';
// three's own KTX2Loader, deliberately, not three-stdlib's port.
//
// They choose different transcode targets for ETC1S. three ranks ETC2 first
// (`priorityETC1S: 1`), giving RGB_ETC2 at 0.5 bytes/texel; three-stdlib's older port has no
// priority table and takes the first match in astc -> bptc -> dxt order, landing on
// RGBA_BPTC at 1 byte/texel — twice the memory, and an alpha channel these textures do not
// have. Measured on this scene: 401.06 MB with three-stdlib against 377 MB class with three.
// PERF-01/02/03 all validated against three's loader, so this also keeps the evidence chain
// intact. The cast bridges the two packages' structurally identical types.
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const TRANSCODER_PATH = '/basis/';

let loader: KTX2Loader | null = null;
let detectedFrom: THREE.WebGLRenderer | 'probe' | null = null;

/** The shape `detectSupport` consumes: `extensions.has` plus `extensions.get` for ASTC. */
const probeSupport = () => {
  const gl = document.createElement('canvas').getContext('webgl2');
  return {
    extensions: {
      has: (name: string) => !!gl?.getExtension(name),
      get: (name: string) => gl?.getExtension(name),
    },
    capabilities: { isWebGL2: !!gl },
  };
};

const ktx2 = (): KTX2Loader => {
  if (!loader) {
    loader = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH);
    loader.detectSupport(probeSupport() as unknown as THREE.WebGLRenderer);
    detectedFrom = 'probe';
  }
  return loader;
};

/** Re-detect against the real renderer once R3F has one. Idempotent. */
export const setKTX2Renderer = (renderer: THREE.WebGLRenderer): void => {
  if (!renderer || detectedFrom === renderer) return;
  ktx2().detectSupport(renderer);
  detectedFrom = renderer;
};

/** Passed to drei's `useGLTF` as `extendLoader`. Must be a stable reference: drei keys its cache on it. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const extendWithKTX2 = (gltfLoader: { setKTX2Loader: (l: any) => unknown }): void => {
  gltfLoader.setKTX2Loader(ktx2());
};
