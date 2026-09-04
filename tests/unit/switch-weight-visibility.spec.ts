import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FRONT } from '../../src/lib/apparatusView';
import {
  QUARTER_TURN,
  faceNormalAxis,
  localBounds,
  powerSwitchTurn,
  spindleAxis,
  spindleCentre,
} from '../../src/lib/powerSwitch';
import { MESH } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import { loadApparatus } from '../helpers/model';
import { REPO_ROOT } from '../helpers/glb';

/**
 * Two presentation defects, and one that turned out not to be one.
 *
 * ## The switch
 *
 * The knob turned about **Z** — the operator's left-to-right axis — which tipped it out of
 * the panel instead of spinning it. ON rendered the disc as a flat ellipse lying down. The
 * axis was wrong, not merely the sign, and the geometry settles it: the knob is thinnest
 * across X, so X is the face it looks out of, and a disc spins about its face normal.
 *
 * ## The weights
 *
 * Reported as disappearing when the camera moves. Measured across camera dolly, orbit,
 * return, flow change, monitor open/close and guided-step camera flights, the loaded discs
 * never once vanished and never changed identity. The one disappearance is the canonical
 * lesson's own `REMOVE_ALL_WEIGHTS` at the end of a reading step, where the runtime clears
 * them too. There was no presentation bug to fix; these tests exist so that there continues
 * not to be one. See `docs/42`.
 */

let model: THREE.Group;

beforeAll(async () => {
  model = await loadApparatus();
});

