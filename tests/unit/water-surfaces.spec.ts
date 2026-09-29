import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { loadApparatus } from '../helpers/model';
import { MESH, WATER_SHAPES } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import {
  DRAIN_CAPACITY_FRACTION,
  advanceLevel,
  targetLevel,
} from '../../src/lib/tankWater';
import { flowRateLMin } from '../../src/domain/physics';

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
/** Since F08 the water is drawn from `src/lib/jetFlowMesh.ts` (`docs/57`). */
const jetFlowMesh = readFileSync(path.join(REPO_ROOT, 'src/lib/jetFlowMesh.ts'), 'utf8');
/** The shared water material the jet and the hose wear (`src/lib/waterMaterial.ts`). */
const waterMaterial = readFileSync(path.join(REPO_ROOT, 'src/lib/waterMaterial.ts'), 'utf8');

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

  it('no flow draws no water at all, rather than a fallback shape', () => {
    // F08: the water is one path computed from the flow. With no flow there is no path —
    // `buildJetPath` returns no points for a zero velocity — and the frame loop hides it.
    expect(deviceModel).toMatch(/const flowing = state\.isPowerOn && state\.valveOpening > 0\.05 && !state\.isCoverOpen;/);
  });

  it('the water and the pool are hidden on the branch taken when nothing flows', () => {
    // `flowing` (or water still falling after the flow stopped) gates the whole water block.
    // The else-branch must hide both — this is what makes "pump off -> no mesh" true.
    const elseBranch = deviceModel.slice(
      deviceModel.indexOf('const flowing = state.isPowerOn')
    );
    expect(/jetFlowMesh\.visible = false/.test(elseBranch)).toBe(true);
    expect(/if \(poolMesh\) poolMesh\.visible = false/.test(elseBranch)).toBe(true);
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

  it('the authored caches are still shipped, and no longer drawn (F08)', () => {
    // Kept as source material; the water is computed from state instead (`docs/57`).
    expect(Object.keys(WATER_SHAPES).length).toBe(8);
    expect(deviceModel).not.toMatch(/WATER_SHAPES/);
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

describe('F — the water is owned by the flow, not by the tank surface', () => {
  it('the path reads the flow, the fitted deflector and the carrier — never the tank level', () => {
    // Filling or draining the tank cannot add, remove or bend the incoming water.
    const block = deviceModel.slice(deviceModel.indexOf('buildJetPaths({'));
    const call = block.slice(0, block.indexOf('})\n        : lastPathRef'));
    expect(call).toMatch(/state\.live\.nozzleVelocityMS/);
    expect(call).toMatch(/state\.live\.flowRateM3S/);
    expect(call).not.toMatch(/tankLevel/);
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
    // Explicitly not a replacement volume, shell or surface. Since F08 the only water drawn
    // is the path from the nozzle and the film it lands in on the floor (2 mm, `POOL_DEPTH_M`)
    // — built in `jetFlowMesh.ts`, never a body standing in the glass.
    for (const shape of ['Cylinder', 'Sphere', 'Cone', 'Plane', 'Circle', 'Ring']) {
      expect(deviceModel, `${shape}Geometry must not appear`).not.toMatch(
        new RegExp(`new THREE\\.${shape}Geometry`)
      );
    }
    expect(jetFlowMesh).not.toMatch(/CylinderGeometry/);
  });

  it('water materials: the shared water (jet and hose) and the floor film', () => {
    // A third would mean something started drawing standing water again.
    expect(deviceModel.match(/new THREE\.MeshPhysicalMaterial\(/g)).toBeNull();
    expect(waterMaterial.match(/new THREE\.MeshPhysicalMaterial\(/g)?.length).toBe(1);
    expect(jetFlowMesh.match(/new THREE\.MeshPhysicalMaterial\(/g)?.length).toBe(1);
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

  it('the water keeps its free-surface treatment everywhere', () => {
    // Foam and glint are unconditional: the water falls through air for its whole length.
    // Reflection is added on top and never scaled away; air whitens the body.
    expect(waterMaterial).toMatch(/premultipliedAlpha: true/);
    expect(waterMaterial).toMatch(/gl_FragColor = vec4\(reflection \+ colour \* a \+ flowLight \* isFilm, a\);/);
    // A body of water (the jet, the film over the deflector) is refracted and whitened by air.
    // Refracted and reflected (lit), given its own lit body, then whitened by air (lit
    // foam, not a self-lit white).
    expect(waterMaterial).toMatch(/vec3 water = mix\(lit \* \(1\.0 \+ 0\.45 \* waterCrest\), bodyB,/);
    expect(waterMaterial).toMatch(/water = mix\(water, vec3\(0\.9, 0\.94, 0\.97\) \* waterLight, clamp\(aeration \* 1\.3, 0\.0, 1\.0\)\);/);
    expect(waterMaterial).toMatch(/mix\(bodyColour, vec3\(0\.9, 0\.94, 0\.97\) \* waterLight, clamp\(aeration \* 1\.4, 0\.0, 1\.0\)\)/);
    expect(waterMaterial).not.toMatch(/uWaterline|submerged/);
  });
});

describe('the water no longer hangs a curtain in the tank, nor fades out in mid-air (F08)', () => {
  it('A — no procedural tank cylinder has come back', () => {
    expect(deviceModel).not.toMatch(/createTankWaterGeometry/);
    expect(deviceModel).not.toMatch(/tankWaterRef/);
    const lib = readFileSync(path.join(REPO_ROOT, 'src/lib/tankWater.ts'), 'utf8');
    expect(lib).not.toMatch(/new THREE\.CylinderGeometry/);
  });

  it('D — no height band cuts the water: it runs to the floor and ends there', () => {
    // BEDO-WATER-15 hid the authored caches' lower sheet with a world-height fade, which
    // ended the water in mid-air. The computed path ends in the floor film instead
    // (`tests/unit/f08-acceptance.spec.ts` AC5), so there is nothing to fade.
    expect(deviceModel).not.toMatch(/uPlumeCut|PLUME_CUT/);
    expect(jetFlowMesh).not.toMatch(/uPlumeCut/);
    expect(waterMaterial).not.toMatch(/uPlumeCut/);
  });

  it('water running down the glass is a clear film, not a tinted body', () => {
    // What BEDO-WATER-14 removed must not come back as a wall film: run-off is drawn as
    // rivulets and highlights over nearly clear water.
    // A film a fraction of a millimetre thick absorbs next to nothing (Beer–Lambert on its
    // own thickness); what shows is rivulets and a dimmed reflection.
    // Absorption through the layer's own thickness, along the line of sight, and run-off
    // carrying no body between its rivulets.
    expect(waterMaterial).toMatch(/\(t \/ max\(cosView, 0\.18\)\)/);
    expect(waterMaterial).toMatch(/\* \(1\.0 - isRunoff\)/);
    expect(waterMaterial).toMatch(/\+ isRunoff \* \(0\.02 \+ rivulet \* 0\.28/);
    // A sheet is never more than a couple of millimetres thick.
    expect(waterMaterial).toMatch(/clamp\(vFlowData\.x, 0\.0, 0\.002\)/);
  });

  it('C — the hose wears the same water, as a conduit, with no fade band', () => {
    const hose = deviceModel.slice(
      deviceModel.indexOf('const hoseMaterial = useMemo('),
      deviceModel.indexOf('}, [scene, hoseMaterial]);')
    );
    expect(hose).toMatch(/createWaterMaterial\(waterTex, hoseUniforms, 'conduit'\)/);
    expect(hose).not.toMatch(/uPlumeCut/);
  });

  it('the fill still follows the flow the water is drawn from', () => {
    expect(targetLevel(flowRateLMin(0.5) / 120, false)).toBeGreaterThan(0);
    expect(DRAIN_CAPACITY_FRACTION).toBeGreaterThan(0);
  });
});
