// Playback of the authored water caches.
//
// ## What the assets are
//
// BEDO authored the water as eight Alembic vertex caches (`assets-source/WaterShapes/*.abc`),
// one per deflector plus the pre-impact jet. Measured rather than assumed — see `docs/44`:
//
//   * 81 samples at 24 fps — 3.3333 s, which the Unity importer settings corroborate
//     independently (`abcEndTime: 3.3333333` in every `.abc.meta`).
//   * **Constant topology.** Vertex, polygon and loop counts never change across the 81
//     frames, which is what makes morph targets a legal representation at all.
//   * One mesh each, visible throughout. No visibility animation, no topology change.
//   * Every frame distinct: 81 of 81 unique.
//
// What shipped instead was **frame 80 of each cache, frozen** — matched to within 3e-5
// units by searching all 81 frames. Frame 0 is a 0.1-2 unit nub and frame 80 is the full
// 17-28 unit shape, so 81 frames of authored flow development had been reduced to one.
//
// ## Why the base pose is the last frame
//
// The conversion (`scripts/water/abc_to_morph_glb.py`) exports frame 80 as the base mesh
// and each other frame as a *relative* morph target. That is deliberate and load-bearing:
//
//   * `waterFit` measures each shape's extents and scales the jet from them so it leaves
//     the nozzle at its true 10 mm bore (BEDO-017). Frame 80 is what it measured before,
//     so it measures exactly the same numbers now — verified bit-identical.
//   * `buildWaterUv` bakes its surface coordinate from the same vertices (BEDO-043).
//   * All influences at zero **is** the geometry that shipped. The animation is purely
//     additive, so nothing that was verified against the settled shape moves.
//
// ## Not a loop
//
// The caches are one-shot startup transients that end mid-motion. Returning frame 80 to
// frame 0 moves every vertex by 18-29 % of the shape's own diagonal on average, and the
// quietest 12-frame window inside any of them still has a seam error at least as large as
// the motion within it — there is no authored steady-state cycle to find. So playback runs
// once and holds; the perpetual living-water movement stays the ripple shader's job
// (`src/lib/waterUv.ts`), which is why that work complements this rather than being
// replaced by it.

import * as THREE from 'three';

/** Samples per second in the authored caches. */
export const WATER_CACHE_FPS = 24;

/** Sample count: frames 0..80 inclusive. */
export const WATER_CACHE_FRAMES = 81;

/**
 * The frame the exported base mesh holds, and therefore the frame that needs no morph
 * target of its own — its delta would be zero by construction.
 */
export const WATER_CACHE_BASE_FRAME = WATER_CACHE_FRAMES - 1;

/** How long the cache was *authored* over: 81 samples at 24 fps. 3.3333 s. */
export const WATER_CACHE_SECONDS = WATER_CACHE_BASE_FRAME / WATER_CACHE_FPS;

/**
 * How long the water actually takes to establish — **measured from the reference**.
 *
 * The archive's 3.3333 s is the rate the cache was *authored* at. It is not the rate the
 * simulator plays it at, and BEDO-044's first cut wrongly assumed it was.
 *
 * `Bedo_Mesu_J.mp4` (1920x1080, 30.000 fps) shows the water starting at **55.55 s** and
 * establishing over about a second. Counting water pixels per frame in the tank region,
 * against a stable pre-water baseline of ~8,200:
 *
 *   | share of steady | timestamp |
 *   |-----------------|-----------|
 *   | 0 %             | 55.55 s   |
 *   | 50 %            | 56.02 s   |
 *   | 90 %            | 56.40 s   |
 *   | 95 %            | 56.70 s   |
 *   | asymptotic      | ~57.0 s   |
 *
 * So the reference reaches its established state in **1.15 s**, not 3.33 s — nearly three
 * times faster. The cache still plays frames 0..80 in order and still holds at 80; only the
 * rate changes. `docs/44` records the measurement.
 */
export const WATER_STARTUP_SECONDS = 1.15;

/** Morph targets carried by a converted asset: one per frame except the base. */
export const WATER_CACHE_TARGETS = WATER_CACHE_FRAMES - 1;

/** The name the converter gives the target holding frame `f`. */
export const cacheTargetName = (frame: number): string => `f${String(frame).padStart(3, '0')}`;

/**
 * Where playback has reached, in frames, after `seconds` of flow.
 *
 * Paced by `WATER_STARTUP_SECONDS` — the duration measured from the reference — not by the
 * cache's authored 24 fps. Clamped at the base frame rather than wrapped: holding the
 * settled pose is the whole playback policy (see above), so this is where "play once and
 * hold" is actually decided.
 */
export const cacheFrameAt = (seconds: number): number =>
  Math.min(
    WATER_CACHE_BASE_FRAME,
    Math.max(0, (seconds / WATER_STARTUP_SECONDS) * WATER_CACHE_BASE_FRAME)
  );

/**
 * Which morph target index carries which authored frame.
 *
 * Read from the asset's own `morphTargetDictionary` rather than assumed from array order,
 * so a re-export that happens to order its targets differently cannot silently play the
 * animation scrambled. Frames with no target of their own — the base frame — map to -1,
 * meaning "contribute nothing", which is correct because the base mesh already is that
 * frame.
 *
 * Falls back to index order only when the asset carries no names at all.
 */
