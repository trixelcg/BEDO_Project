# 45 — The apparatus GLB, and where its 26 MB actually went

`public/Bedo_baked_v2.glb` was 27,178,344 bytes and dominated startup: on production it took
**3,436 ms to download** against **272 ms to parse, decode and upload**. It is now 11,948,588
bytes, a **56.0% reduction**, with no texture resized, no geometry decimated, no node renamed
and no application source changed.

| | bytes | sha256 |
|---|---:|---|
| Original | 27,178,344 | `0a7753623aa16529a67fad8077f562a7f7416a55d97c6e6a564bf4bd7bf9ea26` |
| Optimized | 11,948,588 | `f1836e3b0af22f9090df2136899b69e77e455b7dd19d9b3aa3ccf2f6cf24d6f4` |

The original is recoverable exactly from git — `git show 14d8979:public/Bedo_baked_v2.glb`
hashes to the value above — so no second copy is kept. A duplicate would have doubled the
repository's largest object to buy provenance git already provides.

---

## 1. Where the bytes were

Parsed straight from the container, classifying every `bufferView` by what references it:

| | bytes | share |
|---|---:|---:|
| **Textures** | 24,169,428 | **88.9%** |
| Geometry | 2,802,678 | 10.3% |
| JSON + padding | 206,065 | 0.8% |

Geometry breaks down as POSITION 936 KB, NORMAL 936 KB, TEXCOORD_0 517 KB, INDEX 253 KB,
COLOR_0 94 KB, COLOR_1 65 KB.

Two facts removed most of the risk before any work started. There is **no `TEXCOORD_1`** — the
room bake is delivered through *emissive* on UV0, not through a lightmap channel — and there
are **no TANGENT attributes at all**. The two classic ways to destroy a baked model were
therefore not available.

**Geometry was never the opportunity.** Perfect geometry compression could save at most 2.6 MB
of 25.9.

---

## 2. Proving what resolution the camera actually needs

The obvious plan — halve the 4096² maps — was wrong, and measurement is what showed it.

A debug pass reproduces the GPU's own mip selection per fragment:

```glsl
vec2 dx = dFdx(vMapUv * texSize);
vec2 dy = dFdy(vMapUv * texSize);
float mip = log2(max(length(dx), length(dy)));
```

`mip = 1` means two texels per screen pixel, so half the resolution would be indistinguishable.
`mip <= 0` means the texture is being magnified and every texel is earning its place. Sampled
across all eight supported views and accumulated as a **histogram** — a single grazing fragment
otherwise sets an absurd minimum — the tightest demand is the 1st percentile.

| texture | dims | mip p01 | p50 | verdict |
|---|---|---:|---:|---|
| `MergedBake` baseColor/emissive | 4096² | −3.75 | −3.00 | **already magnified — do not touch** |
| `MergedBake.002` | 4096² | −4.25 | −3.50 | already magnified |
| `Pitot1` (wall diagram) | 4800×2950 | +1.00 | +2.75 | over-resolved by 2× |
| `CONE60.001` | 1024² | +1.25 | +2.25 | over-resolved by 2× |

The `MergedBake` result is counter-intuitive and important: it is the largest GPU consumer in
the file (426 MB across five maps) yet it is *under*-resolved per pixel, because it is an
**atlas** — each wall owns only a small island of a shared 4096 sheet. Shrinking it softens the
room while saving almost nothing on disk, since it is only 5.5 MB encoded.

So the winning candidate reduces **no** resolution at all. The saving is entirely encoding.

---

## 3. What the encoding pass does

`scripts/glb/recompress.mjs` rewrites image bufferViews and nothing else. Nodes, hierarchy,
transforms, meshes, accessors, materials and texture slots are copied through untouched.

Colour maps (`baseColor`, `emissive`) become JPEG; anything a shader reads as **data** —
normal, metallic-roughness, occlusion — stays lossless, because JPEG's chroma handling turns
into shading error rather than image noise.

**Alpha is decided by measurement, not by `alphaMode`.** The exporter marked materials `BLEND`
routinely, so the file is full of RGBA images whose alpha channel is a constant 255. Each image
is decoded and its minimum alpha read; only genuinely-opaque images are converted. 16 of 42
images stayed PNG on that test.

Result: textures 23.05 MB → 9.90 MB with every dimension unchanged.

---

## 4. Geometry

`gltfpack -cc -kn -km -ke -kv -noq` — meshopt compression, no quantization.

`EXT_meshopt_compression` is a **true drop-in**: drei's `useGLTF` defaults `useMeshOpt` to true
and wires the decoder from `three-stdlib` at module scope, so nothing in the application
changes. `KHR_draco_mesh_compression` was rejected despite also being nominally supported,
because drei fetches its decoder from `https://www.gstatic.com/draco/…` — a third-party network
dependency at runtime.

