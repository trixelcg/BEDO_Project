# 20 — Rendering Budget

**Enforced in CI. A change that exceeds a budget fails the build.**
Baseline numbers are frozen in `docs/11_PERFORMANCE_BASELINE.md`.

---

## 1. Target platform (confirmed, Phase 2 brief §1)

| Parameter | Value |
|---|---|
| Deployment | **Desktop web browser only** |
| Browsers | Chrome, Edge, Safari where practical |
| Input | Mouse + keyboard |
| Hardware | WebGL2-capable desktop/laptop |
| Primary design viewport | **1920 × 1080** |
| Must remain usable | 1366 × 768 · 1440 × 900 · 2560 × 1440 |
| Not a Phase 2 target | Mobile phones |
| Constraint | No architectural decision may permanently prevent future tablet/mobile support |

**Reference hardware for acceptance** (the honest lower bound for "WebGL2-capable desktop/laptop"): a
2019-era laptop with integrated graphics — Intel UHD 620 class, 8 GB system RAM, shared VRAM. This is what
a vocational training room actually has, and it is what the 764 MB texture set cannot run.

Because mobile is out of scope, the budget is *less* aggressive than a mobile budget would be — but the
integrated-GPU floor still binds, especially on VRAM.

---

## 2. Budgets

### 2.1 Hard budgets — CI fails the build

| # | Metric | Baseline | **Budget** | Stretch | Measured by |
|---|---|---|---|---|---|
| B‑1 | Draw calls / frame | 769 | **≤ 150** | ≤ 100 | WebGL harness (`docs/11 §1.2`) |
| B‑2 | Triangles submitted / frame | 217 055 | **≤ 60 000** | ≤ 50 000 | WebGL harness |
| B‑3 | Framebuffer binds / frame | 22 | **≤ 4** | ≤ 2 | WebGL harness |
| B‑4 | Transmissive materials | 3 | **≤ 1** | 0 | `analyze-glb.mjs` + scene audit |
| B‑5 | Texture VRAM | 764 MB | **≤ 150 MB** | ≤ 120 MB | `analyze-glb.mjs` |
| B‑6 | Critical model payload | 26 MB | **≤ 8 MB** | ≤ 5 MB | file size, CI |
| B‑7 | JS initial chunk (gzip) | 338 KB | **≤ 150 KB** | ≤ 120 KB | `vite build` output |
| B‑8 | `dist/` total | 95 MB | **≤ 40 MB** | ≤ 30 MB | `du` |
| B‑9 | Time to TRAINING READY | 15–20 s | **≤ 4 s** | ≤ 3 s | Playwright, throttled |
| B‑10 | Black screen at any point | occurs | **never** | — | Playwright screenshot at 300 ms |

### 2.2 Runtime budgets — verified in the perf E2E

| # | Metric | Budget |
|---|---|---|
| B‑11 | Frame rate, reference hardware, active step | ≥ 60 fps at 1920×1080, DPR 1 |
| B‑12 | Frame rate, high-DPI (2560×1440 @ DPR 2) | ≥ 30 fps sustained |
| B‑13 | p95 frame time | ≤ 20 ms |
| B‑14 | Frames rendered while idle (`demand` loop) | **0/s** after 2 s of no input |
| B‑15 | JS heap after a full 12-step run | ≤ 250 MB, and **stable** across three consecutive runs |
| B‑16 | `renderer.info.memory.{geometries,textures}` | **no net growth** over a 10-minute session |
| B‑17 | Shader programs | ≤ 20 |
| B‑18 | Compiled-shader stalls after TRAINING READY | 0 (pre-warm the pipeline) |

### 2.3 Policy budgets — settings, not measurements

| # | Policy | Value |
|---|---|---|
| B‑19 | `dpr` | `[1, 1.5]`, adaptive downward under load |
| B‑20 | `frameloop` | `demand` with explicit invalidation (`docs/17 §3`) |
| B‑21 | `preserveDrawingBuffer` | **false** — capture via an on-demand render (`PERF‑08`) |
| B‑22 | Shadow maps | 1 casting light, 1024², frustum tight to the bench |
| B‑23 | `castShadow` | Explicit dynamic-part list only — never a blanket traversal |
| B‑24 | Post-processing | None until B‑1..B‑5 are met; then only dithering + optional GTAO |
| B‑25 | Antialias | MSAA at DPR 1; consider off at DPR ≥ 1.5 |

---

## 3. How each headline number is reached

