import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DEFLECTORS, MESH } from '../../src/domain/apparatus';
import { jetState } from '../../src/domain/physics';
import { gltfName } from '../../src/lib/gltfNames';
import { measureTankInterior } from '../../src/lib/tankWater';
import { NOZZLE_DIAMETER_M } from '../../src/lib/waterJet';
import { NOZZLE_MOUTH_MESH } from '../../src/lib/carrierTravel';
import {
  FILM_OFFSET_M,
  JET_FLOW_AZIMUTHS,
  MAX_COLUMN_SPREAD,
  POOL_DEPTH_M,
  buildJetPaths,
  measureCeiling,
  measureWettedSurface,
  rimDeflection,
  surfaceAt,
  type JetGeometry,
  type JetPath,
  type WettedSurface,
} from '../../src/lib/jetFlow';
import { assetPath } from '../helpers/glb';
import { loadApparatus } from '../helpers/model';

/**
 * F08 acceptance criteria — the water — asserted against the shipped model, with the
 * nozzle, tank, cover and every deflector measured exactly as `DeviceModel` measures them.
 *
 *   AC1  No deflector: a straight free jet only.
 *   AC2  Splash/deflection starts at the actual contact, never in free space.
 *   AC3  The seven deflectors produce distinguishable, physically coherent patterns.
 *   AC4  No solid is penetrated.
 *   AC5  The water reaches the receiver/base and does not end mid-path.
 *   AC6  Flow changes the jet's intensity and velocity.
 *   AC7  Carrier/deflector position changes the impact location and pattern.
 */

let model: THREE.Group;
let geometry: JetGeometry;
let axis: { x: number; z: number };
const surfaces = new Map<number, WettedSurface>();
const same = (v: THREE.Vector3) => v;
const part = (name: string) => model.getObjectByName(gltfName(name)) ?? model.getObjectByName(name)!;
const FLOWS = [0.15, 0.4, 0.6, 1.0];

const paths = (valve: number, deflectorId: number | null, liftM = 0): JetPath[] => {
  const jet = jetState(valve, deflectorId ?? 90);
  return buildJetPaths({
    v0: jet.nozzleVelocityMS,
    q: jet.flowRateM3S,
    geometry,
    deflector:
      deflectorId === null
        ? null
        : {
            surface: surfaces.get(deflectorId)!,
            liftM,
            nominalDeflectionRad: THREE.MathUtils.degToRad(deflectorId),
          },
  });
};

beforeAll(async () => {
  model = await loadApparatus();
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(part(NOZZLE_MOUTH_MESH), true);
  axis = { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 };
  const tank = measureTankInterior(part(MESH.tank), same, {
    floor: part(MESH.nozzle),
    ceiling: part(MESH.tankCover),
  })!;
  geometry = {
    mouthY: box.max.y,
    boreRadius: NOZZLE_DIAMETER_M / 2,
    tubeRadius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
    wallRadius: tank.radius,
    floorY: tank.floorY,
    ceilingY: measureCeiling(model, axis, box.max.y + 0.04, [0.03, 0.045, 0.06, 0.075], same, same)!,
  };
  for (const d of DEFLECTORS) surfaces.set(d.id, measureWettedSurface(part(d.installed), axis, same, same)!);
});

describe('the measured apparatus', () => {
  it('the water runs where the model is', () => {
    expect(geometry.mouthY).toBeCloseTo(1.26176, 4);
    expect(geometry.floorY).toBeCloseTo(1.08096, 4);
    // The lower plate of the cover — not `Tank_cover`'s own underside, 8.4 mm higher.
    expect(geometry.ceilingY).toBeCloseTo(1.3563, 3);
    expect(geometry.tubeRadius).toBeCloseTo(0.015, 3);
    expect(geometry.wallRadius).toBeGreaterThan(0.08);
    for (const d of DEFLECTORS) {
      const s = surfaces.get(d.id)!;
      expect(s.profiles).toHaveLength(JET_FLOW_AZIMUTHS);
      // Every deflector is round except the 45°, whose underside is a wedge.
      expect(s.axisymmetric, `${d.id}°`).toBe(d.id !== 45);
    }
  });
});

