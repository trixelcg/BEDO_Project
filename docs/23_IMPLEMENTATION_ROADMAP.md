# 23 — Implementation Roadmap

Every task is small enough to **understand, implement, test, benchmark and revert independently**.
Nothing here is implemented except `BEDO‑001`.

**Priorities:** `P0` security/blocker · `P1` core lesson correctness · `P2` architecture/UX/rendering · `P3` polish
**Status:** ✅ done · ▶ next · ☐ planned

---

## Sequencing, and one deviation from the brief's order

The brief's order (§21) is followed with **one change**: the **asset/texture track (item 7) starts in week 1,
in parallel**, instead of after the draw-call work.

**Why.** Texture memory is the single largest win (764 → ~25 MB) *and* it is the dominant cause of the 15–20 s
load — 42 PNG/JPEG images decoded on the main thread, five of them 4096². The loading system (item 5) can show
a beautiful progress bar, but it cannot make the wait short; only the asset work can. The asset work is also
**tooling/DCC work with no code dependency**, so it blocks nothing and is blocked by nothing. Running it from
week 1 means the rendering work in items 6/15 lands against already-optimised assets rather than being redone.

Everything else follows the brief's sequence.

```
Week  1  ✅ BEDO-001 security  │ ▶ BEDO-002..004 baseline + tests + hygiene
Week  2  ░ BEDO-005..007 domain core        ║ ASSET TRACK  BEDO-030..033
Week  3  ░ BEDO-008..010 simulation runtime ║ (parallel, DCC + gltf-transform)
Week  4  ░ BEDO-011..013 loading + scene foundations
Week  5  ░ BEDO-014, 015 draw calls  │ ✅ BEDO-016 coordinates, BEDO-017 water
Week  6  ✅ BEDO-018..020, 022 lesson engine + gate  │ ░ BEDO-021, 023 interaction
Week  7  ░ BEDO-024..027 camera + UI shell
Week  8  ░ BEDO-028..031 rendering quality + audio/feedback
Week  9  ░ BEDO-032..035 accessibility + i18n
Week 10  ░ BEDO-036..040 optimisation, QA, deployment
```

---

## Phase A — Security & baseline protection

### ✅ BEDO‑001 — Remove unused API attack surface `P0`
- **Objective** Delete six inherited handlers; gate the router with an allow-list.
- **Reason** Anonymous Vertex AI/TTS billed to the project, arbitrary public GCS writes, open SSRF (`ARCH‑09`).
- **Affected** `api/{chat,tts,upload,crawl,register,gcsStorage}.ts` (deleted), `server.ts`.
- **Dependencies** none · **Risks** none — 6 files with zero references.
- **Acceptance** ✅ all six routes 404; `save-config` still reaches its handler; `src/` untouched.
- **Tests** runtime probe (`docs/10 §4.2`).
- **Perf** −784 lines; smaller image.
- **Status** ✅ commit `93b6dbb`. See `docs/10`.

### ✅ BEDO‑002 — Pin current behaviour with tests `P0`
- **Objective** Vitest + Playwright; specs for physics, apparatus contract, experiments, and one E2E walkthrough — written **against today's code**.
- **Reason** Zero tests today. `BUG‑06/14/15/05/27` all shipped because nothing checked them. Refactoring without a pin will silently change the verified physics.
- **Affected** `package.json`, `vitest.config.ts`, `playwright.config.ts`, `src/**/__tests__/`, `.github/workflows/ci.yml`, `src/domain/apparatus/__fixtures__/apparatus.nodes.json`.
- **Dependencies** none · **Risks** none (additive).
- **Acceptance** `npx vitest run` green; the physics spec reproduces all six BEDO spreadsheet rows to 1e-6; the contract spec resolves every `MESH`/`shelf`/`installed` name; E2E completes 12 steps.
- **Tests** *is* the test task.
- **Perf** CI time +~2 min.
- **Note** ★ **This is the recommended first implementation task.** Detail in `docs/22 §4`.
- **Status** ✅ Complete. 259 unit/integration tests + 9 Playwright tests; physics pinned to the spreadsheet,
  all 33 GLB contract names checked against the shipped asset, five guards covered, the twelve-step lesson
  completes in a browser, removed API routes probed on a live server, and `scripts/perf-baseline.mjs`
  reproduces the `docs/11` GPU baseline exactly. Two production seams, both behaviour-neutral:
  `src/lib/readiness.ts` loading markers, and a dev-only `window.__bedoTest.coverClick` adapter that
  `vite build` strips. **Full detail, tolerances, strategy and the defects it found: `docs/25`.**

### ✅ BEDO‑003 — Remove the production dev panel and the config backend `P0`
- **Objective** Bake `SceneConfig` into a checked-in constant; gate `MenuSettings` behind `import.meta.env.DEV`; delete `api/save-config.ts`, the `/config.json` fetch, and the four `alert()` calls.
- **Reason** Any visitor can change the scene for everyone (`ARCH‑13`, residual risk `R‑1`); "Capture Camera" lies (`BUG‑23`); the eval PDF specifies **no backend**.
- **Affected** `src/App.tsx:78‑136,387‑415`, `src/components/MenuSettings.tsx`, `api/save-config.ts`, `server.ts`, `vite.config.ts`.
- **Dependencies** BEDO‑002 · **Risks** low — losing a tuning tool; mitigated by keeping it in dev builds.
- **Acceptance** production bundle contains no `MenuSettings` and no `/api/*` call; `api/` is empty; scene renders identically.
- **Tests** `bundle.spec.ts` asserts the string `save-config` is absent from `dist`.
- **Perf** −~12 KB JS; removes a 404 on every load (`BUG‑24`).
- **Status** ✅ Complete. `MenuSettings` (350 lines) and `api/save-config.ts` (224 lines) deleted; `api/` no
  longer exists and the server answers every `/api/*` with 404. The thirteen scene values are frozen in
  `src/lib/sceneConfig.ts` — **read out of the live three.js scene graph before removal, not copied from the
  panel's defaults**. `scripts/scene-fingerprint.mjs` compares the before/after scene graphs: all four lights,
  the apparatus transform, 33 mesh world transforms, 16 click hotspots, the cover material and the camera are
  **byte-identical**; the only difference in the whole run is `/config.json` no longer being requested.
  JS −10.6 kB, CSS −1.5 kB, one fewer request, `BUG‑23` and `BUG‑24` gone with it. Detail: `docs/26`.

### ✅ BEDO‑004 — Dead code and dead asset removal `P1`
- **Objective** Delete ~39 MB of unreferenced assets, two unused deps, and the dead exports/types/CSS.
- **Reason** `PERF‑12`, `CQ‑04`. `dist/` 95 MB with 39 MB never requested.
- **Affected** `public/{Bedo_M.glb,Bedo_model_optimized.glb,icons.svg}`, `public/WaterShapes/*.abc`, `src/assets/*`, `package.json` (`framer-motion`, `@react-three/postprocessing`, `@types/three` → dev), `src/types/index.ts`, `src/lib/*`, `src/index.css`, `push.sh`. Move binaries to Git LFS.
- **Dependencies** BEDO‑002 · **Risks** low; `.abc` files move to the art repo, not the bin.
- **Acceptance** `dist/` ≤ 56 MB; build green; app visually identical.
- **Tests** existing suite; `du -sh dist` in CI.
- **Perf** `dist` −39 MB; node_modules −6.6 MB.
- **Status** ✅ Complete. `dist/` **95.27 → 56.25 MB** (−39.02 MB, 27 → 15 files) and every remaining file is
  one the app actually requests. The 39 MB was **moved to `assets-source/`, not deleted** — the eight Alembic
  caches and two superseded model exports are inputs to the asset track, and Vite copies all of `public/`
  into `dist/`, which is the only reason they shipped. Each move required four independent proofs: no source
  reference, no build-output reference, never requested in a full runtime trace
  (`scripts/network-trace.mjs`, new), and no dynamic path anywhere in `src/` that could name it — every asset
  URL in the app is a string literal, so the served set is closed and enumerable at twelve paths.
  Runtime deps 10 → 7 (`framer-motion`, `@react-three/postprocessing` removed; `@types/three` → dev).
  New `.dockerignore` takes the build context **584.4 → 55.4 MB**, and the runner no longer copies `public/`
  on top of `dist/` (~−133 MB of duplicated assets in the image; the fallback was verified live).
  Scene fingerprint and network trace both **identical** — 17 paths, 55.13 MB, zero 4xx, zero console errors,
  before and after. JS output byte-identical. Detail: `docs/28`.

---

## Phase B — Domain core isolation

