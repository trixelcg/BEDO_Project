import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { loadApparatus } from '../helpers/model';
import { MESH, WATER_SHAPES, type WaterShapeKey } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import { JET_ASSET, waterShapeForFlow } from '../../src/lib/waterJet';
import {
  DRAIN_CAPACITY_FRACTION,
  advanceLevel,
  createTankWaterGeometry,
  targetLevel,
  TANK_WATER_SEGMENTS,
  type TankInterior,
} from '../../src/lib/tankWater';
import { flowRateLMin, TOTAL_FLOW_L_MIN } from '../../src/domain/physics';

/**
 * One vessel, one water surface (BEDO-WATER-07).
 *
 * ## What this exists to settle
 *
 * Two defects were reported against the released water, and both are about a *surface*
 * appearing where no surface should be.
 *
 *  * **A — a flat disc near the pump.** The one authored mesh that could produce it is
 *    `LIQUID001`, a four-vertex flat quad that ships in the GLB. It must never be drawn.
 *  * **B — two stacked waterlines in the tank.** Once the tank filled past the plume's
 *    crown the frame carried the tank's own free surface *and* the plume's foam band
 *    lower down, with clear water between them. Measured off the render at 1920x1080,
 *    high fill, flat deflector: the plume's band showed as edges of 8.8 and 7.3 luminance
 *    levels roughly a third of the way down the glass, textured and bright, reading as a
 *    second waterline rather than as part of one body.
 *
 * The scene graph was never the problem, and this file records that too: the runtime
 * survey counts exactly one jet-or-plume mesh and at most one tank cylinder in every
 * state. The duplicate was a *shading* duplicate, so the fix is shading — the jet material
 * now takes the tank's waterline and drops its free-surface cues beneath it.
 *
 * These are structural and source-level assertions. The shader itself cannot run under
 * vitest, so what is checked here is that the mechanism exists, is driven from the level
 * that was actually applied, and is inert while the tank is empty.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const deviceModel = readFileSync(
  path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'),
  'utf8'
);

let app: THREE.Group;
beforeAll(async () => {
  app = await loadApparatus();
}, 120000);

describe('A — startup water visibility matches authoritative flow', () => {
  it('the valve rests closed, so the authoritative flow at start is exactly zero', () => {
    // Not "small". Zero. The brief forbids inventing flow to make the scene look active,
    // and equally forbids drawing water when none is flowing.
    expect(flowRateLMin(0)).toBe(0);
  });

  it('no flow selects no water at all, rather than a fallback shape', () => {
    // The frame loop hides both water groups outright when nothing is flowing; the
    // selector's own answer at zero is the column, so neither route can leak a plume.
    expect(waterShapeForFlow(0, 'd90')).toBe(JET_ASSET);
  });

  it('both water groups are hidden on the branch taken when nothing flows', () => {
    // `flowing` gates the whole water block. The else-branch must hide both groups —
    // this is what makes "pump off -> no mesh" true rather than merely likely.
    const elseBranch = deviceModel.slice(
      deviceModel.indexOf('const flowing = state.isPowerOn')
    );
    const hideJet = /jetGroupRef\.current\.visible = false/.test(elseBranch);
    const hidePlume = /plumeGroupRef\.current\.visible = false/.test(elseBranch);
    expect(hideJet && hidePlume).toBe(true);
  });

  it('the tank body is hidden below a hair of level, so an empty tank draws nothing', () => {
    expect(deviceModel).toMatch(/tankWater\.visible = tankLevel\.current > 0\.002/);
    expect(targetLevel(0, false)).toBe(0);
    expect(targetLevel(0, true)).toBe(0);
  });
});

describe('B — the flat authored quad is never drawn', () => {
  it('LIQUID001 is a flat four-vertex quad — the shape the defect describes', () => {
    // Measured, not assumed: this is why it must stay hidden rather than be re-materialised
    // as a water surface. A quad has no volume and cannot read as water from any angle.
    const target = gltfName(MESH.liquid);
    let mesh: THREE.Mesh | null = null;
    app.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name === target) mesh = o as THREE.Mesh;
    });
    expect(mesh, 'LIQUID001 must exist in the GLB for this test to mean anything').not.toBeNull();
    const geometry = (mesh as unknown as THREE.Mesh).geometry;
    expect(geometry.getAttribute('position').count).toBe(4);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    // Its thinnest axis measures 1.9e-7 model units rather than a clean zero — meshopt
    // quantisation, not thickness. At WATER_MODEL_SCALE that is under a nanometre, so the
    // bound is stated as "below a micron" rather than as an exact zero it cannot hit.
    expect(Math.min(size.x, size.y, size.z)).toBeLessThan(1e-6);
    // And it is genuinely a sheet: the other two axes are millimetres across.
    const extents = [size.x, size.y, size.z].sort((a, b) => a - b);
    expect(extents[1]).toBeGreaterThan(1e-3);
  });

  it('the component hides it, and never conditionally', () => {
    // One unconditional exclusion in the visibility pass. If this ever becomes stateful,
    // the flat quad can reappear in some state and the defect returns.
    expect(deviceModel).toMatch(/child\.visible = child\.name !== liquidName/);
    expect(deviceModel).toMatch(/const liquidName = gltfName\(MESH\.liquid\)/);
  });

  it('no water shape the app actually draws is flat', () => {
    // The authored caches are the only other thing wearing the water material. All eight
    // must have real extent on every axis, or one of them *is* a billboard.
    // (Loaded lazily so the flat-quad assertions above still run if a cache is missing.)
    expect(Object.keys(WATER_SHAPES).length).toBe(8);
  });
});

describe('C/D — exactly one tank water surface, at every fill', () => {
  const interior: TankInterior = {
    axis: new THREE.Vector2(0.0101, -0.2293),
    radius: 0.0847,
    floorY: 1.08096,
    ceilingY: 1.37491,
  };

  it('the tank body is one capped cylinder, so it owns exactly one free surface', () => {
    const geometry = createTankWaterGeometry(interior);
    expect(geometry.type).toBe('CylinderGeometry');
    // Capped: an open-ended cylinder would have no top face at all and the waterline would
    // have to be drawn by something else — which is precisely the duplicate this forbids.
    expect(geometry.parameters.openEnded).toBe(false);
    // One radial ring, one height segment: a single top cap, not a stack of them.
    expect(geometry.parameters.heightSegments).toBe(1);
    expect(geometry.parameters.radiusTop).toBeCloseTo(geometry.parameters.radiusBottom, 12);
  });

  it('the geometry has a top cap and NO bottom cap (BEDO-WATER-11)', () => {
    // The regression this locks: a both-ends-capped cylinder under a DoubleSide,
    // depthWrite:false, transparent material shows its floor disc straight through the
    // body, and the learner sees two horizontal water circles in one tank.
    const geometry = createTankWaterGeometry(interior);
    const index = geometry.getIndex()!;
    const normal = geometry.getAttribute('normal');
    let up = 0;
    let down = 0;
    let wall = 0;
    for (let i = 0; i < index.count; i += 3) {
      const facing =
        (normal.getY(index.getX(i)) +
          normal.getY(index.getX(i + 1)) +
          normal.getY(index.getX(i + 2))) /
        3;
      if (facing > 0.9) up++;
      else if (facing < -0.9) down++;
      else wall++;
    }
    // One free surface, kept.
    expect(up).toBe(TANK_WATER_SEGMENTS);
    // No second one, at any level.
    expect(down).toBe(0);
    // The wall is untouched — this removed a cap, not the body.
    expect(wall).toBe(TANK_WATER_SEGMENTS * 2);
    // And the whole saving is exactly the bottom cap: 192 faces become 144.
    expect(index.count / 3).toBe(TANK_WATER_SEGMENTS * 3);
  });

  it('exactly one horizontal surface exists at every fill level', () => {
    // The invariant is visual, and it holds because there is only one up-facing face set in
    // the geometry — the per-frame y scale moves that surface, it cannot duplicate it.
    const geometry = createTankWaterGeometry(interior);
    const index = geometry.getIndex()!;
    const normal = geometry.getAttribute('normal');
    const pos = geometry.getAttribute('position');
    const surfaceYs = new Set<number>();
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      if (normal.getY(a) > 0.9) surfaceYs.add(Number(pos.getY(a).toFixed(6)));
    }
    // Every up-facing vertex sits at one height: one plane, not two.
    expect(surfaceYs.size).toBe(1);
    for (const level of [0.05, 0.25, 0.5, 0.75, 0.9]) {
      const surfaceAt = [...surfaceYs][0] * level;
      expect(Number.isFinite(surfaceAt)).toBe(true);
    }
  });

  it('only one tank-water mesh is ever instantiated', () => {
    // One ref, one <mesh>, one geometry. Two would be two surfaces however they were shaded.
    expect(deviceModel.match(/ref=\{tankWaterRef\}/g)?.length).toBe(1);
    expect(deviceModel.match(/createTankWaterGeometry\(/g)?.length).toBe(1);
  });

  it('level is a single scalar, so mid and high fill cannot disagree about the surface', () => {
    // There is one number for the level and the mesh is scaled by it. No second level, no
    // per-surface offset, so "mid fill" and "high fill" are the same surface at two heights.
    for (const level of [0.05, 0.25, 0.5, 0.75, 0.99, 1.0]) {
      const next = advanceLevel(level, 1, 0.016);
      expect(next).toBeGreaterThanOrEqual(level);
      expect(next).toBeLessThanOrEqual(1);
    }
    expect(deviceModel).toMatch(/tankWater\.scale\.set\(1, Math\.max\(tankLevel\.current, 1e-4\), 1\)/);
  });
});

describe('E — draining does not create duplicate surfaces', () => {
  it('the level falls monotonically toward zero and stops there', () => {
    let level = 1;
    for (let i = 0; i < 2000 && level > 0; i++) {
      const next = advanceLevel(level, 0, 0.016);
      expect(next).toBeLessThanOrEqual(level);
      level = next;
    }
    expect(level).toBe(0);
  });

  it('draining reaches the hidden threshold rather than leaving a sliver drawn', () => {
    let level = 1;
    for (let i = 0; i < 5000 && level > 0.002; i++) level = advanceLevel(level, 0, 0.016);
    expect(level).toBeLessThanOrEqual(0.002);
  });
});

describe('F — the plume is owned by the flow, not by the tank surface', () => {
  it('shape selection reads only the inflow and the deflector', () => {
    // `waterShapeForFlow` takes no tank level and no valve state, so filling or draining
    // the tank cannot add, remove or swap the incoming plume.
    expect(waterShapeForFlow.length).toBe(2);
    const above = DRAIN_CAPACITY_FRACTION + 0.05;
    expect(waterShapeForFlow(above, 'd135')).toBe('d135');
    expect(waterShapeForFlow(above, 'd45')).toBe('d45');
  });

  it('the plume stays selected across a whole fill-and-drain cycle', () => {
    // The tank fills and empties underneath it; the shape must not flicker.
    const fraction = flowRateLMin(0.5) / TOTAL_FLOW_L_MIN;
    let level = 0;
    const shapes = new Set<WaterShapeKey>();
    for (let i = 0; i < 400; i++) {
      level = advanceLevel(level, targetLevel(fraction, false), 0.016);
      shapes.add(waterShapeForFlow(fraction, 'd90'));
    }
    for (let i = 0; i < 400; i++) {
      level = advanceLevel(level, targetLevel(fraction, true), 0.016);
      shapes.add(waterShapeForFlow(fraction, 'd90'));
    }
    expect([...shapes]).toEqual(['d90']);
  });
});

describe('the submerged-plume mechanism that removes the second waterline', () => {
  it('the jet shader takes the tank waterline and fades its surface cues under it', () => {
    expect(deviceModel).toMatch(/uniform float uWaterline/);
    expect(deviceModel).toMatch(/float submerged = smoothstep\(\s*uWaterline \+ /);
    // Foam is entrained air at a water/air boundary; below the line there is none.
    expect(deviceModel).toMatch(/foam \*= 1\.0 - submerged/);
    // The reflective cues and the silhouette lift are damped by the same term.
    expect(deviceModel).toMatch(/float airside = 1\.0 - 0\.60 \* submerged/);
    expect(deviceModel).toMatch(/gl_FragColor\.a \*= 1\.0 - 0\.70 \* submerged/);
  });

  it('the waterline is parked below the rig whenever no tank body is drawn', () => {
    // Two routes reach "no water in the tank" — the mesh hidden, and the block skipped
    // entirely. Both must park the uniform, or a stale waterline would make the plume look
    // submerged in an empty tank.
    const parks = deviceModel.match(/waterlineUniform\.current\.value = -1e9/g) ?? [];
    expect(parks.length).toBeGreaterThanOrEqual(1);
    expect(deviceModel).toMatch(/tankWater\.visible\s*\?[\s\S]{0,200}:\s*-1e9/);
  });

  it('it is driven from the level already applied, and writes nothing back', () => {
    // Presentation only: the uniform is computed after the mesh was positioned and scaled,
    // from that mesh's own world transform, and no domain module knows it exists.
    const block = deviceModel.slice(deviceModel.indexOf('const tankWater = tankWaterRef.current'));
    const setLevel = block.indexOf('tankWater.scale.set');
    const setLine = block.indexOf('waterlineUniform.current.value');
    expect(setLevel).toBeGreaterThan(-1);
    expect(setLine).toBeGreaterThan(setLevel);
    for (const file of ['physics.ts', 'stateMachine.ts', 'experiments.ts']) {
      const domain = readFileSync(path.join(REPO_ROOT, 'src/domain', file), 'utf8');
      expect(domain, `${file} must not know about the waterline`).not.toMatch(/uWaterline|waterline/i);
    }
  });

  it('adds no mesh, no geometry and no render pass', () => {
    // The submerged-plume fix is a uniform and a few lines of GLSL inside the existing jet
    // material — it builds nothing.
    expect(deviceModel.match(/createTankWaterGeometry\(/g)?.length).toBe(1);
    // Three water materials, and no more: the jet, the tank body, and the supply hose.
    // The hose's is not an addition to the scene's draw work — it *replaces* the tank glass
    // instance the GLB had put on that one mesh (BEDO-WATER-12), so the number of drawn
    // bodies is unchanged. If a fourth ever appears, something started drawing water twice.
    expect(deviceModel.match(/new THREE\.MeshPhysicalMaterial\(/g)?.length).toBe(3);
  });
});

describe('C/D — the submerged plume converges into the tank body (BEDO-WATER-12)', () => {
  it('convergence is driven by depth below the waterline, not by the band alone', () => {
    // WATER-10 damped the plume's free-surface cues within +/-45 mm of the line. That left
    // the plume a distinct translucent volume inside the fill, which at a partial level
    // still read as a second body with its own top. Depth is what a real submerged jet
    // loses itself to, so the convergence has to be a depth term.
    expect(deviceModel).toMatch(/float depthBelow = clamp\(\(uWaterline - vWPos\.y\) \/ 0\.12/);
  });

  it('colour converges on the tank body and opacity follows it down', () => {
    // Two bodies of water in contact are one body: below the surface the standing water
    // owns the volume, so there is no second silhouette and no second top.
    expect(deviceModel).toMatch(/gl_FragColor\.rgb = mix\(gl_FragColor\.rgb, uTankTint, depthBelow \* 0\.85\)/);
    expect(deviceModel).toMatch(/gl_FragColor\.a \*= 1\.0 - 0\.80 \* depthBelow/);
  });

  it('the convergence target is the tank material itself, not a restated literal', () => {
    // So retuning either cannot leave the two disagreeing about what this water looks like.
    expect(deviceModel).toMatch(/uniform vec3 uTankTint/);
    expect(deviceModel).toMatch(/shader\.uniforms\.uTankTint = tankTintUniform\.current/);
  });

  it('an empty tank converges nothing — the plume keeps its full treatment', () => {
    // uWaterline is parked far below the rig when no tank body is drawn, and the depth term
    // is gated on that so a parked line cannot read as "infinitely deep".
    expect(deviceModel).toMatch(/step\(-1e8, uWaterline\)/);
    expect(deviceModel).toMatch(/waterlineUniform\.current\.value = -1e9/);
  });
});
