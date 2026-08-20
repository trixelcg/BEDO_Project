# 12 — Target Architecture: BEDO 2.0

**Status:** proposal for approval. Nothing in this document is implemented.

---

## 0. Reference materials — what was found, and what it changes

The Phase 2 brief said to inspect `docs/reference/` and to record any absence as a limitation. The situation is
better than expected, with one exception.

### 0.1 Available and inspected

| Source | Location | Status |
|---|---|---|
| Evaluation document | `docs/reference/Bedo Hydraulic Machines Vocational Training.pdf` | ✅ read (2 pp.) — *Unity Demo Evaluation Summary*, Husni Hawash, 30 Oct 2025 |
| Demo video | `docs/reference/Bedo_Mesu_J.mp4` | ✅ present — **byte-identical** (SHA-1 `398258db…`) to `public/Bedo_Mesu_J.mp4` |
| **Storyboard (real)** | `../Measurement of Jet Forces/Phase 1/Jetforce_Storyboard.pptx` | ✅ **68 MB, 38 slides, fully extracted** |
| State machine spec | `../Measurement of Jet Forces/Phase 1/Jet force_State machine.docx` | ✅ extracted |
| Mathematical model | `../Measurement of Jet Forces/Phase 1/Jet force_Mathematical model.xlsx` | ✅ extracted — **used to verify our physics** |
| Parameter setting spec | `../Measurement of Jet Forces/Phase 1/Jet force_Parameter setting.docx` | ✅ extracted |
| Experiment sheets 1–4 | `../Measurement of Jet Forces/Phase 2/Exp.{1..4}*.docx` + answer-sheet PDFs | ✅ extracted |
| Phase-1 step deck | `../Measurement of Jet Forces/Phase 1/Steps_phase one.pdf`, `Steps.pptm` | present, not yet read |
| Proposal | `../Measurement of Jet Forces/Phase 1/Measurement of Jet forces_Proposal .pdf` | present, not yet read |

### 0.2 ⚠️ Reference-material limitation

`docs/reference/Storyboard.pptx` is **not a PowerPoint file**. It is a 165-byte macOS AppleDouble stub
containing only the string `Nada Adel. Rashed`, carrying a `com.apple.quarantine` xattr from WhatsApp — the
file body was lost in transfer. The identical 165-byte stub also sits at
`../Measurement of Jet Forces/Storyboard.pptx`, so this is not a copy error at your end.

**The real storyboard is `Phase 1/Jetforce_Storyboard.pptx` (68 MB)** and it has been extracted and used
throughout this document. No requirement below is invented; each is cited to a slide or a document.

### 0.3 Editable DCC source assets — **they exist**

Contrary to the Phase 1 assumption, editable sources are available:

| Asset | Path | Size |
|---|---|---|
| **Blender source** | `~/Desktop/BEDO_Project/Bedo_MJblend.blend` | 16 MB |
| FBX (with room) + loose textures | `Measurement of Jet Forces/3D model/Measurement of Jet Forces_with_room_scale.fbx` + `.fbm/` | 23.5 MB |
| FBX (apparatus only) + loose textures | `Measurement of Jet Forces/3D model/Measurement_of_jetforces.fbx` + `.fbm/` | 21 MB |
| Original Unity package | `Bedo_Unity/Bedo_Measurement_of_jet_forces.unitypackage` | 87 MB |
| Unity project (HighlightPlus, PlayMaker, RTLTMPro) | `Project_VL-FM009/` | — |
| Water plume Alembic caches | `public/WaterShapes/*.abc` | 20 MB |

The `.fbm` folders contain the **original-resolution source textures** (`plate_uv.png`, `pointer_uv.png`,
`Jetforce_background.png`, `ground_uv_3.png`, …), which means the texture re-budget in `docs/19` can be done
from sources rather than by re-compressing already-compressed bakes.

