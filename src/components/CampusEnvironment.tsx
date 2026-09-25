// The campus around the laboratory (BEDO-ENV-01).
//
// `public/lab-environment.glb` is the supplied `bedo_campus_only.glb`, byte for byte
// (sha256 6494135e75a1…, 2,105,712 B): a Blender export of the corridor, the neighbouring
// labs and a photographic exterior backdrop, authored in the same Blender scene and units
// as the apparatus GLB. It is visible geometry only — no lights, no cameras — and it is not
// an image-based lighting source; the approved studio environment still lights everything.
//
// ## Placement
//
// One transform, documented here and nowhere else: the same group transform the apparatus
// is placed with (`characterPosition` / `characterScale` from the scene config), then the
// same rigid `-AUTHORED_APPARATUS_OFFSET` the model adapter applies to the apparatus's own
// top-level nodes. Both files come from one Blender scene, so one offset aligns them; the
// apparatus, the water and the cameras are not moved to meet it.
//
// ## Scope
//
// A separate GLTF scene under its own group, so nothing the apparatus looks up by name
// (`pick`, anchors, hotspots, material passes, the camera-containment walls) can see it.
// It casts no shadows, so the sun still enters the laboratory exactly as approved, and it
// takes no pointer events.

import React, { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { assetUrl } from '../lib/assetUrl';
import { extendWithKTX2 } from '../lib/ktx2';
import { AUTHORED_APPARATUS_OFFSET } from '../lib/modelAdapter';

/**
 * Written as a literal `assetUrl('…')` at each call on purpose: the closed-asset test finds
 * what ships by scanning for exactly that form. Load and preload use the same URL, so the
 * file is fetched once.
 */

const INNER_OFFSET: [number, number, number] = [
  -AUTHORED_APPARATUS_OFFSET[0],
  -AUTHORED_APPARATUS_OFFSET[1],
  -AUTHORED_APPARATUS_OFFSET[2],
];

const noRaycast = () => {};

export const CampusEnvironment: React.FC<{
  position: [number, number, number];
  /** Radians, exactly as the apparatus group receives it. */
  rotation: [number, number, number];
  scale: [number, number, number];
}> = ({ position, rotation, scale }) => {
  const { scene } = useGLTF(assetUrl('lab-environment.glb'), true, true, extendWithKTX2) as unknown as {
    scene: THREE.Group;
  };

  // Once per loaded scene: decorative, so no shadows and no hit-testing.
  useMemo(() => {
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = noRaycast;
    });
  }, [scene]);

  useEffect(() => {
    scene.name = 'bedoCampusEnvironment';
  }, [scene]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group position={INNER_OFFSET}>
        <primitive object={scene} />
      </group>
    </group>
  );
};

useGLTF.preload(assetUrl('lab-environment.glb'), true, true, extendWithKTX2);
