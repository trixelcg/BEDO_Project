# 43 — Water shader sampling and the banding

Closes the second half of **BUG‑03**: the striping on the water surface.

`BEDO‑017` (`docs/41`) fixed the water's *size*. This fixes how its surface is *sampled*.
No physics changed; `TRAVEL_HEIGHT_M` was not touched (§11).

---

## 1. The defect, reproduced at HEAD

Reproduced at `5c461d5` with `scripts/water-shader.mjs`, which flies the camera in until the
water fills a known fraction of frame and then holds one framing for every deflector family,
so the images are comparable rather than impressionistic.

The water rendered as **horizontal streaky bands** across the column — light and dark stripes
running perpendicular to the flow, with no variation across the width. Visible on every
shape, before and after impact.

`measurements/water/shader-before/`.

### Where it came from

Four texture lookups, all sampling **world position**:

```glsl
vec2 uvTop  = vWPos.xz * 6.0 + vec2(uTime * 1.2, uTime * 0.9);
vec2 uvSide = vec2(vWPos.x + vWPos.z, vWPos.y * 2.0) * 4.5 - vec2(0.0, uTime * 7.5);
float hTop  = texture2D(uWaterTex, vWPos.xz * 5.0 + …).b;
float hSide = texture2D(uWaterTex, vec2(vWPos.x - vWPos.z, vWPos.y * 2.5) * 5.0 - …).b;
```

A world-space planar projection. Converting those multipliers into **repeats over the jet**
(0.331 world units long, 0.018 across) shows the problem exactly:

| Layer | Expression | Tiles **along** | Tiles **across** |
|---|---|---|---|
| surface normal | `vWPos.y * 2.0 * 4.5` | 2.98 | **0.11** |
| highlight / foam | `vWPos.y * 2.5 * 5.0` | 4.14 | **0.09** |

**A tenth of a repeat cannot vary.** Across the water's narrow cross-section the lookup was
effectively constant, so a 2‑D texture fetch collapsed into a function of height alone — and
a function of height alone, drawn on a column, is a stack of horizontal bands.

**`BEDO‑017` sharpened it by a factor of seventeen.** Correcting the jet from 172 mm to its
true 10 mm bore cut the cross-flow variation to almost nothing. The banding was latent
before and obvious after; the size fix did not cause it but did expose it.

---

## 2. Water asset UV inventory

Re-read from the GLB accessors for this task rather than taken from `docs/41`.

| Asset | Prims | TEXCOORD_0 | TEXCOORD_1 | U range | V range | Flow axis | Flow tracks |
|---|---|---|---|---|---|---|---|
| `Water_low` | 3 | ✅ | — | 0.36–0.64 | −0.02–0.74 | Z, Y, Z | V (+0.973), U, V (**−0.996**) |
| `Water90_Flat` | 2 | ✅ | ✅ | 0.00–1.03 | 0.13–0.90 | Y, Z | V (−0.999), U (0.529) |
| `Water120_HemiSphere` | 3 | ✅ | — | 0.36–0.64 | −0.02–0.80 | Z, Y, Z | V, U, V |
| `Water135_Conical` | 3 | ✅ | — | −0.02–0.94 | −0.54–1.50 | Z, Y, Z | V (+0.997), U, V (−0.971) |
| `Water180_HemiSphere` | 2 | ✅ | ✅ | 0.04–0.95 | 0.25–0.86 | Z, Z | U (0.765), U (0.454) |
| `Water30` | 2 | ✅ | — | −0.06–0.99 | 0.16–1.62 | Y, Z | U (−0.630), V (+0.999) |
| `Water45_Oblique` | 2 | ✅ | ✅ | −0.23–0.65 | 0.17–0.99 | Y, Z | V (−0.979), **neither (0.003 / −0.003)** |
| `Water60_Cone` | 2 | ✅ | — | −0.22–0.79 | −0.24–1.03 | Z, Y | V (−1.000), U (0.416) |

**All eight declare `textures: 0, images: 0`**, with bare `Max_MaterialID_*` materials.

`docs/41` recorded TEXCOORD_1 on two assets. It is on **three** — `Water45_Oblique` has one
too. `docs/41 §9` is corrected accordingly.

---

## 3. Authoritative UV set: none of them

`§3` of the brief says not to reach for `TEXCOORD_0` just because it exists. Having inspected
the authored mapping, it cannot serve as a ripple coordinate:

1. **It addresses nothing.** No asset ships a texture. These are leftover 3ds Max mapping
   coordinates that were never sampled by anything.
2. **It is an atlas, not a tiling.** Each primitive occupies a disjoint band of V —
   `Water_low` runs [−0.02, 0.20], [0.20, 0.24], [0.24, 0.74] — so the same V distance means
   a different geometric distance on each primitive.
3. **It reverses.** Within `Water_low`, V correlates with the flow at **+0.973** on one
   primitive and **−0.996** on another. A ripple tiled across that seam mirrors.
4. **U is not a wrap.** `Water_low` and `Water120_HemiSphere` span 28 % of U.
5. **One primitive has no flow correlation at all** — `Water45_Oblique#1`, 0.003 on U and
   −0.003 on V.

Choosing per-asset channels would mean filename conditionals in shader code, which `§3`
forbids and which would be unmaintainable besides.

**Chosen instead: a cylindrical parameterisation derived from each mesh's own vertices**, in
`src/lib/waterUv.ts`, baked into a geometry attribute (`aWaterUv`) once at load:

```
u = angle about the flow axis, wrapped to 0..1
v = distance along the flow axis, normalised by that mesh's own bounds
```

One rule, all eight shapes, no special cases. Object space, so it is welded to the water.
The flow axis is **measured per mesh** — three shapes are authored lying down with their
length on Z, so it cannot be assumed to be Y.

