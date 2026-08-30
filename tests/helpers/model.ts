import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { assetPath } from './glb';

/**
 * The apparatus GLB declares `KHR_texture_basisu` in `extensionsRequired`, so GLTFLoader
 * refuses to parse it without a KTX2 loader — even here, where only geometry is read.
 * These specs never look at pixels (textures already fail to decode in Node and that noise
 * is suppressed below), so a stub that hands back an empty texture is enough to satisfy the
 * extension and keeps the parse geometry-faithful.
 */
const stubKTX2Loader = () => ({
  load: (
    _url: string,
    onLoad: (t: THREE.Texture) => void
  ) => {
    onLoad(new THREE.Texture());
  },
});

/**
 * The shipped apparatus, as a real three.js scene graph (BEDO-016).
 *
 * `tests/helpers/glb.ts` reads the file's *structure* — node names, counts — which is what
 * the contract test needs. This goes one step further and builds the object tree three.js
 * would build in the browser, so a spec can measure geometry the way the application does
 * rather than against a synthetic stand-in that agrees with it by construction.
 *
 * That matters for the pan: `src/lib/holderAnchor.ts` finds it by looking for the widest
 * part of `deflector_rod`, and the claim worth testing is that this works on *this model*,
 * not on a cylinder a test made earlier.
 */

/** GLTFLoader reaches for `self`, which a Node test environment does not have. */
const ensureBrowserGlobals = () => {
  const g = globalThis as unknown as { self?: unknown };
  g.self ??= globalThis;
};

let cached: Promise<THREE.Group> | null = null;

/**
 * Parse `public/Bedo_baked_v2.glb` into a scene graph, once per test run.
 *
 * Textures cannot decode without a browser image pipeline and GLTFLoader says so on
 * `console.error` for each of the 40-odd images. Geometry, node names and transforms —
 * everything a coordinate test looks at — parse completely regardless, so the noise is
 * suppressed rather than worked around.
 *
 * The result is shared, so a spec that mutates a transform must put it back; the specs
 * that do this clone the part they move instead.
 */
export const loadApparatus = async (): Promise<THREE.Group> => {
  // The apparatus ships meshopt-compressed, so the decoder has to be ready before the
  // loader will touch the file. drei's `useGLTF` wires this up at runtime; a Node test
  // has to do it itself, exactly as `loadWater` below already does.
  await MeshoptDecoder.ready;
  cached ??= new Promise<THREE.Group>((resolve, reject) => {
    ensureBrowserGlobals();
    const bytes = readFileSync(assetPath('public/Bedo_baked_v2.glb'));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const error = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes("Couldn't load texture")) return;
      error(...args);
    };
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setKTX2Loader(stubKTX2Loader() as never);
    loader.parse(
      buffer as ArrayBuffer,
      '',
      (gltf) => {
        console.error = error;
        resolve(gltf.scene);
      },
      (cause) => {
        console.error = error;
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    );
  });
  return cached;
};

/** The apparatus transform the scene actually ships with (`src/lib/sceneConfig.ts`). */
export const APPARATUS_POSITION: [number, number, number] = [0, -1.8, 0];
export const APPARATUS_SCALE = 1.8;

/**
 * The GLB hung under a group, exactly as `DeviceModel` mounts it: the model is a
 * `<primitive>` child of the apparatus group, so apparatus-local space and the GLB's own
 * space coincide, and world space is that group's transform applied.
 */
export const mountApparatus = (
  model: THREE.Object3D,
  {
    position = APPARATUS_POSITION,
    scale = APPARATUS_SCALE,
    rotation,
  }: {
    position?: [number, number, number];
    scale?: number;
    rotation?: [number, number, number];
  } = {}
): THREE.Group => {
  const group = new THREE.Group();
  group.position.set(...position);
  group.scale.setScalar(scale);
  if (rotation) group.rotation.set(...rotation);
  group.add(model);
  group.updateWorldMatrix(true, true);
  return group;
};


/**
 * Load one of the water assets the way the app does.
 *
 * The caches ship as `EXT_meshopt_compression` + `KHR_mesh_quantization` (see
 * `scripts/water/build-water.mjs`), so the decoder has to be wired up here exactly as
 * drei's `useGLTF` wires it up at runtime — without it `GLTFLoader` refuses the file. This
 * lives in the shared helper rather than in each spec so there is one loader that matches
 * production, not several that might drift from it.
 */
export const loadWater = async (url: string): Promise<THREE.Group> => {
  ensureBrowserGlobals();
  await MeshoptDecoder.ready;
  const bytes = readFileSync(assetPath(url.replace(/^\//, 'public/')));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise<THREE.Group>((resolve, reject) => {
    const error = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes("Couldn't load texture")) return;
      error(...args);
    };
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setKTX2Loader(stubKTX2Loader() as never);
    loader.parse(
      buffer as ArrayBuffer,
      '',
      (gltf) => {
        console.error = error;
        resolve(gltf.scene);
      },
      (cause) => {
        console.error = error;
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    );
  });
};
