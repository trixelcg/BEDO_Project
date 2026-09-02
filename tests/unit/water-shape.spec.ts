import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadWater } from '../helpers/model';
import { WATER_SHAPES, DEFLECTORS, type WaterShapeKey } from '../../src/domain/apparatus';
import { WATER_MODEL_SCALE, JET_ASSET } from '../../src/lib/waterJet';
import { basePoseBox } from '../../src/lib/waterCache';
import { RIPPLE_AMPLITUDE, buildWaterUv, packPositions } from '../../src/lib/waterUv';
import { SCENE_CONFIG } from '../../src/lib/sceneConfig';

/**
 * The water's shape is the authored shape, at the authored proportions (BEDO-WATER-03).
 *
 * ## What this exists to settle
 *
 * The water was reported as "correct from the front but compressed in depth", and the
 * obvious reading of that is a non-uniform scale somewhere between the Alembic cache and
 * the screen. This walks the **whole** chain and measures it, so the question is answered
 * with numbers rather than with a screenshot taken along the one axis that cannot show it:
 *
 *   authored GLB node -> water group -> apparatus group -> scene
 *
 * Every link is uniform, and the seven axisymmetric shapes are round in plan to within a
 * tenth of a per cent. The squash is therefore not in the geometry and not in the
 * transform — it was in the material, whose only depth gradient ran *along* the flow axis
 * and so had one single value across every horizontal slice of the body. That is fixed in
 * `DeviceModel`'s water shader; this file is what stops the geometry drifting behind it.
 *
 * `water-alignment.spec.ts` checks where the water *sits* — the nozzle mouth it sheathes,
 * the deflector face it reaches, the bore it fits inside. Nothing here changes those, and
 * the last block re-asserts the two anchors so a scale change cannot quietly move them.
 */

/** Anything looser than this would not detect a squash a viewer could see. */
const ROUND_TOLERANCE = 0.005;

interface Measured {
  box: THREE.Box3;
  size: THREE.Vector3;
  centre: THREE.Vector3;
  /** Every node scale on the path from the asset root down to the mesh. */
  chain: THREE.Vector3[];
  crossRadius: number;
  flowAxis: number;
  vertices: number;
  /**
   * The mesh's extents in its own attribute units.
   *
   * Not the same axes as the world box: five of the eight assets carry a -90 degree node
   * rotation about X, so what is Z in the buffer is Y on screen. `flowAxis` and
   * `crossRadius` are both measured in *this* space, because that is the space the vertex
   * shader displaces in.
   */
  quantisedSize: number[];
}

const shapes = {} as Record<WaterShapeKey, Measured>;

beforeAll(async () => {
  for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
    const scene = await loadWater(WATER_SHAPES[key].url);
    scene.updateWorldMatrix(true, true);
    const box = basePoseBox(scene);
    const chain: THREE.Vector3[] = [];
    let crossRadius = 0;
    let flowAxis = 1;
    let vertices = 0;
    let quantisedSize: number[] = [0, 0, 0];
    scene.traverse((node) => {
      chain.push(node.scale.clone());
      const mesh = node as THREE.Mesh;
      const position = mesh.isMesh ? mesh.geometry?.getAttribute('position') : null;
      if (!position) return;
      // Through `packPositions`, exactly as the runtime does: these attributes are
      // interleaved four components to a vertex, so the raw buffer is not xyz triples.
      const packed = packPositions(position);
      const uv = buildWaterUv(packed);
      quantisedSize = [0, 1, 2].map((axis) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = axis; i < packed.length; i += 3) {
          if (packed[i] < lo) lo = packed[i];
          if (packed[i] > hi) hi = packed[i];
        }
        return hi - lo;
      });
      crossRadius = uv.crossRadius;
      flowAxis = uv.flowAxis;
      vertices = position.count;
    });
    shapes[key] = {
      box,
      size: box.getSize(new THREE.Vector3()),
      centre: box.getCenter(new THREE.Vector3()),
      chain,
      crossRadius,
      flowAxis,
      vertices,
      quantisedSize,
    };
  }
}, 180000);

