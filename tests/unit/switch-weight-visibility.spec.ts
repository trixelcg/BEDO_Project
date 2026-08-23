import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  POWER_SWITCH_AXIS,
  QUARTER_TURN,
  powerSwitchTurn,
} from '../../src/lib/apparatusView';
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

describe('the power switch turns about the face it looks out of', () => {
  it('is thinnest across the axis it turns about', () => {
    // The measurement the axis is chosen from, taken from the shipped model rather than
    // written down: 29.8 x 43.8 x 45.0 mm.
    const node = model.getObjectByName(gltfName(MESH.powerSwitch));
    expect(node, 'Power_Switch is not in the model').toBeTruthy();
    const clone = node!.clone(true);
    clone.updateWorldMatrix(true, true);
    const size = new THREE.Box3().setFromObject(clone).getSize(new THREE.Vector3());

    expect(size.x).toBeLessThan(size.y);
    expect(size.x).toBeLessThan(size.z);
    // Round in the panel plane — a knob, not a lever.
    expect(Math.abs(size.y - size.z) / Math.max(size.y, size.z)).toBeLessThan(0.1);
    expect(POWER_SWITCH_AXIS).toBe('x');
  });

  it('sits at rest when the rig is off', () => {
    expect(powerSwitchTurn(false)).toBe(0);
  });

  it('turns a quarter of a turn when the rig is on', () => {
    expect(powerSwitchTurn(true)).toBe(QUARTER_TURN);
    expect(QUARTER_TURN).toBeCloseTo(Math.PI / 2, 12);
  });

  it('turns clockwise as the operator sees it, which is a positive turn about X', () => {
    // BEDO sl. 29: "Rotate it smoothly 90 degrees clockwise to turn it on."
    //
    // The operator stands at -X looking along +X, so their screen-up is +Y and their
    // screen-right is +Z. A positive turn about X carries +Y to +Z — up to right — which is
    // clockwise. This asserts that geometry rather than the word.
    expect(powerSwitchTurn(true)).toBeGreaterThan(0);

    const up = new THREE.Vector3(0, 1, 0);
    const turned = up
      .clone()
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), powerSwitchTurn(true));
    // Screen coordinates for that observer: right = +Z, up = +Y.
    const before = { right: up.z, up: up.y };
    const after = { right: turned.z, up: turned.y };
    const angle = (p: { right: number; up: number }) => Math.atan2(p.up, p.right);
    // Angles measured anticlockwise, so a clockwise turn *decreases* the angle.
    expect(angle(after)).toBeLessThan(angle(before));
    expect(angle(before) - angle(after)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('returns to rest on the way back, so ON → OFF is a true round trip', () => {
    expect(powerSwitchTurn(true)).toBe(QUARTER_TURN);
    expect(powerSwitchTurn(false)).toBe(0);
    expect(powerSwitchTurn(!!0)).toBe(powerSwitchTurn(false));
  });

  it('no longer turns about Z anywhere in the scene', () => {
    // The literal defect: `powerPivot.rotation.z = damp(..., -QUARTER_TURN, ...)`.
    const source = readFileSync(
      path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'),
      'utf8'
    );
    const block = source.slice(source.indexOf('const powerPivot'), source.indexOf('const lampMat'));
    expect(block).toMatch(/powerPivot\.rotation\.x = damp/);
    expect(block).not.toMatch(/powerPivot\.rotation\.z = damp/);
  });

  it('is presentation only — it cannot change the rig', () => {
    // `powerSwitchTurn` takes a boolean and returns a number. It has no access to the
    // domain and the domain has no access to it.
    const source = readFileSync(path.join(REPO_ROOT, 'src/lib/apparatusView.ts'), 'utf8');
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

  it('is cleared only by the runtime, and the lesson is the only thing that clears it', () => {
    // The measured cause of the reported "disappearance": the canonical lesson ends each
    // reading step with REMOVE_ALL_WEIGHTS, so the pan empties as the camera flies to the
    // next step. That is the lesson's own specification, not a rendering fault — recorded
    // here so the coupling is visible rather than surprising. See `docs/42 §7`.
    const lesson = readFileSync(path.join(REPO_ROOT, 'src/lesson/currentLesson.ts'), 'utf8');
    const clears = [...lesson.matchAll(/REMOVE_ALL_WEIGHTS/g)];
    expect(clears).toHaveLength(2);
    for (const id of ['balance-reading-1', 'balance-reading-2']) {
      const step = lesson.slice(lesson.indexOf(id), lesson.indexOf(id) + 700);
      expect(step, `${id} should tidy the pan when it completes`).toMatch(
        /onComplete:[\s\S]*REMOVE_ALL_WEIGHTS/
      );
    }
  });
});