### 769 → ≤ 150 draw calls

| Step | Action | Draws after |
|---|---|---|
| 0 | baseline | 769 |
| 1 | Merge 26 static room nodes → 1 (`docs/19 §4`) | ~745 |
| 2 | Merge static bench/pipework/panel (~60 → ~5) | ~690 |
| 3 | `castShadow` on dynamic parts only (shadow pass ~181 → ~25) | ~535 |
| 4 | Cover material → opaque metal: **removes one full transmission pass** | ~355 |
| 5 | Remove the GLB's two transmissive materials (keep tank only) | ~175 |
| 6 | Remove `ContactShadows` (a whole extra scene render) | ~120 |
| 7 | Material atlasing → batching | **~90** ✅ |

The multiplier is the point: at baseline the scene is drawn ≈ 4.5 times per frame. Removing passes is worth
far more than removing objects.

### 764 MB → ≤ 150 MB VRAM

| Step | Action | VRAM after |
|---|---|---|
| 0 | baseline | 764 MB |
| 1 | Room bake 4096² → 1024², drop 2 redundant channels | ~338 MB |
| 2 | Wall chart 4800×2950 → 2048×1280 | ~280 MB |
| 3 | Atlas 5 weight sheets → one 1024² | ~178 MB |
| 4 | Pointer/plate/hose 2048² → 1024²; LED → 64² | ~120 MB |
| 5 | Remaining halved where > 512² | ~75 MB |
| 6 | KTX2 (UASTC + ETC1S) | **~20–30 MB** ✅✅ |

### 15–20 s → ≤ 4 s

| Contribution | Now | After |
|---|---|---|
| Download (broadband, 20 Mbit) | ~10 s | ~3 s (8 MB) |
| PNG/JPEG CPU decode (42 images, five 4096²) | **~8–12 s** | **~0 s** — KTX2 needs no decode |
| GPU upload | ~2–4 s | < 0.5 s |
| Shader compile | ~1 s | pre-warmed |
| **Perceived** | black screen throughout | branded progress from ~300 ms |

### 26 MB → ≤ 8 MB

Textures 23.05 MB → ~3.5 MB (KTX2 + resize) · geometry ~2.5 MB → ~1.5 MB (meshopt) · JSON 0.2 MB
⇒ **~5 MB**, with the room split out to a deferred `room.glb`.

---

## 4. Enforcement

```
┌── pre-commit ─────────────────────────────────────────────┐
│ tsc --noEmit · oxlint · vitest (unit)                      │
├── CI: every PR ───────────────────────────────────────────┤
│ vitest · asset-budget check (B-4..B-6, B-8)                │
│ bundle-size check (B-7)                                    │
│ Playwright: 12-step E2E + no-black-screen (B-10)           │
│ Playwright perf: B-1..B-3, B-9, B-14, B-16                 │
├── nightly ────────────────────────────────────────────────┤
│ Full matrix: 1366×768 · 1440×900 · 1920×1080 · 2560×1440   │
│ Visual regression across all five named views              │
│ 10-minute soak for leak detection (B-16)                   │
└───────────────────────────────────────────────────────────┘
```

Budget checks read `asset-budget.json` and compare against `node scripts/analyze-glb.mjs --json`.

---

## 5. Quality is a budget too

These are objectives, **not permission to visibly destroy model quality** (brief §12). Every optimisation PR
must include before/after screenshots at 1920×1080 for the five named views, and must not regress:

- legibility of deflector labels, weight markings and the BEDO wall chart
- the baked lighting reading as lighting
- absence of banding on large gradients
- material differentiation — metal must read as metal, glass as glass

A PR that meets B‑1..B‑10 but fails the visual gate is rejected.

---

## 6. Future-proofing for tablet (not a Phase 2 target)

Per the brief: do not permanently prevent tablet/mobile support. The decisions that keep that door open cost
nothing now:

- **KTX2** transcodes to ASTC/ETC on mobile GPUs — the single most important one.
- **`frameloop="demand"`** matters far more on a battery device than on a desktop.
- **Adaptive DPR** already implies a quality ladder; a mobile tier is one more rung.
- **Split `apparatus.glb` / `room.glb`** allows a mobile tier that skips the room entirely.
- **A DOM control for every apparatus action** means a touch UI does not need new interaction logic.
- Avoid desktop-only assumptions in the interaction layer: pointer events, not mouse events; no hover-only
  affordances (hover is an enhancement, never the sole cue).