export function buildFrameMap(
  dictionary: Record<string, number> | undefined,
  targetCount: number
): Int32Array {
  const map = new Int32Array(WATER_CACHE_FRAMES).fill(-1);
  for (let frame = 0; frame < WATER_CACHE_FRAMES; frame++) {
    if (frame === WATER_CACHE_BASE_FRAME) continue;
    const named = dictionary?.[cacheTargetName(frame)];
    if (named !== undefined) map[frame] = named;
    else if (!dictionary && frame < targetCount) map[frame] = frame;
  }
  return map;
}

/**
 * Point a mesh's morph influences at a (possibly fractional) authored frame.
 *
 * Two influences at most, linearly blended, which is exactly the interpolation the cache
 * was sampled with. Because the targets are relative to frame 80, blending targets `a` and
 * `b` by `t` yields `(1-t)*frame[a] + t*frame[b]` — the base contribution cancels — so a
 * fractional frame is a true in-between pose and not a drift toward the settled shape.
 *
 * The base frame contributes by *absence*: its map entry is -1, the influence stays zero,
 * and the mesh renders its own base vertices.
 */
export function setCacheFrame(
  influences: number[],
  frameMap: Int32Array,
  framePosition: number
): void {
  influences.fill(0);
  const clamped = Math.min(WATER_CACHE_BASE_FRAME, Math.max(0, framePosition));
  const lower = Math.floor(clamped);
  const upper = Math.min(lower + 1, WATER_CACHE_BASE_FRAME);
  const blend = clamped - lower;

  const lowerTarget = frameMap[lower];
  if (lowerTarget >= 0 && lowerTarget < influences.length) {
    influences[lowerTarget] += 1 - blend;
  }
  if (upper !== lower) {
    const upperTarget = frameMap[upper];
    if (upperTarget >= 0 && upperTarget < influences.length) {
      influences[upperTarget] += blend;
    }
  }
}

/** Where a prepared mesh keeps the frame map, so playback needs no lookup table. */
const FRAME_MAP_KEY = 'bedoWaterFrameMap';

/**
 * Work out a mesh's frame map once, at load.
 *
 * Meshes with no morph targets are left alone and stay inert under `applyCacheFrame`, so a
 * build that still has the superseded static assets in `public/` renders exactly as it did
 * before rather than failing.
 */
export function prepareCacheMesh(mesh: THREE.Mesh): void {
  const influences = mesh.morphTargetInfluences;
  if (!influences || influences.length === 0) return;
  if (mesh.userData[FRAME_MAP_KEY]) return;
  mesh.userData[FRAME_MAP_KEY] = buildFrameMap(mesh.morphTargetDictionary, influences.length);
}

/** Point every prepared mesh under `root` at an authored frame. */
export function applyCacheFrame(root: THREE.Object3D, framePosition: number): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const influences = mesh.morphTargetInfluences;
    const frameMap = mesh.userData?.[FRAME_MAP_KEY] as Int32Array | undefined;
    if (!influences || !frameMap) return;
    setCacheFrame(influences, frameMap, framePosition);
  });
}

/**
 * The world-space bounds of a subtree's **base pose**, ignoring morph targets.
 *
 * `Box3.setFromObject` cannot be used on these assets. `BufferGeometry.computeBoundingBox`
 * expands the box over every morph target, and for *relative* targets it does so by adding
 * the most negative delta found anywhere to the overall minimum — a per-attribute bound,
 * not a per-vertex one. Across 80 targets that inflates the box enormously, and since
 * `waterFit` divides the nozzle bore by the measured width, an inflated box would shrink
 * the jet and quietly undo BEDO-017.
 *
 * So this walks the vertices itself. It is called once per asset at load, over at most 897
 * vertices, and never again.
 */
export function basePoseBox(root: THREE.Object3D, target?: THREE.Box3): THREE.Box3 {
  const box = (target ?? new THREE.Box3()).makeEmpty();
  const vertex = new THREE.Vector3();
  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry?.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position as THREE.BufferAttribute, i);
      box.expandByPoint(vertex.applyMatrix4(mesh.matrixWorld));
    }
  });
  return box;
}

/**
 * A one-shot clock for a single water object.
 *
 * The jet and the plume each own one. They are separate because BEDO specifies the two
 * shapes separately (storyboard sl. 18) and they start at different moments: the column
 * forms when the water starts flowing, the spray forms when that column actually reaches
 * the deflector. Sharing one clock would let the plume appear already settled — it would
 * pop in at frame 80 — whenever the learner opened the valve slowly.
 *
 * `running` false parks the clock; the next rising edge restarts from frame 0, which is the
 * documented stop policy (`docs/44 §F2`): no authored shutdown cache exists, so nothing is
 * reversed and nothing is invented.
 */
export interface CacheClock {
  /** Advances (or arms) the clock and returns the frame to display. */
  advance(running: boolean, delta: number): number;
  reset(): void;
}

export function createCacheClock(): CacheClock {
  let elapsed = 0;
  let wasRunning = false;
  return {
    advance(running, delta) {
      if (!running) {
        wasRunning = false;
        elapsed = 0;
        return 0;
      }
      if (!wasRunning) {
        wasRunning = true;
        elapsed = 0;
      } else {
        elapsed += delta;
      }
      return cacheFrameAt(elapsed);
    },
    reset() {
      elapsed = 0;
      wasRunning = false;
    },
  };
}
