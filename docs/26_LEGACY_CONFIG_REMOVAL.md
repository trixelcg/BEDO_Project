# 26 — Legacy Config Surface Removal (BEDO‑003)

**What was removed:** the developer scene editor, the configuration backend, and the runtime configuration
fetch. **What replaced them:** one frozen constant, `src/lib/sceneConfig.ts`.

**What did not change:** the scene. Not one light, transform, material, hotspot or camera value — proven, not
asserted (§6).

---

## 1. The old architecture

```
                    ┌──────────────────────────┐
   App mounts  ───► │ useState<SceneConfig>    │  literals in App.tsx:79‑94
                    └────────────┬─────────────┘
                                 │
   fetch('/config.json')  ───────┤  if it parses, overwrite every field
                                 │
                    ┌────────────▼─────────────┐
                    │ sceneConfig (React state)│──► Scene3D ──► lights, renderer,
                    └────────────┬─────────────┘                apparatus transform,
                                 │                              glass material
                    ┌────────────▼─────────────┐
                    │ MenuSettings (350 lines) │  22 live sliders + a colour picker
                    └────────────┬─────────────┘
                                 │ "Save Config"
                    ┌────────────▼─────────────┐
                    │ POST /api/save-config    │  api/save-config.ts (224 lines)
                    │  → public/config.json    │  writes to disk
                    │  → gs://<bucket>/config  │  …and uploads it, then makePublic()
                    └──────────────────────────┘
```

Four moving parts for one purpose: let someone drag a slider and have the result survive a reload.

### Why it existed

The project was inherited from a "talking character" template — the same lineage that supplied the six API
handlers BEDO‑001 deleted. `save-config`'s own payload still shows it: alongside `sceneConfig` it accepts
`ttsConfig`, `aiConfig`, `characterUrl`, `locationUrl`, `hdrUrl` and `visemeMap`, and `App.tsx` dutifully sent
`{ ttsConfig: { apiKey: '' }, aiConfig: { apiKey: '' }, visemeMap: {} }` on every save. The apparatus was the
"character". None of that has anything to do with a jet-force lesson.

The editor was genuinely useful **once** — to find the exposure, ambient colour and apparatus transform the
scene now uses. That job finished the moment the values were found.

### Why it had to go

| | |
|---|---|
| **Security** | `save-config` is unauthenticated. In the Cloud Run deployment it writes `config.json` into a public GCS bucket and calls `makePublic()`. `server.ts` then serves missing static paths *from that bucket* — so any visitor could permanently restyle, or blank, the scene for every other visitor. This is `ARCH‑13` / residual risk `R‑1`. |
| **Correctness** | The scene had no single defined appearance. What a student saw depended on a fetch that might or might not resolve, of a file that might or might not exist, containing values nobody reviewed. |
| **Product** | The evaluation PDF specifies **"React, Threejs (webGL), Redux (no backend)"**. A configuration backend is outside the product. |
| **Noise** | The fetch 404'd on every single page load in production (`BUG‑24`), and logged `Using default client-side scene configuration.` on every load in development. |
| **Honesty** | "Capture Camera" printed *"Camera angles captured. Save config to write permanently."* and captured nothing at all (`BUG‑23`). |

---

## 2. The effective values, and how they were established

The audit's warning was that `MenuSettings` and `handleSaveConfig` were the only consumers of `SceneConfig` —
so the panel's *slider ranges* must never be mistaken for the app's *values*. They were not consulted.

Resolution order in the old code was: literals in `App.tsx` → overwritten by `/config.json` if it fetched and
parsed. **`config.json` has never existed in this repository** (`git log --all` has no such file; `public/`
has none; the build ships none), so the fetch could not succeed and the literals were always in force.

That reasoning was then checked against reality rather than trusted. `scripts/scene-fingerprint.mjs` attaches
to three.js's own `__THREE_DEVTOOLS__` hook — before any page script runs, so the app is unaware — waits for
the model, and reads the values back out of the **live scene graph**:

| Field | Value | Read back from the running scene as |
|---|---|---|
| `exposure` | `1.0` | `renderer.toneMappingExposure = 1` |
| `selfIllumination` | `0.15` | `AmbientLight.intensity = 0.15` |
| `contrast` | `1.0` | directional intensities `0.8` / `0.3` / `0.4` |
| `ambientColor` | `#d1f2f7` | `AmbientLight.color = d1f2f7` |
| `hdrLight` | `1.0` | `scene.environmentIntensity = 1`, `backgroundIntensity = 1` |
| `hdrRotation` | `0` | `background.rotation = 0` |
| `reflection` | `1.0` | `envMapIntensity = 1` on 183 model materials |
| `characterPosition` | `[0, -1.8, 0]` | apparatus group world position |
| `characterRotation` | `[0, 0, 0]` | apparatus group quaternion `[0,0,0,1]` |
| `characterScale` | `[1.8, 1.8, 1.8]` | apparatus group world scale |
| `glassSpecular` | `1.0` | `Tank_cover.material.specularIntensity = 1` |
| `glassRoughness` | `0.02` | `Tank_cover.material.roughness = 0.02` (clearcoat `0.01`) |
| `glassIor` | `1.52` | `Tank_cover.material.ior = 1.52` |