**Consequence:** the DCC-side fixes in `docs/19 § DCC_ASSET_ACTIONS_REQUIRED` are viable. Ownership of the
`.blend` still needs confirming, but its existence is no longer a blocker.

### 0.4 What the references change

Findings that **alter design decisions** and are reflected below.

| # | Finding | Source | Impact |
|---|---|---|---|
| R‑1 | **Physics verified exactly.** `Q(n)` quartic, `v₀ = Q/A`, `v = √(v₀²−2gs)`, `A = 0.0000785 m²`, `s = 0.035 m`, `k = 200 N/m`, and **all seven momentum factors** reproduce the spreadsheet to ≤ 0.004 %. | Math model xlsx; storyboard sl. 6–8 | `physics.ts` / `apparatus.ts` confirmed **KEEP**. See `docs/13`. |
| R‑2 | **Audio is specified, not optional.** State A: *"The pump sound is not present"*, `Audio: N/A`. States B/C/D/J: *"The pump sound is present"*, `Audio: Pump`. | Storyboard sl. 29–32, 38 | `BUG‑30` is a spec violation. Feedback system must include audio from the start. |
| R‑3 | **Weights are individually removable.** State D: *"Weights on holder → B → Click on the weight on holder → The weight removed from the tank holder in 2 sec."* | Storyboard sl. 32; state machine docx | Confirms `UX‑24`. Weight inventory must be bidirectional. |
| R‑4 | **Transfers are click → 2-second animation**, not instant. *"the deflector moves to the tank to install it in the rod in 2 seconds"*, *"the weight moves to the tank holder in 2 sec"*. | Storyboard sl. 14–16 | Interaction engine needs animated transfer as a first-class concept. |
| R‑5 | **Drag-and-drop is an explicit client requirement.** *"Limited Interactivity: The demo relies solely on basic clicks, lacking essential features like drag-and-drop."* Exp. sheets also say *"**Drag** the 90° flat deflector"*. | Evaluation PDF §2b; Exp.1–4 docx | Resolves `BUG‑22` **in favour of implementing drag**, with click-to-select as the accessible equivalent. |
| R‑6 | **The water-shape switch is physics-driven, not a magic threshold.** *"If v_th ≤ 0, the water … forms the water shape **before impact**. If v_th > 0, the water impacts the deflector, the water shape **after impact** will form."* | Storyboard sl. 6 | Replaces `valveOpening > 0.22` with `jetState().theoreticalV > 0`. Removes a magic number and makes the plume choice a domain consequence. |
| R‑7 | **Spring displacement is `X = h_F − h_w`, clamped at zero.** *"If h_F ≤ h_w, then X = 0 and the deflector spring will not move"*, and *"The spring will not exceed the cover or holder surface."* | Storyboard sl. 8, 19 | Current code allows negative deflection. Spec deviation to correct in the simulation runtime. |
| R‑8 | **Only four camera views exist**, reached by clicking a camera icon: *deflectors + weights*, *pointer*, *tank*, *software monitor*. There is no per-step camera flight. | Storyboard sl. 26–27 | Justifies replacing nine per-step anchors with a small named-view set. See `docs/18`. |
| R‑9 | **Table rows are created by changing the valve opening** — *"Fill rows by changing the valve opening"*. There is also a **Clear** button that erases table and graph. | Storyboard sl. 22, 24 | Confirms `BUG‑14`/`BUG‑15`/`BUG‑06`: readings are an append-only list, not four fixed rows. |
| R‑10 | **Custom parameters have Apply / Warning / Reset semantics.** Apply is disabled until a value changes; applying mid-experiment raises a confirm (*yes* resets the scene, *no* keeps previous values); Reset restores initial values but **does not** change the installed deflector. | Storyboard sl. 12 | Current sliders apply live with no confirmation. Redesign in `docs/14`/`docs/21`. |
| R‑11 | **The experiment sheets define 11 steps, and none of them is a volumetric-valve step.** The volumetric tank valve exists as a clickable that is state-neutral. | Exp.1–4 docx; state machine docx | Our step 5 is an invention. Lesson definitions must be reconciled — see `docs/14 §5`. |
| R‑12 | **Software monitor extras not implemented:** gravity display, total-weight display, a **green LED that lights once the deflector is installed**, deflector-name display, angle display, Clear button, "max 4 digits" formatting rule. | Storyboard sl. 22–23 | Backlog items in `docs/23`. |
| R‑13 | **Water drains when the pump stops** — *"The water will gradually drain from the tank if the valve is opened"* on power-off. | Storyboard sl. 30, 32 | Simulation runtime behaviour, currently absent. |
| R‑14 | **Proposed stack is "React, Threejs (webGL), Redux (no backend)"**, desktop browser only. | Evaluation PDF | Confirms the platform decision and the removal of the backend. **Redux vs Zustand is an open decision — see `docs/21 §6`.** |
| R‑15 | The evaluation's complaint list maps almost 1:1 onto the Phase 1 audit — including *"No Feedback: users receive zero visual or auditory feedback"*, *"Missing Action Feedback: water flow after adjusting values is absent"*, *"Missing Progress Indicators"*, *"Flawed Modal & Notification Systems"*, *"Inefficient 3D info cards: excessively large yet contain minimal content"*, *"Unnatural lighting: absence of baked lightmaps"*, *"Incorrect Environment Setup: environment assigned to a glass window"*. | Evaluation PDF | These are the **POC acceptance criteria**. Every one has a corresponding finding and roadmap task. |