---

## 4. New sampling

```glsl
attribute vec2 aWaterUv;          // vertex
varying  vec2 vWaterUv;

vec2 uvA = vWaterUv * vec2(2.0, 3.0) + vec2(uTime * 0.10, -uTime * 0.55);
vec2 uvB = vWaterUv * vec2(3.0, 4.0) + vec2(-uTime * 0.07, -uTime * 0.85);
```

`vWPos` survives in exactly one place — `normalize(cameraPosition - vWPos)` for the rim
term, which genuinely needs a view vector. It is never a texture coordinate again, and a test
asserts that.

**Flow direction**: `v` runs along the flow by construction, so scrolling is `−uTime` on `y`.
A small `x` drift keeps the two layers from marching in lockstep.

**Animation is unchanged in kind** (§5): the coordinate is spatial, the motion is `uTime`.
Nothing about time is baked into geometry.

### A vertex bug found on the way

The displacement used `clamp(position.y * 0.05 + 0.5, 0.0, 1.0)` as a 0..1 height, assuming
every shape was ~20 units tall and centred on the origin. Most are not — `Water90_Flat` sits
at y 106.9 to 128.9 — so that expression was **pinned at 1** for them and the ripple built
toward nothing. It now uses `aWaterUv.y`, which is normalised per mesh.

---

## 5. Frequency mapping — derived, then calibrated

| | Old (per world metre) | Old tiles over the jet | New (tiles per surface) |
|---|---|---|---|
| normal, along | `× 9.0` | 2.98 | **3** |
| normal, across | `× 6.0` | **0.11** | **2** |
| highlight, along | `× 12.5` | 4.14 | **4** |
| highlight, across | `× 5.0` | **0.09** | **3** |

The along-flow counts are the density the water was authored to have, kept. The across-flow
counts are the defect, replaced with values that can actually vary.

**A first attempt used 7 and 11 along the flow and looked worse** — two to three times the
original density, which read as a stack of rings rather than turbulence. That is recorded
because it is the useful lesson: denser is not less banded, and the numbers had to come from
the old effective density rather than from taste. The pairs are coprime so the two layers do
not beat into a regular pattern of their own.

---

## 6. Colour space

The ripple map is generated at runtime into a canvas and its channels are a height/gradient
field the shader does arithmetic on — **data, not colour**. It is now explicitly
`THREE.NoColorSpace`. three.js already defaults a `CanvasTexture` that way; stating it makes
the decision survive a change of default and is asserted by a test.

---

## 7. Before / after

Identical framing, `measurements/water/shader-{before,after}/`, for all seven deflector
families plus the before-impact jet alone and a two-camera pair.

| | Surface |
|---|---|
| **Before** | Horizontal streaky bands across the column; no cross-flow variation |
| **First attempt (7/11)** | Strong regular rings — denser, and worse |
| **After (2/3, 3/4)** | Irregular mottled ripple; flow direction reads down the column; no stripes |

---

## 8. Camera independence

The coordinate is a **geometry attribute in object space**. It is a function of the mesh's
own vertices and of nothing else — no view matrix, no projection, no camera position — so it
cannot swim, by construction rather than by tuning. A test asserts that the same vertices
produce the same coordinate, and that no ripple lookup references `vWPos` or
`cameraPosition`.

Captured from two camera positions (`I-camera-1`, `J-camera-2`) as supporting evidence.

---

## 9. BEDO‑017 regression

Untouched, re-measured after the shader change:

| State | Jet width | Error | Plume |
|---|---|---|---|
| Low flow, reading 1, reading 2, max flow | **10.00 mm** each | **−0.00 %** | 52.0 mm |
| Flat 90°, semi 180°, conical 135°, oblique 45° | **10.00 mm** each | **−0.00 %** | 52.0 mm |

No shader work changed geometry scale.

---

## 10. Performance

| | Before | After |
|---|---|---|
| Idle (perf baseline) | 769 draws / 217,055 tris / 22 binds / 42 programs | **identical** |
| Free-mode idle | 308 / 86,958 / 36 programs | **identical** |
| Flowing, n = 0.40 | 323 / 94,212 / 39 programs | **identical** |

**Zero added draw calls, triangles or shader programs.** The change is fragment and vertex
arithmetic plus one `vec2` attribute, computed once at load. No post-processing.

---

## 11. `TRAVEL_HEIGHT_M` was not changed

The constant says the jet climbs **35 mm**; the shipped model measures **184 mm** from
nozzle lip to deflector — a factor of 5.3. It feeds `impactVelocitySquared` in `computeRow`.
**Nothing here touched it**, and no physics, target mass or balance figure moved. It remains
open and needs BEDO source evidence rather than an engineering decision.

---

## 12. Remaining water debt

1. **`TRAVEL_HEIGHT_M` vs the model geometry** (§11).
2. **No drain behaviour.** Storyboard sl. 29/30 says *"The water will gradually drain from
   the tank if the valve is opened"*; the tank never fills or drains.
3. **`PLUME_SPREAD = 1.6`** remains presentation with no source backing (`docs/41`).
4. **The authored UV channels are still dead weight** in the assets. If the water is ever
   re-authored, real tiling UVs would let `src/lib/waterUv.ts` be deleted rather than
   extended.

---

## 13. Files changed

| File | |
|---|---|
| `src/lib/waterUv.ts` | **new** — the surface coordinate and the tile counts |
| `src/components/DeviceModel.tsx` | attribute baked at load; four lookups re-based; vertex height fixed; texture colour space stated |
| `tests/unit/water-uv.spec.ts` | **new** — 20 tests |
| `scripts/water-shader.mjs` | **new** — framed before/after surface capture |
| `docs/43` (this), `docs/41`, `docs/23` | documentation |