The flags matter, and two were found the hard way:

* **`-kv`** — without it gltfpack strips "unused" attributes, which removed `TEXCOORD_0` and
  `COLOR_0` from 44 meshes.
* **`-noq`** — quantization is where transform drift comes from. Without it, world matrices
  stay bit-exact.

`gltf-transform meshopt` was evaluated and **rejected**: it dismantled `deflector_rod`, moving
its mesh out of the node and emptying its material assignment. That node is runtime-critical.

gltfpack also promotes a `BLEND` material with an opaque texture to `OPAQUE`. Defensible, but a
contract change, so `scripts/glb/repair-contract.mjs` restores the authored flags. With an
opaque texture the two render identically.

---

## 5. The contract, and how it is checked

`scripts/glb/manifest.mjs` emits every runtime-facing fact as stable JSON: for all 159 nodes,
the name, path, parent, children, TRS, full world matrix, local bounds and world
bounds/centre/size, plus per-primitive material and attribute set; and for all 68 materials,
texture slots with UV indices, PBR factors, alpha mode and extensions.

`scripts/glb/compare-manifest.mjs` diffs two manifests and exits non-zero on any violation. It
is what caught all three optimizer defects above — none of which a screenshot would have shown.

Final result against the baseline:

```
nodes 159 -> 159        named nodes 159 -> 159      materials 68 -> 68
worst world-matrix delta   0.00e+0
worst bounds-centre delta  1.00e-6
worst bounds-size delta    0.00e+0
CONTRACT OK
```

Three nodes (`JET Force 2_205`, `_212`, `_214`) differ in their stored local translation by
1e-6 — float32 round-trip in the last decimal place, on coordinates spanning 60 units, a
relative error of 1.6e-8. Their composed world matrices are identical.

`meshes 157 -> 128` and `primitives 181 -> 150` are gltfpack sharing identical mesh data
between nodes. Per-node material assignment, attributes and bounds are unchanged, which is
what the runtime resolves against.

---

## 6. What this did not solve

**GPU texture memory is unchanged at ~764 MB.** No drop-in can change it: PNG and JPEG both
decode to RGBA8. Only KTX2/Basis stays compressed on the GPU, and that is not a drop-in —
`KTX2Loader` is not wired into the `useGLTF` path and a transcoder would have to be
self-hosted. Tracked separately.

**The GLB is served with no `content-encoding`.** Production runs a hand-rolled
`http.createServer` in `server.ts` with no compression dependency, so brotli is a code change
rather than a config flip. On the optimized file it would take the transfer from 11.40 MB to
9.11 MB. Deliberately kept out of this release so the improvement stays attributable to the
asset alone.

---

## 7. Reproducing the asset

```
node scripts/glb/recompress.mjs  <original>.glb  textures.glb --quality 0.92 --report report.json
./node_modules/.bin/gltfpack -i textures.glb -o packed.glb -cc -kn -km -ke -kv -noq
node scripts/glb/repair-contract.mjs <original>.glb packed.glb public/Bedo_baked_v2.glb
node scripts/glb/manifest.mjs public/Bedo_baked_v2.glb > candidate.json
node scripts/glb/compare-manifest.mjs assets-source/optimization/baseline/manifest.json candidate.json
```

The last line is the gate: a non-zero exit means the asset is not interchangeable and must not
ship. `assets-source/optimization/baseline/manifest.json` is the frozen contract of the
original and should not be regenerated from a candidate.

`recompress.mjs` uses Chromium through Playwright as its codec — already a dependency, and the
same decoder that will read the result. `--rules '{"18":2400}'` caps individual images by
index when a future asset genuinely is over-resolved.

---

## 8. Rejected candidates

**B (9.92 MB)** halved `Pitot1`, the instructional wall diagram, which the measurement put
exactly at the boundary (p01 mip = 1.0). At 4× zoom the text survives but the cross-hatch
inside the deflector figures smooths. 1.48 MB was not worth instructional detail.

**C (7.84 MB)** additionally halved the `MergedBake` atlas. It is the only candidate that cuts
GPU memory materially (764 → 378 MB) and it fails on quality: the wall diagram falls to PSNR
36.35 / SSIM 0.9728. It also changes the room bake that the room-derived IBL is captured from,
so the error propagates into apparatus reflections everywhere.

## 9. Parity of the shipped asset

Eight deterministic fixed views against the approved production rendering: mean **PSNR 56.16,
SSIM 0.9995**, worst region 53.68. Every label crop — BEDO logo, Main Hydraulic Unit, MADE IN
EGYPT, both control labels, switch face — measures a maximum channel error of **1**. The wall
diagram measures PSNR 55.69 and its deflector artwork SSIM 1.0000.
