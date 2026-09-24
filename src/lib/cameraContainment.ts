// Keeping the learner's camera inside the laboratory (BEDO-LOOK-06).
//
// The interior is described by a handful of half-spaces measured once from the room's own
// wall geometry: every full-height wall triangle of the named room meshes contributes its
// plane, oriented so that the apparatus is on the inside, and near-duplicates are merged.
// The floor and ceiling come from the same triangles' vertical extent. Nothing about the
// scene's overall bounding box is used — the background and any furniture outside the
// room never widen the volume.
//
// Each frame, before the frame is rendered, the camera and the orbit target are pushed
// back inside every violated plane by the exact amount they overshoot, with a margin that
// covers the near-plane footprint. Because the interior is convex and the correction is a
// projection rather than a collision along the path, a large single-frame move (a fast
// drag, a guided flight, a reset) cannot tunnel: wherever the pose lands, it is projected
// back to the nearest inside point. Orbit controls re-derive their spherical state from the
// corrected position, so the camera slides along the wall rather than bouncing.

import * as THREE from 'three';

export interface InteriorPlane {
  /** Unit normal pointing into the room. */
  normal: THREE.Vector3;
  /** `normal · p = offset` on the wall surface. */
  offset: number;
}

export interface InteriorBounds {
  planes: InteriorPlane[];
  floorY: number;
  ceilingY: number;
}

/** A wall triangle has to be this large (m²) and this tall (m) to count as a boundary. */
export const MIN_WALL_TRIANGLE_AREA = 1.2;
export const MIN_WALL_TRIANGLE_HEIGHT = 1.5;

/** Two planes closer than this in angle (cos) and offset (m) are the same wall. */
const SAME_PLANE_COS = 0.995;
const SAME_PLANE_OFFSET = 0.08;

/**
 * Measure the room's interior from its wall meshes.
 *
 * `inside` is a point known to be inside the room — the apparatus — and decides which side
 * of each wall is the room. Only near-vertical triangles are considered; the floor and
 * ceiling are read off their vertical extent.
 */
export function measureInterior(
  roomNodes: THREE.Object3D[],
  inside: THREE.Vector3
): InteriorBounds | null {
  const planes: InteriorPlane[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  let floorY = Infinity;
  let ceilingY = -Infinity;

  for (const node of roomNodes) {
    node.updateWorldMatrix(true, true);
    node.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.index;
      const count = index ? index.count : position.count;
      for (let i = 0; i < count; i += 3) {
        const ia = index ? index.getX(i) : i;
        const ib = index ? index.getX(i + 1) : i + 1;
        const ic = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
        e1.subVectors(b, a);
        e2.subVectors(c, a);
        const normal = new THREE.Vector3().crossVectors(e1, e2);
        const area = normal.length() / 2;
        if (area < MIN_WALL_TRIANGLE_AREA) continue;
        normal.divideScalar(area * 2);
        if (Math.abs(normal.y) > 0.3) continue;
        const top = Math.max(a.y, b.y, c.y);
        const bottom = Math.min(a.y, b.y, c.y);
        if (top - bottom < MIN_WALL_TRIANGLE_HEIGHT) continue;
        floorY = Math.min(floorY, bottom);
        ceilingY = Math.max(ceilingY, top);
        // Orient into the room.
        if (normal.dot(inside) - normal.dot(a) < 0) normal.negate();
        normal.y = 0;
        normal.normalize();
        const offset = normal.dot(a);
        const twin = planes.find(
          (p) => p.normal.dot(normal) > SAME_PLANE_COS && Math.abs(p.offset - offset) < SAME_PLANE_OFFSET
        );
        if (twin) {
          // Keep the tighter of the two (the one nearer the inside point).
          twin.offset = Math.max(twin.offset, offset);
        } else {
          planes.push({ normal, offset });
        }
      }
    });
  }

  if (planes.length === 0 || !isFinite(floorY) || !isFinite(ceilingY)) return null;
  return { planes, floorY, ceilingY };
}

/** Signed distance from the nearest boundary; negative means outside. */
export function interiorClearance(point: THREE.Vector3, bounds: InteriorBounds): number {
  let clearance = Math.min(point.y - bounds.floorY, bounds.ceilingY - point.y);
  for (const { normal, offset } of bounds.planes) {
    clearance = Math.min(clearance, normal.dot(point) - offset);
  }
  return clearance;
}

/**
 * Push a point inside every plane it violates, by at least `margin`.
 *
 * A few passes, because correcting one plane can nudge a corner point out of another.
 * Returns how far the point moved.
 */
export function containPoint(point: THREE.Vector3, bounds: InteriorBounds, margin: number): number {
  const start = point.clone();
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    if (point.y < bounds.floorY + margin) {
      point.y = bounds.floorY + margin;
      moved = true;
    }
    if (point.y > bounds.ceilingY - margin) {
      point.y = bounds.ceilingY - margin;
      moved = true;
    }
    for (const { normal, offset } of bounds.planes) {
      const distance = normal.dot(point) - offset;
      if (distance < margin) {
        point.addScaledVector(normal, margin - distance);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return point.distanceTo(start);
}

/**
 * Margin for the camera: covers the near plane's half-diagonal at the widest aspect the
 * app runs at, plus a hand's width so the wall never fills the frame edge-on.
 */
export const CAMERA_MARGIN = 0.35;
/** The orbit target may sit closer to a wall than the eye, but not inside it. */
export const TARGET_MARGIN = 0.2;

/**
 * Keep the camera and its orbit target inside the room. Returns true when a correction was
 * applied this frame.
 */
export function containCamera(
  camera: THREE.Object3D,
  target: THREE.Vector3 | null,
  bounds: InteriorBounds
): boolean {
  let corrected = containPoint(camera.position, bounds, CAMERA_MARGIN) > 1e-6;
  if (target) corrected = containPoint(target, bounds, TARGET_MARGIN) > 1e-6 || corrected;
  return corrected;
}
