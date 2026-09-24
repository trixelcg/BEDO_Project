// How the re-authored apparatus GLB is brought back onto the runtime contract.
//
// `public/Bedo_baked_v2.glb` was replaced by a new Blender export (BEDO-MODEL-02,
// sha256 931202ad…). It is the same rig — every functional part has the same size and
// orientation as before, to a fraction of a millimetre — but it was exported differently,
// and four things about that break the names and coordinates the application relies on.
// This module repairs exactly those four, once, at load, and changes nothing else.
//
// ## 1. The whole scene moved, rigidly
//
// The export is room-centred rather than apparatus-centred. Measured over the nozzle
// (`JET Force 2_214`), the glass tank (`JET Force 2_205`) and the bench (`BENCH_GROUND`),
// every apparatus part sits at exactly
//
//     old + (1.619263, 0, -1.927590)        agreement between the three: < 1.1 µm
//
// with identical world scale (0.021516), identical rotation and no mirroring. Nothing else
// changed about the rig's geometry: moving parts agree with the tank to 0.6 mm.
//
// The water caches, the contact shadow, the camera offsets and the scene placement all
// live in the *apparatus's* coordinate frame (see `water-caches-authored-in-rig-space`:
// the nozzle axis is (0.0101, -0.2293)). So the model is put back into that frame by the
// measured offset, rather than every consumer being moved to meet it. The room comes along
// with it, still exactly where the author put it relative to the rig.
//
// ## 2. Parts were renamed
//
// `Tank_cover` is now `Cylinder005`, `deflector_spring` is `spring`, the weights carry a
// " gm" suffix, the lamp is `Diagram_Green_light_off(3)014`, and the seven mounted
// deflectors are `Deflector 45` … `Deflector Cone 60`. Each was matched by world bounds
// and triangle count, not by name — `Deflector 130` is the 135° conical deflector (394
// triangles in the old mount less its 12-triangle engraved label = 382, and it has the
// conical profile), so the name in the file is a typo and the mapping below goes by shape.
// The mounted deflectors are regrouped rather than renamed, because their labels split
// off too (§3).
//
// ## 3. Assemblies were split into loose parts
//
// The old file grouped parts that move together under one node; this one exports every
// part as its own root node. The runtime lifts and hides by node, so the groups are
// rebuilt here without moving anything:
//
//   deflector_rod   rod `JET Force 2_210` + weight pan `JET Force 2_209`
//   Screws          the 12 bolts, nuts and washers on the cover
//   <angle>_base    each tray deflector + the engraved angle label beside it
//   <angle>.001     each mounted deflector + its engraved label
//
// `Object3D.attach` preserves every world transform, so this is re-parenting only.
//
// ## 4. Some parts keep their orientation on the node
//
// Harmless to the eye, but the runtime sizes parts from their local bounding boxes, so a
// rotated node measures larger than it is. See `ORIENTATION_BAKED_PARTS`.
//
// Nothing in the file itself is modified, and the source asset is not re-exported. If a
// future export restores the old names and origin, `adaptApparatusScene` detects that the
// new-export nodes are absent and leaves the scene alone.

import * as THREE from 'three';
import { gltfName } from './gltfNames';

/**
 * Where the new export put the apparatus, relative to where the runtime expects it.
 * Subtracted from every top-level node of the model. See §1 above.
 */
export const AUTHORED_APPARATUS_OFFSET: readonly [number, number, number] = [1.619263, 0, -1.92759];

/** One part under a new name: exported name -> contract name (both as authored). */
export const RENAMED_PARTS: ReadonlyArray<readonly [string, string]> = [
  ['Cylinder005', 'Tank_cover'],
  ['spring', 'deflector_spring'],
  ['Weight_50 gm', 'Weight_50'],
  ['Weight_100 gm', 'Weight_100'],
  ['Weight_200 gm', 'Weight_200'],
  ['Weight_500 gm', 'Weight_500'],
  ['Diagram_Green_light_off(3)014', 'Diagram_Green_light_off'],
];