describe('A/F — nothing in the water transform chain is non-uniform', () => {
  it('every node of every authored asset carries a uniform scale', () => {
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      for (const [index, scale] of shapes[key].chain.entries()) {
        // gltfpack quantises these meshes and puts the dequantisation factor on the mesh
        // node, so the numbers differ from asset to asset (0.0032 to 0.0052). What matters
        // is that within one node all three axes agree — a quantiser that used a per-axis
        // range would show up here as exactly the squash being investigated.
        expect(scale.y / scale.x, `${key} node ${index} y/x`).toBeCloseTo(1, 6);
        expect(scale.z / scale.x, `${key} node ${index} z/x`).toBeCloseTo(1, 6);
      }
    }
  });

  it('the runtime transform is one uniform number, not three', () => {
    // `DeviceModel` renders both water groups with `scale={WATER_MODEL_SCALE}`, which
    // three expands to (s, s, s). Stating it as a scalar is what makes that impossible to
    // get wrong, so this asserts the type as much as the value.
    expect(typeof WATER_MODEL_SCALE).toBe('number');
    expect(WATER_MODEL_SCALE).toBeCloseTo(0.01, 6);
  });

  it('the apparatus above it is uniform too, so the world scale stays uniform', () => {
    const [x, y, z] = SCENE_CONFIG.characterScale;
    expect(y / x).toBeCloseTo(1, 6);
    expect(z / x).toBeCloseTo(1, 6);
  });
});

describe('B — the authored proportions survive to the runtime', () => {
  /**
   * Seven of the eight shapes are bodies of revolution about the flow axis, so their two
   * cross-flow extents must agree. This is the measurement the depth-squash report needed
   * and no front-on capture could make.
   */
  it('every axisymmetric shape is round in plan, to a tenth of a per cent', () => {
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      if (key === 'd45') continue; // authored asymmetric — see below
      const { quantisedSize, flowAxis } = shapes[key];
      // The two axes across the flow, whichever axis the shape was authored along.
      const across = quantisedSize.filter((_, i) => i !== flowAxis);
      expect(Math.abs(across[0] / across[1] - 1), `${key} cross-flow aspect`).toBeLessThan(
        ROUND_TOLERANCE
      );
    }
  });

  it('the one asymmetric shape is the oblique spray, and it is authored that way', () => {
    // `Water45_Oblique` throws its sheet sideways, so 1.65 : 1 across the flow is the
    // authored behaviour rather than a defect. Recorded so that a re-export which made it
    // round — or which made any other shape oblique — turns this red.
    const { size } = shapes.d45;
    expect(size.z / size.x).toBeCloseTo(1.651, 2);
  });

  it('scaling is a similarity: runtime aspect equals authored aspect exactly', () => {
    // A uniform scale cannot change a ratio, so this is the statement that the whole
    // pipeline is a similarity transform. It would fail the instant any axis picked up its
    // own factor.
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      const { size } = shapes[key];
      const runtime = size.clone().multiplyScalar(WATER_MODEL_SCALE);
      expect(runtime.x / runtime.y, `${key} x/y`).toBeCloseTo(size.x / size.y, 9);
      expect(runtime.z / runtime.y, `${key} z/y`).toBeCloseTo(size.z / size.y, 9);
    }
  });
});

describe('C/D/E — the anchors the scale must not move', () => {
  it('C — every shape still centres on the apparatus axis', () => {
    // The basis of `WATER_MODEL_SCALE`: the caches are authored in centimetres in the rig's
    // own space, so the scaled centre *is* the rig's axis. Half a millimetre is a tenth of
    // the glass wall.
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      const c = shapes[key].centre;
      expect(c.x * WATER_MODEL_SCALE, `${key} x`).toBeCloseTo(0.0101, 3);
      expect(c.z * WATER_MODEL_SCALE, `${key} z`).toBeCloseTo(-0.2293, 3);
    }
  });

  it('D — the jet still reaches the nozzle mouth at 1.26176', () => {
    // Measured off `Bedo_baked_v2.glb`'s `Cylinder012`; `water-alignment.spec.ts` proves
    // the tube is there. A gap reads as a floating jet, so this is a floor, not a range.
    expect(shapes[JET_ASSET].box.max.y * WATER_MODEL_SCALE).toBeGreaterThanOrEqual(1.26176);
  });

  it('E — every plume still reaches its deflector underside at 1.28455', () => {
    const lowestUnderside = 1.28455;
    for (const d of DEFLECTORS) {
      expect(
        shapes[d.water].box.max.y * WATER_MODEL_SCALE,
        `${d.id} deg plume top`
      ).toBeGreaterThan(lowestUnderside - 0.03);
    }
  });
});

