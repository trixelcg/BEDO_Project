# 04 — Performance Report

## 0. Measurement method

All figures below are **measured**, not estimated, unless explicitly marked as computed.

- **Runtime GPU metrics** were captured by patching `WebGL2RenderingContext.prototype.drawElements`,
  `drawArrays`, `drawElementsInstanced`, `useProgram` and `bindFramebuffer` in the page's main world and
  sampling 240 consecutive frames of the idle scene.
- **Texture footprint** was computed by parsing `Bedo_baked_v2.glb`'s binary chunk, reading each embedded
  PNG/JPEG header for its true pixel dimensions, and applying RGBA8 + full mip chain (`w·h·4·4/3`), which is
  what three.js uploads given the file's single sampler (`minFilter = LINEAR_MIPMAP_LINEAR`).
- **Network/timing** came from the Navigation and Resource Timing APIs.
- **Host:** Apple‑silicon Mac, Chrome, `devicePixelRatio = 2`, model served from `localhost`. This is roughly a
  **best case**. A vocational lab's integrated‑GPU laptop or tablet is the real target and will be far worse.

---

## Measured baseline

| Metric | Measured | Reasonable target | Over budget by |
|---|---|---|---|
| **Draw calls / frame** | **769** | ≤ 150 | **5.1×** |
| **Triangles submitted / frame** | **217 055** | ≈ 50 000 | **4.3×** |
| **Model triangles (actual)** | 48 487 | — | scene is drawn ~4.5× per frame |
| **Framebuffer binds / frame** | **22** | ≤ 4 | **5.5×** |
| **Compiled shader programs** | 35 | ≤ 20 | 1.8× |
| **Texture VRAM (computed)** | **≈ 764 MB** | ≤ 256 MB | **3.0×** |
| **JS heap (idle, after load)** | 120 MB | ≤ 80 MB | 1.5× |
| **Canvas backing store** | 4726 × 2478 = **11.7 Mpix** | ≤ 4 Mpix | 2.9× |
| **Initial transfer (client)** | **≈ 27 MB** | ≤ 8 MB | 3.4× |
| **JS bundle (1 chunk)** | 1 235 KB raw / 338 KB gz / 264 KB br | ≤ 150 KB gz | 2.3× |
| **`dist/` total** | **95 MB** (39 MB unreferenced) | — | — |
| **Time to visible 3D scene** | **≈ 15–20 s** (localhost!) | ≤ 4 s | 4–5× |
| **Idle frame rate** | 60 fps *on this machine* | 60 | ✅ here only |

The 60 fps figure is the misleading one. This machine has enough GPU headroom to absorb 769 draw calls; the
work is real and will not fit on the target hardware.

---

## Findings

| ID | Title | Severity | Difficulty | Priority |
|---|---|---|---|---|
| PERF‑01 | 764 MB of texture VRAM from 42 uncompressed images | **Blocker** | Moderate | P0 |
| PERF‑02 | 769 draw calls/frame — the scene is rendered ~4.5× | **Critical** | Moderate | P0 |
| PERF‑03 | 22 framebuffer binds/frame from transmission + shadow passes | Critical | Moderate | P0 |
| PERF‑04 | 26 MB blocking model download with no compression | **Blocker** | Moderate | P0 |
| PERF‑05 | `frameloop="always"` — full render at 60 fps on a static scene | High | Easy | P1 |
| PERF‑06 | ~15 full scene‑graph `getObjectByName` walks **per frame** | High | Easy | P1 |
| PERF‑07 | Uncapped DPR → 11.7 Mpix backing store | High | Trivial | P0 |
| PERF‑08 | `preserveDrawingBuffer: true` for a screenshot feature | Medium | Trivial | P1 |
| PERF‑09 | Real‑time shadows layered on a fully baked lightmap | High | Easy | P1 |
| PERF‑10 | `ContactShadows` adds a second, physically wrong shadow pass | Medium | Trivial | P1 |
| PERF‑11 | Single 1.2 MB JS chunk; lucide‑react pulled whole | Medium | Easy | P1 |
| PERF‑12 | 39 MB of unreferenced assets in `dist/` and the container image | Medium | Trivial | P1 |
| PERF‑13 | Every state change re‑renders the 1 197‑line `DeviceModel` | Medium | Moderate | P1 |
| PERF‑14 | 110 inline `style={{}}` objects allocated per render | Low | Easy | P2 |
| PERF‑15 | Material/texture leaks (see `BUG‑17`) | High | Easy | P1 |
| PERF‑16 | `computeRow` × 4 runs on every interaction via effect→setState | Low | Easy | P2 |
| PERF‑17 | No `Range`/CDN for a 28 MB video (see `BUG‑25`) | High | Easy | P1 |