/** Loose parts that move as one: contract name <- exported parts (all as authored). */
export const REASSEMBLED_PARTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['deflector_rod', ['JET Force 2_210', 'JET Force 2_209']],
  [
    'Screws',
    [
      'Cylinder001', 'Cylinder006', 'Cylinder008', 'Cylinder009', 'Cylinder010', 'Cylinder011',
      'Sphere009', 'Sphere010', 'Sphere011', 'Object019', 'Object020', 'Object021',
    ],
  ],
  // The mounted deflectors. Five carry an engraved angle label that the new export writes
  // as its own node — under names the previous file used for unrelated bench parts
  // (`Object315.001`, …), which is why they cannot be matched by name. Each label sits on
  // its deflector (the 45° label's 2.7 x 11.3 x 16.5 mm matches the old mount's exactly);
  // left loose, all five float inside the tank whichever deflector is fitted.
  ['Oblique_surface_deflector_45.001', ['Deflector 45', 'Object320.001']],
  ['Flat_surface_deflector_90.001', ['Deflector 90', 'Object315.001']],
  ['Conical_deflector_135.001', ['Deflector 130', 'Object316.001']],
  ['Hemi_sphere_deflector_120.001', ['Deflector 120', 'Object317.001']],
  ['Hemi_sphere_deflector_180.001', ['Deflector 180', 'Object318.001']],
  ['Cone_surface_deflector_30.001', ['Deflector Cone 30']],
  ['Cone_surface_deflector_60.001', ['Deflector Cone 60']],
  // The tray copies, each with the label engraved beside it.
  ['Oblique_surface_deflector_45_base', ['Cylinder001.001', 'Object023']],
  ['Flat_surface_deflector_90_base', ['JET Force 2_222', 'Object313']],
  ['Conical_deflector_135_base', ['JET Force 2_216', 'Object022']],
  ['Hemi_sphere_deflector_120_base', ['JET Force 2_217', 'Object024']],
  ['Hemi_sphere_deflector_180_base', ['JET Force 2_220', 'Object025']],
  ['Cone_surface_deflector_30_base', ['Cone003', 'Cone001']],
  ['Cone_surface_deflector_60_base', ['Cone002', 'Cone004']],
];

/**
 * Parts whose orientation the new export keeps on the node instead of in the vertices.
 *
 * The runtime sizes parts with `Box3.setFromObject`, which transforms each mesh's *local*
 * bounding box — so a node rotation inflates the measured size even though no vertex
 * moved. The previous export baked these orientations into the geometry; this one does not,
 * and measured through the app's own boxes the weight discs came out 80 mm across instead
 * of 57 mm (every disc; a 45° turn is √2), the pointer 2.5x, the spring 1.4x, the 45° tray
 * deflector 1.7x. That widened the disc hit targets, moved the pointer and spring pivots,
 * changed the spring's rest height and let the 50 g disc's flight dip into the lid.
 *
 * So for these parts, and only these, each mesh's own rotation and scale are applied to its
 * loaded vertices and the node is left with its translation: every world vertex is where
 * it was, and every measured box is what production measured. Parts whose boxes were
 * already inflated identically in the previous export (the cover, the pointer pin) are left
 * alone, so their hotspots and pivots stay exactly as they were.
 */
export const ORIENTATION_BAKED_PARTS: readonly string[] = [
  'Screws',
  'deflector_spring',
  'Pointer',
  'Oblique_surface_deflector_45_base',
  'Flat_surface_deflector_90_base',
  'Flat_surface_deflector_90.001',
  'Weight_Custom',
  'Weight_50',
  'Weight_100',
  'Weight_200',
  'Weight_500',
];

/** A node only the new export has; its absence means the scene is already on contract. */
const NEW_EXPORT_MARKER = 'Deflector 90';

const ADAPTED = 'bedoApparatusAdapted';

export interface AdaptReport {
  /** Exported names the adapter expected and did not find. Empty on the shipped asset. */
  missing: string[];
}

/**
 * Put the loaded apparatus scene on the runtime contract. Idempotent: `useGLTF` hands the
 * same cached scene to every caller, so the second call is a no-op.
 */
