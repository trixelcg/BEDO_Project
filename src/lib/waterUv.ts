// A surface coordinate for the water, derived from the water's own geometry.
//
// ## Why not the authored UVs
//
// The eight Alembic caches all carry `TEXCOORD_0`, and three of them (`Water90_Flat`,
// `Water180_HemiSphere`, `Water45_Oblique`) also carry `TEXCOORD_1`. It is tempting to read
// that as "the assets are UV-mapped, use their UVs". They are not, and it does not work:
//
//  - **Nothing addresses them.** Every one of the eight declares `textures: 0, images: 0`,
//    and its materials are bare `Max_MaterialID_*`. The UVs are leftover 3ds Max mapping
//    coordinates that no texture has ever sampled.
//  - **They are an atlas, not a tiling.** Each primitive occupies its own disjoint band of
//    V — `Water_low` runs [-0.02, 0.20], [0.20, 0.24], [0.24, 0.74] — so the scale changes
//    from one primitive to the next over quite different geometric lengths.
//  - **They reverse.** Within `Water_low`, V correlates with the flow axis at +0.973 on one
//    primitive and -0.996 on another. Tiling across that seam mirrors the ripple.
//  - **U barely moves.** `Water_low` and `Water120_HemiSphere` span U [0.36, 0.64] — 28 % of
//    the range — so U is not a wrap around the column.
//  - **One primitive has no flow correlation at all.** `Water45_Oblique#1` correlates 0.003
//    on U and -0.003 on V.
//
// So the authored channels are inventoried and rejected on evidence, not ignored. Since
// BEDO-044 the conversion does not even ship them (`scripts/water/abc_to_morph_glb.py`):
// they address nothing, and a UV seam splits a vertex that would then be paid for again in
// each of the 80 morph targets. If the caches are ever re-authored with real tiling UVs,
// this module and that converter flag are the two places that have to change.
//
// ## What is used instead
//
// A cylindrical parameterisation of each mesh, computed once when the model loads and baked
// into a geometry attribute:
//
//   u = angle about the flow axis, wrapped to 0..1
//   v = distance along the flow axis, normalised to 0..1 by that mesh's own bounds
//
// It is **object space**, so it is welded to the water and cannot swim when the camera
// moves; it varies in two directions, which is what the world-space projection it replaces
// did not; and it is one rule for all eight shapes, with no filename special cases.
//
// ## The banding it fixes
//
// The shader sampled its ripple texture at `vWPos.xz` and `vWPos.y` — a world-space planar
// projection. Across the water's narrow cross-section `xz` barely changes, so the lookup
// collapsed to a function of height alone and drew horizontal stripes. BEDO-017 made that
// worse by a factor of seventeen: correcting the jet from 172 mm to its true 10 mm bore cut
// the cross-flow variation to almost nothing. See `docs/43`.

/** Which axis a shape flows along: the longest one. */
export type FlowAxis = 0 | 1 | 2;

export interface WaterUvResult {
  /** Interleaved u, v per vertex. */
  readonly uv: Float32Array;
  /** The axis the shape was found to flow along — 0 = x, 1 = y, 2 = z. */
  readonly flowAxis: FlowAxis;
  /** That axis's extent, for the record. */
  readonly flowLength: number;
  /**
   * The shape's mean radius about its own flow axis.
   *
   * The one number a *shared* material needs in order to ripple every shape by the same
   * visual amount. The eight caches are authored at their true sizes and differ by more
   * than three to one across the flow — `Water_low` is 5.08 units across, the plumes are
   * 16.4 to 17.0 — so a fixed object-space amplitude is either invisible on one or a
   * convulsion on the other. It was the former: 0.022 units on a 17-unit body is a tenth
   * of a per cent, which is why the "ripple that keeps the stream alive" could not be
   * seen in any capture (BEDO-WATER-03).
   *
   * Mean rather than maximum, so one stray vertex thrown wide by the splash cannot set the
   * amplitude for the whole shape.
   */
  readonly crossRadius: number;
}

/**
 * Find the axis a shape flows along.
 *
 * The longest one. Every shipped shape is a column or plume much longer than it is wide,
 * and three of them (`Water30`, `Water120_HemiSphere`, `Water135_Conical`) are authored
 * lying down with their length on Z — which is exactly why this is measured per mesh rather
 * than assumed to be Y.
 */
export function flowAxisOf(positions: ArrayLike<number>): FlowAxis {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  let axis: FlowAxis = 0;
  if (size[1] > size[axis]) axis = 1;
  if (size[2] > size[axis]) axis = 2;
  return axis;
}

