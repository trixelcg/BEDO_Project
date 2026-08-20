# 02 — Architecture Audit

Every finding uses the same shape: **Severity · Description · Root Cause · Affected Files · Recommended
Solution · Estimated Difficulty · Priority**.

Severity: `Blocker` > `Critical` > `High` > `Medium` > `Low`
Difficulty: `Trivial` (<1 h) · `Easy` (½ d) · `Moderate` (1–3 d) · `Hard` (1–2 w) · `Very Hard` (>2 w)
Priority: `P0` (rebuild cannot start without it) · `P1` · `P2` · `P3`

---

## Summary

| ID | Title | Severity | Difficulty | Priority |
|---|---|---|---|---|
| ARCH‑01 | `DeviceModel.tsx` is a 1 197‑line god component | Critical | Hard | P0 |
| ARCH‑02 | No memoisation boundary — a toast re‑renders the whole 3D scene | High | Moderate | P0 |
| ARCH‑03 | Simulation state is a single `useState` object prop‑drilled 20 ways | High | Moderate | P0 |
| ARCH‑04 | The `useGLTF` cache is destructively mutated (materials, hierarchy, transforms) | Critical | Hard | P0 |
| ARCH‑05 | No render/asset budget; nothing declares what the target device is | High | Moderate | P0 |
| ARCH‑06 | Business rules split between `App.tsx` and `DeviceModel.tsx` | High | Moderate | P1 |
| ARCH‑07 | Guided‑mode gating is cosmetic — `onClick` ignores `liveKeys` | High | Easy | P1 |
| ARCH‑08 | `useFrame` reads React state from a stale-prone closure | Medium | Moderate | P1 |
| ARCH‑09 | Backend: 5 unauthenticated write/proxy endpoints on a public URL | Critical | Easy | P0 |
| ARCH‑10 | Backend: dynamic `import()` driven by the request path | Medium | Trivial | P1 |
| ARCH‑11 | Backend: no HTTP `Range` support — the 28 MB video cannot seek | High | Easy | P1 |
| ARCH‑12 | Backend: `immutable` cache headers on non‑hashed asset filenames | High | Trivial | P1 |
| ARCH‑13 | Dev "Scene Settings" panel shipped to students, writes global config | High | Easy | P1 |
| ARCH‑14 | Five `api/` handlers belong to a different product | Medium | Trivial | P2 |
| ARCH‑15 | No error boundary; a single throw blanks the app | High | Easy | P1 |
| ARCH‑16 | No build‑time code splitting — one 1.2 MB chunk | Medium | Easy | P1 |
| ARCH‑17 | Two conflicting GCS bucket defaults | Medium | Trivial | P2 |
| ARCH‑18 | No test infrastructure of any kind | High | Moderate | P1 |

---

### ARCH‑01 — `DeviceModel.tsx` is a 1 197‑line god component

**Severity:** Critical **Difficulty:** Hard **Priority:** P0

**Description.** One React component owns: GLTF loading (9 files), material authoring, a hand‑written GLSL
water shader with a procedurally generated texture, runtime pivot‑group surgery on the scene graph, bounding‑box
measurement of every interactive part, hotspot generation, camera‑anchor derivation, highlight management,
the unscrew/reseat animation, valve + switch + lamp animation, spring physics, pointer kinematics, jet
positioning and scaling, weight‑stack cloning, and the guide arrow. Its `useFrame` callback alone is 272 lines.

**Root cause.** Organic growth without a seam. Git shows 42 of 48 commits touching this one file; each new
behaviour was appended to the same `useFrame` rather than given a home. There is no notion of "an animated
apparatus part" as a unit, so every part's logic is inlined side by side.

**Affected files.** `src/components/DeviceModel.tsx` (all of it).

**Consequences observed.**
- Any change risks all others; the commit log is a chain of `Fix X … and also Y` regressions.
- Impossible to unit‑test — none of the logic is reachable without a WebGL context and a 26 MB GLB.
- Impossible to reason about frame cost: ~15 full scene‑graph `getObjectByName` walks happen per frame
  (see `PERF‑06`) because there is no place to cache a resolved reference.
