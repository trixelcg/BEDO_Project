// Closing the open seams in the campus model (QA, 2026-09-29).
//
// `lab-environment.glb` is modelled as separate slabs and walls, and several of them stop
// short of the surface they should meet. From inside the laboratory, looking out through
// the glass across the corridor, those slots show the exterior backdrop as bright strips
// along the top and the foot of the neighbouring labs' fronts (QA screenshot). Measured in
// the file's own units (metres, the Blender scene the apparatus shares), in the scene
// root's frame:
//
//   | part                                   | stops at | should meet            | slot  |
//   |----------------------------------------|----------|------------------------|-------|
//   | lab fronts: facade transom, top        | 2.99     | ceiling underside 3.09 | 10 cm |
//   | end walls, lab back walls, dividers    | 3.05     | ceiling underside 3.09 |  4 cm |
//   | lab fronts: bottom glazing rail, foot  | 0.018    | floor top −0.015       |  3 cm |
//   | lab fronts: glazing mullions, foot     | 0.00     | floor top −0.015       | 1.5 cm |
//
// The fix moves only the edge that falls short, into the slab it should meet: tops up to
// the ceiling slab's top (3.21), feet down to the floor slab's bottom (−0.115). The moved
// faces end inside those slabs, so nothing new is visible except that the slots are gone;
// no mesh is added, no material changes, and the rest of each part keeps its shape.

import * as THREE from 'three';

/** Heights in the campus file's own frame, measured from its slabs. */
export const CAMPUS_LEVELS = {
  /** Top of the ceiling slabs (acoustic ceiling and each lab's ceiling). */
  ceilingTop: 3.21,
  /** Bottom of the floor slabs (corridor floor and each lab's floor). */
  floorBottom: -0.115,
} as const;

export interface SeamRule {
  /** Which meshes, by their (three.js-sanitised) node name. */
  match: RegExp;
  /** Vertices above this height are the top edge, moved up to the ceiling's top. */
  topAbove?: number;
  /** Vertices below this height are the foot, moved down to the floor's bottom. */
  footBelow?: number;
  /** Only meshes whose lowest point is below this (picks the bottom rail of two). */
  onlyIfMinYBelow?: number;
}

export const SEAM_RULES: readonly SeamRule[] = [
  { match: /^Campus_(end_wall|lab_back_wall|lab_partition)\d*$/, topAbove: 3.0 },
  { match: /^Campus_facade_transom\d*$/, topAbove: 2.84 },
  { match: /^Campus_glazing_horizontal_rail\d*$/, footBelow: 0.035, onlyIfMinYBelow: 0.1 },
  { match: /^Campus_glazing_mullion\d*$/, footBelow: 0.05 },
];

/**
 * Move each matched mesh's short edge into the slab it should meet. Idempotent per scene:
 * a mesh is only touched once (its geometry is cloned first, so a cached GLTF shared with
 * another scene is not altered). Returns how many meshes were changed.
 */
export function closeCampusSeams(root: THREE.Object3D, rules: readonly SeamRule[] = SEAM_RULES): number {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const toRoot = new THREE.Matrix4();
  const fromRoot = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let changed = 0;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.bedoSeamClosed) return;
    const rule = rules.find((r) => r.match.test(mesh.name));
    if (!rule) return;

    toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
    fromRoot.copy(toRoot).invert();
    const geometry = mesh.geometry.clone();
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < position.count; i++) {
      const y = v.fromBufferAttribute(position, i).applyMatrix4(toRoot).y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (rule.onlyIfMinYBelow !== undefined && !(minY < rule.onlyIfMinYBelow)) return;
    // The edge moves as a whole, bevel and all, so its shape is kept and only its height
    // changes: the top by as much as the part falls short of the ceiling slab's top, the
    // foot by as much as it stands above the floor slab's bottom.
    const lift = rule.topAbove !== undefined ? Math.max(0, CAMPUS_LEVELS.ceilingTop - maxY) : 0;
    const drop = rule.footBelow !== undefined ? Math.min(0, CAMPUS_LEVELS.floorBottom - minY) : 0;
    if (lift === 0 && drop === 0) return;

    let moved = 0;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(toRoot);
      let dy = 0;
      if (lift > 0 && v.y > rule.topAbove!) dy = lift;
      else if (drop < 0 && v.y < rule.footBelow!) dy = drop;
      if (dy === 0) continue;
      v.y += dy;
      v.applyMatrix4(fromRoot);
      position.setXYZ(i, v.x, v.y, v.z);
      moved++;
    }
    if (moved === 0) return;
    position.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    // Normals are unchanged: sides stay vertical and tops and feet stay horizontal.
    mesh.geometry = geometry;
    mesh.userData.bedoSeamClosed = true;
    changed++;
  });
  return changed;
}
