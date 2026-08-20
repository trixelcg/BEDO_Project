# 28 — Dead Code, Dependency & Asset Cleanup (BEDO‑004)

**Result:** `dist/` **95.27 MB → 56.25 MB** (−39.02 MB, −41 %), 27 files → 15. Docker build context
**584.4 MB → 55.4 MB**. Three runtime dependencies gone. **Zero behaviour change** — the scene fingerprint and
the runtime network trace are both identical.

Nothing valuable was deleted. The 39 MB was *moved out of the served directory*, not destroyed.

---

## 1. Pre-cleanup baseline

Commit `ab3757a`, clean tree, production build.

| | Bytes | MB | Files |
|---|---:|---:|---:|
| **`dist/` total** | 99 893 537 | **95.27** | 27 |
| ├ GLB | 47 129 280 | 44.95 | 11 |
| ├ video | 29 756 224 | 28.38 | 1 |
| ├ Alembic `.abc` | 21 305 016 | 20.32 | 8 |
| ├ JS | 1 225 427 | 1.17 | 1 |
| ├ images | 463 005 | 0.44 | 3 |
| ├ CSS | 7 521 | 0.01 | 1 |
| ├ HTML | 916 | 0.00 | 1 |
| └ misc (`.DS_Store`) | 6 148 | 0.01 | 1 |
| **`public/` total** | 98 659 673 | **94.09** | 24 |
| **`src/`** | 182 958 | 0.17 | 16 |
| JS gzip (`gzip -9`) | 335 147 | 0.32 | |
| Startup requests (prod build) | 15 | | |
| Full trace: requests / declared bytes | 17 / 57 806 000 | 55.13 | |

---

## 2. Inventory methodology

The rule was: **never delete on the strength of a filename search.** Every candidate had to fail *four*
independent tests before it could move.

| # | Evidence | Tool |
|---|---|---|
| 1 | No reference in any source, config, script or test | `grep -rn` across the tree, excluding `dist/`, `docs/`, `node_modules/` |
| 2 | No reference in the **build output** | extraction of every `/`-rooted asset literal from `dist/assets/*.js`, `*.css`, `index.html` |
| 3 | **Never requested at runtime** | `scripts/network-trace.mjs` (new) — loads the production build, opens the walkthrough video modal and the data monitor, and records every request with status and bytes |
| 4 | **No dynamic path could name it** | audit of every asset-URL construction site in `src/` |

Evidence 4 is what makes 1–3 conclusive rather than suggestive. Every asset URL in `src/` is a **string
literal** — there is no template path, no string concatenation, no `import.meta.glob`, no runtime-built URL
anywhere in the application:

```
Scene3D.tsx:25     useTexture('/rosendal_plains_2_4k.webp')
DeviceModel.tsx:91 useGLTF('/Bedo_baked_v2.glb')
DeviceModel.tsx:95 useGLTF(WATER_SHAPES.<key>.url)     ← literals in apparatus.ts
UIOverlay.tsx:652  <video src="/Bedo_Mesu_J.mp4">
index.html:5       <link rel="icon" href="/favicon.svg">
```

So the production asset set is **closed and enumerable**, and the build output confirms it — exactly twelve
paths:

```
/Bedo_baked_v2.glb   /Bedo_Mesu_J.mp4   /rosendal_plains_2_4k.webp   /favicon.svg
/WaterShapes/{Water30, Water45_Oblique, Water60_Cone, Water90_Flat,
              Water120_HemiSphere, Water135_Conical, Water180_HemiSphere, Water_low}.glb
```

The runtime trace requested those twelve, plus the shell, the JS chunk, the stylesheet and two Google Fonts
`woff2` files. Nothing else, ever.

---

## 3. Disposition of every candidate

### MOVED — preserved in `assets-source/`, no longer served

Not deleted. These are inputs to the asset work in `docs/23` (BEDO‑032…035), and the brief is explicit that
source material must survive. They simply must not sit in `public/`, because Vite copies that directory
wholesale into `dist/` and from there into the container image.