- Two separate commits in July had to re‑derive the same weight‑stack transform maths.

**Recommended solution.**
1. Introduce an **apparatus model layer** that resolves every authored GLB name to an `Object3D` **once**, at
   load, into a typed `ApparatusRefs` record. Nothing downstream calls `getObjectByName` again.
2. Split into single‑responsibility children, each owning one `useFrame`:
   `<CoverAssembly/>`, `<DeflectorMount/>`, `<SpringPointer/>`, `<WaterJet/>`, `<ValveGroup/>`,
   `<PowerPanel/>`, `<WeightStack/>`, `<Hotspots/>`, `<GuideArrow/>`.
3. Move the water shader and its procedural texture into `src/three/materials/waterMaterial.ts` with an
   explicit `dispose()`.
4. Move bounding‑box/anchor derivation into `src/three/measureApparatus.ts`, a pure function of `scene` →
   `{anchors, hotspots, tankBounds, nozzleLip}`, unit‑testable against a fixture.

---

### ARCH‑02 — No memoisation boundary between UI state and the 3D scene

**Severity:** High **Difficulty:** Moderate **Priority:** P0

**Description.** `App` holds one state object. `Scene3D` receives the whole `state`; `DeviceModel` receives the
whole `state`. Neither is wrapped in `React.memo`, and none of the ~20 callbacks passed to them is stable
(`handleCoverClick`, `handleSelectDeflector`, `handleTogglePower`, … are re‑created every render). Therefore
**opening a warning toast, typing in a settings slider, answering the quiz, or switching a sidebar tab
re‑renders `DeviceModel`** — re‑running its 12 hooks and re‑creating its hotspot JSX.

**Root cause.** State granularity is the whole simulation; component boundaries do not match state boundaries.

**Affected files.** `src/App.tsx:373‑449`, `src/components/Scene3D.tsx:157‑272`,
`src/components/DeviceModel.tsx:70‑89`.

**Recommended solution.** Move simulation state into a selector‑based store (Zustand is the idiomatic choice
with R3F, and R3F already ships it as a transitive dependency). Each 3D child subscribes to only the slices it
needs; UI‑only state (`showSettings`, `panel`, `showVideo`, `notice`) never crosses into the canvas at all.
Wrap `DeviceModel` in `React.memo` as a backstop and make every handler a stable `useCallback`.

---

### ARCH‑03 — Simulation state is one `useState` object, prop‑drilled

**Severity:** High **Difficulty:** Moderate **Priority:** P0

**Description.** `SimulationState` has 18 fields spanning four unrelated concerns: apparatus physical state
(`isCoverOpen`, `valveOpening`, `loadedWeights`…), lesson progression (`mode`, `currentStep`, `experimentId`),
derived results (`recordedRows`, `currentRecordIndex`, `isCalculated`), and transient UI (`warningMessage`,
`notice`, `showMonitor`, `language`). All 18 change together through one setter and travel as one prop.

**Root cause.** No domain decomposition. The type was written before the concerns were separated.

**Affected files.** `src/types/index.ts:56‑79`, `src/App.tsx` (entire), all four components.

**Consequences.**
- `pointerOffset` is declared, initialised to `0.0`, and **never read or written again** — dead state
  (see `CQ‑04`).
- The derived `recordedRows` live *inside* the same state they are derived from, forcing a
  `useEffect → setState` round trip on every interaction (`src/App.tsx:146‑169`) and an extra render per click.
- `handleSelectExperiment` resets the *whole* object, silently discarding the student's Free‑mode choice.

**Recommended solution.** Split into `useApparatusStore` (physical), `useLessonStore` (progression), and local
component state for UI. Derive `recordedRows` with `useMemo`/a selector, never store it.

---

### ARCH‑04 — The `useGLTF` cache is destructively mutated

