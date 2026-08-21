# 11 — Performance Baseline (frozen)

**This document is the immutable reference point for every optimisation in Phase 2.**
Do not edit the *Baseline* tables. Append measurements to §5 as work lands.

- **Measured:** 2026‑08‑20
- **Commit measured:** `2471bc9` (`main`, pre‑Phase‑2)
- **Artifact measured:** `dist/` built 2026‑07‑14, plus a live dev‑server session

---

## 1. Measurement methodology (reproduce exactly)

Any future comparison must use this same procedure, or the numbers are not comparable.

### 1.1 Host and conditions

| Parameter | Value |
|---|---|
| Machine | Apple silicon Mac, Darwin 25.5.0 |
| Browser | Chrome (via the Claude‑in‑Chrome extension) |
| `devicePixelRatio` | 2 |
| Window inner size | 1440 × 757 CSS px |
| Canvas backing store | 4726 × 2478 device px = **11.7 Mpix** |
| Asset origin | `localhost` (Vite dev server, port 5179) — **best case; no network latency** |
| Tab state | **foreground and visible** (critical — see §1.5) |
| Scene state | idle, guided mode, step 1, no interaction |

### 1.2 GPU counters — WebGL prototype instrumentation

Injected into the page's **main world** (not an isolated world — prototype patches do not cross the boundary),
then sampled over 240 consecutive frames:

```js
const s = document.createElement('script');
s.textContent = `
(function(){
  const P = WebGL2RenderingContext.prototype;
  const g = {draws:0,tris:0,frames:0,progs:0,fbBinds:0,samples:[]};
  window.__mw = g;
  const seen = new Set();
  const de=P.drawElements, da=P.drawArrays, dei=P.drawElementsInstanced,
        up=P.useProgram, bf=P.bindFramebuffer;
  P.drawElements=function(m,c,t,o){g.draws++;g.tris+=c/3;return de.apply(this,arguments)};
  P.drawArrays=function(m,f,c){g.draws++;g.tris+=c/3;return da.apply(this,arguments)};
  P.drawElementsInstanced=function(m,c,t,o,n){g.draws++;g.tris+=(c/3)*n;return dei.apply(this,arguments)};
  P.useProgram=function(p){if(p){seen.add(p);g.progs=seen.size}return up.apply(this,arguments)};
  P.bindFramebuffer=function(t,fb){g.fbBinds++;return bf.apply(this,arguments)};
  let last=performance.now();
  (function tick(){const n=performance.now();g.samples.push(n-last);last=n;g.frames++;
    if(g.samples.length>300)g.samples.shift();requestAnimationFrame(tick)})();
})();`;
document.documentElement.appendChild(s);
```

Reset counters, wait 4 s, then read `draws/frames`, `tris/frames`, `fbBinds/frames`, `progs`, and frame‑time
percentiles from `samples`.

### 1.3 Texture VRAM — computed from the GLB binary

Parse the GLB's JSON chunk, read each embedded image's **true pixel dimensions** from its PNG IHDR / JPEG SOF
header, and apply `w × h × 4 × 4/3` (RGBA8 + full mip chain). The mip term is correct because the file ships a
single sampler with `minFilter = 9987` (`LINEAR_MIPMAP_LINEAR`).

Reproduce with `scripts/analyze-glb.mjs` (added in this branch):

```bash
node scripts/analyze-glb.mjs public/Bedo_baked_v2.glb
```

### 1.4 Network and timing

`performance.getEntriesByType('navigation' | 'resource' | 'paint')`, plus wall‑clock observation of when the
3D scene first becomes visible (screenshot sampling at 5 s intervals from navigation).

### 1.5 ⚠️ Pitfall that invalidates measurements

A **backgrounded tab throttles `requestAnimationFrame` to zero**. In a backgrounded tab this harness reports
`frames: 1`, `draws: 0`, and the Paint Timing API reports a misleadingly late FCP because no real paint occurs
until the compositor is asked for one. **Always confirm `document.hidden === false` before sampling.** The
first measurement attempt in this audit was discarded for exactly this reason.

