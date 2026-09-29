import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { loadApparatus } from '../helpers/model';
import { MISMATERIALLED_HOSE, MESH, SUPPLY_HOSE } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import { CONDUIT_REFERENCE_SPEED, measureConduit } from '../../src/lib/waterMaterial';

/**
 * Water in the supply hose (BEDO-WATER-12).
 *
 * ## What this exists to settle
 *
 * `Line010` is the feed hose into the tank base. The GLB gives it `Galss_Material` — the
 * tank cylinder's material — whose only route to translucency is a `baseColorFactor` alpha
 * of 0.10 blended flat and double-sided. That has no edge definition, so a 620 mm tube seen
 * near edge-on composited into a broad featureless smear across the bench.
 *
 * MODEL-01 answered that by making the hose opaque. It removed the smear and was wrong
 * about the part: `Bedo_Mesu_J.mp4` at t = 74 s shows this hose as a translucent tube with
 * a blue-grey water-filled interior and bright specular highlights along both edges. It
 * carries the water and the reference lets you see it.
 *
 * So the hose gets a hose material: water in glass, with a Fresnel rim that draws the tube's
 * own silhouette, and an interior fill driven by the authoritative flow. The geometry is
 * untouched — the water is shaded *inside the authored tube*, so its curvature, bore and
 * transform are exactly the model's and cannot drift.
 *
 * The shader cannot run under vitest, so what is checked here is that the mechanism exists,
 * is driven by the real flow, and reuses the hose's own geometry rather than inventing a
 * second one.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const deviceModel = readFileSync(
  path.join(REPO_ROOT, 'src/components/DeviceModel.tsx'),
  'utf8'
);
/** Since 2026-09-28 the hose and the jet share one water material. */
const waterMaterial = readFileSync(path.join(REPO_ROOT, 'src/lib/waterMaterial.ts'), 'utf8');

/** The hose material block, isolated so assertions cannot match the jet's shader by accident. */
const hoseBlock = deviceModel.slice(
  deviceModel.indexOf('const hoseMaterial = useMemo('),
  deviceModel.indexOf('}, [scene, hoseMaterial]);')
);

let app: THREE.Group;
beforeAll(async () => {
  app = await loadApparatus();
}, 120000);