---

### PERF‑01 — 764 MB of texture VRAM

**Severity:** Blocker **Difficulty:** Moderate **Priority:** P0

**Description.** The apparatus GLB embeds 42 images totalling 23 MB compressed. Decoded to RGBA8 with mipmaps
they occupy **≈764 MB of GPU memory**. Full breakdown of the worst offenders:

| VRAM | Dimensions | File | Format | Image |
|---|---|---|---|---|
| 85.3 MB | 4096×4096 | 3 160 KB | png | `MergedBake_SM_D_Wood01_PBR_Lightmap` |
| 85.3 MB | 4096×4096 | 567 KB | png | `MergedBake_SM_D_Wood01_PBR_Normal` |
| 85.3 MB | 4096×4096 | 803 KB | png | `MergedBake_SM_D_Wood01_PBR_Diffuse` |
| 85.3 MB | 4096×4096 | 445 KB | png | `..._PBR_Metalness` |
| 85.3 MB | 4096×4096 | 693 KB | png | `..._PBR_Diffuse_A` |
| 72.0 MB | 4800×2950 | 1 803 KB | png | `Jetforce_background` (the wall chart) |
| 25.4 MB | 2598×1923 | 281 KB | png | `background_uv_small` |
| 21.3 MB ×5 | 2048×2048 | ~1 140 KB ea | png | `weight_50/100/200/500/custom_uv` |
| 21.3 MB | 2048×2048 | 1 875 KB | png | `pointer_uv` |
| 21.3 MB | 2048×2048 | 1 947 KB | png | `plate_uv` |
| 21.3 MB | 2048×2048 | 980 KB | jpeg | `red_led_off` |
| 21.0 MB | 2048×2018 | 1 661 KB | png | `water hose entry_uv` |
| 19.1 MB | 1396×2696 | 399 KB | jpeg | `Gray metal` |
| **≈ 764 MB** | | **23.0 MB** | | **42 images** |

**Root cause.** The model was exported straight out of Blender with no texture budget. Five 4096² sheets are
consumed by the **baked room** — walls, floor, desks, window — i.e. **426 MB of VRAM for scenery the student
never interacts with**. A 2048² sheet is spent on each individual weight disc, and another on an LED that is
one pixel of screen area. There is no `KHR_texture_basisu`, so nothing is GPU‑compressed.

Several dimensions are non‑power‑of‑two and oddly specific (4800×2950, 2598×1923, 413×3602, 2048×2018),
indicating textures were baked at whatever resolution a source image happened to be.

**Affected files.** `public/Bedo_baked_v2.glb`.

**Consequences.** 764 MB exceeds the *total* VRAM of most integrated GPUs and many tablets. On those devices the
driver will thrash, evict, or lose the context outright (`BUG‑33`), and the ~15 s load (`BUG‑01`) is largely the
cost of decoding and uploading this set.

**Recommended solution.**
1. **KTX2 / Basis Universal** (`toktx` or `gltf-transform`) for every texture → GPU‑compressed, typically **6–8×
   smaller in VRAM** and no CPU decode.
2. **Re‑budget resolutions.** Room bake 4096² → 1024² (85 MB → 5 MB each). Wall chart 4800×2950 → 2048×1280.
   Weights 2048² → 512², and **atlas all five onto one sheet**. LED → 64².
3. **Drop channels that carry no information** — a metalness map that is uniform can be a scalar factor.
4. Target: **≤ 150 MB VRAM, ≤ 5 MB file.**
5. Add a CI check that fails if the GLB exceeds its budget.