---

## 2. Baseline — GPU and runtime

| # | Metric | **Baseline (measured)** | Phase 2 target | Factor |
|---|---|---|---|---|
| P‑1 | Draw calls / frame | **769.0** | ≤ 150 (stretch ≤ 100) | **5.1×** |
| P‑2 | Triangles submitted / frame | **217 055** | ≤ 60 000 | **3.6×** |
| P‑3 | Model triangles (actual) | 48 487 | — | scene drawn **≈ 4.5×/frame** |
| P‑4 | Framebuffer binds / frame | **22** | ≤ 4 | **5.5×** |
| P‑5 | Compiled shader programs | 35 | ≤ 20 | 1.8× |
| P‑6 | Frame rate (this host, idle) | 60 fps · avg 16.67 ms · p95 17.0 ms · max 17.7 ms | 60 fps | ✅ *on this host only* |
| P‑7 | JS heap (idle, post‑load) | 120.2 MB | ≤ 80 MB | 1.5× |
| P‑8 | Canvas backing store | 4726 × 2478 = 11.7 Mpix | ≤ 4 Mpix | 2.9× |
| P‑9 | Frameloop | `always` — 240 frames rendered in 4 s of a static scene | `demand` | — |

> **P‑6 is the trap.** 60 fps here does not mean the budget is met. This host absorbs 769 draw calls; the
> target device (2019 mid‑range laptop, integrated GPU) will not. The work is real and unbudgeted.

---

## 3. Baseline — assets and memory

### 3.1 Texture VRAM: **≈ 764 MB** from 23.0 MB of compressed images

| VRAM | Dimensions | On disk | Format | Image |
|---|---|---|---|---|
| 85.3 MB | 4096×4096 | 3 160 KB | png | `MergedBake_SM_D_Wood01_PBR_Lightmap` |
| 85.3 MB | 4096×4096 | 567 KB | png | `MergedBake_SM_D_Wood01_PBR_Normal` |
| 85.3 MB | 4096×4096 | 803 KB | png | `MergedBake_SM_D_Wood01_PBR_Diffuse` |
| 85.3 MB | 4096×4096 | 445 KB | png | `..._PBR_Metalness` |
| 85.3 MB | 4096×4096 | 693 KB | png | `..._PBR_Diffuse_A` |
| 72.0 MB | 4800×2950 | 1 803 KB | png | `Jetforce_background` (wall chart) |
| 25.4 MB | 2598×1923 | 281 KB | png | `background_uv_small` |
| 21.3 MB | 2048×2048 | 1 141 KB | png | `weight_50_uv` |
| 21.3 MB | 2048×2048 | 1 141 KB | png | `weight_100_uv` |
| 21.3 MB | 2048×2048 | 1 142 KB | png | `weight_200_uv` |
| 21.3 MB | 2048×2048 | 1 142 KB | png | `weight_500_uv` |
| 21.3 MB | 2048×2048 | 1 155 KB | png | `weight_custom weight_uv` |
| 21.3 MB | 2048×2048 | 980 KB | jpeg | `red_led_off` |
| 21.3 MB | 2048×2048 | 1 875 KB | png | `pointer_uv` |
| 21.3 MB | 2048×2048 | 1 947 KB | png | `plate_uv` |
| 21.0 MB | 2048×2018 | 1 661 KB | png | `water hose entry_uv` |
| 19.1 MB | 1396×2696 | 399 KB | jpeg | `Gray metal` |
| 7.6 MB | 413×3602 | 191 KB | png | `numbering_cad` |
| 5.3 MB | 1024×1024 | 1 276 KB | png | `ground_uv_3` |
| 5.3 MB | 1024×1024 | 779 KB | png | `CONE 60` |
| 8.9 MB | (23 smaller) | ~1 090 KB | mixed | remainder |
| **≈ 764.4 MB** | **42 images** | **23.05 MB** | | |