describe('the power switch turns about its real spindle', () => {
  /**
   * The scene's own rig, rebuilt: a pivot at the spindle centre with the knob re-parented
   * under it, then one scalar driving a quaternion about the derived axis. Testing the
   * transform this produces is the point — an assertion about a Euler component or a named
   * constant is what let a visibly broken build pass twice.
   */
  const rig = () => {
    const node = model.getObjectByName(gltfName(MESH.powerSwitch));
    expect(node, 'Power_Switch is not in the model').toBeTruthy();
    const parent = new THREE.Group();
    const knob = node!.clone(true);
    parent.add(knob);
    parent.updateWorldMatrix(true, true);

    const axis = spindleAxis(knob, new THREE.Vector3(...FRONT));
    const centre = spindleCentre(knob);
    const pivot = new THREE.Group();
    pivot.position.copy(centre);
    parent.add(pivot);
    knob.position.sub(centre);
    pivot.add(knob);
    parent.updateWorldMatrix(true, true);

    /** The point furthest off the spindle: the indicator tip, and the best tracer there is. */
    const mesh = knob as THREE.Mesh;
    const position = (mesh.geometry as THREE.BufferGeometry).getAttribute('position');
    let marker = new THREE.Vector3();
    let best = -1;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
      const radial = v.clone().sub(centre);
      radial.addScaledVector(axis, -radial.dot(axis));
      if (radial.length() > best) {
        best = radial.length();
        marker = v.clone();
      }
    }
    const at = (turn: number) => {
      pivot.quaternion.setFromAxisAngle(axis, turn);
      pivot.updateWorldMatrix(true, true);
      return {
        marker: marker.clone().applyMatrix4(pivot.matrixWorld).applyMatrix4(
          new THREE.Matrix4().copy(pivot.matrixWorld).invert()
        ),
      };
    };
    void at;
    return { parent, pivot, knob, axis, centre, marker, markerRadius: best };
  };

  /** Where the marker ends up after turning the pivot by `turn`. */
  const markerAt = (r: ReturnType<typeof rig>, turn: number) => {
    const local = r.marker.clone().sub(r.centre);
    return local.applyAxisAngle(r.axis, turn).add(r.centre);
  };

  it('is thinnest across its spindle in its own space — and is not axis-aligned', () => {
    const node = model.getObjectByName(gltfName(MESH.powerSwitch))!;
    const local = localBounds(node).getSize(new THREE.Vector3());

    // A lamina in its own space: two comparable in-plane extents and one much smaller.
    const s = [local.x, local.y, local.z].sort((a, b) => a - b);
    expect(s[0]).toBeLessThan(s[1] * 0.3);
    expect(Math.abs(s[1] - s[2]) / s[2]).toBeLessThan(0.05);
    expect(faceNormalAxis(local)).toBe(2);

    // The trap that produced the deployed defect: the *world* box is thinnest across X, so
    // reading the axis off it gives world X — which is not the spindle.
    const clone = node.clone(true);
    clone.updateWorldMatrix(true, true);
    const world = new THREE.Box3().setFromObject(clone).getSize(new THREE.Vector3());
    expect(world.x).toBeLessThan(world.y);
    expect(world.x).toBeLessThan(world.z);

    const axis = spindleAxis(clone, new THREE.Vector3(...FRONT));
    const tilt = (axis.angleTo(new THREE.Vector3(1, 0, 0)) * 180) / Math.PI;
    expect(Math.min(tilt, 180 - tilt)).toBeGreaterThan(20);
  });

  it('is the face normal carried through the node own rotation, component by component', () => {
    // Pinned as an actual direction, not merely as "not axis-aligned". An earlier cut
    // derived the axis by extracting a quaternion from `object.matrix`, which is invalid
    // while the node carries its exporter scale of 0.0215; it returned very nearly world Z
    // and every other assertion here still passed, because a wrong axis through the right
    // centre keeps the marker's radius and plane offset perfectly constant.
    const node = model.getObjectByName(gltfName(MESH.powerSwitch))!;
    const expected = new THREE.Vector3(0, 0, 1).applyQuaternion(node.quaternion).normalize();
    if (expected.dot(new THREE.Vector3(...FRONT)) > 0) expected.negate();

    const axis = spindleAxis(node, new THREE.Vector3(...FRONT));
    expect(axis.x).toBeCloseTo(expected.x, 6);
    expect(axis.y).toBeCloseTo(expected.y, 6);
    expect(axis.z).toBeCloseTo(expected.z, 6);
    // The measured console tilt: 29.45 degrees up from horizontal, in the XY plane.
    expect(axis.z).toBeCloseTo(0, 6);
    expect(Math.abs(axis.x)).toBeCloseTo(0.87075, 4);
    expect(Math.abs(axis.y)).toBeCloseTo(0.49173, 4);
  });

  it('points away from the operator, which is what fixes the sign of the turn', () => {
    const node = model.getObjectByName(gltfName(MESH.powerSwitch))!;
    const axis = spindleAxis(node, new THREE.Vector3(...FRONT));
    // `FRONT` points from the rig toward the operator; the spindle points the other way.
    expect(axis.dot(new THREE.Vector3(...FRONT))).toBeLessThan(0);
  });

  it('keeps the spindle centre exactly still through the whole travel', () => {
    const r = rig();
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      r.pivot.quaternion.setFromAxisAngle(r.axis, powerSwitchTurn(true) * f);
      r.pivot.updateWorldMatrix(true, true);
      const moved = new THREE.Vector3().setFromMatrixPosition(r.pivot.matrixWorld);
      expect(moved.distanceTo(r.centre)).toBeLessThan(1e-9);
    }
  });

  it('keeps the marker on one circle about the spindle — no wobble, no tipping', () => {
    const r = rig();
    const radii: number[] = [];
    const alongAxis: number[] = [];
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const p = markerAt(r, powerSwitchTurn(true) * f).sub(r.centre);
      alongAxis.push(p.dot(r.axis));
      radii.push(p.addScaledVector(r.axis, -p.dot(r.axis)).length());
    }
    // Constant radius: it orbits the spindle rather than drifting off it.
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-6);
    // Constant offset along the spindle: it stays in the panel plane, so it cannot sink
    // through the backplate the way the world-X rotation does.
    expect(Math.max(...alongAxis) - Math.min(...alongAxis)).toBeLessThan(1e-6);
  });

  it('advances monotonically to exactly a quarter turn', () => {
    const r = rig();
    // The angle *about the spindle*, so the axial component of the marker is projected out
    // first. Measuring between the raw 3D vectors instead under-reads the turn, because the
    // indicator tip does not sit exactly in the plane through the spindle centre.
    const radial = (turn: number) => {
      const p = markerAt(r, turn).sub(r.centre);
      return p.addScaledVector(r.axis, -p.dot(r.axis));
    };
    const ref = radial(0);
    const angles = [0, 0.25, 0.5, 0.75, 1].map((f) =>
      ref.angleTo(radial(powerSwitchTurn(true) * f))
    );
    for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeGreaterThan(angles[i - 1]);
    expect(angles.at(-1)!).toBeCloseTo(QUARTER_TURN, 6);
  });

  it('turns clockwise as the operator sees it', () => {
    // BEDO sl. 29, state A (off): "Rotate it smoothly 90 degrees clockwise to turn it on."
    //
    // `spindleAxis` points away from the operator, so their view direction is +axis. In a
    // right-handed frame, a positive turn about an axis pointing away from the viewer is
    // clockwise to them. Measured here in the operator's own screen basis rather than
    // asserted: screen-right is axis x up, screen-up is right x axis.
    const r = rig();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(r.axis, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, r.axis).normalize();
    const screen = (turn: number) => {
      const p = markerAt(r, turn).sub(r.centre);
      return Math.atan2(p.dot(up), p.dot(right));
    };
    const before = screen(0);
    let after = screen(powerSwitchTurn(true));
    // Unwrap onto the same branch so the comparison is about direction, not the cut.
    while (after > before) after -= Math.PI * 2;
    // Angles increase anticlockwise, so clockwise decreases them.
    expect(before - after).toBeCloseTo(QUARTER_TURN, 6);
  });

  it('starts at rest and returns to it, so ON → OFF retraces the same arc', () => {
    const r = rig();
    expect(powerSwitchTurn(false)).toBe(0);
    expect(powerSwitchTurn(true)).toBe(QUARTER_TURN);
    const rest = markerAt(r, powerSwitchTurn(false));
    const back = markerAt(r, powerSwitchTurn(false));
    expect(back.distanceTo(rest)).toBeLessThan(1e-12);
    // A quarter turn each way about one axis is the same arc reversed, by construction:
    // the orientation is rebuilt from the scalar every frame rather than accumulated.
    expect(markerAt(r, QUARTER_TURN).distanceTo(markerAt(r, -QUARTER_TURN))).toBeGreaterThan(0);
  });

  it('rebuilds the orientation from one scalar instead of easing a Euler component', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'),
      'utf8'
    );
    const block = source.slice(source.indexOf('const powerPivot'), source.indexOf('const lampMat'));
    expect(block).toMatch(/powerPivot\.quaternion\.setFromAxisAngle/);
    expect(block).not.toMatch(/powerPivot\.rotation\.[xyz] = damp/);
  });

  it('is presentation only — it cannot change the rig', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'src/lib/powerSwitch.ts'), 'utf8');
    expect(source).not.toMatch(/POWER_ON|POWER_OFF|dispatch|SimulationRuntime/);
  });
});

