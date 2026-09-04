# ARCHITECTURE NOTES — VL-FM009 remediation brief

Discovery map for the phased brief (bugs / physics / water / UI / monitor / report / QA).
File → responsibility, for every file the later phases touch.

## Stack

Vite 8 + React 19 + TypeScript 6, `@react-three/fiber` 9 / `@react-three/drei` 10, three 0.184.
**No Zustand, no i18n library, no chart library, no PDF library, no postprocessing package.**
State is a hand-written external store (`simulation/runtime.ts`) read through
`useSyncExternalStore`; i18n is paired `…En` / `…Ar` fields on domain data plus inline
`isAr ? 'ar' : 'en'` ternaries in components. Tests: vitest (unit + integration, jsdom) and
Playwright (`tests/e2e`). Lint is `oxlint`.

## Domain — pure, no React/three/DOM (`tests/unit/domain-boundary.spec.ts` enforces it)

| File | Responsibility |
|---|---|
| `src/domain/units.ts` | Unit vocabulary and conversions. Suffix names the stored unit. |
| `src/domain/physics.ts` | **All equations.** `flowRateLMin`, `jetState`, `computeRow`, `targetMassG`, every constant, `BALANCE_TOLERANCE_G`, `ROW_VALVE_SETTINGS`. Phase 1.9 and all of Phase 2 land here. |
| `src/domain/apparatus.ts` | Mesh names, `DEFLECTORS` (with `momentumFactor` k), `WEIGHTS`, `WATER_SHAPES`, `AnchorKey`. Phase 2.3 lands here. |
| `src/domain/spring.ts` | `X = h_F − h_w`, clamped. Drives the pointer (Phase 3.7). |
| `src/domain/stateMachine.ts` | `attempt(state, action)` — the five safety guards. Sole authority on apparatus legality. |
| `src/domain/experiments.ts` | The four sheets, 11-step copy (`buildSteps`), `quiz` (1 question each — Phase 5 wants ≥5), `ANSWER_SHEETS` → static PDFs (Phase 6). |

## Simulation

| File | Responsibility |
|---|---|
| `src/simulation/state.ts` | `SimulationState`: apparatus, experimentId, pumpFlowLMin, `activeReadingIndex`, `committedReadingCount`, `committedWeightsG`, `isActualForceRecorded`. |
| `src/simulation/runtime.ts` | Command dispatch + subscribers. `BEGIN_READING` / `END_READING` / `RECORD_ACTUAL_FORCE` live here — Phase 1.1's record event belongs here. |
| `src/simulation/selectors.ts` | Derived views: `selectReadings` (**the 4 fixed rows** — Phase 1.2), `selectLiveReadout`, `selectReadingsTaken` (**Phase 1.1 bug**), `selectLoadedMassG` (the single Total-Weight selector Phase 1.3 asks for). |
| `src/lib/useSimulation.ts` | `useSyncExternalStore` adapter. |

## Lesson

| File | Responsibility |
|---|---|
| `src/lesson/schema.ts` | `LessonStepDefinition`: `target`, `cameraView`, `highlight`, `panelControls`, `expectation`, `isSatisfied`, `advance`, `onComplete`. |
| `src/lesson/currentLesson.ts` | The 11 steps as data. `onComplete: [END_READING, REMOVE_ALL_WEIGHTS]` on both balance steps is **Phase 1.8's cause**. |
| `src/lesson/runner.ts` | Where the learner is; returns commands, never mutates. |
| `src/lib/useLesson.ts` | React adapter. |
| `src/interaction/gate.ts` | `evaluateInteraction` — apparatus legality then lesson legality. Every click goes through it. |

## Presentation