---

### PERF‑02 — 769 draw calls per frame

**Severity:** Critical **Difficulty:** Moderate **Priority:** P0

**Description.** Measured across 240 frames of a completely static scene: **769.0 draw calls and 217 055
triangles submitted per frame**, against a model containing only 48 487 triangles across 181 primitives. The
scene is therefore rasterised roughly **4.5 times every frame**.

**Root cause — the multiplier, decomposed:**

| Pass | Draws | Why |
|---|---|---|
| Main colour pass | ~181 | 181 primitives, 68 materials — almost no batching possible |
| Shadow map (1 casting light) | ~181 | `castShadow = true` forced on **all 157 meshes** (`DeviceModel.tsx:183`) |
| Transmission pass ×N | ~181 × N | three.js renders the **entire scene into a render target for every transmissive material** |
| `ContactShadows` | ~181 | A second, independent depth render of the scene |
| **Total measured** | **769** | consistent with ~4.5 full scene passes |

The 22 framebuffer binds per frame (`PERF‑03`) confirm the multi‑pass structure.

**Why batching cannot help as authored:** 68 distinct materials across 157 meshes, all `doubleSided`, several
`BLEND`. Nothing shares state.

**Affected files.** `public/Bedo_baked_v2.glb`, `src/components/DeviceModel.tsx:181‑207`,
`src/components/Scene3D.tsx:204‑222`.

**Recommended solution.**
1. **Merge static geometry.** The room (walls, floor, desks, window, chart) is 26 nodes that never move and share
   one bake — merge into **one** mesh. The bench frame, pipework and panel are similarly static.
   Target ≤ 30 static draws + ~20 dynamic parts.
2. **Cut the material count** by atlasing (`PERF‑01`) — fewer materials means fewer state changes and real
   batching opportunities.
3. **Stop forcing `castShadow` on everything.** Only the cover, screws, rod, deflector, weights and pointer need
   to cast. Walls and floor do not (they are baked).
4. **Eliminate the transmission passes** — see `PERF‑03`.
5. Turn on frustum culling benefits by not parenting everything under one giant group whose bounds cover the room.

---

### PERF‑03 — 22 framebuffer binds/frame from transmission and shadow render targets

**Severity:** Critical **Difficulty:** Moderate **Priority:** P0

**Description.** 22 `bindFramebuffer` calls per frame for a scene with one shadow‑casting light. The excess
comes from `MeshPhysicalMaterial.transmission`.

**Root cause.** Three transmission sources:
1. The GLB itself declares `KHR_materials_transmission` on two materials (`Material #27568`, `Material #27572`).
2. `DeviceModel.tsx:188‑201` **replaces the tank cover's material** with a new `MeshPhysicalMaterial` at
   `transmission: 0.98`, `ior: 1.52`, `thickness: 1.5`, `clearcoat: 1.0`.
3. `waterMaterial` (`:285‑310`) sets `transmission: 0.3`, `thickness: 0.35`, `ior: 1.33`, plus `clearcoat`.

three.js resolves transmission by rendering the **entire opaque scene into a separate render target** per
transmissive material, per frame, at the current resolution — here 4726×2478 (`PERF‑07`). Three transmissive
materials therefore triple the full scene cost, plus the shadow pass, plus `ContactShadows`.

The cover's transmission is also **visually wrong**: the "upper plate" the student unscrews is a metal plate on
the real rig, and rendering it as 98 %‑transmissive glass is why it reads as a floating blue disc in every
screenshot.

**Recommended solution.** Reserve transmission for the tank glass **only**, and even then consider a cheaper
`transparent + opacity + envMap` approximation. Make the cover plate opaque metal (correct **and** free). For the
water, use a hand‑authored transparent shader rather than physical transmission. Target ≤ 1 transmissive
material, ideally 0.

---

### PERF‑04 — 26 MB blocking model download, uncompressed

**Severity:** Blocker **Difficulty:** Moderate **Priority:** P0

**Description.** `Bedo_baked_v2.glb` is 26 542 KB, fetched before anything renders. On localhost it downloaded
in 386 ms; on a 10 Mbit school connection that is **~21 seconds of download alone**, before the ~15 s of decode
and upload (`BUG‑01`).