All thirteen fields are consumed by the running scene; none is dead. So **KEEP: all thirteen values. REMOVE:
the mechanism around them** — the state, the fetch, the editor, the endpoint, and the ability to change any of
it at runtime.

They now live in `src/lib/sceneConfig.ts`, `Object.freeze`d (nested tuples included), typed, and passed to
`Scene3D` as a module constant. `tests/unit/scene-config.spec.ts` pins each value against the observable it
was read from.

---

## 3. Removed

| File | Lines | What it was |
|---|---|---|
| `src/components/MenuSettings.tsx` | 350 | The scene editor: 22 sliders, colour picker, "Save Config", "Capture Camera" |
| `api/save-config.ts` | 224 | Wrote `config.json` to disk and to a public GCS bucket; downloaded arbitrary URLs |
| `api/` (directory) | — | Now empty and deleted. The project has no API. |

Also removed:

- `App.tsx` — `useState<SceneConfig>`, the `/config.json` effect, `handleSaveConfig` (incl. three `alert()`
  calls), `showSettings` state, the floating toggle button, the settings drawer, and the `Sliders`/`X` imports.
- `src/types/index.ts` — the `SceneConfig` interface, moved next to its only value.
- `server.ts` — `API_ROUTES`, the `/api/*` router, the dynamic `import('./api/…')`, the Vercel-shaped
  `responseWrapper`, and `parseRequest`. `/api/*` is now a flat JSON 404, answered before the static handler so
  it can never fall through to `index.html`.
- `vite.config.ts` — the `/api` and `/uploads` dev proxies.
- `Dockerfile` — the `COPY … /app/api ./api` line, which would otherwise fail the next container build.
- `package.json` — `dev` is now `vite`, not `tsx server.ts & vite`. There is no backend to run alongside it.
- `src/index.css` — 93 lines of settings-drawer styles and the `slideInRight` keyframes they used.
  `.section-title` and `.menu-content-wrapper` are **kept**: the software monitor and the training panel use
  them.

**Kept deliberately:** `server.ts` itself (it is the production static host for Cloud Run) and its
`@google-cloud/storage` dependency, which serves missing static assets from the bucket — unrelated to the
config surface and still in use. `docs/23` retires it under `BEDO‑039`.

**Not touched:** every learner-facing control — language, Free/Guided, experiment selection, the Custom
Parameters panel (pump flow rate and custom weight are lesson inputs, not developer settings), reset, and the
monitor's Save Screen / Export Data.

---

## 4. Retained configuration

```ts
// src/lib/sceneConfig.ts
export const SCENE_CONFIG: Readonly<SceneConfig> = Object.freeze({ … });
```

- typed (`SceneConfig`, exported from the same module)
- immutable at runtime (`Object.freeze`, nested arrays too)
- no fetch, no backend, no `localStorage`, no developer UI
- documented in place, with the provenance of the numbers

The `Custom Parameters` panel still edits `qTotal` and `customWeightG` at runtime. That is **not** scene
configuration — those are experiment inputs the student is meant to vary, they live in `SimulationState`, and
they are untouched by this task.

---

## 5. Network verification

`/config.json` is gone from startup. Measured with the fingerprint tool, which records every request the page
makes:

| | BEDO‑002 | BEDO‑003 |
|---|---|---|
| Requests during load | 16 | **15** |
| `/config.json` requested | **yes** | **no** |
| Failed responses | 0 | 0 |
| Console errors | 0 | 0 |
| Console noise | `Using default client-side scene configuration.` on every load | none |

In production the same request was a genuine 404 from `server.ts` (`/config.json` has an extension, so the
SPA fallback did not apply) — that is `BUG‑24`, now fixed as a side effect.

Regression cover: `tests/e2e/readiness.e2e.ts` fails if startup requests anything matching `config.json` or
`/api`, or if any response ≥ 400, or if anything reaches the console as an error.

---

## 6. Behavioural verification — the scene did not move

The requirement was that nothing moves, rotates, rescales, or shifts a click target. That is checked by
comparing the **live scene graph** before and after, not by reading the diff and hoping.

```bash
git worktree add /tmp/bedo002 <BEDO-002 commit>     # the "before" tree
(cd /tmp/bedo002 && npx vite build && node scripts/scene-fingerprint.mjs --out before.json)
npm run build && node scripts/scene-fingerprint.mjs --out after.json
diff measurements/before.json measurements/after.json
```

The fingerprint covers, all rounded to 6 decimals:

- renderer tone mapping, exposure, colour space, shadow map settings
- `scene.environmentIntensity`, `backgroundIntensity`, background rotation/mapping/colour space, object count
- every light: type, intensity, colour, position, shadow map size and bias
- the apparatus group's world **and** local position, quaternion and scale
- the world position, quaternion, scale and visibility of **all 33 meshes the runtime drives**
- **all 16 invisible click hotspots** — radius, local position, world position
- the tank cover's full `MeshPhysicalMaterial` parameter set
- an `envMapIntensity` census across every material in the model
- the camera: type, position, quaternion, fov, aspect, near, far, zoom

