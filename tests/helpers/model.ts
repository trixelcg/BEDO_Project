import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetPath } from './glb';

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
export const loadApparatus = (): Promise<THREE.Group> => {
  cached ??= new Promise<THREE.Group>((resolve, reject) => {
    ensureBrowserGlobals();
    const bytes = readFileSync(assetPath('public/Bedo_baked_v2.glb'));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const error = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes("Couldn't load texture")) return;
      error(...args);
    };
    new GLTFLoader().parse(
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
