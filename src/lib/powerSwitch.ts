// Where the power switch's spindle actually is.
//
// ## Two wrong answers, and why each looked right
//
// The knob is a rotary isolator on the "Main Hydraulic Unit" panel. It has been animated
// wrongly twice, and both times the reasoning was sound and the *measurement* was not.
//
// **First: `rotation.z`.** The operator's left-to-right axis. That tipped the knob out of
// the panel and ON rendered the disc as a flat ellipse lying down.
//
// **Then: `rotation.x`.** Chosen because `Box3.setFromObject(knob)` measures
// 29.8 x 45.0 x 43.8 mm — thinnest across X — and a disc spins about the axis it is
// thinnest across. The flaw is that `Box3.setFromObject` returns a **world axis-aligned**
// box. For a lamina tilted off the world axes, the thinnest side of its AABB points *near*
// the face normal but not along it, and the error is the tilt. Measured on the shipped
// GLB, turning this knob about world X tips its face normal by **40.69 degrees** — it
// sinks through the yellow backplate, which is exactly what the deployed build does.
//
// The panel is an angled console: its outward normal is `[-0.87075, 0.49173, 0]`, tilted
// 29.45 degrees up toward the standing operator. Nothing axis-aligned will do.
//
// ## The right answer
//
// Measure the knob's bounding box in its **own local space**, where it is a lamina lying
// in a coordinate plane: 2.091 x 2.111 x 0.401, unambiguously thinnest across local Z.
// Then carry that local axis through the node's own rotation. Derived from the asset every
// time, never written down as a constant — `docs/44 §E1`.
//
// ## Where the spindle passes through
//
// Checked rather than assumed, because an axis with the wrong origin makes the knob orbit
// instead of spin. Three independent estimates of the centre — the world AABB centre the
// pivot has always used, the local bounding-box centre, and the x-symmetric mid-thickness
// point — agree to within **0.35 mm** on a 45 mm knob. The pivot was never the defect. The
// local-geometry centre is used anyway, being the one of the three that cannot be skewed
// by the node's orientation.

import * as THREE from 'three';

/** A quarter turn. The travel BEDO gives every rotary control. */
export const QUARTER_TURN = Math.PI / 2;

export type LocalAxis = 0 | 1 | 2;

/**
 * Which local axis a lamina is thinnest across — the axis it faces along.
 *
 * Meaningful only in the object's own space. Run against a world-aligned box it answers
 * the question that produced the 40.69-degree error above.
 */
export function faceNormalAxis(size: THREE.Vector3): LocalAxis {
  const s = [size.x, size.y, size.z];
  let axis: LocalAxis = 0;
  if (s[1] < s[axis]) axis = 1;
  if (s[2] < s[axis]) axis = 2;
  return axis;
}

/**
 * A subtree's bounds in **its own** local space.
 *
 * Child transforms are honoured, the object's own is not — which is the whole point: this
 * is the box the geometry occupies before the node orients it.
 */
export function localBounds(object: THREE.Object3D, target?: THREE.Box3): THREE.Box3 {
  const box = (target ?? new THREE.Box3()).makeEmpty();
  const vertex = new THREE.Vector3();
  object.updateWorldMatrix(false, true);
  const toLocal = new THREE.Matrix4().copy(object.matrixWorld).invert();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry?.getAttribute('position');
    if (!position) return;
    const toObject = new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld);
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position as THREE.BufferAttribute, i);
      box.expandByPoint(vertex.applyMatrix4(toObject));
    }
  });
  return box;
}

/**
 * The spindle line, expressed in the space the object's **parent** lives in — which is the
 * space the pivot group is created in, so this is the vector a rotation can use directly.
 *
 * Oriented to point *away* from the operator, so that the sign convention below has one
 * fixed meaning no matter which way round the asset happens to be authored.
 */
export function spindleAxis(
  object: THREE.Object3D,
  front: THREE.Vector3,
  target?: THREE.Vector3
): THREE.Vector3 {
  const size = localBounds(object).getSize(new THREE.Vector3());
  const axis = target ?? new THREE.Vector3();
  const index = faceNormalAxis(size);
  axis.set(index === 0 ? 1 : 0, index === 1 ? 1 : 0, index === 2 ? 1 : 0);
  // The node's own rotation, not its world matrix: the pivot is a sibling of the object
  // under the same parent, so parent space is the space that matters.
  //
  // Read straight off `object.quaternion`. Extracting it from `object.matrix` instead is
  // wrong and quietly so: `Quaternion.setFromRotationMatrix` requires an unscaled rotation
  // matrix, and this node carries a scale of 0.0215 baked in by the exporter. Doing that
  // produced an axis of [0.02, -0.01, 1.00] — very nearly world Z, which is the axis the
  // *first* version of this bug used. It survived the unit tests because a wrong axis
  // through the right centre still keeps the marker's radius and plane offset constant.
  axis.applyQuaternion(object.quaternion).normalize();
  // `front` points from the rig toward the operator, so a spindle pointing away from the
  // operator has a positive dot with it reversed.
  if (axis.dot(front) > 0) axis.negate();
  return axis;
}

/** Where the spindle passes through, in world space, for the pivot to be built on. */
export function spindleCentre(object: THREE.Object3D, target?: THREE.Vector3): THREE.Vector3 {
  const centre = localBounds(object).getCenter(target ?? new THREE.Vector3());
  object.updateWorldMatrix(true, false);
  return centre.applyMatrix4(object.matrixWorld);
}

/**
 * How far the knob has turned, in radians about `spindleAxis`.
 *
 * **Source.** `Jetforce_Storyboard.pptx` sl. 29, state A: *"The red power switch is off.
 * (Rotate it smoothly 90 degrees **clockwise** to turn it on.)"* — read from the file, not
 * quoted from earlier work. Sl. 30 appears to disagree, saying *"anticlockwise to turn it
 * on"*, but it says so of a switch it has just described as already **on**, which is not a
 * transition that exists; it is sl. 29's sentence copied and half-edited, and the two agree
 * the moment it is read as "to turn it off".
 *
 * **Sign.** Positive, because `spindleAxis` points away from the operator. By the
 * right-hand rule a positive turn about an axis pointing *away* from the viewer appears
 * clockwise to them. Confirmed by rendering the shipped knob at both signs: the indicator
 * starts at 12 o'clock, and this sign carries it to 3 o'clock — clockwise — while the
 * other carries it to 9. The sign is meaningless without the axis convention, which is why
 * the two live in the same file.
 */
export const powerSwitchTurn = (isPowerOn: boolean): number => (isPowerOn ? QUARTER_TURN : 0);
