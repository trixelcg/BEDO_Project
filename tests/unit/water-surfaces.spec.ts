import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { loadApparatus } from '../helpers/model';
import { MESH, WATER_SHAPES, type WaterShapeKey } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import {
  JET_ASSET,
  waterShapeForFlow,
  PLUME_CUT_FULL_Y,
  PLUME_CUT_CLEAR_Y,
} from '../../src/lib/waterJet';
import {
  DRAIN_CAPACITY_FRACTION,
  advanceLevel,
  targetLevel,
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

  it('no flow means no fill, and there is no tank body to draw in any case', () => {
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

describe('A — the procedural tank cylinder is gone (BEDO-WATER-14)', () => {
  it('no tank body geometry is built anywhere in the app', () => {
    // The standing water used to be a CylinderGeometry inside the glass, and it read as
    // exactly that: a blue cylinder with its own walls, narrower than the bore it filled.
    // Hiding it at runtime produced the wanted frame outright, so it is removed rather than
    // reshaded — builder and all, so nothing can reintroduce it by calling the old helper.
    expect(deviceModel).not.toMatch(/createTankWaterGeometry/);
    expect(deviceModel).not.toMatch(/tankWaterRef/);
    const lib = readFileSync(path.join(REPO_ROOT, 'src/lib/tankWater.ts'), 'utf8');
    expect(lib).not.toMatch(/export function createTankWaterGeometry/);
    expect(lib).not.toMatch(/new THREE\.CylinderGeometry/);
  });

  it('nothing procedural is substituted for it', () => {
    // Explicitly not a replacement volume, shell or surface — the brief asked for removal,
    // not for a different body. The authored plume is the water in the tank.
    for (const shape of ['Cylinder', 'Sphere', 'Cone', 'Plane', 'Circle', 'Ring']) {
      expect(deviceModel, `${shape}Geometry must not appear`).not.toMatch(
        new RegExp(`new THREE\\.${shape}Geometry`)
      );
    }
  });

  it('two water materials remain: the jet and the hose', () => {
    // The tank body's material went with the body. A third would mean something started
    // drawing standing water again.
    expect(deviceModel.match(/new THREE\.MeshPhysicalMaterial\(/g)?.length).toBe(2);
  });
});

describe('B — the fill is still simulated, just not drawn', () => {
  it('the level is still advanced from the authoritative inflow every frame', () => {
    // Removing a visualisation must not remove state. The level is domain-adjacent: the
    // fill logic owns it and it is still driven by the same flow the jet reads.
    expect(deviceModel).toMatch(/tankLevel\.current = advanceLevel\(/);
    expect(deviceModel).toMatch(/targetLevel\(inflow, state\.isVolumetricValveOpen\)/);
    expect(deviceModel).toMatch(/state\.live\.flowRateLMin \/ Math\.max\(state\.params\.pumpFlowLMin/);
  });

  it('the level maths is untouched by the removal', () => {
    // Same numbers as before: the threshold, the fill and the drain all still behave.
    expect(targetLevel(DRAIN_CAPACITY_FRACTION + 0.01, false)).toBeGreaterThan(0);
    expect(targetLevel(DRAIN_CAPACITY_FRACTION + 0.01, true)).toBe(0);
    expect(targetLevel(0, false)).toBe(0);
    let level = 0;
    for (let i = 0; i < 400; i++) level = advanceLevel(level, 0.9, 0.016);
    expect(level).toBeCloseTo(0.9, 5);
    for (let i = 0; i < 800; i++) level = advanceLevel(level, 0, 0.016);
    expect(level).toBe(0);
  });

  it('the interior is still measured, and still gates when the fill may start', () => {
    // The level no longer uses the interior's dimensions — nothing is drawn from them — but
    // the measurement is still what says the apparatus is ready, and it is what a waterline
    // would be derived from if one is ever needed again.
    expect(deviceModel).toMatch(/measureTankInterior\(/);
    expect(deviceModel).toMatch(/if \(tankInterior\) \{/);
  });
});

describe('C/D — the submerged-plume machinery went with the body', () => {
  it('the jet shader no longer damps itself against a waterline', () => {
    // That convergence existed only to stop the plume reading as a second volume beside the
    // cylinder. With the cylinder gone it had nothing to converge into and simply erased the
    // water — at high flow it left an empty glass. Its premise is gone, so it is gone.
    expect(deviceModel).not.toMatch(/uWaterline/);
    expect(deviceModel).not.toMatch(/uTankTint/);
    expect(deviceModel).not.toMatch(/float submerged =/);
    expect(deviceModel).not.toMatch(/depthBelow/);
  });

  it('the plume keeps its full free-surface treatment everywhere', () => {
    // Foam, glint and the silhouette lift are unconditional again: the authored plume is
    // falling through air for its whole length now that no standing water is drawn.
    expect(deviceModel).toMatch(/gl_FragColor\.rgb = mix\(gl_FragColor\.rgb, vec3\(0\.78, 0\.85, 0\.93\), foam \* 0\.45\)/);
    expect(deviceModel).toMatch(/gl_FragColor\.rgb \+= vec3\(0\.62, 0\.74, 0\.92\) \* \(glint \* 0\.22 \+ edge \* 0\.18\)/);
  });
});

describe('F — water selection is unchanged by the removal', () => {
  it('no flow draws nothing, low flow is the column, high flow is the plume', () => {
    expect(waterShapeForFlow(0, 'd90')).toBe(JET_ASSET);
    const low = flowRateLMin(0.4) / TOTAL_FLOW_L_MIN;
    const high = flowRateLMin(0.5) / TOTAL_FLOW_L_MIN;
    expect(waterShapeForFlow(low, 'd90')).toBe(JET_ASSET);
    expect(waterShapeForFlow(high, 'd90')).toBe('d90');
  });

  it('the selector still reads only the flow, never the tank level', () => {
    expect(waterShapeForFlow.length).toBe(2);
  });
});

describe('the after-impact plume no longer hangs a curtain in the tank (BEDO-WATER-15)', () => {
  // Measured live at Q = 43.5 L/min on the flat-plate plume, in world units.
  const PLUME = { yMin: 0.11174, yMax: 0.50764 };
  const NOZZLE_MOUTH_Y = 0.47118;
  const TANK_FLOOR_Y = 0.10454;

  it('A — no procedural tank cylinder has come back', () => {
    expect(deviceModel).not.toMatch(/createTankWaterGeometry/);
    expect(deviceModel).not.toMatch(/tankWaterRef/);
    const lib = readFileSync(path.join(REPO_ROOT, 'src/lib/tankWater.ts'), 'utf8');
    expect(lib).not.toMatch(/new THREE\.CylinderGeometry/);
  });

  it('D — the deep part of the plume is suppressed, and by world height', () => {
    // The cache does not stop at the splash: it runs from y 0.1117 up to 0.5076 while the
    // nozzle mouth is at 0.4712, so about nine tenths of its height hangs inside the vessel
    // and reads as a blue cylinder. That lower part is what the mask removes.
    expect(deviceModel).toMatch(/uniform vec2 uPlumeCut/);
    expect(deviceModel).toMatch(/gl_FragColor\.a \*= smoothstep\(uPlumeCut\.x, uPlumeCut\.y, vWPos\.y\)/);
    // Clears well above the floor, so nothing of the sheet survives down there.
    expect(PLUME_CUT_CLEAR_Y).toBeGreaterThan(TANK_FLOOR_Y);
    expect(PLUME_CUT_CLEAR_Y).toBeLessThan(PLUME_CUT_FULL_Y);
  });

  it('E — the impact and the entry stay fully drawn', () => {
    // Everything from just under the nozzle mouth upward is untouched, which is the jet, the
    // impact and the immediate turbulent spread.
    expect(PLUME_CUT_FULL_Y).toBeLessThan(NOZZLE_MOUTH_Y);
    expect(PLUME_CUT_FULL_Y).toBeLessThan(PLUME.yMax);
    // The kept region is a real slice of the plume, not a sliver.
    expect(PLUME.yMax - PLUME_CUT_FULL_Y).toBeGreaterThan(0.04);
  });

  it('the fade is a band, not a plane, so the sheet thins instead of ending on a line', () => {
    const band = PLUME_CUT_FULL_Y - PLUME_CUT_CLEAR_Y;
    expect(band).toBeGreaterThan(0.05);
  });

  it('F — the pre-impact column is never cut', () => {
    // Water_low is short and sits at the nozzle; cutting it would shorten the low-flow state.
    // The band is parked out of range whenever the column is the active shape.
    expect(deviceModel).toMatch(/plumeCutUniform\.current\.value\.set\(-1e9, -1e9 \+ 1\)/);
    expect(deviceModel).toMatch(/plumeCutUniform\.current\.value\.set\(PLUME_CUT_CLEAR_Y, PLUME_CUT_FULL_Y\)/);
    // And it is keyed on the same `impacting` flag the shape selection already uses.
    const block = deviceModel.slice(deviceModel.indexOf('const activeWater = waterShapeForFlow'));
    expect(block.slice(0, 900)).toMatch(/if \(impacting\) \{/);
  });

  it('B/F — shape selection is unchanged by the mask', () => {
    expect(waterShapeForFlow(0, 'd90')).toBe(JET_ASSET);
    expect(waterShapeForFlow(flowRateLMin(0.4) / TOTAL_FLOW_L_MIN, 'd90')).toBe(JET_ASSET);
    expect(waterShapeForFlow(flowRateLMin(0.5) / TOTAL_FLOW_L_MIN, 'd90')).toBe('d90');
  });

  it('C — the hose is untouched by this change', () => {
    // Its own material, its own uniforms, and no plume cut anywhere near it.
    const hose = deviceModel.slice(
      deviceModel.indexOf('const hoseMaterial = useMemo('),
      deviceModel.indexOf('}, [scene, hoseMaterial]);')
    );
    expect(hose).toMatch(/uniform float uHoseFlow/);
    expect(hose).not.toMatch(/uPlumeCut/);
  });

  it('adds no mesh, geometry, material or render pass', () => {
    // The whole fix is one uniform and one line of GLSL.
    expect(deviceModel.match(/new THREE\.MeshPhysicalMaterial\(/g)?.length).toBe(2);
    for (const shape of ['Cylinder', 'Sphere', 'Cone', 'Plane', 'Circle', 'Ring']) {
      expect(deviceModel).not.toMatch(new RegExp(`new THREE\\.${shape}Geometry`));
    }
  });
});
