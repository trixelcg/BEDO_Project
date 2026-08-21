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
Week  5  ░ BEDO-014..017 draw calls, coordinate correctness  ← P1 visual defects
Week  6  ░ BEDO-018..023 lesson engine + interaction
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

### ☐ BEDO‑016 — ★ Coordinate-space strategy + weight placement `P1`
- **Objective** Implement the three named spaces with typed converters; fix the weight stack to measure and correct in **one** space on **all three axes**.
- **Reason** **`BUG‑02` — discs render 2.18 m from the pan** because X/Z use the node translation while Y uses a measured bbox centre. Root cause, spaces, computed error, fix, test and visual criterion are in `docs/17 §5.2`.
- **Affected** `src/scene/apparatus/WeightStack.tsx`, `src/assets/measureApparatus.ts`, `src/three/spaces.ts` (new).
- **Dependencies** BEDO‑013, BEDO‑014 · **Risks** low once the space discipline exists.
- **Acceptance** every disc's world bbox centre within **5 mm** of the pan axis in X/Z; stacked in Y without interpenetration; **visible on the pan at the `pointer` view with 250 g loaded**.
- **Tests** `weightStack.spec.ts` + visual regression.
- **Perf** none.

### ☐ BEDO‑017 — ★ Water jet physical-to-visual mapping `P1`
- **Objective** Derive jet diameter from `NOZZLE_AREA_M2` (`d = 2√(A/π) = 0.010 m`), not from tank width; switch plume by `theoreticalV > 0`; make flow rate visibly legible.
- **Reason** **`BUG‑03` — the jet is ~18× too wide and hides the deflector**, defeating the two observations the lesson asks for (`UX‑02`). Plus `BUG‑21` (no visible change with flow), `BUG‑27` (nozzle mesh is the base flange). Full analysis in `docs/17 §5.3`.
- **Affected** `src/scene/water/**`, `src/simulation/selectors/flow.ts`.
- **Dependencies** BEDO‑014. **Not blocked by the DCC pass** — the plumes already carry flow‑aligned
  `TEXCOORD_0` (verified against all eight binaries), so replacing the world‑space planar fallback with UV
  sampling is a code change. Only physical re‑sizing needs Blender (`docs/19` D‑5).
- **Risks** medium — non‑uniform scale still distorts the vertex ripple until D‑5 lands.
- **Acceptance** plume XZ extent within **±15 %** of `2√(A/π)·scale`; deflector face unobstructed; n = 0.4 vs 0.5 obviously different side by side.
- **Tests** `waterJet.spec.ts` + visual regression at 5 flow rates × 7 deflectors.
- **Perf** slightly fewer fragments.

---

## Phase F — Lesson engine & interaction

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

### ☐ BEDO‑020 — Interaction engine + single gate `P1`
- **Objective** Affordance registry with mandatory `a11y` descriptors; gesture recogniser; intent bus; **one** gate.
- **Reason** `BUG‑04` (clicks bypass gating → two-click dead end), `BUG‑18` (sticky cursor), `BUG‑19` (invisible clickables), `ARCH‑07`.
- **Affected** `src/interaction/**` (new), `DeviceModel.tsx:1167‑1191`.
- **Dependencies** BEDO‑014, BEDO‑018 · **Risks** medium.
- **Acceptance** disallowed intents never dispatch and always produce coaching feedback.
- **Tests** `gating.spec.ts`, `hitshape.spec.ts`.

### ☐ BEDO‑021 — Drag-and-drop + 2 s transfers `P1`
- **Objective** `transferable` affordance supporting click→2 s move, pointer drag with ghost + drop target, and keyboard pick-up/put-down.
- **Reason** **Explicit client requirement** — eval PDF §2b *"lacking essential features like drag-and-drop"*; Exp. sheets say *"Drag the 90° flat deflector"*; storyboard specifies the 2 s animation (`BUG‑22`).
- **Dependencies** BEDO‑020, BEDO‑010 · **Risks** medium — drag on a 3D canvas needs care with OrbitControls.
- **Acceptance** all three input paths produce the identical intent; step 2 copy matches behaviour in both languages.
- **Tests** `intent.spec.ts`, E2E drag path.

### ☐ BEDO‑022 — Deflector scope + weight removal `P1`
- **Objective** Reject deflectors outside the loaded experiment; make loaded weights individually removable (click on holder → 2 s return).
- **Reason** `BUG‑05` (Exp.1 silently runs with `k = 2.0` while every label says `F = ρAV²`), `UX‑24`; state machine `D →(weight-on-holder)→ B`.
- **Dependencies** BEDO‑020 · **Risks** low.
- **Acceptance** cross-experiment selection impossible from any surface; removing one disc updates the balance.
- **Tests** `deflectorScope.spec.ts`, `weights.spec.ts`.

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
| `BUG‑02` weights 2.18 m off | **BEDO‑016** |
| `BUG‑03` jet 18× too wide | **BEDO‑017** |
| `BUG‑04` gating bypass | BEDO‑020 — apparatus safety gated in ✅ BEDO‑006, knowledge duplication removed in ✅ BEDO‑018; **only the gating itself remains** |
| `BUG‑05` cross-experiment deflector | BEDO‑022 |
| `BUG‑06` Free mode records nothing | BEDO‑023 |
| `BUG‑07`/`08`/`10`/`11`/`12` UI/CSS | BEDO‑025, 026 |
| `BUG‑09` RTL no-op | BEDO‑037 |
| `BUG‑13`/`UX‑20` monitor | BEDO‑027 |
| `BUG‑14`/`15`/`16` fabricated data | BEDO‑009 |
| `BUG‑17` material leak | BEDO‑013 |
| `BUG‑20` floating screws | BEDO‑014 |
| `BUG‑21` no flow feedback | BEDO‑017, 030 |
| `BUG‑22` drag-and-drop | BEDO‑021 |
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