| Asset | Size | Evidence | Now at |
|---|---:|---|---|
| `WaterShapes/*.abc` ×8 | 20.32 MB | Alembic **caches**; the runtime loads the baked `.glb` exports of them | `assets-source/WaterShapes/` |
| `Bedo_M.glb` | 16.94 MB | Superseded by `Bedo_baked_v2.glb`; 0 refs, never requested | `assets-source/models/` |
| `Bedo_model_optimized.glb` | 1.75 MB | 0 refs; the only existing smaller apparatus export — directly relevant to BEDO‑032/033 | `assets-source/models/` |
| `icons.svg` | 5 KB | 0 refs; every icon in the UI comes from `lucide-react` | `assets-source/images/` |
| `src/assets/hero.png` | 13 KB | Never imported; provenance unknown, so kept | `assets-source/images/` |

`assets-source/README.md` records what each file is and why it is not served.

### DELETED

| | Size | Why |
|---|---:|---|
| `src/assets/vite.svg`, `src/assets/react.svg` | 12.8 KB | Vite starter-template scaffolding. Not project material, not imported, never shipped (unimported files under `src/` are not copied by Vite). |
| `public/.DS_Store` | 6 KB | macOS Finder metadata — untracked, but Vite copied it into `dist/` on every build, so it shipped. `.dockerignore` now blocks it from the image as well. |

### KEPT — despite looking suspicious

| Asset | Why it stays |
|---|---|
| `Bedo_Mesu_J.mp4` (28.38 MB) | **Lesson media.** Requested only when a student opens the "Video" modal, so it is absent from an initial-load capture. The full trace loaded it (HTTP 206). It is the largest single file in `dist/`, and it is used. `BEDO‑039` transcodes it. |
| All 8 water `.glb` | Each is named by a literal in `WATER_SHAPES` and requested on load. |
| `favicon.svg` | `index.html` only — invisible to a `src/`-only scan. |
| `targetMassG()` (`physics.ts`) | No production consumer; used only by `physics.spec.ts`. Kept: it is verified domain physics with test coverage, listed in `docs/13 §2` as part of the module's API for the domain extraction. Deleting tested, correct physics to save ten lines is the wrong trade. |
| `FRONT` (`apparatus.ts`) | No production consumer; documents the coordinate convention every `ANCHOR_VIEW` offset is expressed in, and `apparatus.spec.ts` asserts the framing invariant against it. |
| `@google-cloud/storage` | Still used by `server.ts` to proxy missing static assets from the bucket in production. Unrelated to the config surface BEDO‑003 removed. |
| `tsx` | Runs `server.ts` in the container and in `api-surface.spec.ts`. |
| `character*` field names in `SceneConfig` | Avatar-template naming for the apparatus transform. A rename is behaviour-neutral but is churn across three files; `BEDO‑005` owns renames. |

---

## 4. Dead code removed

Conservative by design. `DeviceModel.tsx` was not touched — it remains architecture debt for `BEDO‑014`.

| Symbol | File | Evidence |
|---|---|---|
| `DeflectorOption` | `src/types/index.ts` | Legacy type superseded by `DeflectorDef`. Exactly one occurrence in the repository: its own definition. |
| `StepDefinition` | `src/types/index.ts` | Legacy type superseded by `ExperimentStep`. Same — one occurrence. |
| `readyAt()` | `src/lib/readiness.ts` | Added by BEDO‑002 as a "measurement helper" and never used, by anything, including its own tests. My own dead code. |
| `.header-area`, `.step-container` | `src/index.css` | Rules with no consumer in any component. |
| `--border-color`, `--accent-blue-rgb`, `--accent-gold-rgb`, `--glass-gradient` | `src/index.css` | Custom properties never referenced by any rule or component. |

Checked and found clean: no TTS/viseme/avatar remnants remain in `src/` (BEDO‑001 and BEDO‑003 removed them),
no unused imports or locals (`noUnusedLocals`/`noUnusedParameters` are on and the build is green), no
unreachable branches found.

---

## 5. Dependencies removed

| Package | Was for | Evidence of non-use | Impact |
|---|---|---|---|
| `framer-motion` | Animation, from the inherited template | Zero imports in `src/`, `tests/`, `scripts/`, `server.ts` or any config; zero occurrences in the built bundle | −5.6 MB `node_modules`; no bundle change (it was never bundled) |
| `@react-three/postprocessing` | Post-processing effects, never wired up | Same: zero imports, zero bundle occurrences | −1.0 MB `node_modules`; no bundle change |
| `@types/three` | TypeScript types for `three` | **Not removed — moved to `devDependencies`.** `three@0.184.0` ships no types of its own, so it is required to typecheck; it has no runtime role, and the container installs with `npm ci --only=production` | Smaller production install |

