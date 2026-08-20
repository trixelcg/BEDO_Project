# 19 — Asset Pipeline

**Goal:** 26 MB → ≤ 8 MB critical payload, 764 MB → ≤ 150 MB VRAM, 769 → ≤ 150 draw calls — **without visibly
degrading a model that must read as industrial training equipment.**

---

## 1. Editable sources — they exist

The Phase 1 audit assumed no DCC source. That was wrong. Located during Phase 2:

| Source | Path (relative to `~/Desktop/BEDO_Project/`) | Size | Value |
|---|---|---|---|
| **Blender scene** | `Bedo_MJblend.blend` | 16 MB | Full editable scene — origins, materials, UVs |
| FBX + textures (with room) | `Measurement of Jet Forces/3D model/Measurement of Jet Forces_with_room_scale.fbx` + `.fbm/` | 23.5 MB | **Original-resolution loose textures** |
| FBX + textures (apparatus) | `Measurement of Jet Forces/3D model/Measurement_of_jetforces.fbx` + `.fbm/` | 21 MB | As above |
| Unity package | `Bedo_Unity/Bedo_Measurement_of_jet_forces.unitypackage` | 87 MB | The reference build |
| Unity project | `Project_VL-FM009/` (HighlightPlus, PlayMaker, RTLTMPro) | — | Reference interaction/highlight behaviour |
| Alembic water caches | `BEDO_Project_R3F/public/WaterShapes/*.abc` | 20 MB | Re-authorable plume sources |

The `.fbm/` folders hold the **original** `plate_uv.png`, `pointer_uv.png`, `Jetforce_background.png`,
`ground_uv_3.png`, weight sheets and deflector labels. Re-budgeting from these avoids generation loss from
re-compressing already-baked PNGs.

⚠️ **Ownership of `Bedo_MJblend.blend` still needs confirming** — but its existence removes the blocker, and
§5 separates what can be done at runtime from what should be done in the DCC.

---

## 2. Where the weight actually is

| | Bytes | Share |
|---|---|---|
| Textures (42 images) | 23.05 MB | **89 %** |
| Geometry (48 487 tris) | ~2.5 MB | 10 % |
| JSON | 0.20 MB | 1 % |

**Geometry is not the problem.** Draco/meshopt on 48 k triangles saves ~1–2 MB; texture work saves ~20 MB and
**614 MB of VRAM**. Sequence accordingly.

---

## 3. Texture strategy

### 3.1 Re-budget resolutions first (biggest win, no quality loss where it matters)

| Image | Now | Target | VRAM now → then |
|---|---|---|---|
| `MergedBake_..._Lightmap` | 4096² | **1024²** | 85.3 → 5.3 MB |
| `MergedBake_..._Normal` | 4096² | **1024²** | 85.3 → 5.3 MB |
| `MergedBake_..._Diffuse` | 4096² | **1024²** | 85.3 → 5.3 MB |
| `MergedBake_..._Metalness` | 4096² | **drop → scalar** if uniform | 85.3 → 0 |
| `MergedBake_..._Diffuse_A` | 4096² | **drop** (alpha companion; see §3.3) | 85.3 → 0 |
| `Jetforce_background` (wall chart) | 4800×2950 | **2048×1280** | 72.0 → 14.0 MB |
| `background_uv_small` | 2598×1923 | 1024×768 | 25.4 → 4.2 MB |
| `weight_50/100/200/500/custom_uv` | 5 × 2048² | **one 1024² atlas** | 106.7 → 5.3 MB |
| `pointer_uv` | 2048² | 1024² | 21.3 → 5.3 MB |
| `plate_uv` | 2048² | 1024² | 21.3 → 5.3 MB |
| `red_led_off` | 2048² | **64²** | 21.3 → 0.02 MB |
| `water hose entry_uv` | 2048×2018 | 1024² | 21.0 → 5.3 MB |
| `Gray metal` | 1396×2696 | 1024×2048 | 19.1 → 10.7 MB |
| `numbering_cad` | 413×3602 | 256×2048 | 7.6 → 2.7 MB |
| 7 deflector labels | 7 × 267×115 | **one 512² atlas** | 1.1 → 1.3 MB |
| remainder (22) | — | halve where > 512² | ~7.8 → ~4 MB |

**Estimated VRAM: 764 MB → ~75 MB before compression.**

The room bake alone is 426 MB (56 % of the budget) for scenery the student never touches. At 1024² it remains
perfectly convincing at the camera distances the four named views use — this must be verified with a
before/after at 1920×1080, not assumed.

### 3.2 Then compress: KTX2 / Basis Universal

