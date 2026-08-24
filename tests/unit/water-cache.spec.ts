import { describe, expect, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import {
  WATER_CACHE_BASE_FRAME,
  WATER_CACHE_FPS,
  WATER_CACHE_FRAMES,
  WATER_CACHE_SECONDS,
  WATER_STARTUP_SECONDS,
  WATER_CACHE_TARGETS,
  applyCacheFrame,
  basePoseBox,
  buildFrameMap,
  cacheFrameAt,
  cacheTargetName,
  createCacheClock,
  prepareCacheMesh,
  setCacheFrame,
} from '../../src/lib/waterCache';
import { WATER_SHAPES, type WaterShapeKey } from '../../src/domain/apparatus';
import { loadWater } from '../helpers/model';

/**
 * The authored water motion, restored.
 *
 * BEDO authored eight Alembic vertex caches. What shipped was **frame 80 of each, frozen** —
 * so the water had one pose and the only thing moving was the ripple shader. These tests
 * pin the three facts that make the fix correct rather than merely animated:
 *
 *  1. the assets really do carry the whole cache, at the authored rate;
 *  2. influences at zero reproduce exactly the geometry that shipped before, so BEDO-017's
 *     10 mm jet and BEDO-043's surface coordinate are untouched;
 *  3. playback is one-shot, because the caches are transients and looping them would pop.
 */

const scenes = {} as Record<WaterShapeKey, THREE.Group>;

beforeAll(async () => {
  for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
    scenes[key] = await loadWater(WATER_SHAPES[key].url);
  }
});

const meshesOf = (root: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

describe('the authored timing', () => {
  it('is 81 samples at 24 fps — 3.3333 s', () => {
    // Corroborated independently by the Unity importer settings preserved in every
    // `.abc.meta`: `abcStartTime: 0`, `abcEndTime: 3.3333333`.
    expect(WATER_CACHE_FRAMES).toBe(81);
    expect(WATER_CACHE_FPS).toBe(24);
    expect(WATER_CACHE_SECONDS).toBeCloseTo(10 / 3, 6);
    expect(WATER_CACHE_BASE_FRAME).toBe(80);
    // One target per frame except the base, whose delta would be zero.
    expect(WATER_CACHE_TARGETS).toBe(80);
  });

  it('plays at the reference rate, not the authored one', () => {
    // The archive was authored over 3.3333 s; the reference simulator establishes its
    // water in 1.15 s. The frames are the same and their order is the same — only the
    // pace differs. Measured in `Bedo_Mesu_J.mp4`; see `docs/44`.
    expect(WATER_CACHE_SECONDS).toBeCloseTo(10 / 3, 6);
    expect(WATER_STARTUP_SECONDS).toBe(1.15);
    expect(WATER_STARTUP_SECONDS).toBeLessThan(WATER_CACHE_SECONDS);
  });

  it('reaches the settled pose exactly when the reference does, and holds', () => {
    expect(cacheFrameAt(0)).toBe(0);
    expect(cacheFrameAt(WATER_STARTUP_SECONDS / 2)).toBeCloseTo(40, 6);
    expect(cacheFrameAt(WATER_STARTUP_SECONDS)).toBe(WATER_CACHE_BASE_FRAME);
    // Held, not wrapped. Wrapping is the one thing these caches must never do.
    expect(cacheFrameAt(WATER_STARTUP_SECONDS * 10)).toBe(WATER_CACHE_BASE_FRAME);
    expect(cacheFrameAt(-5)).toBe(0);
    // The reference's own midpoint: half of steady at ~0.47 s after the start.
    expect(cacheFrameAt(0.47) / WATER_CACHE_BASE_FRAME).toBeGreaterThan(0.35);
    expect(cacheFrameAt(0.47) / WATER_CACHE_BASE_FRAME).toBeLessThan(0.5);
  });
});

describe('every shipped asset carries the whole cache', () => {
  it('has one morph target per authored frame, named for that frame', () => {
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      const meshes = meshesOf(scenes[key]);
      expect(meshes.length, `${key} has no mesh`).toBeGreaterThan(0);
      for (const mesh of meshes) {
        expect(mesh.morphTargetInfluences, `${key} carries no morph targets`).toBeTruthy();
        expect(mesh.morphTargetInfluences!.length).toBe(WATER_CACHE_TARGETS);
        // Named, so playback never has to trust array order.
        expect(mesh.morphTargetDictionary?.[cacheTargetName(0)]).toBeTypeOf('number');
        expect(
          mesh.morphTargetDictionary?.[cacheTargetName(WATER_CACHE_BASE_FRAME - 1)]
        ).toBeTypeOf('number');
      }
    }
  });

  it('stores them as deltas, so zero influence is the authored settled pose', () => {
    for (const key of Object.keys(WATER_SHAPES) as WaterShapeKey[]) {
      for (const mesh of meshesOf(scenes[key])) {
        expect(mesh.geometry.morphTargetsRelative, `${key} is not relative`).toBe(true);
      }
    }
  });

  it('is a real animation: every frame differs from the settled pose', () => {
    // Guards against an export that produced 80 empty targets, which would type-check,
    // load, play and look exactly like the frozen geometry it replaced.
    const mesh = meshesOf(scenes.d90)[0];
    const deltas = mesh.geometry.morphAttributes.position!;
    expect(deltas.length).toBe(WATER_CACHE_TARGETS);
    const magnitude = (a: THREE.BufferAttribute) => {
      let most = 0;
      for (let i = 0; i < a.count; i++) {
        most = Math.max(most, Math.hypot(a.getX(i), a.getY(i), a.getZ(i)));
      }
      return most;
    };
    // Frame 0 is a nub and frame 79 is nearly settled, so the first delta must dwarf the last.
    expect(magnitude(deltas[0] as THREE.BufferAttribute)).toBeGreaterThan(1);
    expect(magnitude(deltas[0] as THREE.BufferAttribute)).toBeGreaterThan(
      magnitude(deltas[WATER_CACHE_TARGETS - 1] as THREE.BufferAttribute) * 5
    );
  });
});