### ✅ BEDO‑005 — Move `lib/` → `domain/`, add unit branding `P1`
- **Objective** Relocate physics/apparatus/experiments unchanged; add branded scalar types; rename ambiguous fields (`springhW → springDeflectionMm`, `mass → balancingMassG`, …).
- **Reason** `ARCH‑06`, `CQ‑05`. **Equations and constants unchanged** — verified correct against BEDO's spreadsheet (`docs/13 §1`).
- **Affected** `src/domain/**` (new), imports across `src/`.
- **Dependencies** BEDO‑002 · **Risks** **medium — a rename could alter a value.** Mitigated: the physics spec must stay green with zero edits.
- **Acceptance** `vitest` green with **no changes to any expected value**; boundary lint passes (`domain/` imports no react/three).
- **Tests** `physics.spec.ts` unchanged and passing.
- **Perf** none.
- **Status** ✅ Complete. `src/domain/{units,physics,apparatus,experiments}.ts` — four files, no React, no
  three.js, no DOM, no clock, enforced by `domain-boundary.spec.ts` (15 tests) including a load-and-compute
  check in a DOM-free environment. Fourteen `RecordRow` fields renamed to state their units
  (`springhW → springDeflectionMm`, `mass → balancingMassG`, `fth → theoreticalForceN`, …) with **no value
  converted** — the physics spec's numeric literals are identical, compared as multisets before and after.
  The CSV schema was **pinned first** (`export-contract.spec.tsx`, 15 tests) and then decoupled behind
  `src/lib/exportSchema.ts`; the exported file is character-identical. `gltfName()` and the camera framing
  moved *out* of the domain to `src/lib/`, per the identity-vs-lookup split. Scene fingerprint identical;
  340 tests green. **Unit branding is naming only — the branded scalar types of `docs/13 §3` are not
  implemented.** Lever arm resolved as 1:1 from BEDO's own simulator (`docs/29 §8`). Detail: `docs/29`.

### ✅ BEDO‑006 — Extract `domain/stateMachine.ts` `P1`
- **Objective** Implement `attempt(state, action)` transcribing the state machine document exactly (A/B/C/D + Error1‑5 + J).
- **Reason** The five guards are duplicated in `App.tsx` and `DeviceModel.tsx` (`CQ‑06 #1`), which is why 3D clicks bypass gating (`BUG‑04`).
- **Affected** `src/domain/stateMachine.ts` (new); `App.tsx` handlers delegate to it.
- **Dependencies** BEDO‑005 · **Risks** low — pure function, fully tabulated in `docs/13 §5`.
- **Acceptance** every cell of the transition table passes; existing app behaviour unchanged.
- **Tests** `stateMachine.spec.ts` — full matrix.
- **Perf** none.
- **Status** ✅ Complete. `src/domain/stateMachine.ts` — `attempt(state, action)`, pure and total over a
  six-field `ApparatusState`, ten intents and six typed `RejectionReason` codes. A refusal returns the input
  state **by identity**; legal-but-nothing-to-do returns `changed: false`. All five guards extracted, including
  their precedence (error3 before error5) and the power-off valve reset. Copy moved to
  `src/lib/apparatusGate.ts`, character for character, keeping the warning/notice distinction. **Valve snapping
  stayed on the lesson side** — it is keyed on the step, so it was never an apparatus rule (`docs/30 §7`).
  61 pure tests added; the 17 React guard tests pass **unchanged**, which is the behaviour-preservation proof.
  The two behaviours BEDO's document specifies and the app has never had (single-weight removal, drain on
  power-off) are asserted *absent* — still `BEDO‑023`/`BEDO‑010`. Scene fingerprint identical; 404 tests green.
  Detail: `docs/30`.