**Room bake contribution: 426.5 MB** (the five 4096² sheets) — 56 % of all texture memory, spent on scenery the
student never interacts with.

Dimension census: `4096²`×5, `4800×2950`×1, `2598×1923`×1, `2048²`×8, `2048×2018`×1, `1396×2696`×1,
`413×3602`×1, `1024²`×2, and 22 smaller.

### 3.2 Apparatus GLB (`Bedo_baked_v2.glb`)

| Property | Value |
|---|---|
| File size | **26 542 KB** (25.92 MB), bin chunk 25.72 MB |
| Generator | Khronos glTF Blender I/O v4.5.48 |
| Nodes / meshes / primitives | 159 / 157 / 181 |
| Triangles / vertices | **48 487** / 78 063 |
| Materials / textures / images | 68 / 57 / 42 |
| `doubleSided` materials | **68 of 68 (100 %)** |
| `alphaMode: BLEND` materials | **19** (49 `OPAQUE`) |
| Extensions | `KHR_materials_clearcoat`, `_transmission`, `_specular`, `_anisotropy`, `_ior` |
| Compression | **none** — no Draco, no meshopt, no KTX2/Basis |
| Animations / skins / cameras | 0 / 0 / 0 |
| Vertex attributes | POSITION 181, NORMAL 181, TEXCOORD_0 144, COLOR_0 23, COLOR_1 23 |

**89 % of the file is texture data.** Geometry is trivial.

### 3.3 Water plume GLBs (8 files, 364 KB total)

| File | Size | Nodes | Prims | Tris |
|---|---|---|---|---|
| `Water120_HemiSphere.glb` | 80 KB | 1 | 3 | 1 482 |
| `Water180_HemiSphere.glb` | 52 KB | 1 | 2 | 1 638 |
| `Water_low.glb` | 48 KB | 1 | 3 | 1 014 |
| `Water135_Conical.glb` | 44 KB | 1 | 3 | 1 560 |
| `Water60_Cone.glb` | 44 KB | 1 | 2 | 1 716 |
| `Water90_Flat.glb` | 44 KB | 1 | 2 | 1 404 |
| `Water30.glb` | 32 KB | 1 | 2 | 1 170 |
| `Water45_Oblique.glb` | 20 KB | 1 | 2 | 576 |

### 3.4 Bundle and distribution

| Metric | Baseline |
|---|---|
| JS chunks | **1** (no code splitting) |
| JS raw / gzip / brotli | 1 235 395 B / **337 627 B** / 263 896 B |
| CSS raw / gzip | 9 025 B / 2 452 B |
| `dist/` total | **95 MB** (99 905 009 B) |
| **Unreferenced bytes in `dist/`** | **≈ 39 MB** — `Bedo_M.glb` 17 MB, `WaterShapes/*.abc` 20 MB, `Bedo_model_optimized.glb` 1.7 MB, `icons.svg` |
| Client initial transfer | **≈ 27 MB** (26 MB GLB + 338 KB JS + 440 KB env + 364 KB plumes) |
| `.git` | 110 MB |
| `node_modules` | 345 MB |
| Unused runtime deps | `framer-motion` (5.6 MB), `@react-three/postprocessing` (1.0 MB) |

### 3.5 Loading

| Metric | Baseline |
|---|---|
| `Bedo_baked_v2.glb` download (localhost) | starts 471 ms, **completes 857 ms** (386 ms duration) |
| DOM content loaded | 483 ms |
| Load event | 1 272 ms |
| **Time to visible 3D scene** | **≈ 15–20 s** (observed: black at t≈10 s, visible by t≈20 s) |
| Loading UI shown during that time | **none** — black viewport |
| Total resources | 41 |