/**
 * Build the surface coordinate for one mesh's vertices.
 *
 * `u` comes from `atan2` about the flow axis and is therefore continuous around the column
 * — a ripple crossing it wraps rather than stopping. It is left in 0..1 so a caller can
 * choose a tile count without having to know anything about radians.
 *
 * `v` is normalised by this mesh's **own** bounds, which matters: the shapes are authored at
 * wildly different offsets (`Water90_Flat` sits at y 106.9 to 128.9, nowhere near the
 * origin), so a shared constant would saturate on some and not others. The old vertex
 * displacement did exactly that — `clamp(position.y * 0.05 + 0.5, 0, 1)` is pinned at 1 for
 * every shape authored above y = 10, which is most of them.
 *
 * A degenerate mesh — no vertices, or no extent along the flow — yields zeros rather than
 * NaNs, so a malformed asset draws flat water instead of nothing at all.
 */
export function buildWaterUv(positions: ArrayLike<number>): WaterUvResult {
  const count = Math.floor(positions.length / 3);
  const uv = new Float32Array(count * 2);
  if (count === 0) return { uv, flowAxis: 1, flowLength: 0, crossRadius: 0 };

  const flowAxis = flowAxisOf(positions);
  // The two axes across the flow, in order, so the angle is measured consistently.
  const a = ((flowAxis + 1) % 3) as FlowAxis;
  const b = ((flowAxis + 2) % 3) as FlowAxis;

  let lo = Infinity;
  let hi = -Infinity;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < count; i++) {
    const f = positions[i * 3 + flowAxis];
    if (f < lo) lo = f;
    if (f > hi) hi = f;
    sumA += positions[i * 3 + a];
    sumB += positions[i * 3 + b];
  }
  // The column's own axis, so the angle is measured about the water rather than about the
  // origin the exporter happened to leave it at.
  const centreA = sumA / count;
  const centreB = sumB / count;
  const span = hi - lo;
  const scale = span > 1e-9 ? 1 / span : 0;

  let radiusSum = 0;
  for (let i = 0; i < count; i++) {
    const da = positions[i * 3 + a] - centreA;
    const db = positions[i * 3 + b] - centreB;
    // atan2 in -PI..PI, mapped to 0..1 and continuous around the wrap.
    uv[i * 2] = Math.atan2(db, da) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = (positions[i * 3 + flowAxis] - lo) * scale;
    radiusSum += Math.hypot(da, db);
  }
  return { uv, flowAxis, flowLength: span, crossRadius: radiusSum / count };
}

/**
 * How many times the ripple repeats across the surface.
 *
 * **Derived, not chosen.** The old world-space projection multiplied *metres* by fixed
 * numbers, so its effective tile count depended on how big the water happened to be. Over
 * the jet — 0.331 world units long and 0.018 across — those multipliers worked out as:
 *
 * | layer            | old expression        | tiles along | tiles across |
 * |------------------|-----------------------|-------------|--------------|
 * | surface normal   | `vWPos.y * 2.0 * 4.5` | 2.98        | **0.11**     |
 * | highlight / foam | `vWPos.y * 2.5 * 5.0` | 4.14        | **0.09**     |
 *
 * The along-flow figures are the density the water was authored to look like, so they are
 * kept: 3 and 4. The across-flow figures are the defect itself — a tenth of a repeat cannot
 * vary, so the lookup collapsed to a function of height and drew stripes — and they are
 * replaced by counts that actually vary over the visible surface.
 *
 * Kept deliberately low. A first attempt at 7 and 11 along the flow was two to three times
 * the original density and read as a stack of rings: denser is not the same as less banded.
 * The pairs are coprime so the two layers do not beat into a regular pattern of their own.
 */
export const RIPPLE_TILES = {
  /** Repeats around the column, and along it, for the surface-normal layer. */
  normal: { around: 2, along: 3 },
  /** The faster highlight/foam layer. */
  highlight: { around: 3, along: 4 },
  /**
   * A third, finer layer, added once the coordinate was correct (BEDO-WATER-03).
   *
   * The two above were sized against the *old* world-space projection, and they are the
   * right coarse structure: two to four repeats over the whole body. But over a plume 105 mm
   * in mean radius that is a wavelength of roughly 150 mm — a swell, not a water surface,
   * and it was all there was once the geometry stopped supplying detail of its own.
   *
   * Seven and eleven put a repeat every 40 to 60 mm, which is the scale at which a
   * disturbed surface actually breaks up. Coprime with each other and with both pairs
   * above, so the three layers never beat into a pattern.
   */
  detail: { around: 7, along: 11 },
} as const;