describe('AC1 — no deflector: a straight free jet only', () => {
  it('rises straight up the axis from the nozzle, with no deflection anywhere in free space', () => {
    for (const n of FLOWS) {
      for (const path of paths(n, null)) {
        const kinds = new Set(path.points.map((p) => p.segment));
        expect(kinds.has('film'), `n=${n}`).toBe(false);
        expect(path.contact).toBeNull();
        expect(path.release).toBeNull();
        const column = path.points.filter((p) => p.segment === 'column');
        // Only a jet too weak to reach the cover falls back on itself; nothing spreads.
        for (const p of path.points.filter((q) => q.segment === 'free')) {
          expect(p.r).toBeLessThanOrEqual(geometry.tubeRadius + FILM_OFFSET_M + 1e-12);
        }
        expect(column[0].y).toBeCloseTo(geometry.mouthY, 9);
        // Straight: it only rises, and only widens as it slows (continuity), by < 10 %.
        for (let i = 1; i < column.length; i++) {
          expect(column[i].y).toBeGreaterThan(column[i - 1].y);
          expect(column[i].r).toBeGreaterThanOrEqual(column[i - 1].r - 1e-12);
        }
        expect(column[column.length - 1].r / column[0].r).toBeLessThanOrEqual(n < 0.2 ? MAX_COLUMN_SPREAD : 1.1);
      }
    }
  });

  it('the scene draws no deflector’s water unless one is on the rod', () => {
    const source = readFileSync(assetPath('src/components/DeviceModel.tsx'), 'utf8');
    expect(source).toMatch(
      /lesson\.hasInstalledDeflector && !ghostDeflectorIds\.has\(deflector\.id\)\s*\?\s*wettedRef\.current\.get\(deflector\.id\)/
    );
  });
});

describe('AC2 — deflection starts at the actual contact', () => {
  it('the jet rises to the deflector’s own surface, and the film starts on it, on every azimuth', () => {
    for (const d of DEFLECTORS) {
      const s = surfaces.get(d.id)!;
      for (const n of FLOWS) {
        paths(n, d.id).forEach((path, a) => {
          const profile = s.profiles[s.axisymmetric ? 0 : a];
          const column = path.points.filter((p) => p.segment === 'column');
          const top = column[column.length - 1];
          const under = surfaceAt(profile, top.r)!;
          // Exactly the film offset below the part: not short of it in free space, not in it.
          expect(under - top.y, `${d.id}° n=${n} az=${a}`).toBeCloseTo(FILM_OFFSET_M, 5);
          const film = path.points.filter((p) => p.segment === 'film');
          expect(film.length, `${d.id}° n=${n}`).toBeGreaterThan(0);
          for (const p of film) {
            expect(surfaceAt(profile, p.r)! - p.y).toBeCloseTo(FILM_OFFSET_M, 5);
          }
          // The free sheet leaves from the rim, not before it.
          const release = path.release!;
          expect(release.r).toBeCloseTo(profile.rimRadius, 6);
        });
      }
    }
  });
});

