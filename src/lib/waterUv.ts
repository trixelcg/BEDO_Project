// A surface coordinate for the water, derived from the water's own geometry.
//
// ## Why not the authored UVs
//
// The eight shipped water GLBs all carry `TEXCOORD_0`, and three of them
// (`Water90_Flat`, `Water180_HemiSphere`, `Water45_Oblique`) also carry `TEXCOORD_1`. It is
// tempting to read that as "the assets are UV-mapped, use their UVs". They are not, and it
// does not work:
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
// So the authored channels are inventoried and rejected on evidence, not ignored. If the
// assets are ever re-authored with real tiling UVs, this module is the one place that has
// to change.
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
  if (count === 0) return { uv, flowAxis: 1, flowLength: 0 };

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

  for (let i = 0; i < count; i++) {
    const da = positions[i * 3 + a] - centreA;
    const db = positions[i * 3 + b] - centreB;
    // atan2 in -PI..PI, mapped to 0..1 and continuous around the wrap.
    uv[i * 2] = Math.atan2(db, da) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = (positions[i * 3 + flowAxis] - lo) * scale;
  }
  return { uv, flowAxis, flowLength: span };
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
} as const;

/** The attribute name the water shader reads its surface coordinate from. */
export const WATER_UV_ATTRIBUTE = 'aWaterUv';