**Root cause.** No Draco/meshopt geometry compression, no KTX2 textures, no LOD, no progressive load, and no
splitting of the room from the apparatus. Geometry is only 48 k triangles — **89 % of the file is texture**.

**Recommended solution.** Combined with `PERF‑01`: KTX2 + meshopt should land the apparatus at **2–4 MB**. Split
the file so the interactive rig loads first and the room streams in second. Serve from a CDN with brotli and
correct cache headers (`ARCH‑12`).

---

### PERF‑05 — `frameloop="always"` on a static scene

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** Measured 240 frames in 4 s with nothing on screen changing. The app re‑renders the entire
769‑draw‑call scene 60 times a second while the student reads a step description. On a laptop this is a
continuous ~15–25 W GPU draw; on a tablet it is thermal throttling and battery drain within minutes.

**Root cause.** `<Canvas>` (`Scene3D.tsx:187‑192`) does not set `frameloop`, so R3F defaults to `"always"`.
`DeviceModel`'s `useFrame` runs unconditionally and always writes transforms, so even an on‑demand loop would
need invalidation discipline.

**Recommended solution.** `frameloop="demand"` plus explicit `invalidate()` from the animation controllers, with
a continuous loop only while something is actually animating (camera flight, unscrew sequence, water flowing,
highlight pulse). The pulse highlight should be CSS‑like and cheap, or paused when the pointer is idle.

---

### PERF‑06 — ~15 full scene‑graph searches per frame

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** `pick(name)` is `scene.getObjectByName(...)` — an **O(n) depth‑first walk of 159 nodes**, with a
second full walk as a fallback (`DeviceModel.tsx:166‑170`). It is called from inside `useFrame`:

| Call site | Line | Calls per frame |
|---|---|---|
| `setGlow(key, …)` for each highlighted part | 874‑877 | 1–7 (**7 during step 2**) |
| `clearGlow(key)` | 866‑869 | 0–7 |
| power lamp material | 939 | 1 |
| `lift(tankCover)`, `lift(screws)` | 980‑981 | 2 |
| `pick(rod)`, `pick(pointerPin)` | 984, 988 | 2 |
| `pick(deflector.installed)` | 1008 | 1 |
| `WEIGHTS.forEach(pick)` | 1083‑1090 | **6** |

That is **15–25 full scene‑graph traversals per frame, ≈900–1500 per second**, plus a `traverse()` of each
found subtree inside `setGlow`/`clearGlow` which then writes `material.emissive` and `emissiveIntensity` every
frame (forcing uniform re‑upload on up to 7 materials).

**Recommended solution.** Resolve every name **once** at load into a typed refs object (`ARCH‑01`). Drive the
highlight pulse from a single shared uniform or a single emissive value, updated only when it changes.

---

### PERF‑07 — Uncapped device pixel ratio

**Severity:** High **Difficulty:** Trivial **Priority:** P0

**Description.** Measured canvas backing store: **4726 × 2478 = 11.7 megapixels** at `devicePixelRatio = 2`.
Every one of the ~4.5 full scene passes per frame (`PERF‑02`) rasterises at that resolution, and so does each
transmission render target.

**Root cause.** `<Canvas>` (`Scene3D.tsx:187‑192`) sets no `dpr`, so R3F's default `[1, 2]` clamps to 2 on any
retina display. `antialias: true` adds MSAA on top.

**Recommended solution.** `dpr={[1, 1.5]}` as a baseline, with an adaptive controller (drei's
`<PerformanceMonitor>` / `<AdaptiveDpr>`) that drops DPR when frame time rises. This one line is the single
cheapest large win available.

---

### PERF‑08 — `preserveDrawingBuffer: true`

**Severity:** Medium **Difficulty:** Trivial **Priority:** P1

**Description.** `Scene3D.tsx:191` enables `preserveDrawingBuffer` so `SoftwareMonitor.handleSaveScreen` can call
`canvas.toDataURL()`. This forces the browser to retain the back buffer after every composite, disabling
buffer‑swap optimisations and adding an 11.7 Mpix copy per frame — permanently, for a feature used at most once
per session.