Result:

```
objects 290  lights 4  tracked 33  hotspots 16      (before)
objects 290  lights 4  tracked 33  hotspots 16      (after)

diff → 3 lines, all in the network section:
  - "/assets/index-C1GDMXEh.js"   →   "/assets/index-rh_7GhqP.js"     (content hash)
  - "/assets/index-CVnzwU_9.css"  →   "/assets/index-vwYyvWEw.css"    (content hash)
  - "/config.json"                →   (gone)
```

**Every scene-graph section is byte-identical.** Nothing moved, nothing rotated, nothing rescaled, no camera
framing changed, no light moved, no hotspot moved.

The tool is deterministic — two consecutive runs on unchanged code produce identical output — which was
verified before it was trusted. (Blob URLs minted per texture by `GLTFLoader` are excluded; they carry a fresh
UUID every run and describe nothing.)

The BEDO‑002 suite is the second line of defence: all of it still passes, including the twelve-step lesson in
jsdom and in a browser.

---

## 7. Performance observation

Recorded, not pursued. BEDO‑003 optimises nothing and no target moved.

| | BEDO‑002 | BEDO‑003 |
|---|---|---|
| Resources requested | 14 | **13** |
| Transferred | 27.02 MB | 27.02 MB |
| Draw calls / frame | 769 | 769 |
| Triangles / frame | 217 055 | 217 055 |
| Framebuffer binds / frame | 22 | 22 |
| Shader programs | 42 | 42 |
| JS bundle (raw / gzip) | 1 236.04 kB / 343.48 kB | **1 225.42 kB / 340.72 kB** |
| CSS (raw / gzip) | 9.02 kB / 2.43 kB | **7.52 kB / 2.19 kB** |
| Startup error noise | one 404 (prod) + one console log | **none** |
| `app-ready` | 375 ms | 427 ms |
| `scene-ready` | 44.3 s | 22.4 s |

**The timing rows are noise, not results.** Across runs on this host `app-ready` moved between 375 and 452 ms
and `scene-ready` between 22.2 and 44.3 s *with no code change at all* — software rendering under SwiftShader
is dominated by machine load. Nothing in BEDO‑003 plausibly affects them: the removed fetch was one ~1 KB
response that resolved before the model started downloading. The honest summary is **one fewer request, ~12 kB
less JavaScript and CSS, no measurable timing change.** The `docs/11` targets are untouched.

---

## 8. Residual risks

1. **A `config.json` may exist in the production GCS bucket.** ⚠️ *The one item needing a human.*
   If anyone ever pressed "Save Config" on the deployed site, `gs://bedo-project-assets-2026/config.json`
   exists and was public, and `server.ts` would have served it — meaning **the deployed scene may have been
   running on values that are not the ones in this repository**. This cannot be checked from here (no
   credentials, and checking is not this task's business). Before the next deploy:

   ```bash
   gsutil cat gs://bedo-project-assets-2026/config.json      # exists? compare its sceneConfig
   gsutil rm  gs://bedo-project-assets-2026/config.json      # then delete it — nothing reads it now
   ```

   If it exists and differs, that difference is a **deliberate art-direction decision to merge**, not a
   regression to fix silently. Nothing in the current codebase can be affected either way: the fetch is gone.

2. **The scene can no longer be tuned without a rebuild.** That is the intent. The workflow is: edit
   `src/lib/sceneConfig.ts`, rebuild, and run `node scripts/scene-fingerprint.mjs` to see exactly what moved.
   If look-development needs a live editor again it should be a dev-only tool behind `import.meta.env.DEV`,
   never a shipped endpoint.

3. **`server.ts` still constructs a GCS client** and proxies missing static assets from the bucket in
   production. Unrelated to this task and still required, but it means the bucket remains part of the serving
   path. `BEDO‑039` retires it.

4. **The container image is not verified here.** `Dockerfile` copied `api/` into the runner
   (`COPY --from=builder /app/api ./api`); Docker fails a `COPY` whose source does not exist, so deleting the
   directory would have broken the next container build. That line is removed in this task — it is a direct
   consequence of the deletion, not unrelated cleanup — but no container build was run to confirm it, because
   that needs Docker and a registry. **Build the image once before the next deploy.**

---

## 9. Defects found while doing this

| | |
|---|---|
| **New** | `Dockerfile` copied `api/` into the runner image. Deleting the directory would have broken the next container build, since Docker fails a `COPY` with a missing source. Fixed here (one line), because this task caused it — but the image itself has not been built to confirm. |
| **New** | `scripts/*.mjs` wrote measurement artefacts into `test-results/`, which Playwright **empties at the start of every run** — a perf baseline could be destroyed by running the E2E suite. Fixed in this task: Playwright now owns `test-results/playwright/`, and measurements go to `measurements/`. |
| Confirmed | `BUG‑23` "Capture Camera" captured nothing. Removed with the panel. |
| Confirmed | `BUG‑24` `/config.json` 404 on every production load. Gone. |