### ✅ BEDO‑007 — Correct the spring model to spec `P1`
- **Objective** `X = h_F − h_w` clamped to `[0, maxTravel]`, `maxTravel` injected from measured geometry.
- **Reason** Storyboard sl. 8: *"If h_F ≤ h_w, X = 0 and the deflector spring will not move."* Current code allows negative deflection. **This is the one physics-adjacent change justified by evidence** (brief §4).
- **Affected** `src/domain/physics/spring.ts` (new), `DeviceModel.tsx:952‑958`.
- **Dependencies** BEDO‑005 · **Risks** low; visually verifiable.
- **Acceptance** spring never extends below rest; never exceeds cover/holder surface.
- **Tests** `spring.spec.ts`.
- **Perf** none.
- **Status** ✅ Complete. Verified against the storyboard itself — sl. 8's three equations and *"If hF ≤ hw,
  The X = 0 and the deflector spring will not move"*, sl. 19's direction of travel, and the spreadsheet's
  `=W4/200*1000` fixing k = 200 N/m in **millimetres**. `src/domain/spring.ts` is pure and takes the travel
  limit as a parameter, because BEDO states the ceiling as geometry (*"will not exceed the cover or holder
  surface"*) and gives no number — so none was invented and its value is unchanged. **Only the lower clamp
  changed**, from −45 % of rest height to 0. Two grid sweeps prove every difference from the old model is a
  case that was below rest. In the running app only states D (overloaded) and E (weights, pump off) move:
  spring scale.y 0.743 → 1.0 and 0.670 → 1.0, four spring-driven parts, 84 other field comparisons identical.
  Rest-state fingerprint identical in every section; draw calls 769 unchanged. 34 tests added, 441 green.
  Detail: `docs/31`.
- **Note** ★ The primary sources are **not missing** — they sit one directory above the repo. `docs/31 §1`.

---

## Phase C — Simulation runtime

### ✅ BEDO‑008 — Framework-free `SimulationRuntime` `P1`
- **Objective** `createSimulation()` with `dispatch`/`tick`/`subscribe`; split `ApparatusState` (discrete) from `ApparatusKinetics` (60 Hz refs); `installedDeflectorId: null` initially; valve rotates without value change when the pump is off.
- **Reason** `ARCH‑03`, `ARCH‑08`, `PERF‑13`; storyboard sl. 23 (LED lights *after* install) and the A→valve→A transition.
- **Affected** `src/simulation/**` (new); `App.tsx` becomes a thin adapter.
- **Dependencies** BEDO‑006 · **Risks** **medium** — the largest state change so far. Mitigated by the strangler approach: `App` delegates, nothing is deleted yet.
- **Acceptance** all existing behaviour preserved; E2E green; runtime drivable headlessly.
- **Tests** `runtime.spec.ts`, `determinism.spec.ts`.
- **Perf** enables (does not yet deliver) the render-count reduction.
- **Status** ✅ Complete. `src/simulation/{state,runtime,selectors}.ts` — plain TypeScript, drivable with no
  renderer, boundary-enforced (no React, store, three.js, DOM, clock or randomness). **Eight fields left
  React**; `recordedRows` left *everything* — it is derived by `selectReadings` now, which removes the
  five-dependency effect that kept a copy of the physics in state. Apparatus legality is **called, never
  re-implemented**: a test greps the runtime for guard-shaped code. Subscribers get `(state, previous)` and
  hear nothing from a rejected or no-op command. React observes via `useSyncExternalStore`; `App` projects a
  read-only `SimulationView` so no component changed. **`BALANCE_ROW = {7:1, 9:2}` no longer decides simulation
  truth** — the runtime is told `BEGIN_READING { index }`, and the step map is now a compatibility adapter in
  the lesson's own file for `BEDO‑019` to delete. Scene fingerprint identical, draw calls 769 unchanged, CSV
  character-identical, 12-step lesson unchanged. 78 tests added, 498 green. Detail: `docs/33`.

### ☐ BEDO‑009 — Readings as an append-only list `P1`
- **Objective** Replace the four fixed `recordedRows` with `Reading[]` carrying provenance; derive chart series from **one** dataset; add Clear.
- **Reason** **Fixes `BUG‑14` (fabricated row 4 with `F_th = 6.63 N`), `BUG‑15` (phantom `F_ac = 0` dot), `BUG‑16` (nonsense "Total Weight"), and unblocks `BUG‑06`.** Storyboard sl. 22: *"Fill rows by changing the valve opening"*; sl. 24: Clear.
- **Affected** `src/simulation/state/readings.ts`, `src/types`, `SoftwareMonitor.tsx`, `App.tsx:146‑169`.
- **Dependencies** BEDO‑008 · **Risks** low.
- **Acceptance** the table shows exactly the readings taken; chart line and dots identical in count; CSV matches.
- **Tests** `readings.spec.ts`, `freeMode.spec.ts`.
- **Perf** removes an effect→setState round trip per interaction (`PERF‑16`).

### ☐ BEDO‑010 — Continuous simulation: drain, transfers, kinetics `P2`
- **Objective** Tank drains on power-off; 2 s animated transfers as first-class state; kinetics advanced by `tick(dt)`.
- **Reason** Storyboard sl. 14–16, 30, 32. Currently absent.
- **Affected** `src/simulation/runtime/tick.ts`, scene components.
- **Dependencies** BEDO‑008 · **Risks** low.
- **Acceptance** drain visible and monotonic; transfers take 2.0 s ±100 ms.
- **Tests** `drain.spec.ts`, `transfer.spec.ts`.
- **Perf** requires frames only while active (`docs/17 §3`).

---

## Phase D — Loading system

### ☐ BEDO‑011 — Staged loading + error boundary + context-loss recovery `P1`
- **Objective** BOOT → SHELL → CRITICAL UI → CORE SCENE → TRAINING READY → OPTIONAL, with a branded bilingual DOM progress UI; root error boundary; `webglcontextlost` recovery.
- **Reason** **`BUG‑01`/`UX‑01`: 15–20 s of black screen with zero feedback** — the worst first impression in the product. `ARCH‑15`/`BUG‑33`: any throw or context loss blanks the app permanently.
- **Affected** `src/app/boot/**`, `src/app/ErrorBoundary.tsx`, `index.html` (inline critical CSS), `Scene3D.tsx`.
- **Dependencies** none (can start any time) · **Risks** low.
- **Acceptance** **no black frame at any point**; progress reflects real asset bytes; killing the GLB request shows a bilingual retry, not a blank page.
- **Tests** `noBlackScreen` Playwright guard (screenshot at 300 ms); context-loss simulation via `WEBGL_lose_context`.
- **Perf** perceived load 15–20 s → branded UI at ~300 ms.

### ☐ BEDO‑012 — Code splitting + icon imports `P2`
- **Objective** `React.lazy` the monitor, settings and video modals; `manualChunks` for three; per-icon lucide imports.
- **Reason** `ARCH‑16`, `PERF‑11` — one 1.2 MB chunk, warning suppressed rather than fixed.
- **Affected** `vite.config.ts`, `src/App.tsx`.
- **Dependencies** BEDO‑004 · **Risks** low.
- **Acceptance** initial chunk ≤ 150 KB gzip (B‑7).
- **Tests** bundle-size CI check.
- **Perf** 338 → ~150 KB gzip.

---

## Phase E — Scene foundations, draw calls, coordinate correctness

### ☐ BEDO‑013 — `loadApparatus` + `measureApparatus` + disposal registry `P1`
- **Objective** Resolve every mesh name **once** into typed refs, throwing at load on a miss; pure `measureApparatus`; tracked create/dispose for all runtime resources.
- **Reason** `ARCH‑04` (mutated drei cache), `PERF‑06` (~15–25 full scene-graph walks *per frame*), `BUG‑17` (material leak per settings tick).
- **Affected** `src/assets/**` (new), `DeviceModel.tsx`.
- **Dependencies** BEDO‑002 · **Risks** medium — touches load order. Mitigated by the contract test.
- **Acceptance** zero `getObjectByName` inside any `useFrame`; `renderer.info.memory` flat over 50 settings changes.
- **Tests** `contract.spec.ts`, `disposal.spec.ts`.
- **Perf** removes ~900–1500 scene-graph traversals/second.

### ☐ BEDO‑014 — Split `DeviceModel` into subsystem components `P2`
- **Objective** Nine components, one `useFrame` each; all magic numbers to `three/tuning.ts` with units and provenance.
- **Reason** `ARCH‑01`/`CQ‑09` — 1 197 lines, 42/48 commits, a 272-line frame callback doing eleven jobs.
- **Affected** `src/scene/apparatus/**` (new), `DeviceModel.tsx` (deleted at the end).
- **Dependencies** BEDO‑008, BEDO‑013 · **Risks** **high — the biggest refactor.** Mitigated: one component per commit, E2E green after each, revert granularity of one part.
- **Acceptance** behaviour identical; no file over 250 lines; `DeviceModel.tsx` gone.
- **Tests** existing E2E + visual regression must not change.
- **Perf** neutral; unlocks BEDO‑015/016.

### ☐ BEDO‑015 — Draw-call reduction `P2`
- **Objective** Merge static room/bench geometry; `castShadow` on a dynamic list only; remove `ContactShadows` and the two decorative fills; cut transmissive materials to ≤ 1.
- **Reason** `PERF‑02`/`PERF‑03`/`RND‑08`/`RND‑18` — the scene is drawn ≈ 4.5× per frame.
- **Affected** `src/scene/environment/**`, `Stage.tsx`, and the merged GLB from BEDO‑031.
- **Dependencies** BEDO‑014, BEDO‑031 · **Risks** medium — shadow quality; mitigated by the visual gate.
- **Acceptance** **≤ 150 draws/frame, ≤ 4 FB binds** measured with the frozen methodology.
- **Tests** Playwright perf spec (B‑1..B‑3).
- **Perf** 769 → ~90–120 draws; 22 → ~3 FB binds.

### ✅ BEDO‑016 — ★ Coordinate-space strategy + weight placement `P1`
- **Objective** Fix the weight stack to measure and correct in **one** space on **all three axes**.
- **Reason** **`BUG‑02` — discs render 2.18 m from the pan** because X/Z use the node translation while Y uses a measured bbox centre.
- **Acceptance** every disc's world bbox centre within **5 mm** of the pan axis in X/Z; stacked in Y without interpenetration; **visible on the pan**.
- **Status** ✅ Complete. **`BUG‑02` is closed.** Reproduced first, at HEAD, against the running
  application: **2.196500 world units** — 1.2203 model units, ≈1.22 m of apparatus — matching the
  audit's ≈2.18 m exactly. Two things the audit did not record: the invisible **click proxies sat
  1.93 units from the discs they represented**, and **Y was wrong too**, by a constant 58 mm, because
  the audit compared against the rod's *crown* rather than the pan.

  The root cause was not a wrong number but a wrong *kind* of number. `proto.position` is a node's
  translation relative to its glTF parent, and this export is **baked**: every top-level node — the
  rod, all five discs, everything — carries the identical `(0, 1.238958, −1.231891)`, the exporter's
  Z-up conversion. Subtracting it did not move a disc *towards* the pan; it displaced every disc by
  the same constant wherever it was.

  There is **no pan node in the GLB** — the plate is part of `deflector_rod`, at y ∈ [1.430594,
  1.433344] with a 0.040774 radius, under a thin retaining post that reaches 1.490356. The discs are
  annular, bore 6.353 mm against a 5.153 mm post: they *slide down the post onto the plate*, which is
  independent confirmation of where they belong. `src/lib/holderAnchor.ts` now finds that plate as the
  widest lamina on the rod and returns its top face in **apparatus-local space only** — no axis from a
  node transform, no world round-trip, no magic constant. The slot group's origin **is** the seat, so
  the drawn disc and its hit proxy cannot diverge; the proxy became a cylinder of the disc's own
  measured radius and thickness, retiring two hand-picked clamps.

  **Result: horizontal error exactly 0.000000**; the residual is the deliberate 1 mm seating clearance
  per disc. **2.1965 → 0.0018 world units.** Proxy offset **1.930381 → 0**. Under a lifted spring the
  pan and the disc rise by the same 0.045690 and the seating error does not change.

  The fix is at **runtime, not in the DCC**: the pivots are not mis-placed in a way Blender could
  repair — they are all identical because the transform was baked, which is valid glTF — so a
  re-export would risk the 33-name contract in `tests/unit/glb-contract.spec.ts` for no mathematical
  gain. **The production GLB was not modified.**

  Empty-baseline scene fingerprint **identical in every section** bar the JS chunk hash; 769 draw
  calls, 217 055 triangles, 22 framebuffer binds and 42 programs all unchanged. In loaded states
  **draw calls and triangles are identical too** — the only delta is +1 transform node per disc, the
  recentring group. No `useFrame` added; the anchor is measured once at load.

  **825 tests green** (798 + 27 new coordinate tests, run against the shipped GLB via a new
  `tests/helpers/model.ts`), and the six real pointer-drag browser tests — including the two-second
  weight removal — pass against the 26 MB apparatus. Physics, spring, lesson and gate untouched.
  Detail: `docs/39`.

  Still open and deliberately untouched: `BUG‑03` water width (`BEDO‑017`), the rod being off-screen
  at step 2 (camera work), and the missing **tray → holder** 2 s transfer — storyboard sl. 16 says the
  weight *moves* to the holder, and BEDO‑021 built only the reverse. Now that the destination is
  correct and proven, that is the natural next step.
- **Tests** `tests/unit/holder-anchor.spec.ts` + `scripts/weight-anchor.mjs` before/after capture.
- **Perf** neutral — see above.

### ✅ BEDO‑017 — ★ Water jet physical-to-visual mapping `P1`
- **Objective** Derive the jet's diameter from the nozzle rather than the tank.
- **Reason** **`BUG‑03`** — the jet rendered ~18× too wide, hiding the rod, spring and deflector behind a pipe of water.
- **Acceptance** rendered jet exit diameter within a stated tolerance of the physical bore; no tank-derived width logic remains.
- **Status** ✅ Complete. Reproduced at HEAD first, in **model units** rather than pixels:
  **139.7 mm at reading 1, 172.0 mm at full flow, against a 9.9975 mm bore — 13.98× and
  17.20×.** Every deflector family rendered the identical width, so all four were equally
  wrong.

  Three faults compounding, not one. BEDO's storyboard sl. 18 specifies **two** water objects
  — *"water shape before impact"* and *"water shape after impact"* — and the code had
  collapsed them into one; the survivor was sized at 95 % of the **tank's** 181 mm diameter;
  and a `flowIntensity` ramp scaled the bore with the valve, which no source supports and
  physics contradicts. The seven deflector-named GLBs are the *after-impact* shapes (aspect
  ≈1.3, sprays) and were being used as the jet.

  `Water_low` turned out to be the authored before-impact jet: aspect **3.44** against the
  physical jet's **3.50** (a 10 mm bore over the 35 mm `TRAVEL_HEIGHT_M`), 1.7 % apart, while
  every other shape is near 1.3. It had been used only as a startup trickle. A test now
  identifies it by aspect rather than filename.

  `src/lib/waterJet.ts` is the single physical→scene mapping: `d = 2√(A/π)` from the verified
  `NOZZLE_AREA_M2`, and `jetScale` takes no parameter that could carry a tank, a viewport or
  a flow rate. `tankBounds` is gone from `DeviceModel` entirely and a test asserts it has not
  returned. **Result: 10.00 mm, error −0.00 %**, identical at every flow state and every
  deflector family — 17.20× → 1.00×. Jet origin sits on the nozzle lip with **0.000000**
  radial offset and no gap.

  **No physics changed.** All 855 pre-existing tests pass unedited; 871 green in total.
  Idle performance identical (769 draws / 217 055 tris / 22 binds / 42 programs); flowing
  costs +9 draws and +3 042 triangles, which is BEDO's second water shape being drawn.
  Empty fingerprint differs only by the chunk hash and `objectCount` 290 → 291.

  Two water issues found and deliberately left: the shader samples its ripple texture by
  **world position** rather than the `TEXCOORD_0` every asset carries (the banding), and
  **`TRAVEL_HEIGHT_M` says 35 mm where the model measures 184 mm** — a factor of 5.3 that
  feeds `impactVelocitySquared` and needs BEDO source evidence, not a judgement call.
  Detail: `docs/41`.
- **Tests** `tests/unit/water-jet.spec.ts` + `scripts/water-jet.mjs` before/after capture.
- **Perf** idle neutral; +9 draws while flowing.

### ✅ BEDO‑043 — Water shader UV sampling / banding `P1`
- **Objective** Remove the striping on the water surface, caused by sampling the ripple texture in world space.
- **Status** ✅ Complete. The four ripple lookups sampled `vWPos`, a world-space planar
  projection. Converted to repeats over the jet, the old multipliers gave 2.98 and 4.14 tiles
  *along* the flow but **0.11 and 0.09 across** it — a tenth of a repeat cannot vary, so a 2-D
  fetch collapsed into a function of height and drew horizontal bands. **`BEDO‑017` sharpened
  it seventeenfold**: correcting the jet from 172 mm to its true 10 mm bore removed what
  little cross-flow variation there was. Latent before, obvious after.

  The expected fix — "the assets carry UVs, use them" — does not work, and the inventory says
  why: all eight declare **zero textures and zero images**, so `TEXCOORD_0` is leftover 3ds Max
  mapping no texture ever sampled; it is a per-primitive atlas with disjoint V bands; it
  **reverses** within a single asset (`Water_low` correlates +0.973 on one primitive and −0.996
  on another); U spans 28 % on two assets; and `Water45_Oblique#1` correlates ~0.00 on both.
  Re-reading the accessors also corrected `docs/41`: **three** assets carry `TEXCOORD_1`, not two.

  So the coordinate is derived instead — a cylindrical parameterisation of each mesh's own
  vertices, baked into an `aWaterUv` attribute once at load. Object space, so it cannot swim by
  construction; two-dimensional, so it cannot stripe; one rule for all eight shapes with no
  filename conditionals. The flow axis is measured per mesh, since three are authored lying down.

  Tile counts were **derived from the old effective density** (3 and 4 along, matching 2.98 and
  4.14) rather than chosen. A first attempt at 7 and 11 read as a stack of rings — denser is not
  less banded — and that is recorded. A latent vertex bug surfaced too: the height ramp
  `clamp(position.y * 0.05 + 0.5, …)` was pinned at 1 for every shape authored above y = 10,
  which is most of them.

  `BEDO‑017` re-verified after the change: **10.00 mm, −0.00 %** at every flow state and every
  deflector family. **Zero added draw calls, triangles or programs** — idle and flowing costs are
  byte-identical. Fingerprint identical bar the chunk hash. 903 tests green (883 + 20).
  `TRAVEL_HEIGHT_M` deliberately untouched. Detail: `docs/43`.
- **Tests** `tests/unit/water-uv.spec.ts` + `scripts/water-shader.mjs` before/after capture.
- **Perf** neutral.

### ✅ BEDO‑042 — Power switch direction + loaded-weight visibility `P1`
- **Objective** Two reported presentation defects: the power switch turning the wrong way, and loaded weights vanishing when the camera moves.
- **Status** ✅ Complete. **One defect was real, the other was not**, and the measurement is
  the substance of the task.

  **Switch — real, and worse than reported.** The *axis* was wrong, not the sign. The knob
  turned about **Z**, the operator's left-to-right axis, which tipped it out of the panel:
  ON rendered the disc as a flat ellipse lying down. The geometry settles the axis — the
  knob is 44 mm across and 30 mm deep, thinnest across **X**, so X is the face it looks out
  of, and the operator stands at −X. A disc spins about its face normal. A sign flip would
  only have tipped it the other way.

  The storyboard's two slides appear to contradict each other (sl. 29 "clockwise to turn it
  on", sl. 30 "anticlockwise to turn it on"). Sl. 30 describes turning **on** a switch it
  has just said is already on — not a transition that exists — so it is sl. 29's sentence
  copied and half-edited. Read as "to turn it off", the two agree. Direction resolved from
  the text, not by choosing. New mapping: **+90° about X**, in
  `apparatusView.powerSwitchTurn`. Verified live: marker X constant at 0.000000, motion
  entirely in YZ, round trip returns to rest.

  **Weights — not reproducible.** Across camera dolly, orbit, return, flow change, monitor
  toggle and guided-step camera flights, with single, multiple and duplicate discs, the
  loaded discs never vanished and **never changed UUID** — ruling out remounting, visibility
  predicates, culling and transforms alike. The one disappearance is the canonical lesson's
  own `REMOVE_ALL_WEIGHTS` at the end of each reading step, where the runtime clears too;
  the camera flies at the same instant, which is why it reads as camera-caused. No code
  change was warranted and none was made — tests were added so it stays that way.

  This leaves a conflict for a decision: the brief says lesson progression must never remove
  a weight, while the canonical lesson explicitly does. Not changed unilaterally; see
  `docs/42 §7`.

  883 tests green (871 + 12). Fingerprint identical bar the chunk hash; 769 draws /
  217 055 tris / 22 binds / 42 programs unchanged. Detail: `docs/42`.
- **Tests** `tests/unit/switch-weight-visibility.spec.ts`, plus a camera/orbit/flow persistence browser test.
- **Perf** neutral.

### ✅ BEDO‑018 — Lesson schema + runner `P1`
- **Objective** `LessonStep` as data with declarative `Condition`s; `LessonRunner` owning progression and gating; one condition evaluator for arrow, OK, highlight and rail.
- **Reason** Rules are spread over three files with **two disagreeing "done" predicates** (`CQ‑06 #5`).
- **Affected** `src/lesson/**` (new), `App.tsx:285‑331`, `UIOverlay.tsx:106‑112`, `DeviceModel.tsx:696‑705`.
- **Dependencies** BEDO‑008 · **Risks** medium — behaviour must match exactly.
- **Acceptance** E2E identical; no lesson rule remains in any component.
- **Tests** `lesson.spec.ts`, lesson linter in CI.
- **Status** ✅ Complete. `src/lesson/{schema,currentLesson,runner}.ts` — the twelve shipped steps as data,
  each with a stable `StepId`, and `displayNumber` demoted to metadata. **One completion authority**: the
  `switch (currentStep)` in `App`, `okVisible` in `UIOverlay` and the arrow's `done` in `DeviceModel` — which
  genuinely disagreed on steps 1/3/4/11/12 — now all read the runner. `READING_FOR_STEP = {7:1, 9:2}` is gone;
  a step that starts a reading carries `BEGIN_READING { index }` as its own data. A source audit fails the
  build if any production file compares a step to a number, switches on one, or declares
  `Record<number, number>`. `lesson-flow.spec.tsx` passes **unchanged** — the parity contract. 58 tests added,
  556 green; scene fingerprint identical, draw calls 769 unchanged. **BUG‑04's duplication half is fixed;
  gating is untouched** because enforcing it would change behaviour (`BEDO‑020`). Detail: `docs/34`.

### ✅ BEDO‑019 — Reconcile the step list to the experiment sheets `P1`
- **Objective** 11 steps per the sheets; volumetric valve becomes clickable and state-neutral; step 11 surfaces the real answer sheet PDFs.
- **Reason** `docs/14 §5` — step 5 (volumetric valve) exists in **no** experiment sheet, and causes two of the four disorienting camera trips.
- **✅ Now a data edit.** BEDO‑018 made the schema semantic, so the canonical migration is: delete one step
  entry, renumber `displayNumber`, split `finish`, update the copy. No code follows a step number (`docs/34 §10`).
- **✅ Specification settled** by BEDO‑041 (`docs/32`): 11 numbered steps with stable ids, assessment as a separate structure, one procedure shared by four experiments. **`D‑2` is no longer blocking.** The answer-sheet PDFs are blank fill-in worksheets, not answer keys — surfacing them is part of this task.
- **Dependencies** BEDO‑018, **BEDO‑041** · **⚠️ Needs decision D‑2.**
- **Acceptance** step list matches Exp.1–4 docx exactly, both languages.
- **Tests** `lessonDefinition.spec.ts` compares against a transcribed fixture. Today's twelve steps are pinned
  by `experiments.spec.ts` and `lesson.e2e.ts`; both change **only** once D‑2 is decided.
- **Status** ✅ Complete. **Eleven numbered steps**, as all four experiment sheets specify. The
  volumetric-valve instruction is gone from the procedure and the valve is not: it moved to
  `Lesson.alwaysAvailable`, so it is on the panel at *every* step, still operable from the 3D scene, still in
  the state machine — and inert, exactly as BEDO's state-machine document describes. The closing step now
  opens the **real worksheet**, one per experiment, mapped by stable id and fetched on demand (boot is still
  15 requests / 27.02 MB). The assessment is preserved and unnumbered. **There is no step 12** — completion is
  a state. Ten of eleven step ids were untouched, and BEDO‑018's architecture meant no code followed the
  renumbering. Scene fingerprint identical; draw calls 769 unchanged; 585 tests green. Twelve baseline
  expectations were changed deliberately, each recorded with its evidence in `docs/35 §8`.

### ✅ BEDO‑020 — Unified lesson & apparatus interaction gate `P1`
- **Objective** **One** gate, consulted by every 2D control and every 3D hotspot.
- **Reason** `BUG‑04` (clicks bypass gating), `ARCH‑07`.
- **Affected** `src/interaction/gate.ts` (new), `App.tsx`, `DeviceModel.tsx`, `lib/apparatusGate.ts`.
- **Dependencies** BEDO‑018 · **Risks** medium.
- **Acceptance** disallowed intents never dispatch and always produce feedback.
- **Tests** `interaction-gate.spec.ts`, `interaction-gate.spec.tsx`, `domain-boundary.spec.ts`.
- **Status** ✅ Complete. **`BUG‑04` is closed.** `evaluateInteraction()` — pure, framework-free — is the one
  policy both surfaces ask, and `App.interact` is the only path from a learner's intent to the runtime; a
  boundary test fails if a sixth `runtime.dispatch` call site appears or if any component acquires the
  runtime. It reasons in **affordances** read from the step's own `highlight`/`panelControls`, so no step
  number, button id or mesh name appears in the policy, and the volumetric valve stays available at all
  eleven steps from `Lesson.alwaysAvailable` without being named. Lesson refusals
  (`NOT_EXPECTED_IN_CURRENT_STEP`, blue notice) and apparatus refusals (the five guards, red banner) stay
  disjoint; the apparatus is asked **first** because `attempt()` is pure and its message is the more useful
  one — `docs/36 §5`. The scene now separates *actionable* from *asked for*, which fixes the valve's dead
  cursor and stops a blocked cover from playing its unscrew and snapping back. Scene fingerprint identical;
  769 draw calls unchanged; +2.3 kB of JS. **All 574 pre-existing tests pass unedited**; 650 green in total.
  Detail: `docs/36`.

  Still open from `docs/16`, now split out: the affordance registry, gesture recogniser, hit geometry
  (`BUG‑19`), canvas cursor (`BUG‑18`) and keyboard parity (`UX‑04`) — the *input* half of the engine.
  **`BEDO‑021` then took the gesture recogniser and `BUG‑19`;** the registry, the general hit geometry,
  `BUG‑18` and `UX‑04` remain.

### ✅ BEDO‑021 — Drag-and-drop + 2 s transfers `P1`
- **Objective** `transferable` affordance supporting click→2 s move, pointer drag with ghost + drop target, and keyboard pick-up/put-down.
- **Reason** **Explicit client requirement** — eval PDF §2b *"lacking essential features like drag-and-drop"*; Exp. sheets say *"Drag the 90° flat deflector"*; storyboard specifies the 2 s animation (`BUG‑22`).
- **Dependencies** BEDO‑020, BEDO‑010 · **Risks** medium — drag on a 3D canvas needs care with OrbitControls.
- **Acceptance** all three input paths produce the identical intent; step 2 copy matches behaviour in both languages.
- **Tests** `intent.spec.ts`, E2E drag path.
- **Status** ✅ Complete. **`BUG‑22` is closed, and `BUG‑19` with it.** Step 2 says *drag* in all four
  sheets and in both languages, and now the learner drags: a tray deflector is picked up, carried on a
  camera-facing plane, and dropped on the rod — whose drop region is a bounding sphere **measured from
  `deflector_rod`** and tested in apparatus space, so it rides up with the tank cover instead of being a
  pixel guess. The gesture layer (`src/interaction/drag.ts`, pure) decides only what a gesture *means*;
  `interactionFor(source)` is given the source and never the outcome, so a press-and-release
  (`activate` — the storyboard's own gesture) and a drag onto the rod (`commit`) map to the **identical**
  `Interaction` and reach the **identical** `BEDO‑020` gate. `tests/unit/drag-parity.spec.ts` walks every
  deflector × step × experiment × mode × cover state and asserts the two decisions are deep-equal, so a
  drag-specific lesson policy — `BUG‑04` with a third surface — cannot appear unnoticed.

  **The deflector step 2 names was not on the tray to drag.** The scene drew one on the rod the moment the
  lesson *reached* step 2, so the flat disc the sheet tells the learner to drag was already installed and
  absent from the table — and the browser test caught the gesture falling through to OrbitControls instead.
  That is BEDO's model back to front: the storyboard's initial state is *"the weights and deflectors on the
  table"* (sl. 29) and one reaches the rod only when the learner puts it there (sl. 31). Fixed with two
  semantic pieces — `LessonRunner.hasCompleted(id)` ("past this step", the distinction `hasReached` cannot
  draw) and `App` remembering that a deflector *was* installed — so the rod is empty at steps 1–2 as BEDO
  describes, the install has somewhere to fly to, and **free mode now seats a deflector too**, which it
  never did. `docs/38 §3.1`.

  **The drop target is the tank as well as the rod, because BEDO names both** — *"the deflector moves to
  the tank to install it in the rod"* (sl. 7/8/14/31) — and because without the tank the drag is impossible
  at the step that asks for it: measured on the shipped build, at step 2 the plate is up, the rod rides up
  with it, the camera has flown to the tray, and the rod projects two and a half viewport heights above the
  screen while the tank sits at (210, 9). Both regions are measured, padded boxes tested by ray–AABB in
  apparatus space, and the highlight follows whichever one the pointer is over, so the feedback is always on
  a part the learner can see.

  **BEDO's two seconds are implemented, not approximated.** The storyboard says *"the deflector moves to
  the tank to install it in the rod in 2 seconds"* (sl. 7, 8, 14) and *"the weight removed from the tank
  holder in 2 sec"* (sl. 32, state D); `src/interaction/transfer.ts` owns the stopwatch and the easing and
  imports nothing. Animation never gates progression — BEDO's own state machine transitions on the click
  and the two seconds are its animation, so the runtime is authoritative the instant the gate accepts
  (`docs/38 §4`). A missed drop asks the gate nothing at all and returns the object in 0.35 s
  (implementation timing; no source describes a failed drop). A refused one shows the message it always
  showed and returns the same way. The GLB's own nodes are never moved by a gesture: a cloned ghost rides
  the pointer, so a cancelled drag has nothing to unwind and `SimulationRuntime` never sees a coordinate.

  OrbitControls is suspended from the press — three's controls start orbiting on `pointerdown`, so waiting
  for the threshold would swing the camera through the first pixels of every drag — and restored on all
  seven exit paths, `pointercancel` and unmount included, each with its own regression test. The
  click/drag threshold is held constant in **device** pixels rather than CSS pixels, so the same wrist
  movement means the same thing on a 1× and a 2× display. The 2D panel is untouched and remains the
  keyboard path; canvas-native pick-up/put-down still belongs to `UX‑04`/`BEDO‑036`.

  Scene fingerprint identical to `after-bedo022` in all ten sections bar the JS chunk hash; 769 draw calls,
  217 055 triangles, 22 framebuffer binds and 42 shader programs all unchanged. **Scene object count is 290
  at rest before and after a drag** — a carried object is a clone raised on `pointerdown` and disposed when
  the flight lands (290/219 idle → 294/221 carrying → 290/219 installed), and no new `useFrame` was added.
  +10 kB of JS (1 240 895 → 1 251 320). **All 737 pre-existing tests pass unedited** bar one deliberate
  module-list update; 798 green in total, and the six real pointer-drag browser tests pass against the
  26 MB apparatus. Detail: `docs/38`.

  Still open from `docs/16`: the affordance registry, general hit geometry, the canvas cursor (`BUG‑18`)
  and keyboard parity (`UX‑04`).

### ✅ BEDO‑021b — Tray → holder weight transfer `P1`
- **Objective** Complete the pair BEDO‑021 left half-built: a weight clicked on to the holder must *move* there over BEDO's two seconds instead of appearing.
- **Reason** `Jetforce_Storyboard.pptx` specifies the forward transfer four times — sl. 15 (once per denomination), sl. 16 (*"in 2 seconds"*), and the state machine on sl. 29, 30 and 32 — and only the return leg had been built.
- **Acceptance** the disc flies tray → holder in 2 s to the seat `BEDO‑016` measured; removal still flies holder → tray; both use one pair of anchors; no disc is ever drawn twice.
- **Status** ✅ Complete. Read from the **original 69 MB storyboard** rather than from prior
  summaries — the copy in `docs/reference/` is a 165-byte stub — and extracted from the OOXML so
  that the *column* each sentence sits in is known. That turned out to settle the design: on
  sl. 15/16 the sentence sits under **Animation**, and the state tables put *"Click on the
  weight"* under **Transition** while *"The weight moved to the tank holder in 2 sec"* sits
  under **Event**. The click changes the state; the two seconds are what the learner watches —
  exactly how `SELECT_DEFLECTOR` already behaves. So the runtime still commits on the click and
  **`src/domain`, `src/simulation` and `src/lesson` were not edited at all**; all 825
  pre-existing tests pass unedited.

  The Unity original has nothing to say: both trees carry the device's FBX and textures and no
  weight behaviour whatever — no clip, no PlayMaker FSM, no script. The storyboard is the sole
  behavioural source, and that is now written down.

  One thing did have to move. Sl. 19 says the spring reacts when weights are *"placed on the
  holder"*, so under a commit-first design it would compress while the disc was still visibly on
  the bench. The **visual** spring is therefore driven by the mass physically on the pan, with
  `loadedWeightsG` untouched — measured force, balance window, readings and CSV are byte-identical.

  Both directions resolve through `BEDO‑016`: `to` for an arrival is `from` for the removal that
  undoes it, and vice versa. **A defect was found while measuring the route** — a weight may only
  be added with the cover *shut*, and the pan is above that shut cover, so the straight line
  between bench and pan is inside the tank for the middle third of the flight. `BEDO‑021`'s
  removal had been passing a disc through the glass since it shipped. `src/lib/transferPath.ts`
  now carries both directions over the lid on the smallest arc that clears it by a measured
  10 mm, zero at both ends so no route offset survives the landing.

  **Two one-frame duplicates were found and fixed**: the arrival and removal observers were
  passive effects, so a frame was painted before the ghost existed, and the frame loop read tray
  visibility from a memo that lagged `loadedWeightsG` by a render. Sampled from the running app,
  no frame now shows a disc in two places. Removal is held while anything is in flight — it
  renumbers the stack under a travelling disc — while adding stays open, because each disc owns
  its seat from the moment it was clicked and balancing a reading means several in a row.

  **855 tests green** (825 + 30), the four new browser tests pass against the 26 MB apparatus, and
  the six BEDO‑021 drag tests are unchanged. Detail: `docs/40`.
- **Tests** `tests/unit/weight-transfer.spec.ts`, `tests/e2e/weight-transfer.e2e.ts`, extended `transfer.spec.ts`.
- **Perf** neutral — see `docs/40`.

### ✅ BEDO‑022 — Deflector scope + weight removal `P1`
- **Objective** Reject deflectors outside the loaded experiment; make loaded weights individually removable.
- **Reason** `BUG‑05` (Exp.1 silently runs with `k = 2.0` while every label says `F = ρAV²`), `UX‑24`; storyboard sl. 32 `D →(weight on holder)→ B`.
- **Dependencies** BEDO‑020 · **Risks** low.
- **Acceptance** cross-experiment selection impossible from any surface; removing one disc updates the balance.
- **Tests** `deflector-scope.spec.ts`, `weight-removal.spec.ts`, `deflector-scope.spec.tsx`.
- **Status** ✅ Complete. **`BUG‑05` is closed.** It was `BUG‑04` one layer down: the panel
  scoped the deflector list by *rendering a shorter list*, the 3D tray carries all seven
  discs whatever sheet is open, and BEDO‑020's gate asks "may I touch the deflectors" but
  not "which one". The scope is now a **value-level rule in the gate**, reading the one
  authority that already existed — `EXPERIMENTS[].angles`, transcribed from step 2 of each
  sheet. Two of the four experiments genuinely offer a choice (*"the 120° **or** 180°
  semi-circular deflector"*), so it is a set per experiment, not a required id; a
  `requiredDeflectorId` would have contradicted Exp. 2's own sheet. Refusal is a **second**
  lesson reason, `DEFLECTOR_NOT_IN_EXPERIMENT` — the learner is on the right step touching
  the right tray, and only the value is wrong. `install-deflector` now states the same rule
  itself, which catches the one route the gate cannot: free-mode exploration followed by a
  switch back. Free mode still explores, and no longer silently: the panel lists all seven
  there, so the installed disc is always on screen. **Individual weight removal**
  implemented from storyboard sl. 32 — `REMOVE_WEIGHT` by **stack position**, because two
  50 g discs are two discs; unguarded, because it is the direction that resolves guard 5;
  a no-op on an out-of-range index; and gated on the same `weights` affordance as adding
  one, so the overload-recovery path BEDO‑020 opened stays open. Clear-all untouched.
  Physics equations untouched — only the `k` reaching them. Scene fingerprint identical;
  769 draw calls unchanged; +1.8 kB JS. **731 Vitest + 16 Playwright green**, with two
  pre-existing tests corrected because they pinned `BUG‑05` as expected behaviour. Detail:
  `docs/37`.

  Discovered and recorded, not fixed: BEDO's two Phase 1 documents disagree about whether
  the weight-on-holder click exists at all — the state-machine table has no row for it and
  the storyboard specifies it in full (`docs/37 §7`).

### ☐ BEDO‑023 — Free mode `P1`
- **Objective** Explicit "Record reading" action; growing table; live balance indicator in both modes.
- **Reason** **`BUG‑06` — Free mode currently records nothing**: recording is keyed on `currentStep`, which never advances in Free mode, and the table ignores the valve the student set.
- **Dependencies** BEDO‑009, BEDO‑018 · **Risks** low.
- **Acceptance** a Free-mode reading at an arbitrary valve setting appears in the table with the correct Q.
- **Tests** `freeMode.spec.ts`.

---

## Phase G — Camera & UI

### ☐ BEDO‑024 — `CameraDirector` with named views `P2`
- **Objective** One controller; the five named views; bounding-sphere framing with context; geometry avoidance; viewport-occlusion offset; bounds; reduced-motion.
- **Reason** `RND‑11/12/13/14` — two controllers, camera inside the cabinet, cover framed against the sky, four traversals in five steps.
- **Dependencies** BEDO‑013, BEDO‑018 · **Risks** medium.
- **Acceptance** no computed position inside geometry; subject centred in the *visible* viewport at all four widths.
- **Tests** `framing.spec.ts`, `collision.spec.ts`, `occlusion.spec.ts`.

### ☐ BEDO‑025 — Design tokens + CSS Modules `P2`
- **Objective** One semantic palette; delete the second (cyan) palette and the undefined `--glass-bg`; CSS Modules; logical properties; focus-visible.
- **Reason** `BUG‑07` (transparent panel), `BUG‑08` (`.sidebar-header` has no rule → broken header), `BUG‑11` (**both chart series render the same orange**), `CQ‑07` (110 inline style objects), `CQ‑17`.
- **Dependencies** none · **Risks** low but wide-reaching.
- **Acceptance** every `var(--*)` defined; series colours ΔE > 20 **and** differ by pattern; visible focus on every control.
- **Tests** `tokens.spec.ts`, visual regression.

### ☐ BEDO‑026 — Responsive training shell + progress rail `P2`
- **Objective** Desktop-first shell for 1920×1080 down to 1366×768; step rail with progress/review; single scroll container.
- **Reason** `BUG‑10` (balance indicator clipped at ordinary widths), `BUG‑12` (**all step content vanishes below ~800 px**), `UX‑11` (no progress model — eval PDF §3d), `UX‑25`.
- **Dependencies** BEDO‑018, BEDO‑025 · **Risks** low.
- **Acceptance** no clipped content at 1366×768/1440×900/1920×1080/2560×1440; progress always visible.
- **Tests** viewport matrix visual regression.

### ☐ BEDO‑027 — Software monitor rebuild `P2`
- **Objective** Rebuild on `Reading[]`; add Clear, gravity/total displays, the green install LED, "max 4 digits" formatting; fix Save Screen to capture the monitor; proper dialog semantics.
- **Reason** `BUG‑13` (step-11 notice renders *under* the monitor), `UX‑20` (Save Screen captures the 3D canvas behind), `UX‑25`, storyboard sl. 22–24.
- **Dependencies** BEDO‑009, BEDO‑025 · **Risks** low.
- **Acceptance** matches the storyboard's monitor spec; Esc closes; focus trapped.
- **Tests** `monitor.spec.tsx`.

---

## Phase H — Rendering quality, audio & feedback

### ☐ BEDO‑028 — Lighting rig + material corrections `P2`
- **Objective** Lightmap as ground truth; environment for specular only; one tight key light; ACES + fixed exposure + dithering; cover → opaque metal; tank → real glass.
- **Reason** `RND‑01` (double lighting on a baked model — eval PDF §4a), `RND‑02` (metal plate rendered as 98 % glass — eval PDF §4b), `RND‑06` (tank invisible), `RND‑10`.
- **Dependencies** BEDO‑015, BEDO‑030 · **Risks** medium — a look change; mitigated by the visual gate.
- **Acceptance** metal reads as metal, glass as glass; no banding; contrast restored.
- **Tests** visual regression across five views.

### ☐ BEDO‑029 — Outline highlight `P2`
- **Objective** Replace emissive repaint with a silhouette outline; one part at a time; brand orange.
- **Reason** `RND‑05` — parts render as flat blue slabs; at step 2 **all seven** deflectors glow at once.
- **Dependencies** BEDO‑014, BEDO‑020 · **Risks** low.
- **Acceptance** highlighted parts keep their materials and are identifiable by shape.
- **Tests** visual regression.

### ☐ BEDO‑030 — Feedback system + audio `P1`
- **Objective** `FeedbackBus` with outline/toast/audio/animation channels; pump loop tracking `valveOpening`; water impact; valve/switch/weight one-shots; success/error tones; mute; gesture-gated.
- **Reason** **`BUG‑30` — no audio at all**, which is a *spec violation*: storyboard sl. 29–32/38 specify `Audio: N/A` in state A and `Audio: Pump` in B/C/D/J. Eval PDF §2c: *"zero visual or auditory feedback"*.
- **Dependencies** BEDO‑020 · **Risks** low.
- **Acceptance** every state transition produces a distinguishable cue; pump audible in B/C/D/J only.
- **Tests** `feedback.spec.ts` (event → channel mapping).

### ☐ BEDO‑031 — Custom parameters: Apply / Warning / Reset `P2`
- **Objective** Apply disabled until a value changes; mid-experiment Apply raises a confirm (yes → reset with new values, no → revert); Reset restores initial values but not the installed deflector.
- **Reason** Storyboard sl. 12. Current sliders apply live with no confirmation.
- **Dependencies** BEDO‑008, BEDO‑026 · **Risks** low.
- **Tests** `parameters.spec.tsx`.

---

## Asset track (parallel from week 1)

### ☐ BEDO‑032 — Texture re-budget `P1`
- **Objective** Apply the `docs/19 §3.1` resolution table; atlas the five weight sheets and seven label decals; re-export from the `.fbm` originals where possible.
- **Reason** **`PERF‑01` — 764 MB VRAM, 426 MB of it for room scenery.**
- **Dependencies** none (tooling only) · **Risks** medium — visible quality. **Gate: before/after at 1920×1080.**
- **Acceptance** VRAM ≤ 150 MB pre-compression; label decals and the wall chart still legible.
- **Perf** 764 → ~75 MB.

### ☐ BEDO‑033 — KTX2 + meshopt `P1`
- **Objective** UASTC for base colour/lightmap, ETC1S for normal/MR/AO; meshopt geometry; `KTX2Loader` wiring.
- **Reason** GPU-native compression removes **the CPU decode that dominates the 15–20 s load**.
- **Dependencies** BEDO‑032 · **Risks** medium — transcoder wiring, WebGL2 required (already our target).
- **Acceptance** GLB ≤ 8 MB; VRAM ≤ 30 MB; TTFS ≤ 4 s.
- **Perf** 26 → ~4 MB; 75 → ~25 MB VRAM.

### ☐ BEDO‑034 — Material/culling audit + static merge + scene split `P2`
- **Objective** `doubleSided` off except where needed; 19 `BLEND` → `OPAQUE`/`MASK` where alpha is constant; merge static room/bench; split `apparatus.glb` / `room.glb`.
- **Reason** `RND‑03`, `RND‑04`, `BUG‑31`, `PERF‑02`; enables staged loading.
- **Dependencies** BEDO‑033 · **Risks** medium — culling exposes inverted normals (see `DCC D‑8`).
- **Acceptance** primitives 181 → ~60; no new sorting artefacts.

### ☐ BEDO‑035 — DCC pass `P2`
- **Objective** Execute `docs/19 §5` D‑1..D‑5, D‑10, D‑11 in Blender.
- **Reason** Removes runtime scene-graph surgery permanently; gives the water plumes real UVs at physical size.
- **Dependencies** **⚠️ `.blend` ownership confirmation** · **Risks** external dependency.
- **Note** D‑2/D‑3 have good runtime answers (BEDO‑016/017) and must **not** block the P1 fixes.
  D‑3 is now moot: `BEDO‑016` proved the runtime anchor is exact and the weights need no re-export (`docs/39 §6`).

---

## Phase I — Accessibility, i18n, optimisation, QA

### ☐ BEDO‑036 — Accessibility layer `P1`
- **Objective** A DOM control for **every** apparatus action; dialog semantics + focus traps + Esc; live regions for the five safety warnings; labelled inputs; focus-visible; keyboard parity; reduced-motion.
- **Reason** **`UX‑04` — steps 1 and 3 are mouse-only**; `UX‑12` (unlabelled inputs, `outline:none`, no live regions, colour-only chart encoding).
- **Dependencies** BEDO‑020, BEDO‑025, BEDO‑026 · **Risks** low.
- **Acceptance** full 12-step run keyboard-only; axe clean; WCAG 2.1 AA.
- **Tests** `parity.spec.ts`, axe in CI, manual SR pass.

### ☐ BEDO‑037 — i18n + RTL `P1`
- **Objective** `useI18n` binding `<html lang/dir>`; logical CSS properties; `<bdi>` for embedded LTR terms; translate or remove remaining English-only surfaces; Arabic font stack.
- **Reason** **`BUG‑09` — `.rtl` is a no-op**: the sidebar stays left, `!` and `:` land on the wrong side, `<html lang="en">` in Arabic.
- **Dependencies** BEDO‑025 · **Risks** low.
- **Acceptance** full Arabic run with correct mirroring and punctuation.
- **Tests** `rtl.spec.tsx`, Arabic visual regression.

### ☐ BEDO‑038 — Frameloop, DPR, disposal, persistence `P2`
- **Objective** `frameloop="demand"` with audited invalidation; `dpr [1,1.5]` adaptive; drop `preserveDrawingBuffer`; `localStorage`/`sessionStorage` resume; URL deep links.
- **Reason** `PERF‑05` (60 fps on a static scene), `PERF‑07` (11.7 Mpix), `PERF‑08`, `UX‑26` (a refresh loses everything).
- **Dependencies** BEDO‑014, BEDO‑024 · **Risks** medium — missed invalidation shows as a frozen frame.
- **Acceptance** **0 frames/s when idle**; a refresh resumes the session.
- **Tests** `frameloop.spec.ts` (B‑14), leak soak (B‑16).

### ☐ BEDO‑039 — Static hosting, caching, CDN `P2`
- **Objective** Move static assets to a CDN/host with `Range` support and correct cache headers; content-hash the model; transcode the video to ~6 MB with poster and captions; retire `server.ts`.
- **Reason** `ARCH‑11` (**the 28 MB video cannot seek**), `ARCH‑12` (`immutable` on unhashed filenames — the team already worked around this by renaming the GLB), `BUG‑25`.
- **Dependencies** BEDO‑003 · **Risks** low — the eval PDF specifies no backend.
- **Acceptance** video seeks; a model change invalidates cleanly.

### ☐ BEDO‑040 — Cross-browser QA + production deployment `P2`
- **Objective** Full matrix on Chrome/Edge/Safari at four viewports; perf verification against `docs/11`; visual gate; deploy.
- **Reason** Brief §21 items 19–20.
- **Dependencies** everything · **Acceptance** every budget in `docs/20 §2` met and recorded in `docs/11 §5`; the `docs/09 §7` definition of done satisfied.

### ☐ BEDO‑041 — ★ Reconcile the canonical lesson structure `P1`
- **Objective** Produce **one** authoritative step list, agreed with BEDO, by reconciling the four sources that
  currently disagree:
  1. **the application as it ships** — twelve steps (`src/lib/experiments.ts`, pinned by BEDO‑002),
  2. **the experiment sheets** (Exp. 1–4) — eleven instructional steps, with **no** volumetric-valve step,
  3. **the storyboard**,
  4. **the state-machine document** — which defines a machine independent of the lesson script.
  Deliverable: a transcribed fixture of the agreed list, per experiment, in both languages, plus a written
  note of what was added, removed or merged and on whose authority.
- **Reason** The gap is real and unresolved: step 5 (volumetric valve) appears in no experiment sheet
  (`docs/14 §5`), while steps 11 (Calculate) and 12 (assessment question) come from the sheets and are absent
  from the reference simulator. Deciding this by implementation accident would change what a student is taught.
- **Affected** documentation and a fixture only. **No behaviour changes under this task.**
- **Dependencies** none — this is a decision task and can start immediately · **Blocks** BEDO‑019.
- **⚠️ Resolves decision D‑2.**
- **Risks** none while it stays a paper exercise; the risk is in *not* doing it before BEDO‑018/019 rewrite the
  lesson engine around whichever list happens to be in the code.
- **Acceptance** D‑2 answered in writing; a step-list fixture exists that `lessonDefinition.spec.ts` can be
  written against.
- **Note** Raised by BEDO‑002. Until it is decided, **the twelve-step flow is the specification** — the tests
  enforce it, and no task may quietly renumber, merge or delete a step (`docs/25 §9.7`).
- **Status** ✅ **Re-opened and resolved against the primary sources — `docs/32`.**
  The first pass (`docs/27`) concluded "keep the volumetric step, BEDO ships it", on the strength of the
  reference video. Both of its premises were wrong: the sources were never missing (they are one directory
  above the repo), and the video is not BEDO's current build. **`VL-FM009 StepsText 1.asset`, dated 19 Oct
  2025, has nine steps whose fifth is the *flow* control valve — BEDO removed the volumetric step themselves.**
  No experiment sheet contains it; the storyboard's state tables do not list the control at all; the
  state-machine document gives it transitions A→A, B→B, C→C, D→D, meaning it turns and changes nothing.
  **Canonical: 11 numbered steps** (9 apparatus + `record-actual-force` + `open-answer-sheet`), one reusable
  procedure across all four experiments, assessment as a separate structure, and stable ids rather than
  indexes. `docs/27` is retained as a record of the error.

---

## Traceability

| Audit finding | Task |
|---|---|
| `ARCH‑09` security | ✅ BEDO‑001 |
| `BUG‑01`/`UX‑01` black screen | BEDO‑011 + 032/033 |
| `BUG‑02` weights 2.18 m off | ✅ BEDO‑016 — one authoritative pan anchor in one space (`docs/39`) |
| `BUG‑03` jet 18× too wide | ✅ BEDO‑017 — jet sized from the nozzle bore (`docs/41`) |
| `BUG‑04` gating bypass | ✅ BEDO‑020 — one gate for both surfaces (`docs/36`) |
| `BUG‑05` cross-experiment deflector | ✅ BEDO‑022 — one scope rule for both surfaces (`docs/37`) |
| `BUG‑06` Free mode records nothing | BEDO‑023 |
| `BUG‑07`/`08`/`10`/`11`/`12` UI/CSS | BEDO‑025, 026 |
| `BUG‑09` RTL no-op | BEDO‑037 |
| `BUG‑13`/`UX‑20` monitor | BEDO‑027 |
| `BUG‑14`/`15`/`16` fabricated data | BEDO‑009 |
| `BUG‑17` material leak | BEDO‑013 |
| `BUG‑20` floating screws | BEDO‑014 |
| `BUG‑19` hidden tray weights clickable | ✅ BEDO‑021 — one predicate for the renderer and the hit test (`docs/38 §12`) |
| `BUG‑21` no flow feedback | BEDO‑017, 030 |
| `BUG‑22` drag-and-drop | ✅ BEDO‑021 — the sheets' drag, and the storyboard's 2 s transfer (`docs/38`) |
| `BUG‑25` video | BEDO‑039 |
| `BUG‑30` no audio | BEDO‑030 |
| `BUG‑33` no error boundary | BEDO‑011 |
| `PERF‑01`..`08` | BEDO‑015, 032, 033, 038 |
| `RND‑01`..`18` | BEDO‑015, 028, 029, 024 |
| `UX‑04`/`UX‑12` accessibility | BEDO‑036 |
| `CQ‑01`..`21` | BEDO‑002, 004, 005, 014, 025 |
| `PERF‑12` 39 MB of unrequested assets in `dist/` | ✅ BEDO‑004 |
| Video modal cannot be closed (found by BEDO‑004) | BEDO‑026/027 — see `docs/28 §11` |
| Lesson step count (12 shipped vs 11 canonical) | ✅ BEDO‑041 resolved (`docs/32`), ✅ BEDO‑019 implemented (`docs/35`) |
| R3F step 5 (volumetric valve) has no primary-source support | ✅ BEDO‑019 — number removed, affordance kept |
| Answer-sheet worksheet (4 PDFs) never wired up | ✅ BEDO‑019 — shipped, mapped by experiment id, lazy |
| Lever-arm constant: does one exist? | ✅ BEDO‑005 — no; 1:1 per BEDO's own simulator (`docs/29 §8`) |
| Spring travels below rest against storyboard sl. 8 | ✅ BEDO‑007 (`docs/31`) |
| Storyboard `(200×100)` contradicts the xlsx `/200*1000` | Open — BEDO's own inconsistency (`docs/31 §2`) |
| `BUG‑23` "Capture Camera" captured nothing | ✅ BEDO‑003 (removed with the panel) |
| `BUG‑24` `/config.json` 404 on every load | ✅ BEDO‑003 |
| `ARCH‑13` / `R‑1` anonymous scene rewrite via `save-config` | ✅ BEDO‑003 |
| Popup hidden behind the software monitor (found by BEDO‑002) | BEDO‑027 — see `docs/25 §9.1` |

---

## Blocking decisions

| # | Decision | Blocks |
|---|---|---|
| D‑1 | ✅ **Resolved: Zustand.** ⚠️ BEDO‑008 built the runtime framework-free on purpose: the store must **wrap** it, not replace it, or the simulation stops being testable without React (`docs/33 §13`). Scoped subscriptions and imperative access, so 60 Hz simulation, scene and interaction state need not be pushed through React rendering. Not Redux. Applies to future architecture work only — BEDO‑002 changed no state architecture. | BEDO‑008 |
| D‑2 | ✅ **Resolved: 11 steps**, per all four experiment sheets and BEDO's own current Unity build (`docs/32`). The volumetric valve is an affordance, not a step. Assessment is separate. Engine keys on stable ids, not indexes | BEDO‑019, BEDO‑041 |
| D‑3 | Monitor as DOM overlay (recommended) or in-scene screen | BEDO‑027 |
| D‑4 | Volumetric measurement in scope? | BEDO‑019 |
| D‑5 | Balance target: hidden / hint mode / instructor toggle | BEDO‑023 |
| D‑6 | LMS / SCORM / xAPI reporting required? | BEDO‑027 |
| D‑7 | **`.blend` ownership** | BEDO‑035 only (not the P1 fixes) |