---

## 1. Architectural thesis

Today BEDO is *React UI + assorted Three.js code*, with simulation rules, lesson rules, rendering and
interaction all interleaved inside one 1 197-line component. The target is an **interactive industrial
training runtime**: a layered system in which each layer has one reason to change and a testable contract.

### 1.1 The dependency rule

```
        ┌──────────────────────────────────────────────────────────┐
        │  PRESENTATION  (React DOM)      FEEDBACK  (visual/audio)  │
        └───────────────┬───────────────────────────┬──────────────┘
                        │ reads                     │ reads
        ┌───────────────▼───────────────────────────▼──────────────┐
        │  LESSON ENGINE        observes simulation, gates actions  │
        └───────────────┬──────────────────────────────────────────┘
                        │ reads / dispatches
        ┌───────────────▼──────────────────────────────────────────┐
        │  SIMULATION RUNTIME   apparatus state + derived values    │
        └───────────────┬──────────────────────────────────────────┘
                        │ calls (pure)
        ┌───────────────▼──────────────────────────────────────────┐
        │  DOMAIN CORE          physics · apparatus · experiments   │
        │                       no React, no Three.js, no I/O       │
        └──────────────────────────────────────────────────────────┘

        ┌──────────────────────────────────────────────────────────┐
        │  SCENE  (R3F)  ── renders simulation, emits interactions  │
        │  INTERACTION   ── translates pointer events into intents  │
        │  ASSET         ── loads and measures the apparatus        │
        └──────────────────────────────────────────────────────────┘
```

**Dependencies point downward only.** Concretely:

- `domain/` imports nothing from the project. No `react`, no `three`.
- `simulation/` imports `domain/` only.
- `lesson/` imports `domain/` and reads `simulation/`. It never imports `scene/` or `ui/`.
- `scene/` reads `simulation/` and emits **intents**. It never contains a lesson rule.
- `ui/` reads `lesson/` and `simulation/`. It never contains a physics or lesson rule.
- `interaction/` emits intents; it does not decide whether they are allowed.

This is enforceable — see `docs/22 §7` for the import-boundary lint rule.

### 1.2 The four rules from the brief, made concrete