describe('AC3 — seven distinguishable, coherent patterns', () => {
  const signature = (id: number) => {
    const ps = paths(0.4, id);
    const first = (p: JetPath) => p.points.find((q) => ['wall', 'ceiling', 'tube'].includes(q.segment));
    return {
      angles: ps.map((p) => p.release!.angleRad),
      firstSolid: ps.map((p) => first(p) ?? p.points[p.points.length - 1]),
    };
  };

  it('each round deflector turns the water by its own angle; the cones’ own slopes agree', () => {
    for (const d of DEFLECTORS.filter((x) => x.id !== 45)) {
      for (const angle of signature(d.id).angles) {
        expect(THREE.MathUtils.radToDeg(angle)).toBeCloseTo(d.id, 6);
      }
    }
    // Measured off the meshes, not assumed: the 30° and 60° cones leave at their angle.
    for (const id of [30, 60]) {
      const slope = THREE.MathUtils.radToDeg(rimDeflection(surfaces.get(id)!.profiles[0]));
      expect(Math.abs(slope - id)).toBeLessThan(3);
    }
  });

  it('the 45° wedge sends the water up its two faces at 45°, and level along its ridge', () => {
    const angles = signature(45).angles.map((a) => THREE.MathUtils.radToDeg(a));
    expect(Math.min(...angles)).toBeGreaterThan(40);
    expect(Math.min(...angles)).toBeLessThan(50);
    expect(Math.max(...angles)).toBeGreaterThan(85);
  });

  it('where the water first meets a solid tells every deflector apart', () => {
    const seen = DEFLECTORS.map((d) => {
      const { firstSolid } = signature(d.id);
      const p = firstSolid[0];
      return { id: d.id, segment: p.segment, r: p.r, y: p.y };
    });
    // Climbing deflectors hit higher than level ones, which hit higher than the ones that
    // turn the water down; 180° turns it straight back past the nozzle to the floor.
    const y = (id: number) => seen.find((s) => s.id === id)!.y;
    expect(y(30)).toBeGreaterThanOrEqual(y(60));
    expect(y(60)).toBeGreaterThan(y(90) + 0.02);
    expect(y(90)).toBeGreaterThan(y(120) + 0.02);
    expect(y(120)).toBeGreaterThan(y(135) + 0.02);
    expect(seen.find((s) => s.id === 180)!.r).toBeLessThan(geometry.wallRadius / 2);
    expect(seen.find((s) => s.id === 30)!.segment).toBe('ceiling');
    // Pairwise: no two patterns meet the tank in the same place.
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        const a = seen[i];
        const b = seen[j];
        const distinct =
          Math.hypot(a.r - b.r, a.y - b.y) > 0.005 ||
          signature(a.id).angles.some((x, k) => Math.abs(x - signature(b.id).angles[k]) > 0.1);
        expect(distinct, `${a.id}° vs ${b.id}°`).toBe(true);
      }
    }
  });
});

describe('AC4 — never through a solid', () => {
  it('inside the tank, outside the nozzle tube, and never inside a deflector', () => {
    const ray = new THREE.Raycaster();
    for (const d of DEFLECTORS) {
      const deflector = part(d.installed);
      for (const n of FLOWS) {
        paths(n, d.id).forEach((path, a) => {
          const angle = (a / JET_FLOW_AZIMUTHS) * Math.PI * 2;
          for (const p of path.points) {
            expect(p.r, `${d.id}° n=${n}`).toBeLessThanOrEqual(geometry.wallRadius);
            expect(p.y).toBeLessThanOrEqual(geometry.ceilingY);
            expect(p.y).toBeGreaterThanOrEqual(geometry.floorY);
            if (p.y < geometry.mouthY - 1e-9) expect(p.r).toBeGreaterThan(geometry.tubeRadius);
            // Under the deflector's underside wherever it is over the water.
            const x = axis.x + p.r * Math.cos(angle);
            const z = axis.z + p.r * Math.sin(angle);
            ray.set(new THREE.Vector3(x, p.y - 0.3, z), new THREE.Vector3(0, 1, 0));
            const hit = ray.intersectObject(deflector, true)[0];
            if (hit && hit.point.y < p.y + 0.03) {
              expect(p.y, `${d.id}° n=${n} az=${a} ${p.segment} r=${(p.r*1000).toFixed(2)} in the deflector`).toBeLessThanOrEqual(hit.point.y + 1e-6);
            }
          }
        });
      }
    }
  });
});

