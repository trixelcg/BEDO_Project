import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { MAX_DROPLETS, createSpray } from '../../src/lib/waterSpray';
import {
  RUNDOWN_HEIGHT_FRACTION,
  SINK_MAX_LEVEL,
  createWaterCircuit,
} from '../../src/lib/waterCircuit';
import type { TankInterior } from '../../src/lib/tankWater';
import { DEFLECTORS } from '../../src/domain/apparatus';

/**
 * The rest of the water circuit (brief §3.3-§3.5, §3.7).
 *
 * The shaders cannot run under vitest, so what is pinned here is everything that is not a
 * shader: the emission geometry, the budgets, where each piece is placed relative to
 * measured geometry, and that the basin settles rather than filling for ever.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const deviceModel = readFileSync(path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'), 'utf8');

const interior = (): TankInterior => ({
  axis: new THREE.Vector2(0.018, -0.413),
  radius: 0.09,
  floorY: 0.105,
  ceilingY: 0.675,
});

const sink = () => new THREE.Box3(new THREE.Vector3(-0.6, -0.77, -0.9), new THREE.Vector3(0.55, 0.02, 1.0));

describe('the droplet field', () => {
  const spray = createSpray();

  it('stays inside the brief’s budget, in one draw call', () => {
    expect(MAX_DROPLETS).toBe(2000);
    const geometry = spray.object.geometry;
    expect(geometry.getAttribute('position').count).toBe(MAX_DROPLETS);
    expect(spray.object).toBeInstanceOf(THREE.Points);
  });

  it('moves every droplet on the GPU — no attribute is rewritten per frame', () => {
    // The property that makes 2 000 droplets free. If a future change starts writing
    // positions on the CPU this is what should fail.
    const before = Float32Array.from(spray.object.geometry.getAttribute('position').array);
    for (let i = 0; i < 30; i += 1) {
      spray.update({
        flowFraction: 0.6,
        impactVelocityMS: 5.7,
        deflectorAngleDeg: 90,
        elapsedS: i / 60,
      });
    }
    expect(Array.from(spray.object.geometry.getAttribute('position').array)).toEqual(
      Array.from(before)
    );
  });

  it('thins the spray with the flow rather than rebuilding it', () => {
    spray.update({ flowFraction: 1, impactVelocityMS: 8, deflectorAngleDeg: 90, elapsedS: 0 });
    expect(spray.object.geometry.drawRange.count).toBe(MAX_DROPLETS);

    spray.update({ flowFraction: 0.25, impactVelocityMS: 4, deflectorAngleDeg: 90, elapsedS: 0 });
    expect(spray.object.geometry.drawRange.count).toBe(500);
  });

  it('draws nothing at a trickle, and nothing with no jet', () => {
    spray.update({ flowFraction: 0.01, impactVelocityMS: 1, deflectorAngleDeg: 90, elapsedS: 0 });
    expect(spray.object.visible).toBe(false);
    spray.update({ flowFraction: 0.8, impactVelocityMS: 0, deflectorAngleDeg: 90, elapsedS: 0 });
    expect(spray.object.visible).toBe(false);
  });

  it('throws each deflector’s own cone, from one rule', () => {
    // A jet arriving along +Y and turned through theta leaves at theta from +Y. So the
    // elevation uniform *is* the deflection angle, for all seven — no per-deflector table
    // to fall out of step with `DEFLECTORS`.
    const uniforms = (spray.object.material as THREE.ShaderMaterial).uniforms;
    for (const deflector of DEFLECTORS) {
      spray.update({
        flowFraction: 0.6,
        impactVelocityMS: 5,
        deflectorAngleDeg: deflector.id,
        elapsedS: 0,
      });
      expect(uniforms.uElevation.value, `${deflector.id}°`).toBeCloseTo(
        (deflector.id * Math.PI) / 180,
        9
      );
    }
  });

  it('turns the flat plate’s sheet horizontal and the hemisphere’s back down', () => {
    const uniforms = (spray.object.material as THREE.ShaderMaterial).uniforms;
    const at = (angle: number) => {
      spray.update({
        flowFraction: 0.6,
        impactVelocityMS: 5,
        deflectorAngleDeg: angle,
        elapsedS: 0,
      });
      return Math.cos(uniforms.uElevation.value); // the +Y component of the cone axis
    };
    expect(at(90)).toBeCloseTo(0, 9); //    horizontal disc
    expect(at(180)).toBeCloseTo(-1, 9); //  straight back down
    expect(at(30)).toBeGreaterThan(0.8); // still travelling upward
    expect(at(135)).toBeLessThan(0); //     thrown downward and outward
  });

  it('leaves at a speed set by the jet, not by the valve', () => {
    const uniforms = (spray.object.material as THREE.ShaderMaterial).uniforms;
    spray.update({ flowFraction: 0.5, impactVelocityMS: 3.2, deflectorAngleDeg: 90, elapsedS: 0 });
    const slow = uniforms.uSpeed.value;
    spray.update({ flowFraction: 0.5, impactVelocityMS: 5.7, deflectorAngleDeg: 90, elapsedS: 0 });
    expect(uniforms.uSpeed.value / slow).toBeCloseTo(5.7 / 3.2, 6);
  });

  it('is deterministic, so a visual regression is a regression and not noise', () => {
    const a = createSpray(64);
    const b = createSpray(64);
    expect(Array.from(a.object.geometry.getAttribute('aSeed').array)).toEqual(
      Array.from(b.object.geometry.getAttribute('aSeed').array)
    );
    a.dispose();
    b.dispose();
  });

  it('is never frustum-culled — the droplets outlive the emitter’s bounds', () => {
    expect(spray.object.frustumCulled).toBe(false);
  });
});

describe('the run-down, the drain and the sink', () => {
  const circuit = createWaterCircuit(interior(), sink(), 0.6)!;
  const find = (name: string) => circuit.object.getObjectByName(name) as THREE.Mesh;

  it('builds all three pieces', () => {
    expect(find('BedoTankRundown')).toBeTruthy();
    expect(find('BedoTankDrain')).toBeTruthy();
    expect(find('BedoSinkSurface')).toBeTruthy();
  });

  it('wets a band below the vane, not the whole wall', () => {
    // The judgement BEDO-WATER-14/15 made: a full-height sheet inside a 181 mm glass vessel
    // reads as a blue cylinder filling the tank. This is a collar, and it stops well above
    // the floor.
    const band = find('BedoTankRundown');
    const box = new THREE.Box3().setFromObject(band);
    const height = box.max.y - box.min.y;
    const interiorHeight = interior().ceilingY - interior().floorY;
    expect(height / interiorHeight).toBeCloseTo(RUNDOWN_HEIGHT_FRACTION, 6);
    expect(RUNDOWN_HEIGHT_FRACTION).toBeLessThan(0.5);
    expect(box.max.y).toBeLessThanOrEqual(interior().ceilingY + 1e-9);
    expect(box.min.y).toBeGreaterThan(interior().floorY);
  });

  it('follows the vane, so a different disc wets a different band', () => {
    const high = createWaterCircuit(interior(), sink(), 0.62)!;
    const low = createWaterCircuit(interior(), sink(), 0.5)!;
    const y = (c: typeof high) =>
      new THREE.Box3().setFromObject(c.object.getObjectByName('BedoTankRundown')!).max.y;
    expect(y(high)).toBeGreaterThan(y(low));
    high.dispose();
    low.dispose();
  });

  it('keeps the band inside the glass', () => {
    const band = find('BedoTankRundown');
    const box = new THREE.Box3().setFromObject(band);
    const radius = (box.max.x - box.min.x) / 2;
    expect(radius).toBeLessThan(interior().radius);
  });

  it('falls from the tank’s floor to the basin’s rim, and no further', () => {
    const box = new THREE.Box3().setFromObject(find('BedoTankDrain'));
    expect(box.max.y).toBeCloseTo(interior().floorY, 6);
    expect(box.min.y).toBeCloseTo(sink().max.y, 6);
    // On the tank's own axis, because that is where its outlet is.
    const centre = box.getCenter(new THREE.Vector3());
    expect(centre.x).toBeCloseTo(interior().axis.x, 6);
    expect(centre.z).toBeCloseTo(interior().axis.y, 6);
  });

  it('the basin settles at a depth the flow sets, rather than filling for ever', () => {
    const surface = find('BedoSinkSurface');
    const floor = sink().min.y;
    const run = (flowFraction: number, seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        circuit.update({ flowFraction, deltaS: 1 / 60, phaseS: t, flowing: true });
      }
      return surface.position.y - floor;
    };

    const settled = run(0.8, 120);
    const stillSettled = run(0.8, 120);
    expect(stillSettled).toBeCloseTo(settled, 6);

    // And it is bounded by the basin, not by how long the student stood there.
    const depth = (sink().max.y - sink().min.y) * SINK_MAX_LEVEL;
    expect(settled).toBeLessThanOrEqual(depth + 1e-9);
  });

  it('drains back down when the flow stops', () => {
    const surface = find('BedoSinkSurface');
    for (let t = 0; t < 60; t += 1 / 60) {
      circuit.update({ flowFraction: 1, deltaS: 1 / 60, phaseS: t, flowing: true });
    }
    const wet = surface.position.y;
    for (let t = 0; t < 60; t += 1 / 60) {
      circuit.update({ flowFraction: 0, deltaS: 1 / 60, phaseS: t, flowing: false });
    }
    expect(surface.position.y).toBeLessThan(wet);
    expect(surface.visible).toBe(false);
  });

  it('shows nothing at all while the rig is dry', () => {
    circuit.update({ flowFraction: 0, deltaS: 1 / 60, phaseS: 0, flowing: false });
    expect(find('BedoTankRundown').visible).toBe(false);
    expect(find('BedoTankDrain').visible).toBe(false);
  });

  it('survives a bench with no sink in the model', () => {
    // The stub model most of the browser suite runs against has no room in it.
    const bare = createWaterCircuit(interior(), null, 0.6);
    expect(bare).not.toBeNull();
    expect(bare!.object.getObjectByName('BedoSinkSurface')).toBeUndefined();
    expect(() =>
      bare!.update({ flowFraction: 0.5, deltaS: 0.016, phaseS: 0, flowing: true })
    ).not.toThrow();
    bare!.dispose();
  });
});

describe('the circuit is wired to the authoritative flow', () => {
  it('the spray, the circuit and the jet all read one flow fraction', () => {
    // Not the valve opening, and not three separate derivations — one number, so the hose,
    // the jet, the droplets and the sink can never disagree about how hard it is raining.
    expect(deviceModel).toMatch(/const flowFraction = Math\.min\(/);
    expect(deviceModel).toMatch(/spray\.current\.update\(\{\s*\n\s*flowFraction,/);
    expect(deviceModel).toMatch(/circuit\.current\?\.update\(\{/);
  });

  it('droplets are emitted only where the jet actually strikes', () => {
    expect(deviceModel).toMatch(/if \(impacting\) \{\s*\n\s*const centre = localCentreOf\(/);
  });

  it('the deflector reads through the sheet that leaves it', () => {
    // §3.7: the caches are at their most opaque exactly where the disc is.
    expect(deviceModel).toMatch(/gl_FragColor\.a \*= 1\.0 - 0\.45 \* impact;/);
  });

  it('the water fades rather than switching on', () => {
    expect(deviceModel).toMatch(/const WATER_FADE_S = 0\.3;/);
    expect(deviceModel).toMatch(/gl_FragColor\.a \*= uFade;/);
  });
});