Secondary defect: "Save Screen" captures the **3D canvas**, not the data monitor the student is looking at
(`SoftwareMonitor.tsx:114‑121` selects `document.querySelector('canvas')`). It saves the wrong screen.

**Recommended solution.** Drop the flag; render one frame on demand and read back immediately
(`gl.render(scene, camera); canvas.toDataURL()` inside the same tick), or use `gl.domElement.toBlob()` after an
explicit `invalidate()`. Capture the monitor DOM instead when the monitor is open.

---

### PERF‑09 — Real‑time shadows layered on a baked lightmap

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** The GLB ships `MergedBake_SM_D_Wood01_PBR_Lightmap` — the room's lighting is **already baked
in**. On top of that the app adds an ambient light, **three** directional lights (one `castShadow` with a
1024² PCF map), an environment map at `environmentIntensity = 1.0`, and `ContactShadows`. The result is the
washed‑out, double‑lit look visible in every screenshot, at the cost of a full extra scene pass.

Worse, the shadow camera is `left/right/top/bottom = ±2` (`Scene3D.tsx:210‑213`) while the model group is scaled
1.8 and spans an entire room — so the shadow frustum covers only part of the scene, giving inconsistent or
missing shadows *and* poor texel density where it does apply.

**Recommended solution.** Decide on one lighting model. Given the bake exists, the right answer is: keep the
lightmap, use the environment map for specular only, and cast **one** tight shadow map limited to the apparatus
(a small ortho frustum around the bench, 1024² is then plenty). Remove the two decorative fill lights and the
`selfIllumination * (2.0 - contrast)` / `0.8 * contrast` coupling, which entangles two unrelated controls.

---

### PERF‑10 — `ContactShadows` adds a wrong second shadow

**Severity:** Medium **Difficulty:** Trivial **Priority:** P1

**Description.** `<ContactShadows position={[0,-1.81,0]} scale={6} blur={2.4} far={3}/>`
(`Scene3D.tsx:222`) renders the scene from below into its own render target every frame. The model already has
a baked floor with baked contact darkening, so this is a second, physically inconsistent shadow, and it is one
of the 22 framebuffer binds.

**Recommended solution.** Remove it. If a grounding cue is wanted under the bench, bake it.

---

### PERF‑11 — Single 1.2 MB JS chunk

**Severity:** Medium **Difficulty:** Easy **Priority:** P1

**Description.** `dist/assets/index-DnOhAhMB.js` — **1 235 395 B raw / 337 627 B gzip / 263 896 B brotli**, one
file, no splitting. `vite.config.ts:6‑9` raises `chunkSizeWarningLimit` to 1500 rather than addressing it.
`lucide-react` is 39 MB installed and imported via the barrel; `SoftwareMonitor`, `MenuSettings` and the video
modal are all eagerly bundled despite being conditionally rendered.

**Recommended solution.** `React.lazy` the three conditional surfaces; `manualChunks` for `three`; per‑icon
imports or inline SVG; drop `framer-motion` and `@react-three/postprocessing` (`TD‑02`). Realistic target:
~150 KB gzip initial + a lazily loaded three chunk.

---

### PERF‑12 — 39 MB of unreferenced assets shipped

**Severity:** Medium **Difficulty:** Trivial **Priority:** P1

**Description.** `dist/` is **95 MB**. Never requested by any client:

| File | Size |
|---|---|
| `Bedo_M.glb` | 17 MB |
| `WaterShapes/*.abc` × 8 | 20 MB |
| `Bedo_model_optimized.glb` | 1.7 MB |
| `icons.svg`, `src/assets/*` | 28 KB |
| **Total dead** | **≈ 39 MB** |

These inflate the container image, every Cloud Build, every Cloud Run cold start's layer pull, and the git
history (`.git` is 110 MB).

**Recommended solution.** Delete them from `public/`; keep `.abc` authoring sources in a separate art repo or
Git LFS. Add `.glbignore`‑style hygiene to CI.

---

### PERF‑13 — Every state change re‑renders `DeviceModel`