describe('AC5 — to the receiver, never ending mid-path', () => {
  it('every path, every flow, every deflector and none, ends in the pool on the tank floor', () => {
    for (const id of [null, ...DEFLECTORS.map((d) => d.id)]) {
      for (const n of FLOWS) {
        for (const path of paths(n, id)) {
          const end = path.points[path.points.length - 1];
          expect(end.y, `${id}° n=${n}`).toBeCloseTo(geometry.floorY + POOL_DEPTH_M, 9);
          // Continuous: no jump anywhere along it.
          for (let i = 1; i < path.points.length; i++) {
            const a = path.points[i - 1];
            const b = path.points[i];
            expect(Math.hypot(b.r - a.r, b.y - a.y), `${id}° n=${n} #${i}`).toBeLessThan(0.02);
            expect(b.t).toBeGreaterThanOrEqual(a.t);
          }
        }
      }
    }
  });

  it('nothing fades the water out in mid-air any more', () => {
    const source = readFileSync(assetPath('src/components/DeviceModel.tsx'), 'utf8');
    const mesh = readFileSync(assetPath('src/lib/jetFlowMesh.ts'), 'utf8');
    const material = readFileSync(assetPath('src/lib/waterMaterial.ts'), 'utf8');
    expect(source).not.toMatch(/uPlumeCut|PLUME_CUT/);
    expect(mesh).not.toMatch(/uPlumeCut/);
    expect(material).not.toMatch(/uPlumeCut/);
  });
});

describe('AC6 — flow changes the jet', () => {
  it('leaves the nozzle at the domain’s own velocity, narrows as it speeds up, reaches further', () => {
    const at = FLOWS.map((n) => ({ n, path: paths(n, 60)[0], jet: jetState(n, 60) }));
    for (const { path, jet } of at) {
      expect(path.points[0].speed).toBeCloseTo(jet.nozzleVelocityMS, 9);
    }
    for (let i = 1; i < at.length; i++) {
      const prev = at[i - 1].path;
      const next = at[i].path;
      const top = (p: JetPath) => p.points.filter((q) => q.segment === 'column').pop()!;
      // Faster at the contact, and a column no wider (continuity).
      expect(top(next).speed).toBeGreaterThan(top(prev).speed);
      expect(top(next).r).toBeLessThanOrEqual(top(prev).r + 1e-12);
      // The 60° sheet climbs at least as high before it meets the tank.
      const high = (p: JetPath) => Math.max(...p.points.filter((q) => q.segment === 'free').map((q) => q.y));
      expect(high(next)).toBeGreaterThanOrEqual(high(prev) - 1e-9);
    }
  });

  it('the drawn water moves at the water’s own speed', () => {
    const material = readFileSync(assetPath('src/lib/waterMaterial.ts'), 'utf8');
    // Patterns are sampled on the parcel's time since leaving the nozzle.
    expect(material).toMatch(/float parcel = uClock - vFlowUv\.y;/);
    const source = readFileSync(assetPath('src/components/DeviceModel.tsx'), 'utf8');
    expect(source).toMatch(/jetFlowUniforms\.uClock\.value = t;/);
  });
});

describe('AC7 — the carrier moves the impact', () => {
  it('lowering the deflector lowers the contact, the release and the first strike by the same amount', () => {
    for (const d of DEFLECTORS) {
      const up = paths(0.4, d.id, 0)[0];
      const down = paths(0.4, d.id, -0.0165)[0];
      expect(down.contact!.y - up.contact!.y, `${d.id}°`).toBeCloseTo(-0.0165, 9);
      expect(down.release!.y - up.release!.y, `${d.id}°`).toBeCloseTo(-0.0165, 9);
    }
  });

  it('the scene passes the carrier’s lift of this frame', () => {
    const source = readFileSync(assetPath('src/components/DeviceModel.tsx'), 'utf8');
    expect(source).toMatch(/liftM: holderLift/);
  });
});