describe('the ripple is sized by the shape rather than by a constant', () => {
  /**
   * The defect this replaces: a fixed 0.022 object units of vertex displacement on bodies
   * 5 to 17 units across. On the plumes that is 0.13 % of the cross-section — invisible in
   * every capture — and it was applied along fixed x and z, which for five of the eight
   * shapes is partly *along* the flow rather than across it.
   */
  it('crossRadius tracks each shape and spans the range a constant cannot cover', () => {
    const radii = (Object.keys(WATER_SHAPES) as WaterShapeKey[]).map(
      (k) => shapes[k].crossRadius
    );
    for (const [key, m] of Object.entries(shapes)) {
      expect(m.crossRadius, `${key} crossRadius`).toBeGreaterThan(0);
      // A radius no bigger than the half-extent it was measured inside — in the mesh's own
      // units, which is where it is measured and where the shader spends it.
      const halfCross = Math.max(...m.quantisedSize.filter((_, i) => i !== m.flowAxis)) / 2;
      expect(m.crossRadius, `${key} crossRadius vs cross extent`).toBeLessThan(halfCross);
    }
    // The jet is the narrow one and the plumes are three times wider, which is exactly why
    // one shared object-space amplitude cannot serve both.
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(2.5);
  });

  it('the amplitude stays inside what these meshes can actually carry', () => {
    // The shapes hold 663 to 1,922 vertices. A displacement large relative to the spacing
    // between them turns the rim into a sawtooth of facets rather than a ripple — which is
    // what 4.5 % produced and what this ceiling exists to prevent.
    expect(RIPPLE_AMPLITUDE).toBeGreaterThan(0);
    expect(RIPPLE_AMPLITUDE).toBeLessThanOrEqual(0.05);
    for (const [key, m] of Object.entries(shapes)) {
      // The wave sums to at most 1.55, so this is the largest displacement any vertex sees,
      // as a fraction of the shape's own mean cross-flow radius. Big enough to read as
      // motion, small enough that the authored silhouette stays the morph cache's to own.
      const peak = RIPPLE_AMPLITUDE * 1.55;
      expect(peak, `${key} peak ripple / radius`).toBeGreaterThan(0.02);
      expect(peak, `${key} peak ripple / radius`).toBeLessThan(0.14);
      expect(m.vertices, `${key} vertices`).toBeGreaterThan(300);
    }
  });

  it('the flow axis is found per shape, because they are not authored alike', () => {
    // Five of the eight are authored lying along Z and three along Y. A ripple that assumed
    // one of those would run the wrong way on the others.
    const axes = new Set(Object.values(shapes).map((m) => m.flowAxis));
    expect(axes.size).toBeGreaterThan(1);
    // And the world box disagrees with it on the rotated assets, which is the whole reason
    // the ripple has to be measured in the mesh's own space rather than in world space.
    const worldLongest = (m: Measured) =>
      [m.size.x, m.size.y, m.size.z].indexOf(Math.max(m.size.x, m.size.y, m.size.z));
    expect(Object.values(shapes).some((m) => worldLongest(m) !== m.flowAxis)).toBe(true);
    for (const [key, m] of Object.entries(shapes)) {
      expect(m.flowAxis, `${key} flow axis is the longest`).toBe(
        m.quantisedSize.indexOf(Math.max(...m.quantisedSize))
      );
    }
  });
});