**The gap between an 857 ms download and a ~15–20 s visible scene is main‑thread cost:** decoding 42 PNG/JPEG
images (five of them 4096²) and uploading ≈764 MB to the GPU.

---

## 4. Phase 2 targets

| Metric | Baseline | Target | Stretch |
|---|---|---|---|
| Draw calls / frame | 769 | **≤ 150** | ≤ 100 |
| Triangles / frame | 217 055 | ≤ 60 000 | — |
| Framebuffer binds / frame | 22 | ≤ 4 | ≤ 2 |
| Texture VRAM | 764 MB | **≤ 150 MB** | ≤ 120 MB |
| Time to useful scene | 15–20 s | **≤ 4 s** on broadband desktop | ≤ 3 s |
| Initial critical model payload | 26 MB | **≤ 8 MB** | ≤ 5 MB |
| JS initial chunk (gzip) | 338 KB | ≤ 150 KB | — |
| `dist/` total | 95 MB | ≤ 40 MB | — |
| Frameloop | `always` | `demand` | — |
| DPR | uncapped (2) | clamp [1, 1.5], adaptive | — |
| Black screen at any point | yes | **never** | — |

Quality constraint: these are performance objectives, **not** permission to visibly degrade the model. Every
asset change must be reviewed against a before/after render at 1920×1080.

---

## 5. Measurement log

Append one row per optimisation task. Re‑measure with §1's exact procedure.

| Date | Commit | Task | Draws | Tris/f | FB binds | VRAM | GLB | dist | TTFS | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026‑08‑20 | `2471bc9` | **BASELINE** | 769 | 217 055 | 22 | 764 MB | 26 MB | 95 MB | 15–20 s | frozen reference |
| 2026‑08‑20 | `phase2/security-remediation` | BEDO‑002 (measurement only) | 769 | 217 055 | 22 | 764.45 MB | 25.92 MB | 95.28 MB | 22.2 s | `scripts/perf-baseline.mjs`, headless Playwright/SwiftShader. GPU counters reproduce the baseline exactly; timings are **not** comparable to the row above (no GPU) — 1.3 fps, `scene-ready` mark at 22 180 ms. No optimisation attempted. |
| 2026‑08‑21 | `phase2/security-remediation` | BEDO‑020 (gate) | 769 | 217 055 | 22 | 764.45 MB | 25.92 MB | 57.25 MB | 22.6 s | Interaction gating is a pure function called on click. GPU counters identical to the baseline; scene fingerprint identical in all ten sections; boot still 15 requests. `dist/` reflects BEDO‑004's cleanup and BEDO‑019's worksheets, not this task (+4 KB). |
| | | | | | | | | | | |

---

## 6. Reproducible commands

```bash
npm ci                                   # install
npx tsc -b --force                       # types
npx oxlint                               # lint
npm run build                            # production build + bundle sizes
node scripts/analyze-glb.mjs public/Bedo_baked_v2.glb          # GLB + VRAM report
node scripts/analyze-glb.mjs public/Bedo_baked_v2.glb --nodes  # node-name contract dump
du -sh dist && find dist -type f -exec stat -f%z {} + | awk '{s+=$1} END {print s}'
gzip -9 -c dist/assets/index-*.js | wc -c                      # gzip bundle size
```

For GPU counters and frame timing, use the harness in §1.2 in a **foreground** tab.

Since BEDO‑002 the whole procedure is also scripted — the same counters, the same reset-and-settle sampling,
the same VRAM computation, plus `bedo:*-ready` marks for the timings §1.4 previously took by eye:

```bash
npm run build && npm run perf:baseline                                # measures dist/
node scripts/perf-baseline.mjs --headed --channel chrome --seconds 8  # closest to §1.1
```

It writes JSON to `test-results/` and prints a ready-made row for §5. It measures only — it asserts nothing and
never edits this document. See `docs/25 §7`, including why headless timings are not comparable to §2.