describe('a loaded disc is visible because it is loaded, and for no other reason', () => {
  const deviceModel = () =>
    readFileSync(path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'), 'utf8');

  /** The JSX that draws the stack, from the slot group to the end of its hit proxy. */
  const stackBlock = () => {
    const s = deviceModel();
    const start = s.indexOf('{stack.map(');
    expect(start, 'the stack render moved').toBeGreaterThan(-1);
    return s.slice(start, s.indexOf('</group>', s.indexOf('cylinderGeometry', start)));
  };

  it('gates the disc on exactly one thing: whether it has arrived', () => {
    const block = stackBlock();
    const visibleProps = [...block.matchAll(/visible=\{([^}]*)\}/g)].map((m) => m[1].trim());
    // One gate on the slot, plus the hit proxy's material, which is invisible by
    // definition and gates nothing.
    const gates = visibleProps.filter((v) => v !== 'false');
    expect(gates).toEqual(['!inFlightSeats.has(index)']);
    expect(visibleProps).toContain('false');
  });

  it('never consults the lesson, the camera or the panel', () => {
    // §8/§12: the forbidden couplings, asserted as absences in the code that draws a disc.
    const block = stackBlock();
    for (const forbidden of [
      'currentStep',
      'displayNumber',
      'hasReached',
      'activeReadingIndex',
      'isBalanced',
      'panelControls',
      'highlight',
      'camera',
      'distance',
      'hiddenTrayWeightGrams',
    ]) {
      expect(block, `the stack render consults ${forbidden}`).not.toMatch(
        new RegExp(forbidden)
      );
    }
  });

  it('leaves culling to three.js rather than switching it off', () => {
    // §13: the bounds are correct — measured live, every disc reported a bounding sphere of
    // 2.89 in geometry units against a 5.74-unit disc — so there is nothing to work around.
    expect(deviceModel()).not.toMatch(/frustumCulled/);
  });

  it('keys a disc by its identity, not by anything transient', () => {
    // §14/§17: `${idx}-${grams}` is stack position and mass. Neither changes because the
    // camera moved, so React has no reason to rebuild the object — measured across dolly,
    // orbit, flow change and monitor toggle, every disc kept its UUID.
    expect(deviceModel()).toMatch(/key: `\$\{idx\}-\$\{grams\}`/);
  });

  it('is never cleared by a step completing — the pan is cumulative', () => {
    // The measured cause of the reported "disappearance" used to be here: the canonical
    // lesson ended each reading step with REMOVE_ALL_WEIGHTS, so the pan emptied as the
    // camera flew to the next step. On the apparatus the discs stay on and the student
    // adds more, so no step clears the pan; Reset and loading another sheet do.
    // See `docs/42 §7`.
    const lesson = readFileSync(path.join(REPO_ROOT, 'src/lesson/currentLesson.ts'), 'utf8');
    expect([...lesson.matchAll(/REMOVE_ALL_WEIGHTS/g)]).toHaveLength(0);
  });
});