**Severity:** Critical **Difficulty:** Hard **Priority:** P0

**Description.** `useGLTF` returns a **process‑global, URL‑keyed singleton**. `DeviceModel` then:
- replaces `Tank_cover`'s material with a freshly constructed `MeshPhysicalMaterial` (`DeviceModel.tsx:187‑203`);
- sets `envMapIntensity` on every shared material instance (`:185`);
- toggles `.visible` on ~157 meshes (`:205`);
- **re‑parents nodes** into newly created pivot `Group`s and subtracts their centre from their position
  (`:464‑531`);
- writes `.position.y` on `Tank_cover`, `Screws`, `deflector_rod`, `JET Force 2_212` every frame;
- replaces the 8 water GLBs' materials with a shared one (`:388‑399`).

None of this is undone on unmount, and none of it is idempotent.

**Root cause.** Treating a cached, shared resource as if it were component‑owned instance data.

**Affected files.** `src/components/DeviceModel.tsx:174‑207, 388‑399, 464‑543, 976‑1016`.

**Consequences observed / latent.**
- **Confirmed material leak.** The cover‑material effect re‑runs whenever `reflection`, `glassSpecular`,
  `glassRoughness` or `glassIor` change — i.e. **on every drag of a Scene Settings slider** — constructing a
  new `MeshPhysicalMaterial` (and therefore a new compiled shader program) and never disposing the old one.
- **`restY` baseline corruption.** `baseY(obj, key)` caches "the resting Y" the first time a part is touched
  (`:143‑146`). If the component ever remounts (route change, HMR, StrictMode in a future React mode, or a
  future "restart lab" that unmounts the canvas) the cached scene's positions are *already* offset, so the new
  baseline is wrong and the cover drifts permanently.
- **Duplicate pivots on remount.** `pivots.current` is a fresh ref per mount, so `install()`'s idempotence guard
  does not survive; a second mount nests a second pivot inside the first.
- Two `<DeviceModel/>` instances could never coexist (e.g. a picture‑in‑picture or comparison view).

**Recommended solution.** Load once via `useGLTF`, then **`clone()` (or `SkeletonUtils.clone`) into
component‑owned scene data**, or — better — do the pivot surgery and material assignment **offline in Blender /
`gltf-transform`** so the runtime never rewrites the graph. Any material the app creates must be tracked and
disposed in an effect cleanup.

---

### ARCH‑05 — No render or asset budget is declared anywhere

**Severity:** High **Difficulty:** Moderate **Priority:** P0

**Description.** Nothing in the repo states the target device, target frame rate, texture budget, draw‑call
budget, or time‑to‑interactive goal. Consequently the app ships 764 MB of texture, 769 draw calls per frame,
`frameloop="always"`, uncapped DPR, `preserveDrawingBuffer: true`, real‑time shadows on top of a baked
lightmap, and a 26 MB blocking model — no single one of which was a decision, because there was nothing to
decide against.

**Root cause.** Absence of non‑functional requirements.

**Affected files.** `src/components/Scene3D.tsx:186‑269`, `public/Bedo_baked_v2.glb`, `vite.config.ts`.

**Recommended solution.** Write a one‑page budget into the repo before any Phase‑2 code — see
`09_REBUILD_STRATEGY.md §2`. Vocational‑training labs run integrated‑GPU laptops and school tablets; a
defensible starting budget is *≤ 150 draw calls, ≤ 256 MB VRAM, ≤ 8 MB initial transfer, interactive in ≤ 4 s
on a 2019 mid‑range laptop, 60 fps at DPR ≤ 1.5*. Add an automated check in CI that fails the build if the GLB
grows past its budget.

---

### ARCH‑06 — Business rules are split between `App.tsx` and `DeviceModel.tsx`

**Severity:** High **Difficulty:** Moderate **Priority:** P1