Runtime dependencies: **10 → 7**. `npm install` and the production build were re-run after the change; both
clean.

The bundle did not shrink, because neither package was ever reachable from an import and the bundler had
already excluded them. The saving is in install time and image size, not in what a browser downloads.

The same is true of the dead code: the JavaScript output is **byte-identical before and after** (`md5
62782e371cf14c87ef716b55e5636a2b` both), because the two removed types are erased at compile time and
`readyAt()` was already tree-shaken as an unreferenced export. Only the stylesheet actually shrank. The entry
chunk's *filename* hash still changed — rolldown folds the referenced CSS asset's hash into it — which is why
the fingerprint diff shows two renamed files.

---

## 6. Build and container copy rules

Two structural fixes, both squarely about what reaches production.

**`.dockerignore` (new).** The Dockerfile's builder does `COPY . .`, so every unignored file was uploaded to
the daemon and baked into a layer — including the 28 MB reference video under `docs/`, all of `node_modules`,
the test suite, and every measurement artefact.

| | Context size | Files |
|---|---:|---:|
| Before | 584.4 MB | 15 467 |
| After | **55.4 MB** | **33** |

**The runner image no longer copies `public/`.** Vite already copies all of `public/` into `dist/`, so the
image carried two identical copies of the 26 MB model and the 28 MB video. `server.ts` looks in `public/`
first and falls back to `dist/`; serving with `public/` renamed away was verified live before the change:

```
/                              200        916
/Bedo_baked_v2.glb             200   27178344
/WaterShapes/Water90_Flat.glb  200      43456
/rosendal_plains_2_4k.webp     200     448452
/favicon.svg                   200       9522
/Bedo_Mesu_J.mp4               200   29756224
```

Every production asset resolves from `dist/` alone. Asset bytes in the image: **~189 MB → ~56 MB**.

⚠️ **No container was built.** Docker is not available in this environment, so both changes are reasoned and
locally verified but not confirmed by an image build. **Build the image once before the next deploy.**

---

## 7. Verification

### Scene fingerprint — unchanged

`scripts/scene-fingerprint.mjs` (from BEDO‑003) reads the live three.js scene graph: renderer state, all four
lights, the apparatus transform, the world transform of all 33 meshes the runtime drives, all 16 invisible
click hotspots, the tank cover's material, the `envMapIntensity` census, and the camera.

```
before: objects 290  lights 4  tracked 33  hotspots 16
after : objects 290  lights 4  tracked 33  hotspots 16

diff → 2 lines, both content-hashed bundle names (the stylesheet changed)
scene-graph sections identical: True
```

### Runtime network — unchanged

`scripts/network-trace.mjs` against the production build, driving initial load → walkthrough video → data
monitor:

| | Before | After |
|---|---:|---:|
| Distinct paths requested | 17 | **17** |
| Declared bytes | 55.13 MB | **55.13 MB** |
| Paths no longer requested | — | **none** |
| 4xx / 5xx | 0 | **0** |
| Failed requests | 0 | **0** |
| Console errors | 0 | **0** |

Identical, which is the point: the 39 MB was never fetched, so removing it changed nothing a browser does.

### Behaviour

The full twelve-step lesson completes in the browser, both language smoke paths pass, the 51 GLB contract
tests are unchanged and green.

---

## 8. Results

| | Before | After | Δ |
|---|---:|---:|---:|
| **`dist/` total** | 99 893 537 B · 95.27 MB · 27 files | **58 981 811 B · 56.25 MB · 15 files** | **−40 911 726 B · −39.02 MB · −12 files** |
| ├ GLB | 44.95 MB (11) | 26.26 MB (9) | −18.69 MB |
| ├ Alembic | 20.32 MB (8) | **0** | −20.32 MB |
| ├ video | 28.38 MB | 28.38 MB | — |
| ├ images | 0.44 MB (3) | 0.44 MB (2) | −5 KB |
| ├ JS raw / gzip | 1 225 427 B / 335 147 B | 1 225 427 B / 335 147 B | **— (byte-identical, same md5)** |
| ├ CSS raw / gzip | 7 521 B / 2 213 B | **7 170 B / 2 118 B** | −351 B / −95 B |
| └ misc | 6 148 B | **0** | −6 148 B |
| **`public/`** | 94.09 MB · 24 files | **55.07 MB · 12 files** | −39.02 MB · −12 files |
| **Docker context** | 584.4 MB · 15 467 files | **55.4 MB · 33 files** | −529 MB |
| **Image asset copies** | ~189 MB (dist + public) | **~56 MB** | ~−133 MB |
| **Runtime dependencies** | 10 | **7** | −3 |
| **`node_modules`** | 389.6 MB | 383 MB | −6.6 MB |
| **Repository (git)** | — | — | **unchanged** — the 39 MB moved, it was not deleted |