describe('E/F — hose water follows the authoritative flow', () => {
  it('the hose wears the shared water material, as a conduit', () => {
    // One substance for the whole circuit: the jet is the same material as a stream.
    expect(hoseBlock).toMatch(/createWaterMaterial\(waterTex, hoseUniforms, 'conduit'\)/);
  });

  it('its water moves at Q / A through the bore, and only while the pump delivers', () => {
    // The clock advances at the water's speed in the bore, and not at all without flow.
    expect(deviceModel).toMatch(/hose\.speed = state\.live\.flowRateM3S \/ Math\.max\(bore, 1e-9\)/);
    // Its pattern is carried at that speed, held to a pace the eye can follow.
    expect(deviceModel).toMatch(/hoseUniforms\.uClock\.value \+= \(flowing \? conduitPatternSpeed\(hose\.speed\) : 0\)/);
    expect(deviceModel).toMatch(/hoseUniforms\.uFlow\.value = flowing \? state\.valveOpening/);
  });

  it('it fills from the pump end when the flow starts and empties from it when it stops', () => {
    expect(deviceModel).toMatch(/hose\.head = Math\.min\(hose\.head \+ \(hose\.speed \* rawDelta\)/);
    expect(deviceModel).toMatch(/if \(hose\.tail >= 0\) hose\.tail \+=/);
    // In the shader: water only between the tail and the head; the tube itself always.
    expect(waterMaterial).toMatch(/float present = step\(vFlowUv\.y, uHead\) \* step\(uTail, vFlowUv\.y\);/);
    // How much water the light crosses: the bore when it is full, the plastic wall when not.
    // A supply line under mains pressure stands full when nothing flows (uFill).
    expect(waterMaterial).toMatch(/waterThickness = mix\(0\.0015, waterThickness, present \* max\(clamp\(uFlow \* 3\.0, 0\.0, 1\.0\), uFill\)\);/);
  });

  it('shares the jet’s ripple texture, so the circuit is one substance', () => {
    expect(hoseBlock).toMatch(/waterTex/);
    expect(deviceModel).toMatch(/createJetFlowMaterial\(waterTex, jetFlowUniforms\)/);
  });
});

describe('G/H — the water is inside the hose by construction', () => {
  it('the hose mesh keeps its own geometry — no second tube is built', () => {
    // The strongest guarantee available: the water is shaded on the authored mesh, so it
    // cannot leave the bore, miss the curvature or drift from the scene transform.
    expect(hoseBlock).not.toMatch(/new THREE\.(Tube|Cylinder|Capsule|Torus)Geometry/);
    const assign = deviceModel.slice(
      deviceModel.indexOf('const target = gltfName(MISMATERIALLED_HOSE)'),
      deviceModel.indexOf('}, [scene, hoseMaterial]);')
    );
    expect(assign).toMatch(/child\.material = hoseMaterial/);
    expect(assign).not.toMatch(/child\.geometry\s*=/);
    expect(assign).not.toMatch(/\.position\.set|\.scale\.set|\.rotation\./);
  });

  it('the flow coordinate is measured off the mesh, along the tube, not assumed', () => {
    expect(hoseBlock).toMatch(/measureConduit\(child,/);
    // On the shipped hose: distance from the pump end, round its bend.
    const hose = (app.getObjectByName(gltfName(MISMATERIALLED_HOSE)) as THREE.Mesh).clone();
    hose.geometry = hose.geometry.clone();
    const conduit = measureConduit(hose)!;
    expect(conduit).not.toBeNull();
    const box = new THREE.Box3().setFromObject(hose);
    const size = box.getSize(new THREE.Vector3());
    // Longer than any straight span of its box — it follows the bend.
    expect(conduit.length).toBeGreaterThan(Math.max(size.x, size.y, size.z));
    // A hose bore, not a pipe or a thread.
    expect(conduit.radius).toBeGreaterThan(0.004);
    expect(conduit.radius).toBeLessThan(0.03);
    const uv = hose.geometry.getAttribute('aFlowUv');
    const position = hose.geometry.getAttribute('position');
    hose.updateWorldMatrix(true, false);
    const worldY = (i: number) =>
      new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(hose.matrixWorld).y;
    let lowest = 0;
    for (let i = 1; i < position.count; i++) if (worldY(i) < worldY(lowest)) lowest = i;
    // Zero at the pump end — counted from a cut square across the tube there, so the
    // lowest point of that end sits within a centimetre of it — rising to the length at
    // the other.
    let start = Infinity;
    for (let i = 0; i < uv.count; i++) start = Math.min(start, uv.getY(i));
    expect(start).toBeCloseTo(0, 6);
    expect(uv.getY(lowest)).toBeLessThan(0.02);
    let far = 0;
    let aroundMin = 1;
    let aroundMax = 0;
    for (let i = 0; i < uv.count; i++) {
      far = Math.max(far, uv.getY(i));
      aroundMin = Math.min(aroundMin, uv.getX(i));
      aroundMax = Math.max(aroundMax, uv.getX(i));
    }
    expect(far).toBeCloseTo(conduit.length / CONDUIT_REFERENCE_SPEED, 6);
    // And all the way round.
    expect(aroundMin).toBeLessThan(0.1);
    expect(aroundMax).toBeGreaterThan(0.9);
  });

  it('the hose is a real tube in the shipped model, and not the tank', () => {
    const hose = app.getObjectByName(gltfName(MISMATERIALLED_HOSE)) as THREE.Mesh | undefined;
    const tank = app.getObjectByName(gltfName(MESH.tank)) as THREE.Mesh | undefined;
    expect(hose, 'Line010 must exist for this correction to mean anything').toBeTruthy();
    expect(tank).toBeTruthy();

    const hoseBox = new THREE.Box3().setFromObject(hose!);
    const tankBox = new THREE.Box3().setFromObject(tank!);
    const h = hoseBox.getSize(new THREE.Vector3());
    // A long thin run, not a vessel: its longest axis dominates its shortest several times.
    expect(Math.max(h.x, h.y, h.z) / Math.max(Math.min(h.x, h.y, h.z), 1e-9)).toBeGreaterThan(2);
    // And it stands clear of the tank, which is why it was never the vessel's "base ring".
    const hc = hoseBox.getCenter(new THREE.Vector3());
    const tc = tankBox.getCenter(new THREE.Vector3());
    expect(Math.hypot(hc.x - tc.x, hc.z - tc.z)).toBeGreaterThan(0.1);
  });

  it('the hose carries no UVs, which is why the donor material had to be texture-free', () => {
    // Recorded because it constrains any future material choice for this mesh: a map would
    // sample a single texel and read as a flat wash.
    const hose = app.getObjectByName(gltfName(MISMATERIALLED_HOSE)) as THREE.Mesh;
    expect(hose.geometry.getAttribute('uv')).toBeUndefined();
  });
});

describe('the hose is no longer drawn as tank glass', () => {
  it('it gets its own material rather than the shared Galss_Material instance', () => {
    // The loader hands the tank and the hose one instance, so the correction must replace
    // the mesh's reference. Mutating the material would take the tank's glass with it.
    expect(deviceModel).toMatch(/child\.material = hoseMaterial/);
    const assign = deviceModel.slice(
      deviceModel.indexOf('const target = gltfName(MISMATERIALLED_HOSE)'),
      deviceModel.indexOf('}, [scene, hoseMaterial]);')
    );
    expect(assign).not.toMatch(/Galss|\.opacity\s*=|\.transparent\s*=/);
  });

  it('the tube draws its own silhouette, which is what the flat 0.10 blend could not', () => {
    // The ghost was a missing rim, not the transparency. Without this term the fix regresses
    // to a smear the moment opacity is lowered again.
    expect(waterMaterial).toMatch(/float wall = pow\(1\.0 - cosView, 3\.0\);/);
    expect(waterMaterial).toMatch(/vec3\(0\.70, 0\.77, 0\.86\) \* wall \* 0\.25/);
  });
});

describe('the supply hose from the wall tap carries the same water', () => {
  it('wears the water material over a smoked wall, stands full, and runs with the pump', () => {
    expect(deviceModel).toMatch(/createWaterMaterial\(waterTex, supplyUniforms, 'conduit', CONDUIT_WALLS\.smoked\)/);
    // A line under mains pressure: full of still water when nothing flows.
    expect(deviceModel).toMatch(/u\.uFill\.value = 1;/);
    // Q / A through its own bore, only while the pump delivers.
    expect(deviceModel).toMatch(/const speed = flowing \? state\.live\.flowRateM3S \/ Math\.max\(bore, 1e-9\) : 0;/);
  });

  it('its water runs from the tap towards the bench', () => {
    const hose = (app.getObjectByName(gltfName(SUPPLY_HOSE)) as THREE.Mesh).clone();
    const tap = app.getObjectByName('Cold_Tab_003');
    expect(hose, 'the supply hose must exist for this to mean anything').toBeTruthy();
    expect(tap).toBeTruthy();
    hose.geometry = hose.geometry.clone();
    const conduit = measureConduit(hose)!;
    expect(conduit).not.toBeNull();
    const uv = hose.geometry.getAttribute('aFlowUv');
    const position = hose.geometry.getAttribute('position');
    hose.updateWorldMatrix(true, false);
    const tapAt = new THREE.Box3().setFromObject(tap!).getCenter(new THREE.Vector3());
    let nearest = 0;
    let farthest = 0;
    const d = (i: number) =>
      new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(hose.matrixWorld).distanceTo(tapAt);
    for (let i = 1; i < position.count; i++) {
      if (d(i) < d(nearest)) nearest = i;
      if (d(i) > d(farthest)) farthest = i;
    }
    // Zero at the tap, the whole length at the bench.
    expect(uv.getY(nearest)).toBeLessThan(conduit.length * 0.05);
    expect(uv.getY(farthest)).toBeGreaterThan(conduit.length * 0.9);
  });
});