describe('measuring the base pose', () => {
  it('ignores the morph targets, which Box3.setFromObject cannot', () => {
    // The whole reason `basePoseBox` exists. `computeBoundingBox` expands over every morph
    // target, and for relative targets it adds the most negative delta found *anywhere* to
    // the overall minimum — a per-attribute bound, not a per-vertex one. Divided into the
    // nozzle bore, that inflated width would silently undo BEDO-017.
    const scene = scenes.low;
    scene.updateWorldMatrix(true, true);
    const base = basePoseBox(scene).getSize(new THREE.Vector3());
    const naive = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    expect(naive.length()).toBeGreaterThan(base.length() * 1.2);
  });

  it('measures the jet at the dimensions BEDO-017 was verified against', () => {
    // 5.083 across by 17.481 along — the numbers `src/lib/waterJet.ts` quotes. If the
    // conversion had moved the base pose, this is what would catch it.
    const size = basePoseBox(scenes.low).getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.z)).toBeCloseTo(5.0833, 2);
    expect(size.y).toBeCloseTo(17.4811, 2);
  });
});

describe('pointing a mesh at a frame', () => {
  const frameMap = () => buildFrameMap(undefined, WATER_CACHE_TARGETS);

  it('maps each frame to its own target, and the base frame to none', () => {
    const map = buildFrameMap(undefined, WATER_CACHE_TARGETS);
    expect(map[0]).toBe(0);
    expect(map[79]).toBe(79);
    // The base frame has no target: the mesh already is that frame.
    expect(map[WATER_CACHE_BASE_FRAME]).toBe(-1);
  });

  it('reads the asset own names rather than trusting order', () => {
    // A re-export that ordered its targets differently would otherwise play scrambled.
    const shuffled: Record<string, number> = {};
    for (let f = 0; f < WATER_CACHE_TARGETS; f++) {
      shuffled[cacheTargetName(f)] = WATER_CACHE_TARGETS - 1 - f;
    }
    const map = buildFrameMap(shuffled, WATER_CACHE_TARGETS);
    expect(map[0]).toBe(WATER_CACHE_TARGETS - 1);
    expect(map[79]).toBe(0);
    expect(map[WATER_CACHE_BASE_FRAME]).toBe(-1);
  });

  it('puts all the weight on one target at a whole frame', () => {
    const inf = new Array(WATER_CACHE_TARGETS).fill(0);
    setCacheFrame(inf, frameMap(), 17);
    expect(inf[17]).toBeCloseTo(1, 12);
    expect(inf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('blends exactly two neighbours in between', () => {
    const inf = new Array(WATER_CACHE_TARGETS).fill(0);
    setCacheFrame(inf, frameMap(), 17.25);
    expect(inf[17]).toBeCloseTo(0.75, 12);
    expect(inf[18]).toBeCloseTo(0.25, 12);
    expect(inf.filter((v) => v !== 0)).toHaveLength(2);
  });

  it('leaves every influence at zero on the settled frame', () => {
    // Which is what makes the animation purely additive over the geometry that shipped.
    const inf = new Array(WATER_CACHE_TARGETS).fill(0.5);
    setCacheFrame(inf, frameMap(), WATER_CACHE_BASE_FRAME);
    expect(inf.every((v) => v === 0)).toBe(true);
  });

  it('blends toward the settled pose across the last interval', () => {
    // Frame 79.5 is half of target 79 and half of the base, and the base contributes by
    // absence — so the influences sum to a half, not to one.
    const inf = new Array(WATER_CACHE_TARGETS).fill(0);
    setCacheFrame(inf, frameMap(), 79.5);
    expect(inf[79]).toBeCloseTo(0.5, 12);
    expect(inf.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5, 12);
  });

  it('clamps rather than reading off the end of the array', () => {
    const inf = new Array(WATER_CACHE_TARGETS).fill(0);
    expect(() => setCacheFrame(inf, frameMap(), 500)).not.toThrow();
    expect(() => setCacheFrame(inf, frameMap(), -500)).not.toThrow();
    expect(inf.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('drives a real loaded asset end to end', () => {
    const mesh = meshesOf(scenes.d90)[0];
    prepareCacheMesh(mesh);
    applyCacheFrame(scenes.d90, 0);
    expect(mesh.morphTargetInfluences![0]).toBeCloseTo(1, 9);
    applyCacheFrame(scenes.d90, WATER_CACHE_BASE_FRAME);
    expect(mesh.morphTargetInfluences!.every((v) => v === 0)).toBe(true);
  });

  it('leaves a mesh with no morph targets completely alone', () => {
    // So a build still holding the superseded static assets renders as it always did.
    const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    expect(() => prepareCacheMesh(plain)).not.toThrow();
    expect(() => applyCacheFrame(plain, 40)).not.toThrow();
    expect(plain.morphTargetInfluences).toBeUndefined();
  });
});

describe('the one-shot clock', () => {
  it('starts at the first frame and reaches the last after the authored duration', () => {
    const clock = createCacheClock();
    expect(clock.advance(true, 0)).toBe(0);
    expect(clock.advance(true, WATER_STARTUP_SECONDS)).toBe(WATER_CACHE_BASE_FRAME);
  });

  it('holds the settled pose instead of looping back', () => {
    // Returning frame 80 to frame 0 moves every vertex by 18-29 % of the shape's own
    // diagonal, and no sub-range of any cache loops either. There is nothing to loop.
    const clock = createCacheClock();
    clock.advance(true, 0);
    clock.advance(true, WATER_STARTUP_SECONDS);
    for (let i = 0; i < 20; i++) {
      expect(clock.advance(true, 0.5)).toBe(WATER_CACHE_BASE_FRAME);
    }
  });

  it('does not restart while it keeps running — a valve nudge is not a new start', () => {
    const clock = createCacheClock();
    clock.advance(true, 0);
    const half = clock.advance(true, WATER_STARTUP_SECONDS / 2);
    expect(half).toBeGreaterThan(0);
    expect(clock.advance(true, 0.01)).toBeGreaterThan(half);
  });

  it('replays from the first frame after a stop', () => {
    const clock = createCacheClock();
    clock.advance(true, 0);
    clock.advance(true, WATER_STARTUP_SECONDS);
    expect(clock.advance(false, 0.1)).toBe(0);
    // The next start is a fresh emergence, not a resume and not a reverse: no authored
    // shutdown cache exists, so nothing is invented.
    expect(clock.advance(true, 0)).toBe(0);
  });

  it('parks at the first frame while stopped', () => {
    const clock = createCacheClock();
    for (let i = 0; i < 5; i++) expect(clock.advance(false, 1)).toBe(0);
  });

  it('can be reset outright', () => {
    const clock = createCacheClock();
    clock.advance(true, 0);
    clock.advance(true, WATER_STARTUP_SECONDS);
    clock.reset();
    expect(clock.advance(true, 0)).toBe(0);
  });
});