```bash
gltf-transform uastc apparatus.glb apparatus.ktx2.glb \
  --slots "{baseColorTexture,emissiveTexture}" --level 4 --rdo 4 --zstd 18
gltf-transform etc1s apparatus.ktx2.glb apparatus.final.glb \
  --slots "{normalTexture,metallicRoughnessTexture,occlusionTexture}" --quality 200
```

- **UASTC** for base colour and the lightmap (quality-critical).
- **ETC1S** for normal / metal-rough / AO (far smaller, artefacts imperceptible on these).
- GPU-native: stays compressed **in VRAM** (~4–6× smaller than RGBA8) and needs **no CPU decode** — which is
  most of the 15–20 s load (`BUG‑01`).

**Estimated VRAM after: ~75 MB → ~20–30 MB. File: ~23 MB → ~4 MB.**

> Requires `KTX2Loader` with a transcoder, and a WebGL2 device — already our target (`docs/12 §0`).

### 3.3 Alpha and culling audit

- 19 of 68 materials are `alphaMode: BLEND`; most are Blender defaulting because a base-colour texture carries
  an alpha channel (`..._Diffuse_A` is exactly that). Switch to `OPAQUE` where alpha does not vary, `MASK` with
  `alphaCutoff` for the label decals. Reserve `BLEND` for the tank glass and the water (`RND‑04`).
- 68 of 68 are `doubleSided`. Turn culling on except for genuine single-surface geometry, and fix the inverted
  normals this exposes rather than hiding them (`RND‑03`).

---

## 4. Geometry strategy

| Action | Effect |
|---|---|
| **Merge the 26 static room nodes** into one mesh sharing one bake | ~26 draws → 1 |
| **Merge the static bench frame, pipework and panel** | ~60 draws → ~5 |
| Keep every **interactive/animated** part separate | cover, screws, rod, spring, pointer, 7+7 deflectors, 5 weights, 2 valves, switch, lamp ≈ 25 draws |
| Consolidate materials via the atlases in §3.1 | 68 → ~20, enabling real batching |
| `meshopt` compression (`EXT_meshopt_compression`) | ~40 % geometry, fast decode; preferred over Draco for its decode speed |

**Estimated: 181 primitives → ~35 static + ~25 dynamic ≈ 60 base draws.** With shadows limited to dynamic parts
and transmission cut to one material, total lands **well under the 150 budget**.

---

## 5. `DCC_ASSET_ACTIONS_REQUIRED`

Work that should be done in Blender / the DCC rather than compensated for at runtime forever. Each entry states
whether a runtime workaround exists in the meantime.

| ID | Action | Why it belongs in the DCC | Runtime workaround available? |
|---|---|---|---|
| **D‑1** | **Set each interactive part's origin to its own centre** (valves, switch, pointer, spring, weights, deflectors) | The GLB is baked: every tray node shares translation `(0, 1.239, −1.232)` while geometry lives metres away in vertex space. The app currently performs **runtime scene-graph surgery** — inserting pivot `Group`s and subtracting centres (`DeviceModel.tsx:464‑531`) — to work around this. | ✅ Yes — the existing shim, isolated into `assets/loadApparatus.ts` with explicit teardown |
| **D‑2** | **Add a real nozzle node** sized to the 10 mm bore | `MESH.nozzle` points at `JET Force 2_214`, a `0.227 × 0.048 × 0.227` base flange **wider than the tank** (`BUG‑27`). There is no correct geometric reference for the jet. | ✅ Yes — derive from `NOZZLE_AREA_M2` (`docs/17 §5.3`), which is the better source anyway |
| **D‑3** | **Re-origin the weight discs** to their own centres | Root cause of the 2.18 m misplacement (`BUG‑02`) | ✅ Yes — single-space correction (`docs/17 §5.2`) |
| **D‑4** | **Fix tank and cover materials at source**: `Tank_cover` opaque metal using `plate_uv`; `JET Force 2_205` real glass | The app force-replaces the cover material at runtime, creating a new `MeshPhysicalMaterial` per settings change and leaking it (`BUG‑17`), and rendering a metal plate as glass (`RND‑02`) | ⚠️ Partial — can be assigned at load, but the authored material is the right home |
| **D‑5** | **Re‑author the 8 water plumes at physical size**, origin at the nozzle end, upright | They are ~20 units tall, parked far from origin (`Water90_Flat` at y = +117.9) and some lie down, so the runtime applies a wildly non‑uniform scale (`~0.9 × 0.05 × 0.9`) that squashes the shader's own vertex ripple to ~8 mm and invalidates its normal transform (`RND‑09`). **UVs are NOT the problem — see the note below.** | ✅ **Yes for UVs** (they already exist); ⚠️ partial for size |
| **D‑6** | **Re-export textures at the §3.1 budget from the `.fbm` originals** | Avoids generation loss from re-compressing bakes | ✅ Yes — `gltf-transform resize`, at some quality cost |
| **D‑7** | **Merge static room and bench geometry** (§4) | Cleanest in the DCC where the hierarchy is meaningful | ✅ Yes — `gltf-transform join` |
| **D‑8** | **Turn off `doubleSided` and fix the normals it exposes** | Normal repair needs the modelling tool | ⚠️ Partial — the flag can be flipped at build time, but inverted faces then show |
| **D‑9** | **Split into `apparatus.glb` + `room.glb`** for staged loading | Requires a deliberate scene split | ✅ Yes — `gltf-transform` partition |
| **D‑10** | **Add a `Weight_20` mesh and distinct thicknesses per denomination** | 10 g, 20 g and 25 g currently all render as `Weight_Custom`, which is as thick as the 500 g disc (`BUG‑34`) | ❌ No — needs new geometry |
| **D‑11** | **Model the sump water** | `LIQUID001` is a degenerate `0.000 × 0.017 × 0.007` sliver unrelated to the tank (`BUG‑28`); the tank cannot drain visibly (storyboard sl. 30) without it | ❌ No — needs new geometry |