| Rule | How the architecture enforces it |
|---|---|
| *Physics drives simulation* | `simulation/` computes every derived value by calling `domain/physics`. No formula is duplicated in a component. |
| *Simulation drives presentation* | `scene/` and `ui/` are pure functions of simulation state. A part's transform is derived, never authored as an offset. |
| *Lesson logic observes simulation and user actions* | The lesson engine subscribes to simulation state and to an intent stream. It never mutates apparatus state directly except through the same intents a user would raise. |
| *Never let visual geometry define simulation truth* | Measured geometry (bounding boxes, anchors) feeds **presentation mapping only**. The jet's diameter comes from `NOZZLE_AREA_M2`, not from the tank mesh — this is exactly the `BUG‑03` root cause. |

---

## 2. The eight systems

| System | Owns | Must not know about |
|---|---|---|
| **Domain Core** | Engineering equations, apparatus definitions, experiment definitions, units, constants | React, Three.js, time, I/O |
| **Simulation Runtime** | Apparatus state (cover, power, valves, weights, deflector), derived values, readings, determinism | Lessons, cameras, meshes, DOM |
| **Lesson Engine** | Lesson/step definitions, allowed actions, completion conditions, hints, validation, progression | How anything is drawn or animated |
| **Interaction Engine** | Affordance registry, hover/select/click/drag, manipulator contracts, intent emission | Whether an intent is legal |
| **Scene Runtime** | Meshes, materials, lights, water, annotations, animation of simulation state | Lesson progression, business rules |
| **Camera Director** | One controller, named views, focus/fit/reset, user-interrupt, bounds, damping | Why a view was requested |
| **Feedback System** | Mapping semantic events → outline/UI/audio/animation channels | The rules that produced the event |
| **Asset System** | Loading, staging, measurement, disposal, budget enforcement | Everything above it |

Each has a dedicated document: `docs/13`–`docs/19`.

---

## 3. Target folder structure

Adapted to what BEDO actually needs — not the template. Every boundary is justified.