**Description.** The five documented safety guards live in `App.tsx` (`handleCoverClick`, `handleSelectDeflector`,
`handleTogglePower`). But `DeviceModel.handleHotspot` (`:714‑745`) re‑implements a *subset* of the same rules so
it can decide whether to play the unscrew animation:

```ts
if (state.isPowerOn || state.loadedWeights.length > 0) { onCoverClick(); return; }   // duplicate of error3/error5
```

Two copies of the same predicate, in two files, with no shared constant.

**Root cause.** The animation needed to know the outcome before dispatching, and the guard was copied rather
than extracted.

**Affected files.** `src/App.tsx:195‑282`, `src/components/DeviceModel.tsx:714‑745`.

**Recommended solution.** Extract the state machine into `src/lib/stateMachine.ts` exporting a pure
`attempt(state, action): {next: SimulationState} | {error: ErrorCode}`. Both the UI and the 3D layer call it;
the 3D layer plays its animation only when `attempt` succeeds. This is also the single most testable unit in
the whole rebuild.

---

### ARCH‑07 — Guided‑mode gating is cosmetic

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** `liveKeys` (`DeviceModel.tsx:664‑689`) computes which parts the current step permits, and is
correctly consulted by `onPointerOver` to decide the cursor and the glow. **`onClick` never consults it**
(`:1183‑1186`):

```tsx
onPointerOver={(e) => { …; if (liveKeys.has(h.key)) { …setHoveredKey(h.key) } }}
onClick={(e) => { e.stopPropagation(); handleHotspot(h.action); }}   // ← no gate
```

**Reproduced in browser:** during step 2 (cover open, power off, tray empty) clicking the un‑highlighted tank
cover closes it. `advance(prev, 3, 4)` does not fire because `currentStep` is 2, so the student is left at step 2
with the tank shut; selecting a deflector now raises *"Remove the tank cover first"* and the only escape is
`Reset simulator`. **A dead end reachable in two clicks.**

**Root cause.** The gate was added to the hover handler and not the click handler.

**Affected files.** `src/components/DeviceModel.tsx:1167‑1191`.

