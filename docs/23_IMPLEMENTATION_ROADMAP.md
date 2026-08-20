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

### ▶ BEDO‑002 — Pin current behaviour with tests `P0`
- **Objective** Vitest + Playwright; specs for physics, apparatus contract, experiments, and one E2E walkthrough — written **against today's code**.
- **Reason** Zero tests today. `BUG‑06/14/15/05/27` all shipped because nothing checked them. Refactoring without a pin will silently change the verified physics.
- **Affected** `package.json`, `vitest.config.ts`, `playwright.config.ts`, `src/**/__tests__/`, `.github/workflows/ci.yml`, `src/domain/apparatus/__fixtures__/apparatus.nodes.json`.
- **Dependencies** none · **Risks** none (additive).
- **Acceptance** `npx vitest run` green; the physics spec reproduces all six BEDO spreadsheet rows to 1e-6; the contract spec resolves every `MESH`/`shelf`/`installed` name; E2E completes 12 steps.
- **Tests** *is* the test task.
- **Perf** CI time +~2 min.
- **Note** ★ **This is the recommended first implementation task.** Detail in `docs/22 §4`.

### ☐ BEDO‑003 — Remove the production dev panel and the config backend `P0`
- **Objective** Bake `SceneConfig` into a checked-in constant; gate `MenuSettings` behind `import.meta.env.DEV`; delete `api/save-config.ts`, the `/config.json` fetch, and the four `alert()` calls.
- **Reason** Any visitor can change the scene for everyone (`ARCH‑13`, residual risk `R‑1`); "Capture Camera" lies (`BUG‑23`); the eval PDF specifies **no backend**.
- **Affected** `src/App.tsx:78‑136,387‑415`, `src/components/MenuSettings.tsx`, `api/save-config.ts`, `server.ts`, `vite.config.ts`.
- **Dependencies** BEDO‑002 · **Risks** low — losing a tuning tool; mitigated by keeping it in dev builds.
- **Acceptance** production bundle contains no `MenuSettings` and no `/api/*` call; `api/` is empty; scene renders identically.
- **Tests** `bundle.spec.ts` asserts the string `save-config` is absent from `dist`.
- **Perf** −~12 KB JS; removes a 404 on every load (`BUG‑24`).

### ☐ BEDO‑004 — Dead code and dead asset removal `P1`
- **Objective** Delete ~39 MB of unreferenced assets, two unused deps, and the dead exports/types/CSS.
- **Reason** `PERF‑12`, `CQ‑04`. `dist/` 95 MB with 39 MB never requested.
- **Affected** `public/{Bedo_M.glb,Bedo_model_optimized.glb,icons.svg}`, `public/WaterShapes/*.abc`, `src/assets/*`, `package.json` (`framer-motion`, `@react-three/postprocessing`, `@types/three` → dev), `src/types/index.ts`, `src/lib/*`, `src/index.css`, `push.sh`. Move binaries to Git LFS.
- **Dependencies** BEDO‑002 · **Risks** low; `.abc` files move to the art repo, not the bin.
- **Acceptance** `dist/` ≤ 56 MB; build green; app visually identical.
- **Tests** existing suite; `du -sh dist` in CI.
- **Perf** `dist` −39 MB; node_modules −6.6 MB.

---

## Phase B — Domain core isolation

### ☐ BEDO‑005 — Move `lib/` → `domain/`, add unit branding `P1`
- **Objective** Relocate physics/apparatus/experiments unchanged; add branded scalar types; rename ambiguous fields (`springhW → springDeflectionMm`, `mass → balancingMassG`, …).
- **Reason** `ARCH‑06`, `CQ‑05`. **Equations and constants unchanged** — verified correct against BEDO's spreadsheet (`docs/13 §1`).
- **Affected** `src/domain/**` (new), imports across `src/`.
- **Dependencies** BEDO‑002 · **Risks** **medium — a rename could alter a value.** Mitigated: the physics spec must stay green with zero edits.
- **Acceptance** `vitest` green with **no changes to any expected value**; boundary lint passes (`domain/` imports no react/three).
- **Tests** `physics.spec.ts` unchanged and passing.
- **Perf** none.

### ☐ BEDO‑006 — Extract `domain/stateMachine.ts` `P1`
- **Objective** Implement `attempt(state, action)` transcribing the state machine document exactly (A/B/C/D + Error1‑5 + J).
- **Reason** The five guards are duplicated in `App.tsx` and `DeviceModel.tsx` (`CQ‑06 #1`), which is why 3D clicks bypass gating (`BUG‑04`).
- **Affected** `src/domain/stateMachine.ts` (new); `App.tsx` handlers delegate to it.
- **Dependencies** BEDO‑005 · **Risks** low — pure function, fully tabulated in `docs/13 §5`.
- **Acceptance** every cell of the transition table passes; existing app behaviour unchanged.
- **Tests** `stateMachine.spec.ts` — full matrix.
- **Perf** none.