> **⚠️ Correction to the Phase 1 audit (D‑5).** The shader comment states the plumes *"carry no usable UVs"*.
> Verified directly against the eight binaries: **every plume has `TEXCOORD_0`**, and `Water90_Flat`,
> `Water180_HemiSphere` and `Water45_Oblique` also have `TEXCOORD_1`. V runs **along the flow**
> (`Water_low`: `v[-0.02..0.20]` → `v[0.20..0.24]` → `v[0.24..0.74]` across its three primitives). The shader's
> world‑space planar fallback — the cause of the visible banding — is therefore unnecessary and can be replaced
> with UV sampling **in code**, with no DCC dependency. Only the physical‑size/origin half of D‑5 needs Blender.

**Recommendation:** do **D‑6, D‑7, D‑9** immediately with `gltf-transform` (no `.blend` needed, biggest wins),
and schedule **D‑1 – D‑5, D‑10, D‑11** for a DCC pass once `.blend` ownership is confirmed. `D‑2`/`D‑3` have
good runtime answers and should not block the P0 fixes.

---

## 6. Loading strategy

| Stage | Assets | Budget | Blocking? |
|---|---|---|---|
| **Boot** | inline critical CSS + logo | < 10 KB | — |
| **Shell** | JS entry (React + UI) | ≤ 150 KB gz | yes |
| **Core scene** | `apparatus.glb` (KTX2 + meshopt), environment | **≤ 8 MB** | yes — gates TRAINING READY |
| **Deferred** | `room.glb`, remaining plumes | ~3 MB | no |
| **On demand** | walkthrough video, answer-sheet PDFs | — | no |

Rules: `useGLTF.preload` only for the critical stage; the drei loading manager drives a **DOM** progress UI;
the environment map loads after the apparatus; the video is `preload="none"` behind a poster (`BUG‑25`).

---

## 7. Delete (≈ 39 MB, `PERF‑12`)

| File | Size |
|---|---|
| `public/Bedo_M.glb` | 17 MB |
| `public/WaterShapes/*.abc` (8) | 20 MB |
| `public/Bedo_model_optimized.glb` | 1.7 MB |
| `public/icons.svg`, `src/assets/{hero.png,react.svg,vite.svg}` | 28 KB |

The `.abc` caches move to the art repo (they are authoring sources, per D‑5). `docs/reference/Bedo_Mesu_J.mp4`
is byte-identical to `public/Bedo_Mesu_J.mp4` — keep one, and move binaries to Git LFS so `.git` (110 MB) stops
growing.

---

## 8. Build-time enforcement

```jsonc
// asset-budget.json — checked in CI
{ "apparatus.glb": { "maxBytes": 8388608, "maxVramBytes": 157286400,
                     "maxDrawCalls": 60, "requireKtx2": true, "requireMeshopt": true } }
```

`node scripts/analyze-glb.mjs <file> --json` already emits every field this needs. A CI step compares and fails
the build. This is what stops the budget silently regressing the way it did the first time (`ARCH‑05`).

---

## 9. Quality gate

Compression is not licence to degrade. Before/after screenshots at **1920×1080** for each of the five named
views, reviewed side by side. Specific things to check:

- deflector label decals (`30`, `45`, `60`, `120`, `135`, `180`) still legible at the `deflectorsAndWeights` view
- the BEDO wall chart readable at the `overview` view
- weight denomination markings legible at the `pointer` view
- no banding on the bench, sump or sky
- baked lighting still reads as lighting, not as flat texture