```
src/
├── app/                          Composition root only. Nothing else may import from here.
│   ├── App.tsx                   Wires providers, shell, scene, and the loading gate.
│   ├── Providers.tsx             i18n, stores, feedback bus, error boundary.
│   ├── ErrorBoundary.tsx         Bilingual failure surface. Fixes ARCH-15/BUG-33.
│   └── boot/                     Staged loading state machine (docs/17 §7).
│
├── domain/                       ★ PRESERVED. Pure. No React. No Three.js. 100% unit-testable.
│   ├── physics/
│   │   ├── jet.ts                ← from lib/physics.ts, UNCHANGED equations
│   │   ├── spring.ts             X = h_F − h_w, clamped ≥ 0   (storyboard sl. 8)
│   │   └── units.ts              Branded types: Newtons, Grams, LitresPerMinute, Metres
│   ├── apparatus/
│   │   ├── deflectors.ts         ← from lib/apparatus.ts DEFLECTORS + factors
│   │   ├── weights.ts            ← WEIGHTS
│   │   ├── meshNames.ts          ← MESH map + gltfName()   (the GLB naming contract)
│   │   └── constants.ts          COVER_LIFT, SCREW_LIFT → superseded by measured geometry
│   ├── experiments/
│   │   ├── definitions.ts        ← from lib/experiments.ts EXPERIMENTS
│   │   └── quiz.ts
│   └── stateMachine.ts           ★ NEW. attempt(state, action) → Ok | Err(ErrorCode).
│                                 The A/B/C/D + Error1-5 + J machine, verbatim from the spec.
│
├── simulation/                   Runtime apparatus state. Deterministic. No React in the core.
│   ├── runtime/
│   │   ├── createSimulation.ts   Framework-free simulation object (testable headless)
│   │   ├── intents.ts            The intent union — the ONLY way state changes
│   │   └── tick.ts               Continuous values (water level, drain, animation clocks)
│   ├── state/apparatusStore.ts   Zustand binding over the runtime
│   └── selectors/                readings, balance, jetState, flowState — memoised, derived
│
├── lesson/                       Data-driven training. No lesson rule lives in a component.
│   ├── engine/
│   │   ├── LessonRunner.ts       Observes simulation + intents, advances steps
│   │   ├── conditions.ts         Completion/validation predicate registry
│   │   └── gating.ts             allowedActions → interaction affordance filter
│   ├── definitions/
│   │   ├── jetForces.lesson.ts   The 11/12-step procedure as DATA
│   │   └── schema.ts             LessonStep type (docs/14 §2)
│   └── validation/               Dev-time lesson linter (unreachable steps, bad targets)
│
├── interaction/                  How a user touches equipment. Never decides legality.
│   ├── core/
│   │   ├── InteractionRegistry.ts  id → affordance descriptor
│   │   ├── useAffordance.ts        The one hook every interactable uses
│   │   └── intentBus.ts
│   ├── handlers/                 pointer, drag, keyboard (a11y parity)
│   └── affordances/              Button · Rotary · Lever · Draggable · DropTarget · Transferable
│
├── scene/                        R3F only. Presentation of simulation state.
│   ├── Stage.tsx                 Canvas, frameloop policy, dpr policy, colour policy
│   ├── apparatus/                CoverAssembly · DeflectorMount · SpringPointer · WeightStack ·
│   │                             ValveGroup · PowerPanel · Rotameter
│   ├── water/                    WaterJet · ImpactSpray · waterMaterial
│   ├── environment/              Room, lighting rig, environment map
│   ├── camera/                   CameraDirector + named views
│   ├── annotations/              Screen-space callouts (NOT giant 3D cards — eval PDF §3e)
│   └── effects/                  Outline highlight, optional post stack
│
├── feedback/                     Semantic event → channels. Business logic excluded.
│   ├── FeedbackBus.ts
│   ├── channels/                 outline · toast · audio · animation · haptic(noop)
│   └── vocabulary.ts             hover|available|unavailable|correct|incorrect|success|warning
│
├── assets/
│   ├── manifest.ts               Every asset, its stage, its budget
│   ├── loadApparatus.ts          Load ONCE → typed ApparatusRefs; throws on a missing name
│   ├── measureApparatus.ts       Pure: scene → { anchors, hotspots, tank, nozzle }
│   └── disposal.ts               Tracked create/dispose for every runtime resource
│
├── ui/
│   ├── layout/                   Shell, rail, panels, responsive breakpoints
│   ├── training/                 LessonHeader · StepRail · Instruction · Hint · Progress
│   ├── controls/                 DOM equivalent of EVERY apparatus action (a11y contract)
│   ├── monitor/                  Table · Chart · Export · Quiz · Completion
│   └── feedback/                 Toast · Dialog · LiveRegion · FocusTrap
│
├── i18n/                         en.ts · ar.ts · useI18n (binds <html lang/dir>)
├── audio/                        AudioEngine + sources  (storyboard: pump per state)
└── types/                        Shared cross-layer types only
```

### 3.1 Boundaries, justified

| Boundary | Why it exists |
|---|---|
| `domain/` ↔ everything | It is verified correct against BEDO's spreadsheet. Isolating it means a rendering change can never alter a force. Also makes it reusable for the next trainer. |
| `simulation/` ↔ `lesson/` | The state machine spec (A–D + errors) is **independent of the 11-step script**. The reference proves these are two machines; conflating them is what produced `BUG‑06` (Free mode records nothing because recording is keyed on `currentStep`). |
| `lesson/` ↔ `ui/` | Lesson rules currently live in `App.tsx` switch statements *and* `UIOverlay` ternaries *and* `DeviceModel` predicates, which is why the arrow and the OK button disagree (`CQ‑06 #5`). One definition, many renderers. |
| `interaction/` ↔ `lesson/` | Interaction emits *intent*; lesson/simulation decide *legality*. Today `onClick` bypasses `liveKeys` entirely (`BUG‑04`). With an intent bus, gating happens in exactly one place. |
| `scene/` ↔ `simulation/` | Scene is a pure function of state. No `setState` from `useFrame` (`ARCH‑08`), no imperative offsets accumulating in refs. |
| `assets/` ↔ `scene/` | Loading, measuring and disposing are lifecycle concerns, not rendering concerns. Centralising disposal fixes `BUG‑17`. |
| `feedback/` ↔ everything | The eval PDF's single loudest complaint is *"zero visual or auditory feedback"*. Making feedback a system rather than an afterthought is how that gets fixed once. |