/**
 * A vertex's x, y, z, tightly packed, whatever the attribute is actually stored as.
 *
 * ## The defect this exists to close
 *
 * The eight caches ship through gltfpack, which quantises positions to `Uint16` and packs
 * the base mesh and all eighty morph targets into **one interleaved buffer with a stride of
 * four** — x, y, z and a pad component. three.js models that as an
 * `InterleavedBufferAttribute`, so `attribute.array` is the entire 4,368-element buffer, not
 * this mesh's 1,092 xyz triples.
 *
 * `buildWaterUv(position.array)` therefore read quads as triples. Measured on
 * `Water_low.glb`, one vertex in four came out right and the other three were slices across
 * the boundary — `(pad, x, y)`, `(z, pad, x)`, `(y, z, pad)` — so the surface coordinate was
 * a four-vertex sawtooth of nonsense, and it was 1,456 entries long against a geometry of
 * 1,092. Everything downstream of it was reading that: the ripple, the along-flow depth
 * term, the contact darkening at both ends and the aeration mask.
 *
 * `getX`/`getY`/`getZ` respect the stride and the offset, so this is correct for a plain
 * attribute and for an interleaved one alike, and it is the only thing that should ever be
 * handed to `buildWaterUv` from a loaded asset.
 */
export interface VertexSource {
  readonly count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

export function packPositions(attribute: VertexSource): Float32Array {
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    out[i * 3] = attribute.getX(i);
    out[i * 3 + 1] = attribute.getY(i);
    out[i * 3 + 2] = attribute.getZ(i);
  }
  return out;
}

/** The attribute name the water shader reads its surface coordinate from. */
export const WATER_UV_ATTRIBUTE = 'aWaterUv';

/**
 * The attribute carrying `crossRadius`, so the shared material can size its ripple — and,
 * in its **sign**, which way that shape's water is running.
 *
 * A per-vertex copy of one per-mesh constant, which is the cheapest way to hand a value to
 * a material eight meshes share: a uniform would have to be rewritten between draw calls,
 * and a per-mesh material clone would multiply the programs and the draw state. At 300 to
 * 1,900 vertices per shape this is at most 7.7 kB across the whole set.
 *
 * ## Why the sign carries the flow sense (BEDO-WATER-04)
 *
 * `aWaterUv.y` runs 0 at the bottom of a shape and 1 at the top, and the top is the
 * deflector on all eight. That means the *same* coordinate describes two opposite flows:
 *
 *   * the pre-impact column climbs from the nozzle to the plate, so its surface detail
 *     travels toward v = 1;
 *   * every after-impact plume leaves the plate and runs down and outward to the tank
 *     floor, so its detail travels toward v = 0.
 *
 * One scroll direction was used for both, and measured on the rendered frames it was the
 * column's: correlating consecutive difference images put the moving structure 19 to 72 px
 * per 0.2 s *up* the screen in every state, toward the impact rather than away from it —
 * the four plumes were running backwards. The magnitude and the sense are one number per
 * shape, so they travel in one attribute rather than two.
 *
 * `WATER_FLOW_SENSE` names the two values; the shader reads `abs()` for the amplitude and
 * `sign()` for the direction.
 */
export const WATER_AMPLITUDE_ATTRIBUTE = 'aWaterAmp';

/**
 * Which way a shape's water runs along its own `aWaterUv.y`.
 *
 * `toward` is +1: the flow climbs the surface coordinate, which is the pre-impact column.
 * `away` is -1: the flow descends it, which is every plume spreading off a deflector.
 *
 * A plume cache also contains the column that feeds it, and one sign cannot describe both
 * halves of a shape. The sheet is what the learner sees — the column inside a plume is
 * enclosed by it — so the sheet's sense is the one the shape carries.
 */
export const WATER_FLOW_SENSE = { toward: 1, away: -1 } as const;

/**
 * How much of its own cross-section a shape ripples by.
 *
 * Derived from what the reference shows rather than chosen: between 60 s and 64 s the
 * water region of `Bedo_Mesu_J.mp4` changes by 0.65/255 per frame against 0.05 for a
 * static background — a surface that shimmers rather than boils. Four and a half per cent
 * of the cross-section is the displacement that reads at the guided camera distance
 * without disturbing the authored silhouette, which the morph cache owns.
 */
export const RIPPLE_AMPLITUDE = 0.030;