**Recommended solution.** Gate the click on the same predicate, and — better — raise the appropriate coaching
notice ("Finish step 2 first") instead of silently ignoring, so the student learns why nothing happened.
Additionally, the hotspot spheres are large (the cover's radius clamps to 0.18 model units ≈ 0.32 m world) and
overlap neighbouring parts; sizes should come from a per‑part table, not one clamped heuristic.

---

### ARCH‑08 — `useFrame` reads React state from the render closure

**Severity:** Medium **Difficulty:** Moderate **Priority:** P1

**Description.** The 272‑line frame callback closes over `state`, `hoveredKey`, `liveKeys`, `focusTarget`,
`arrowPos`, `hotspots`, `anchors`, `nozzleLip`, `tankBounds`. R3F re‑registers the callback on every render, so
values are fresh **as long as a render happens**. But the callback also mutates refs (`coverOffsetRef`,
`animTimeRef`, `pointerSwingRef`) that React never sees, and it calls `onCoverClick()` from inside the frame
loop (`:897`) — a `setState` during the render/animation phase.

**Root cause.** Imperative animation and declarative state share no explicit bridge.

**Affected files.** `src/components/DeviceModel.tsx:839‑1110`.

**Recommended solution.** Read volatile simulation values through a store's transient `subscribe`
(`useStore.getState()`), not the closure, so the frame loop is decoupled from render timing. Model the
unscrew sequence as an explicit finite state machine with named phases rather than three `if (a > 0.05 / 0.8 /
2.2)` time comparisons, and dispatch its completion through a queued action rather than calling a React setter
mid‑frame.

---

### ARCH‑09 — Five unauthenticated write/proxy endpoints on a public URL

**Severity:** Critical **Difficulty:** Easy **Priority:** P0

**Description.** `cloudbuild.yaml` deploys with `--allow-unauthenticated`, and `server.ts` routes every
`/api/<name>` to `api/<name>.ts` with no auth check anywhere. The following are reachable by anyone on the
internet at the production URL:

| Endpoint | What an anonymous caller can do |
|---|---|
| `POST /api/chat` | With `{"provider":"gemini"}` and no key, `api/chat.ts:75‑135` fetches the **Cloud Run service account's own metadata token** and calls Vertex AI. Free LLM inference **billed to the project**. |
| `POST /api/tts` | Same pattern with `{"provider":"gcp"}` (`api/tts.ts:6‑33`) — free Google TTS on the project's account. |
| `POST/PUT /api/upload` | Writes an arbitrary body to an arbitrary object name in the GCS bucket and calls `makePublic()` (`api/gcsStorage.ts:25‑62`). **Arbitrary public file hosting on a Google‑owned domain.** |
| `POST /api/save-config` | Accepts `characterUrl`/`hdrUrl`, **downloads them from any URL the caller supplies** (`save-config.ts:59‑95`), writes them into `public/`, uploads to GCS, `makePublic()`, and overwrites the global `config.json` that every visitor loads. |
| `GET /api/crawl?url=…` | Server‑side request forgery — fetches any URL and returns the body (`api/crawl.ts`). |
| `POST /api/register` | Unauthenticated, unrate‑limited writes into the bucket (`registrations/*.json`). |

**Root cause.** `api/` was copied wholesale from a different product (a TTS avatar app — note the default
bucket name `tts-character-assets-2026` and the hard‑coded Arabic assistant system prompt) and deployed without
review. Nothing in this simulator calls any of them except `save-config`.

**Affected files.** `api/chat.ts`, `api/tts.ts`, `api/upload.ts`, `api/crawl.ts`, `api/register.ts`,
`api/gcsStorage.ts`, `api/save-config.ts`, `server.ts:76‑104`, `cloudbuild.yaml:26`.

**Recommended solution.** **Immediately** delete `chat.ts`, `tts.ts`, `crawl.ts`, `upload.ts`, `register.ts`
and `gcsStorage.ts`, and redeploy. Then decide whether `save-config` should exist at all — see `ARCH‑13`. If a
config endpoint is kept, put it behind IAP or a shared secret, drop the remote‑URL download entirely, and
validate the payload against a schema. Also review the bucket for objects an anonymous caller may already have
written.

---

### ARCH‑10 — Dynamic `import()` driven by the request path

**Severity:** Medium **Difficulty:** Trivial **Priority:** P1

**Description.** `server.ts:94‑96`:
```ts
const modulePath = `./api/${apiName}.ts`;
const module = await import(modulePath);
```
`apiName` comes straight from `pathname.split('/')[2]`. WHATWG URL normalisation removes literal `../`
segments, so this is not currently exploitable, but it is one encoding quirk away from arbitrary module
execution and it silently 500s on any unknown name.

**Root cause.** Reimplementing a router with string concatenation.

**Affected files.** `server.ts:76‑104`.

**Recommended solution.** Replace with an explicit allow‑list map `{ 'save-config': handler }` resolved at
module load.

---

### ARCH‑11 — No HTTP `Range` support

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** `server.ts:170‑177` always responds `200` with the full file via `createReadStream`. It never
reads `req.headers.range`. The walkthrough video is **28 MB**; a `<video controls autoPlay>` element cannot
seek without `206 Partial Content`, and every open re‑downloads the whole file.

**Root cause.** Hand‑rolled static server.

**Affected files.** `server.ts:106‑178`, `src/components/UIOverlay.tsx:647‑652`.

**Recommended solution.** Serve static assets from a CDN / GCS with `Range` support, or use a maintained
static middleware. Independently, transcode the video to HLS or at minimum a ~6 MB H.264/AAC 720p file and
drop `autoPlay` (see `UX‑09`).

---

### ARCH‑12 — `immutable` caching on non‑hashed filenames

**Severity:** High **Difficulty:** Trivial **Priority:** P1

**Description.** `server.ts:164‑166` sends `Cache-Control: public, max-age=31536000, immutable` for every
`.js`, `.css` **and `.glb`**. Vite hashes JS/CSS, so that is correct for them. It does **not** hash files in
`public/` — `Bedo_baked_v2.glb` keeps its name across deploys. A student who has loaded the model once will
keep the stale 26 MB copy **for a year**.

**Root cause.** One rule applied to two categories of asset.

**Evidence from git.** Commit *"Rename `Bedo_baked.glb` to `Bedo_baked_v2.glb` to bypass aggressive browser
caching"* — the team already hit this and worked around it by renaming the file, which is why a dead 17 MB
`Bedo_M.glb` and a dead `Bedo_model_optimized.glb` are still in the repo.

**Affected files.** `server.ts:164‑168`, `public/`.

**Recommended solution.** Import models through Vite (`import url from './apparatus.glb?url'`) so they land in
`dist/assets/` with a content hash, or add a build step that hashes `public/` assets and emits a manifest.
Serve unhashed files with `max-age=0, must-revalidate` + `ETag`.

---

### ARCH‑13 — A developer tuning panel is shipped to students

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** A floating **"Scene Settings"** button sits permanently in the top‑right of the production
app. It opens a 350‑line panel exposing tone‑mapping exposure, ambient intensity, HDR intensity and rotation,
reflection, contrast, ambient colour, three glass‑material parameters, and full position/rotation/scale
transforms for the entire apparatus. All labels are **English only**, even in Arabic mode.

Two buttons make it worse:
- **"Capture Camera"** calls `alert('Camera angles captured. Save config to write permanently.')` and
  **does nothing else** (`src/App.tsx:409‑411`) — a lie in the UI.
- **"Save Config"** `POST`s to `/api/save-config`, which writes `public/config.json` **and uploads it to the
  public GCS bucket**, where every subsequent visitor loads it (`src/App.tsx:96‑136`). One student dragging a
  slider and clicking Save changes the lighting for everyone.

**Root cause.** A build‑time authoring tool wired into the runtime app.

**Affected files.** `src/App.tsx:78‑136, 387‑415`, `src/components/MenuSettings.tsx` (all),
`api/save-config.ts`.

**Recommended solution.** Bake the final `SceneConfig` into a checked‑in TS constant. Gate the panel behind
`import.meta.env.DEV` (or a `?debug=1` flag plus a build flag) so it is tree‑shaken out of production entirely.
Delete `save-config` or make it an authenticated internal tool.

---

### ARCH‑14 — Five `api/` handlers belong to a different product

**Severity:** Medium **Difficulty:** Trivial **Priority:** P2

**Description.** `chat.ts` (244 lines), `tts.ts` (214), `crawl.ts` (112), `register.ts` (60), `upload.ts` (64)
and `gcsStorage.ts` (90) — 784 of the 804 `api/` lines — implement an Arabic conversational TTS avatar. They
contain hard‑coded Arabic assistant prompts, ElevenLabs/OpenAI/Vertex integrations, viseme handling and a web
scraper. Nothing in `src/` references them.

**Root cause.** The repo was forked from that product; `git log` starts at *"initial commit of migrated R3F
project"* with `api/` already present.

**Affected files.** `api/*` except `save-config.ts`.

**Recommended solution.** Delete. See also `ARCH‑09` — these are not merely dead, they are actively dangerous.

---

### ARCH‑15 — No error boundary

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** There is no `<ErrorBoundary>` and no `onError` on any `<Suspense>`. If the GLB 404s, the
WebGL context is lost, or any of the many `as any` accesses hits `undefined`, React unmounts the tree and the
student sees a **black page with no message**. There is likewise no `webglcontextlost` handler — on a laptop
that suspends, or a mobile GPU that evicts a 764 MB texture set, the canvas simply dies.

**Root cause.** Not implemented.

**Affected files.** `src/main.tsx`, `src/App.tsx`, `src/components/Scene3D.tsx:195, 224`.

**Recommended solution.** Add a top‑level error boundary with a bilingual "Something went wrong — Reload"
panel; add a `<Suspense>` error fallback around the model; listen for `webglcontextlost`/`restored` on the
canvas and re‑initialise.

---

### ARCH‑16 — No code splitting

**Severity:** Medium **Difficulty:** Easy **Priority:** P1

**Description.** `dist/assets/index-*.js` is a **single 1 235 395‑byte chunk** (338 KB gzip, 264 KB brotli).
`vite.config.ts` raises `chunkSizeWarningLimit` to 1500 to silence the warning rather than address it. Three.js,
drei, lucide‑react (39 MB installed, 18 icons used), the monitor, the settings panel and the video modal all
load before first paint, even though the monitor and the settings panel are conditionally rendered.

**Root cause.** Default Vite config plus a suppressed warning.

**Affected files.** `vite.config.ts:6‑9`, `src/App.tsx:2‑7`.

**Recommended solution.** `React.lazy` for `SoftwareMonitor`, `MenuSettings` and the video modal; a
`manualChunks` split for `three`; import lucide icons individually
(`import Power from 'lucide-react/dist/esm/icons/power'`) or replace with inline SVG.

---

### ARCH‑17 — Two conflicting GCS bucket defaults

**Severity:** Medium **Difficulty:** Trivial **Priority:** P2

**Description.** `server.ts:12` defaults to `bedo-project-assets-2026`; `api/save-config.ts:11` and
`api/gcsStorage.ts:9` default to `tts-character-assets-2026`. `cloudbuild.yaml` sets `GCS_BUCKET_NAME` so
production agrees, but any local or misconfigured run silently splits reads and writes across two buckets.

**Affected files.** `server.ts:12`, `api/save-config.ts:11`, `api/gcsStorage.ts:9`, `cloudbuild.yaml:26`.

**Recommended solution.** One `config.ts` module, one default, fail loudly if the env var is missing in
production.

---

### ARCH‑18 — No test infrastructure

**Severity:** High **Difficulty:** Moderate **Priority:** P1

**Description.** Zero test files, no runner, no CI workflow. The physics, the state machine, the flow‑rate
polynomial, the momentum factors and the row bookkeeping are all pure functions that are trivially testable and
completely untested — which is why the row‑bookkeeping bugs in `03_BUG_REPORT.md` (`BUG‑14`, `BUG‑15`) shipped.

**Recommended solution.** Vitest + one spec each for `physics.ts`, `apparatus.ts` (assert every `MESH` and
deflector name resolves against a checked‑in GLB node‑name fixture — this alone would have caught the class of
bug the code comments describe at `apparatus.ts:1‑26`), and `stateMachine.ts`. Playwright for one smoke test
that walks all twelve steps. Add a GitHub Action running `tsc`, `oxlint`, `vitest`, and an asset‑budget check.

---

## Architectural strengths worth preserving

Not everything here is broken, and Phase 2 should carry these forward intact:

1. **`src/lib/physics.ts`** — correct, single‑sourced, and its comments document *why* each constant is what it
   is, with the reference figures it was validated against. Keep verbatim.
2. **`src/lib/apparatus.ts`** — the `gltfName()` sanitiser and the mesh‑name map encode real, hard‑won knowledge
   about how three.js mangles authored node names. The comment block at lines 11–26 explains a whole class of
   silent failure. Keep verbatim.
3. **`src/lib/experiments.ts`** — a clean, data‑driven definition of all four experiment sheets, bilingual, with
   the derivations transcribed. Keep verbatim.
4. **Deriving anchors and hotspots from real bounding boxes** rather than hard‑coded coordinates is the right
   instinct and should survive the rebuild (`DeviceModel.tsx:554‑655`).
5. **`THREE.MathUtils.damp` instead of frame‑rate‑dependent lerp** (`DeviceModel.tsx:852‑854`) — correctly
   diagnosed and correctly fixed. Keep the pattern.