---

## 4. Subsystem classification — KEEP / REFACTOR / REPLACE / REMOVE

### ✅ KEEP — carry across essentially unchanged

| Subsystem | Lines | Why |
|---|---|---|
| `lib/physics.ts` | 129 | **Verified to ≤ 0.004 % against BEDO's own spreadsheet.** Every constant matches: `A = 0.0000785`, `s = 0.035`, `k = 200 N/m`, `g = 9.81`, and the `Q(n)` quartic reproduces all six tabulated rows exactly. Moves to `domain/physics/jet.ts`. Equations must not change without evidence. |
| `lib/apparatus.ts` — DEFLECTORS + factors | ~90 | All seven momentum factors verified against the spreadsheet (0.25/0.5/0.75/1.0/1.5/1.707/2.0). |
| `lib/apparatus.ts` — `gltfName()` + `MESH` | ~60 | Encodes the GLB naming contract and a silent-failure mode that cost the team weeks. The comment block at lines 11–26 is preserved verbatim. |
| `lib/experiments.ts` — EXPERIMENTS + quizzes | ~200 | Matches the Exp.1–4 sheets, bilingually, including derivations and the exact quiz text. |
| The five safety guards | — | Match the state machine document **exactly** (A→F, B→G, C→E/H, D→I). |
| Bounding-box-derived anchors/hotspots | ~100 | Right technique; survives model re-export. Moves to `assets/measureApparatus.ts` and becomes pure + tested. |
| `THREE.MathUtils.damp` usage | — | Correct frame-rate-independent easing, with a comment explaining the runaway-lerp bug it fixed. |
| All Arabic + English content | — | Complete and good quality. Only its *presentation* fails. |

**≈ 700 lines preserved.**

### 🔧 REFACTOR — the logic is right, the structure is wrong

| Subsystem | Current | Target |
|---|---|---|
| Guided step definitions | `buildSteps()` returns 12 hard-coded steps; behaviour spread across `App`/`UIOverlay`/`DeviceModel` | `lesson/definitions/*.lesson.ts` — data with declarative conditions (`docs/14`) |
| Safety guards | Duplicated in `App.handleCoverClick` and `DeviceModel.handleHotspot` | Single `domain/stateMachine.ts` |
| Row/reading bookkeeping | 4 fixed rows keyed on `currentStep`; fabricates rows 1 and 4 | Append-only `Reading[]` with `taken` provenance (`docs/15`) |
| Anchor measurement | Inside `DeviceModel`'s effects | Pure `assets/measureApparatus.ts` |
| Water plume selection | `valveOpening > 0.22` magic threshold | `theoreticalV > 0` — physics-driven, per storyboard sl. 6 |
| Weight stack placement | Mixed coordinate spaces, lands 2.18 m off | One documented transform strategy (`docs/17 §5`) |
| Hotspot system | 15 spheres with a clamped-radius heuristic; click ignores gating | `interaction/` affordances with per-part geometry and one gate |
| `CameraRig` | Nine per-step anchors, flies into geometry | `CameraDirector` with four named views (`docs/18`) |
| `SoftwareMonitor` | Correct concept, two datasets per series, fabricated rows | Rebuilt on `Reading[]`; adds Clear, LED, gravity/total displays |

### 🔁 REPLACE — rewrite against the new contracts