export function adaptApparatusScene(scene: THREE.Object3D): AdaptReport {
  const missing: string[] = [];
  if (scene.userData[ADAPTED]) return { missing };
  scene.userData[ADAPTED] = true;
  if (!scene.getObjectByName(gltfName(NEW_EXPORT_MARKER))) return { missing };

  // On each top-level node rather than on the root, so the root stays the identity it was
  // in the previous export: a part cloned out of the scene then keeps its placement. The
  // root is the parent of every one of them, so a translation in its space is the world one.
  const offset = new THREE.Vector3(...AUTHORED_APPARATUS_OFFSET);
  for (const node of scene.children) node.position.sub(offset);
  scene.updateMatrixWorld(true);

  const find = (authored: string) => {
    const node = scene.getObjectByName(gltfName(authored));
    if (!node) missing.push(authored);
    return node;
  };

  for (const [exported, contract] of RENAMED_PARTS) {
    const node = find(exported);
    if (node) node.name = gltfName(contract);
  }

  for (const [contract, parts] of REASSEMBLED_PARTS) {
    const group = new THREE.Group();
    group.name = gltfName(contract);
    scene.add(group);
    group.updateMatrixWorld(true);
    for (const part of parts) {
      const node = find(part);
      if (node) group.attach(node);
    }
  }

  const baked = new Set<THREE.BufferGeometry>();
  const linear = new THREE.Matrix4();
  for (const part of ORIENTATION_BAKED_PARTS) {
    const node = find(part);
    node?.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || baked.has(mesh.geometry)) return;
      // Only a mesh whose own node carries the orientation; its parent must add none.
      linear.compose(new THREE.Vector3(), mesh.quaternion, mesh.scale);
      mesh.geometry.applyMatrix4(linear);
      baked.add(mesh.geometry);
      mesh.quaternion.identity();
      mesh.scale.set(1, 1, 1);
    });
  }
  scene.updateMatrixWorld(true);

  return { missing };
}

/**
 * The tank's glass as the previous export authored it, for the one surface that must keep
 * it (BEDO-MODEL-02).
 *
 * The re-authored `glass` is physically transmissive (`KHR_materials_transmission` 1).
 * three.js renders a transmissive surface from a pass that holds only *opaque* objects, so
 * every transparent thing inside the vessel — the jet, the plumes, the fill — vanishes
 * behind it: measured on the first preview render, the low-flow jet, the impact plume and
 * the full tank all went missing while the rig itself was exactly aligned. The experience
 * is read *through* this glass, so it keeps the blended material production has always
 * shown: `Galss_Material` from the previous file, reproduced value for value, which
 * `applyGlass` then tunes exactly as before. Every other glass in the model keeps its own.
 */
export function createPreviousTankGlass(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name: 'Galss_Material',
    color: new THREE.Color().setRGB(0.499308676, 0.6517784, 0.801150203, THREE.LinearSRGBColorSpace),
    opacity: 0.100000001,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    metalness: 1,
    roughness: 0.300000012,
  });
  applyGlassRim(material);
  return material;
}

/** Alpha of the tank wall seen face-on, and at the silhouette. */
export const TANK_GLASS_ALPHA = 0.1;
export const TANK_GLASS_RIM_ALPHA = 0.32;

/**
 * Let the tank's edges read (BEDO-LOOK-01).
 *
 * The blended glass keeps its authored alpha of 0.10, and alpha blending scales the
 * *whole* shaded result by it — reflection included — so the vessel's rim, where a real
 * glass wall reflects almost everything, arrived at a tenth of its strength and the tank
 * read as a faint tint with no edge. This raises alpha with the Fresnel term alone: face-on
 * the wall stays at 0.10 and everything inside is seen exactly as before; at grazing
 * incidence it rises to 0.32, which is where the environment reflection now shows as a
 * rim. Only the alpha is touched, in the fragment, so the water and hose behind it are
 * composited exactly as they were.
 */
export function applyGlassRim(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBedoGlassAlpha = { value: new THREE.Vector2(TANK_GLASS_ALPHA, TANK_GLASS_RIM_ALPHA) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uBedoGlassAlpha;')
      .replace(
        '#include <opaque_fragment>',
        `{
          float bedoNdv = abs(dot(normalize(normal), normalize(vViewPosition)));
          float bedoRim = pow(1.0 - bedoNdv, 3.0);
          diffuseColor.a = mix(uBedoGlassAlpha.x, uBedoGlassAlpha.y, bedoRim);
        }
        #include <opaque_fragment>`
      );
  };
  material.customProgramCacheKey = () => 'bedoGlassRim';
}