| File | Responsibility |
|---|---|
| `src/App.tsx` (837) | Composition root. Owns `LessonAndUiState` (language, monitor, boardView, answer sheet, quiz, customWeight, notices) and every handler. `interact()` is the one path to the simulation. |
| `src/components/UIOverlay.tsx` (923) | Sidebar (free mode), guided dock + footer, `apparatusControls` (deflectors / power / volumetric valve / flow slider / **weights panel** / monitor), video modal. Phase 1.6, 4.1, 4.3, 4.9 land here. `readingsTaken` is duplicated at L152 (Phase 1.1). |
| `src/components/StepInstructionCard.tsx` | Step badge, instruction, OK. Phase 4.1's Back/Hint/progress land here. |
| `src/components/SoftwareMonitor.tsx` (626) | Live tiles, readings table, hand-rolled SVG chart, Calculate, quiz, CSV/screenshot export. All of Phase 5. |
| `src/components/DeflectorBoard.tsx` | The seven deflectors + family diagrams inside the monitor. |
| `src/components/boardReadout.ts` | Canvas texture drawn into the baked in-world board's empty boxes (`V₀`/`V` labels — Phase 1.7). |
| `src/components/Scene3D.tsx` (731) | Canvas, lights, `OrbitControls`, the guided camera flight (`ANCHOR_VIEW` offsets). Phase 4.5. |
| `src/components/DeviceModel.tsx` (3529) | The whole rig: materials, hotspots, drag, weight/deflector transfer, hose shader, jet + spray Alembic caches, tank water, spring/pointer. All of Phase 3. |
| `src/components/useObjectDrag.ts`, `src/interaction/drag.ts`, `transfer.ts`, `src/lib/transferPath.ts` | Drag maths and the 2 s transfer flight (Phase 4.5's orbit-during-drag). |
| `src/components/AnswerSheet.tsx` | iframe over the static PDF + "Open in new tab" (Phase 6). |
| `src/components/LoadingScreen.tsx`, `ExperimentIntro.tsx` | Boot overlay (Phase 7 `Resume`). |

## Scene support (`src/lib/`)

`apparatusView.ts` anchors + `MODEL_UNITS_PER_METRE`; `cameraFraming.ts` bounds-derived fit;
`waterJet.ts` jet sizing from `NOZZLE_AREA_M2`; `waterCache.ts` + `waterUv.ts` Alembic morph
playback and cylindrical UVs; `tankWater.ts` procedural tank body + `DRAIN_CAPACITY_FRACTION`;
`materialFamilies.ts` (805) material classification; `gltfNames.ts`, `holderAnchor.ts`,
`powerSwitch.ts`, `sceneConfig.ts`, `roomEnvironment.ts`, `ktx2.ts`, `assetUrl.ts`,
`readiness.ts`, `languagePreference.ts` (the only `localStorage` use), `exportSchema.ts`
(published CSV contract — pinned by `tests/integration/export-contract.spec.tsx`).

## Baseline

`tsc -b` clean; `vitest run` 52 files / 1179 tests green at `484be85`.

## Decisions taken before Phase 1 (conflicts between the brief and BEDO's pinned data)

1. **`F_th`** — `computeTheoreticalForce` ships both models behind `PHYSICS_MODEL`, defaulting
   to `'legacyAV2'` (`k·ρ·A·V²`), because `tests/fixtures/bedo-reference.ts` transcribes that
   column from BEDO's spreadsheet. `'momentumFlux'` (`k·ρ·Q·V`) is implemented and tested;
   BEDO flips one constant.
2. **k factors** — BEDO's per-family laws stand (sin²θ oblique, 1 − cos θ semi/conical, 1 flat),
   but computed per family rather than written as literals.
3. **Valve curve** — `Q = Q_max·n^exp` with `Q_max = 40`, `exp = 1.5` as config constants; the two
   reading setpoints are re-derived so the recorded readings still land on 15.714 and
   27.024 L/min.
4. **Balance tolerance** — `max(2 % of the exact balancing mass, 5 g)`. A strict 2 % is
   unreachable at reading 1 with 10 g weights.

## Phase 2 — where the physics choices now live

`src/domain/physicsConfig.ts` holds the four switchable decisions with their evidence:
`PHYSICS_MODEL` (default `legacyAV2`), `FLOW_CHARACTERISTIC` (default `powerLaw`),
`VALVE_EXPONENT` (1.5) and `PUMP_MAX_FLOW_L_MIN` (40). `physics.computeTheoreticalForce`
implements both force laws and is the one path every printed force takes;
`apparatus.momentumFactorFor` is the one angle→k step, per family.

Two consequences worth naming:

- **The reading setpoints are derived, not written.** `READING_FLOWS_L_MIN` fixes the two
  flows (15.714 and 27.024 L/min) and `valveOpeningFor` turns each into an opening — 0.536
  and 0.770 on the shipped curve. Re-rating the pump moves the openings and leaves every
  recorded figure alone.
- **`DRAIN_CAPACITY_FRACTION` became `DRAIN_CAPACITY_L_MIN`.** The tank-fill and
  jet-shape threshold was a share of pump delivery calibrated at Q_total = 120. Re-rating to
  40 turned the first reading from 0.131 of delivery into 0.393, which would have filled the
  tank at the reading the reference recording shows it empty at. What the recording bracketed
  is a flow: 21.36 L/min.

## What each phase added, and where it lives

| Phase | New modules |
|---|---|
| 1 | `balanceDeviation` in `domain/physics.ts`; `RecordedReading` in `simulation/state.ts`; `RECORD_READING` in `simulation/runtime.ts`; `selectLiveRow` / `selectCanRecordReading` in `simulation/selectors.ts` |
| 2 | `domain/physicsConfig.ts` (the four switchable choices); `computeTheoreticalForce` and `valveOpeningFor` in `domain/physics.ts`; `momentumFactorFor` in `domain/apparatus.ts` |
| 3 | `domain/volumetric.ts`, `lib/sightGauge.ts`, `lib/waterSpray.ts`, `lib/waterCircuit.ts` |
| 4 | `lib/guidance.ts`, `components/Modal.tsx`, `clampToRoom` in `lib/cameraFraming.ts`, `__APP_VERSION__` in `vite.config.ts` |
| 5–6 | `lib/forceChart.ts` (shared by the monitor and the report), `lib/report.ts` |
| 7 | `lib/sessionStore.ts`; `restore` on the runtime, `goTo` on the lesson runner |

## Things a future change should know

- **`GLB` names are a contract.** Every mesh name in `MESH` is checked against the shipped
  asset by `tests/unit/glb-contract.spec.ts`, which also pins the count. Adding one means
  updating that number.
- **`renderFreshApp`, not `renderApp`.** Sessions persist from the moment Start is pressed
  and `cleanup()` does not touch storage, so an integration spec that renders twice will
  resume its own earlier run unless it asks for a fresh visitor.
- **The bundle ceiling in `tests/unit/bundle.spec.ts` is deliberate.** It moves for
  application code and is meant to stop a library slipping into the initial chunk.
- **Two flow quantities, easily confused.** `valveOpening` is where the lever is;
  `flowRateLMin` is what the pump delivers. Under `Q = Q_max·n^1.5` a half-open valve
  delivers 35 %, and every water effect is a picture of the *flow*.