| Subsystem | Why replace rather than refactor |
|---|---|
| `DeviceModel.tsx` (1 197 ln) | No seams; 42 of 48 commits landed here; the `useFrame` alone is 272 lines doing eleven jobs. Becomes ~9 focused components. |
| State management | One 18-field `useState` prop-drilled 20 ways, with derived data stored inside it. Becomes 3 scoped stores + selectors (`docs/21`). |
| `index.css` (682 ln) | Two conflicting palettes, an undefined token, a class with no rule, no logical properties, no focus styles. Becomes tokens + CSS Modules. |
| `UIOverlay.tsx` (661 ln) | 49 inline style objects; lesson rules embedded in JSX; no progress model; content clipped at ordinary widths. |
| Highlight system | Emissive repaint destroys the part's appearance. Becomes an outline pass (`docs/17 §6`). |
| Water shader material | The shader craft is good but non-uniform scale defeats its own ripple and normals. Re-authored with real UVs at physical size. |
| Loading | No loading UI at all. Becomes a staged boot sequence (`docs/17 §7`). |
| `server.ts` static serving | No `Range`, `immutable` on unhashed filenames, hand-rolled. Replace with a CDN/static host — the eval PDF specifies **no backend**. |

### ❌ REMOVE

| Item | Status |
|---|---|
| `api/chat.ts`, `tts.ts`, `upload.ts`, `crawl.ts`, `register.ts`, `gcsStorage.ts` | ✅ **DONE** — commit `93b6dbb` |
| `api/save-config.ts` + `/config.json` fetch | Planned **BEDO‑003** — the eval PDF specifies no backend |
| `MenuSettings.tsx` in production | Planned **BEDO‑003** — dev-only |
| `framer-motion`, `@react-three/postprocessing` | Planned **BEDO‑004** |
| `Bedo_M.glb` (17 MB), `Bedo_model_optimized.glb`, `WaterShapes/*.abc` (20 MB), `icons.svg`, `src/assets/*` | Planned **BEDO‑004** — ~39 MB |
| `pointerOffset`, `DeflectorOption`, `StepDefinition`, `targetMassG`, `FRONT`, `MESH.powerButtonBody`, `MESH.liquid` | Planned **BEDO‑004** |
| `.header-area`, `.step-container`, `--glass-gradient` | Planned with the CSS replacement |
| `ContactShadows`, two decorative fill lights | Planned **BEDO‑014** |
| `push.sh` | Planned — `git add .` with a canned message is how the 110 MB `.git` happened |

---

## 5. Cross-cutting policies

| Concern | Policy |
|---|---|
| **Determinism** | The simulation is a pure reducer over intents. No `Math.random()`, no `Date.now()` in the runtime. Animation clocks are injected. This makes the E2E test reproducible and enables replay of a student session. |
| **Units** | Branded types at the domain boundary (`Newtons`, `Grams`, `Metres`, `LitresPerMinute`). `RecordRow.springhW` becomes `springDeflectionMm`. Mixing units becomes a compile error. |
| **Coordinate spaces** | Exactly three named spaces, documented in `docs/17 §5`: **GLB space** (authored), **apparatus-local** (the group), **world**. Every transform states its input and output space in its signature. Runtime code never invents a world-space offset. |
| **Error handling** | An error boundary at the root, `webglcontextlost` recovery, and a bilingual failure surface. No silent `catch {}`. |
| **Accessibility** | Every apparatus action has a DOM control. The canvas is an enhancement, never the only path. WCAG 2.1 AA. |
| **Performance** | The budget in `docs/20` is enforced in CI. New assets fail the build if over budget. |
| **i18n** | `lang` and `dir` bound to state; logical CSS properties only; no per-language components. |
| **Feature flags** | `import.meta.env.DEV` gates the debug panel, the perf HUD and the lesson linter, so they tree-shake out of production. |

---

## 6. Migration strategy — strangler, not big-bang

The rebuild proceeds **behind the running application**, one layer at a time, with the old code deleted only
once its replacement passes the pinned tests.