The ~39 MB hypothesis in `docs/11 §3.4` was accurate to within 20 KB.

---

## 9. Regression protection added

| Test | Asserts |
|---|---|
| `assets.spec.ts` — *the served asset set is closed* | `public/` contains **exactly** the twelve production assets and nothing else. Cross-checked from both directions: every reference resolves to a file, and every served file has a reference — so a stale entry in the expected list cannot keep a dead file alive. |
| `assets.spec.ts` — *source assets stay out* | `Bedo_M.glb`, `Bedo_model_optimized.glb`, `icons.svg` and all eight `.abc` are absent from `public/` **and still present in `assets-source/`**. Deleting them instead of moving them fails the suite. |
| `bundle.spec.ts` — *ships nothing unrequested* | The complete `dist/` file list is pinned; no `.abc`, no superseded models. |
| `bundle.spec.ts` — *removed dependencies* | `framer-motion` and `postprocessing` do not appear in the bundle. |

Existing tests were not weakened. Unit/integration 281 → **287**; Playwright unchanged at 11.

---

## 10. Production operations — the deployed `config.json` (BEDO‑003 carry-over)

**Not actioned here, by instruction.** If anyone ever pressed "Save Config" on the deployed site before
BEDO‑003, an object may still exist at `gs://bedo-project-assets-2026/config.json`, and `server.ts` would have
served it — meaning the deployed scene may have been running on values that are not in this repository.

Nothing in the current code can read it: the fetch is gone and the scene configuration is frozen in
`src/lib/sceneConfig.ts`. The object is inert, not urgent. Required process:

```bash
gsutil cat gs://bedo-project-assets-2026/config.json          # 1. read, if it exists
                                                              # 2. compare sceneConfig against
                                                              #    src/lib/sceneConfig.ts
                                                              # 3. record any differences
gsutil rm gs://bedo-project-assets-2026/config.json           # 4. only after explicit approval
```

A difference is an **art-direction decision to merge**, not a regression to fix silently.

---

## 11. Defects found

| | |
|---|---|
| **New — the walkthrough video modal cannot be closed** | `UIOverlay.tsx:624` renders the modal as `className="monitor-fullscreen"` **without `interactive`**, inside `.ui-container { pointer-events: none }`. Nothing in that modal responds to the mouse — not Close, not the video's own controls. The video autoplays, so a student who clicks "Video" is stuck until they reload the page. Found by the network trace, which could not click Close. **Not fixed here**: BEDO‑004 changes no behaviour or styling. One class name; belongs with `BEDO‑026`/`BEDO‑027`. |
| Confirmed | `PERF‑12` — the 39 MB of unrequested assets in `dist/`. Resolved. |
| Confirmed | `CQ‑04` — dead types and dead CSS. Resolved for the symbols listed in §4. |

---

## 12. Residual cleanup candidates (not in this task)

| Candidate | Size | Owner |
|---|---:|---|
| `Bedo_Mesu_J.mp4` — 28 MB, cannot seek, no poster, no captions | 28.38 MB | `BEDO‑039` (transcode to ~6 MB) |
| `Bedo_baked_v2.glb` — 26 MB, uncompressed, 764 MB of texture VRAM | 26.26 MB | `BEDO‑032`/`033` (KTX2 + meshopt) |
| Single 1.2 MB JS chunk, no code splitting | 1.17 MB | `BEDO‑012` |
| Google Fonts loaded from the public internet (`fonts.googleapis.com`) — the app is not self-contained offline | — | `BEDO‑039` |
| `assets-source/` (39 MB) still in git history and working tree | 39 MB | Move to an art repository or Git LFS — a repository decision, not an application one |
| `push.sh` — a `git add . && commit && push` helper | — | Team preference; left alone |