**Severity:** Medium **Difficulty:** Moderate **Priority:** P1

**Description.** See `ARCH‑02`. Because `DeviceModel` is not memoised and receives the whole `state`, opening a
toast, moving a settings slider, switching a sidebar tab or answering the quiz re‑runs a 1 197‑line component
body: 12 hooks re‑evaluated, `liveKeys`/`arrowPos`/`stack` recomputed, 15 hotspot JSX elements re‑created, and
the `useFrame` callback re‑registered. `MenuSettings`'s sliders fire on every `input` event, so a single drag
produces dozens of these.

**Recommended solution.** Store‑based selectors (`ARCH‑02`/`ARCH‑03`); debounce/`onChange`‑commit the settings
sliders; keep UI‑only state out of the canvas subtree entirely.

---

### PERF‑14 — 110 inline style objects per render

**Severity:** Low **Difficulty:** Easy **Priority:** P2

**Description.** `style={{…}}` occurrences: `UIOverlay` 49, `MenuSettings` 38, `SoftwareMonitor` 23. Each is a
fresh object literal every render, defeating React's prop bailout on every styled element and forcing style
recalculation.

**Recommended solution.** Move to CSS classes / CSS Modules with data attributes for variants. This is also the
fix for `BUG‑08` and `BUG‑26`.

---

### PERF‑15 — Material and texture leaks

See `BUG‑17`. Cover material (a transmissive `MeshPhysicalMaterial` + shader program) leaks on every settings
slider tick; `waterTex` (a 256² `CanvasTexture`) and `waterMaterial` are never disposed; highlight clones are
disposed correctly (`clearGlow`, `DeviceModel.tsx:826‑837`) — that one is done right.

---

### PERF‑16 — `computeRow` runs 4× per interaction through an effect→setState round trip

**Severity:** Low **Difficulty:** Easy **Priority:** P2

**Description.** `App.tsx:146‑169` recomputes **all four** result rows in a `useEffect` and writes them back into
the same state object, causing a second render for every click. Individually cheap; structurally wrong (derived
data stored as state — `ARCH‑03`).

**Recommended solution.** `useMemo`, or a store selector. No `setState`.

---

## Recommended budget for Phase 2

Put this in the repo and enforce it in CI:

```
Target device:      2019 mid-range laptop, integrated GPU · 8" – 12" school tablet
Frame rate:         60 fps desktop / 30 fps sustained tablet, no thermal throttle in 15 min
Draw calls:         ≤ 150 / frame
Triangles:          ≤ 60 000 submitted / frame
Framebuffer binds:  ≤ 4 / frame  (≤ 1 transmissive material)
Texture VRAM:       ≤ 150 MB     (KTX2 everywhere)
Initial transfer:   ≤ 8 MB       (apparatus first, room streamed)
JS initial chunk:   ≤ 150 KB gz
Time to interactive:≤ 4 s on 20 Mbit
DPR:                clamp [1, 1.5], adaptive
Frameloop:          demand
```

## Expected impact, ordered by value per hour of work

| # | Action | Effort | Draw calls | VRAM | Load |
|---|---|---|---|---|---|
| 1 | KTX2 + resolution re‑budget on all textures | 1 d | — | **764 → ~120 MB** | **26 → ~6 MB** |
| 2 | Merge static room/bench geometry, atlas materials | 2 d | **769 → ~200** | ↓ | ↓ |
| 3 | Remove cover transmission + `ContactShadows` + 2 fill lights | 2 h | **~200 → ~120** | — | — |
| 4 | `dpr={[1,1.5]}`, `frameloop="demand"`, drop `preserveDrawingBuffer` | 1 h | — | ↓ pixels 2.9× | — |
| 5 | Resolve mesh refs once; kill per‑frame `getObjectByName` | 4 h | — | — | CPU ↓ |
| 6 | Real loading screen + progressive asset load | 1 d | — | — | **perceived 15 s → ~2 s** |
| 7 | Code splitting + drop unused deps | 3 h | — | — | JS 338 → ~150 KB gz |
| 8 | Delete 39 MB of dead assets | 15 min | — | — | image ↓ 40 % |