```
Step 1  Pin current behaviour with tests (BEDO-002)          old code untouched
Step 2  Extract domain/ + stateMachine (BEDO-005..007)       old code delegates to it
Step 3  Introduce simulation runtime  (BEDO-008)             App.tsx becomes a thin adapter
Step 4  Introduce lesson engine       (BEDO-021)             steps become data
Step 5  Replace scene layer part by part (BEDO-011..016)     DeviceModel shrinks each task
Step 6  Replace UI shell              (BEDO-024..027)
Step 7  Delete the husk
```

At no point is `main` left non-functional. Each task in `docs/23` is independently revertable.

---

## 7. Open decisions needing your input

| # | Decision | Options | My recommendation |
|---|---|---|---|
| D‑1 | **Redux or Zustand?** The evaluation PDF specifies *"React, Threejs (webGL), Redux"*. | Redux Toolkit / Zustand | **Zustand.** It is idiomatic for R3F, supports transient subscriptions that bypass React re-render for 60 fps values (essential for `PERF‑13`), and is already a transitive dependency. Redux Toolkit would work but adds ceremony and no benefit here. **This is your call — the doc says Redux.** |
| D‑2 | **Step count: 11 or 12?** The experiment sheets define 11 steps with **no volumetric-valve step**; the current build has 12. | Follow the sheets (11) / keep 12 | **Follow the sheets.** The volumetric valve stays clickable and state-neutral, per the state machine doc. Removing the invented step also removes two disorienting camera trips under the bench. |
| D‑3 | **Software monitor: DOM overlay or in-scene screen?** The storyboard treats it as a **camera view** of a 3D screen. | DOM overlay (current) / 3D screen | **DOM overlay.** Far more legible, accessible and exportable. Record as a deliberate deviation. |
| D‑4 | **Volumetric measurement** (`BUG‑29`) — the rig's litre scales measure nothing. | Implement / remove from framing | Confirm scope. The parameter doc defines `Q = ΔV/Δt`, so it is specified, but no step uses it. |
| D‑5 | **Balance target visibility** (`UX‑03`) — the app prints "target ≈ 80 g". | Remove / hint mode / instructor toggle | **Hint mode, off by default.** The measurement *is* the exercise. |
| D‑6 | **Assessment reporting** — is there an LMS / SCORM / xAPI requirement? | — | Needed before `docs/14` finalises the completion model. |

---

## 8. What this architecture fixes

| Audit finding | Fixed by |
|---|---|
| `ARCH‑01` god component | `scene/apparatus/*` — nine focused components |
| `ARCH‑02`/`PERF‑13` re-render storm | `docs/21` scoped stores + transient subscriptions |
| `ARCH‑03` monolithic state | Three stores with distinct lifetimes |
| `ARCH‑04` mutated GLB cache | `assets/loadApparatus.ts` + offline DCC fixes |
| `ARCH‑05` no budget | `docs/20`, enforced in CI |
| `ARCH‑06`/`CQ‑06` duplicated rules | `domain/stateMachine.ts` |
| `ARCH‑07`/`BUG‑04` cosmetic gating | One gate on the intent bus |
| `ARCH‑08` `setState` in `useFrame` | Intent queue; scene never sets React state mid-frame |
| `ARCH‑09` security | ✅ done, commit `93b6dbb` |
| `ARCH‑15`/`BUG‑33` no error boundary | `app/ErrorBoundary` + context-loss recovery |
| `BUG‑02` weights 2.18 m off | `docs/17 §5` coordinate strategy |
| `BUG‑03` jet 18× too wide | `docs/17 §5` physical-to-visual mapping |
| `BUG‑05` cross-experiment deflector | State machine validates against `deflectorsFor()` |
| `BUG‑06` Free mode records nothing | Readings decoupled from step number |
| `BUG‑14`/`BUG‑15` fabricated data | Append-only `Reading[]` |
| `BUG‑30` no audio | `feedback/` audio channel, per storyboard |
| `UX‑04` mouse-only steps | DOM control for every action |
| `UX‑11` no progress model | `ui/training/StepRail` |