### ☐ BEDO‑007 — Correct the spring model to spec `P1`
- **Objective** `X = h_F − h_w` clamped to `[0, maxTravel]`, `maxTravel` injected from measured geometry.
- **Reason** Storyboard sl. 8: *"If h_F ≤ h_w, X = 0 and the deflector spring will not move."* Current code allows negative deflection. **This is the one physics-adjacent change justified by evidence** (brief §4).
- **Affected** `src/domain/physics/spring.ts` (new), `DeviceModel.tsx:952‑958`.
- **Dependencies** BEDO‑005 · **Risks** low; visually verifiable.
- **Acceptance** spring never extends below rest; never exceeds cover/holder surface.
- **Tests** `spring.spec.ts`.
- **Perf** none.

---

## Phase C — Simulation runtime

### ☐ BEDO‑008 — Framework-free `SimulationRuntime` `P1`
- **Objective** `createSimulation()` with `dispatch`/`tick`/`subscribe`; split `ApparatusState` (discrete) from `ApparatusKinetics` (60 Hz refs); `installedDeflectorId: null` initially; valve rotates without value change when the pump is off.
- **Reason** `ARCH‑03`, `ARCH‑08`, `PERF‑13`; storyboard sl. 23 (LED lights *after* install) and the A→valve→A transition.
- **Affected** `src/simulation/**` (new); `App.tsx` becomes a thin adapter.
- **Dependencies** BEDO‑006 · **Risks** **medium** — the largest state change so far. Mitigated by the strangler approach: `App` delegates, nothing is deleted yet.
- **Acceptance** all existing behaviour preserved; E2E green; runtime drivable headlessly.
- **Tests** `runtime.spec.ts`, `determinism.spec.ts`.
- **Perf** enables (does not yet deliver) the render-count reduction.

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

### ☐ BEDO‑018 — Lesson schema + runner `P1`
- **Objective** `LessonStep` as data with declarative `Condition`s; `LessonRunner` owning progression and gating; one condition evaluator for arrow, OK, highlight and rail.
- **Reason** Rules are spread over three files with **two disagreeing "done" predicates** (`CQ‑06 #5`).
- **Affected** `src/lesson/**` (new), `App.tsx:285‑331`, `UIOverlay.tsx:106‑112`, `DeviceModel.tsx:696‑705`.
- **Dependencies** BEDO‑008 · **Risks** medium — behaviour must match exactly.
- **Acceptance** E2E identical; no lesson rule remains in any component.
- **Tests** `lesson.spec.ts`, lesson linter in CI.

### ☐ BEDO‑019 — Reconcile the step list to the experiment sheets `P1`
- **Objective** 11 steps per the sheets; volumetric valve becomes clickable and state-neutral; step 11 surfaces the real answer sheet PDFs.
- **Reason** `docs/14 §5` — step 5 (volumetric valve) exists in **no** experiment sheet, and causes two of the four disorienting camera trips.
- **Dependencies** BEDO‑018 · **⚠️ Needs decision D‑2.**
- **Acceptance** step list matches Exp.1–4 docx exactly, both languages.
- **Tests** `lessonDefinition.spec.ts` compares against a transcribed fixture.

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

---

## Traceability

| Audit finding | Task |
|---|---|
| `ARCH‑09` security | ✅ BEDO‑001 |
| `BUG‑01`/`UX‑01` black screen | BEDO‑011 + 032/033 |
| `BUG‑02` weights 2.18 m off | **BEDO‑016** |
| `BUG‑03` jet 18× too wide | **BEDO‑017** |
| `BUG‑04` gating bypass | BEDO‑020 |
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

---

## Blocking decisions

| # | Decision | Blocks |
|---|---|---|
| D‑1 | **Redux (per the eval PDF) or Zustand (recommended)** | BEDO‑008 |
| D‑2 | **11 steps (per the experiment sheets) or 12** | BEDO‑019 |
| D‑3 | Monitor as DOM overlay (recommended) or in-scene screen | BEDO‑027 |
| D‑4 | Volumetric measurement in scope? | BEDO‑019 |
| D‑5 | Balance target: hidden / hint mode / instructor toggle | BEDO‑023 |
| D‑6 | LMS / SCORM / xAPI reporting required? | BEDO‑027 |
| D‑7 | **`.blend` ownership** | BEDO‑035 only (not the P1 fixes) |
