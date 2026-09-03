import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { loadApparatus } from '../helpers/model';
import { MISMATERIALLED_HOSE, MESH } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';

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
  it('the hose shader is driven by a flow uniform, not by a free-running clock', () => {
    expect(hoseBlock).toMatch(/uniform float uHoseFlow/);
    expect(hoseBlock).toMatch(/shader\.uniforms\.uHoseFlow = hoseFlow\.current/);
  });

  it('that uniform is the valve opening, and is zeroed when nothing flows', () => {
    // Same authority the jet reads. A dry rig must show a dry hose — the brief forbids
    // inventing startup flow, and equally forbids a hose that runs while the pump is off.
    expect(deviceModel).toMatch(/hoseFlow\.current\.value = state\.valveOpening/);
    expect(deviceModel).toMatch(/hoseFlow\.current\.value = 0/);
  });

  it('every water cue in the hose is multiplied by flow, so Q=0 leaves nothing moving', () => {
    // The fill, the travelling shimmer and the opacity lift all carry the factor. If any one
    // of them did not, an idle hose would still look wet.
    expect(hoseBlock).toMatch(/float flow = clamp\(uHoseFlow \* 1\.5, 0\.0, 1\.0\)/);
    expect(hoseBlock).toMatch(/mix\(gl_FragColor\.rgb \* 0\.85 \+ vec3\(0\.06\), filled, flow\)/);
    expect(hoseBlock).toMatch(/travel \* 0\.10 \* flow/);
    expect(hoseBlock).toMatch(/flow \* 0\.10/);
  });

  it('it shares the jet clock and ripple texture, so the circuit is one substance', () => {
    expect(hoseBlock).toMatch(/shader\.uniforms\.uTime = waterTime\.current/);
    expect(hoseBlock).toMatch(/shader\.uniforms\.uWaterTex = \{ value: waterTex \}/);
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

  it('the flow coordinate is measured off the mesh, not assumed', () => {
    // A hardcoded span would silently desync if the model moved.
    expect(deviceModel).toMatch(/new THREE\.Box3\(\)\.setFromObject\(child\)/);
    expect(deviceModel).toMatch(/hoseSpanUniform\.current\.value\.set\(box\.min\.y, box\.max\.y\)/);
    expect(hoseBlock).toMatch(/uniform vec2 uHoseSpan/);
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
    expect(hoseBlock).toMatch(/float rim = pow\(1\.0 - cosView, 3\.0\)/);
    expect(hoseBlock).toMatch(/rim \* 0\.55/);
  });
});
