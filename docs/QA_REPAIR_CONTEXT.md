# QA_REPAIR_CONTEXT — resumable working context

Companion to `QA_REPAIR_LEDGER.md` and `QA_REPAIR_VALIDATION.md`. Enough to pick the work
back up cold.

## 1. What this programme is

Repairing the VL-FM009 *Measurement of Jet Forces* simulator against the QA review in
`Jet_Forces_Requirements_Ledger.md` + `Jet_Forces_Complete_Report.pdf` (72 pp). Scope is
F01–F19 with their 45 required corrections and 85 acceptance criteria, UI00–UI12 (69
detail items), G01–G05, C01–C08, A01–A20, EP01–EP10, the §7 image notes IMG01–IMG33 and
the §8 decisions DEC01–DEC07.

Both source files live on the user's Desktop, **outside this repository**:
`/Users/ramial-fuqahaa/Desktop/Jet_Forces_Requirements_Ledger.md` and
`/Users/ramial-fuqahaa/Desktop/Jet_Forces_Complete_Report.pdf`.

## 2. Repository

- Path: `/Users/ramial-fuqahaa/Desktop/BEDO_Project/BEDO_Project_R3F`
- Branch: `phase2/security-remediation` — **not** `main`. No publishing or merging to main during these phases.
- Baseline revision: `484be85` ("BEDO-WATER-15: remove submerged plume curtain from tank"), working tree clean at the start of P0.
- Stack: React 19 + TypeScript 6 + Vite 8, three.js 0.184 via @react-three/fiber 9 / drei 10. Tests: vitest 4 (unit + integration, jsdom), Playwright 1.62 (E2E).

```
src/
  domain/        physics, spring, apparatus, experiments, stateMachine, units   ← pure, no React
  simulation/    runtime, state, selectors                                       ← authoritative state
  lesson/        schema, runner, currentLesson                                   ← guided progression
  interaction/   gate, drag, transfer                                            ← what the learner may do
  lib/           scene, water, camera, materials, anchors, assets                ← presentation support
  components/    Scene3D, DeviceModel (3529 lines), UIOverlay (923), SoftwareMonitor (626), App (837)
docs/            50+ numbered design notes; docs/audit/ 01–09; docs/reference/ source media
tests/           unit/ (52 files), integration/, e2e/
scripts/         glb analysis, water builders, render capture, release
```

## 3. Commands

Node v24.15.0, npm 11.15.0 (the versions the baseline was taken on).

| Purpose | Command |
| --- | --- |
| Dev server | `npm run dev` (vite) |
| Type check | `npm run typecheck` (`tsc -b` + `tsc -p tsconfig.test.json`) |
| Lint | `npm run lint` (oxlint) |
| Unit + integration | `npm run test:unit` (vitest) |
| E2E | `npm run test:e2e` (Playwright; its own vite webServer, `--strictPort`) |
| Everything | `npm run test:ci` |
| Build | `npm run build` (runs `assets:manifest`, then `tsc -b && vite build`) |
| GLB inspection | `npm run glb:report` / `npm run glb:nodes` |
| Water caches | `npm run water:build` |
| Perf | `npm run perf:baseline` |

## 4. Ownership map — who owns what (EP06 draft)

| Concern | Owner | Notes |
| --- | --- | --- |
| **Authoritative simulation state** | `src/simulation/runtime.ts` + `state.ts` | Plain TS, no React. Commands only; rejections return state by identity. `freezeSimulationState` prevents behind-the-back mutation. |
| Apparatus legality (safety/mechanics) | `src/domain/stateMachine.ts` `attempt()` | Pure, total. Does **not** know about lesson steps. Reason codes → wording in `src/lib/apparatusGate.ts`. |
| Derived values | `src/simulation/selectors.ts` | Nothing derived is stored. |
| **Physics / equations** | `src/domain/physics.ts` | `flowRateLMin`, `jetState`, `computeRow`, `targetMassG`. Constants: `NOZZLE_AREA_M2 = 7.85e-5`, `GRAVITY_MS2 = 9.81`, `TRAVEL_HEIGHT_M = 0.035`, `TOTAL_FLOW_L_MIN = 120`, `SPRING_RATE_N_PER_M = 200`, `BALANCE_TOLERANCE_G = 10`, `ROW_VALVE_SETTINGS = [0, 0.4, 0.5, 0.6]`. |
| Spring model | `src/domain/spring.ts` | `X = h_F − h_w`, clamped to ≥ 0 and to a caller-supplied `maxTravelMm`. **Deliberately invents no geometric stop.** |
| Deflectors and coefficients | `src/domain/apparatus.ts` | 7 angles: 30 (0.25), 45 (0.5), 60 (0.75), 90 (1.0), 120 (1.5), 135 (1.707), 180 (2.0). |
| Weights | `src/domain/apparatus.ts` `WEIGHTS` | 10, 20, 50, 100, 200, 500 g. **25 g missing vs F04-AC01; 20 g has no mesh.** |
| Experiment families | `src/domain/experiments.ts` | flat [90], semi [120, 180], conical [135], oblique [30, 45, 60]. |
| Guided/Free mode | `src/lesson/runner.ts` (`LessonMode`), `src/interaction/gate.ts:195` | Free Mode bypasses the step gate with reason `FREE_MODE`. |
| Lesson steps | `src/lesson/currentLesson.ts` | 11 steps, `unscrew-cover` → `open-answer-sheet`. |
| Weight drag / transfer | `src/interaction/drag.ts`, `transfer.ts`, `src/components/useObjectDrag.ts`, `src/lib/holderAnchor.ts`, `transferPath.ts` | |
| Water / VFX | `src/lib/waterJet.ts`, `waterCache.ts`, `waterUv.ts`, `tankWater.ts`, `public/WaterShapes/` | Caches authored in rig space, scale 0.01, no fitting. |
| Camera | `src/components/Scene3D.tsx:719` OrbitControls, `src/lib/cameraFraming.ts`, `apparatusView.ts` | |
| Materials | `src/lib/materialFamilies.ts`, `roomEnvironment.ts` | |
| Readouts | `src/components/boardReadout.ts`, `SoftwareMonitor.tsx` | |
| UI shell | `src/components/UIOverlay.tsx`, `ExperimentIntro.tsx`, `StepInstructionCard.tsx` | Left-sidebar overlay. **Not** the interim BEDO bottom-nav shell. |

## 5. Available vs claimed sources (do not overstate these)

**Present in the repository:**

- `public/Bedo_baked_v2.glb` (11.9 MB, gltfpack 1.2) — the shipped model, treated as the optimized baseline.
- `assets-source/models/Bedo_model_optimized.glb`, `Bedo_M.glb`.
- `assets-source/WaterShapes/*.abc` and `public/WaterShapes/` — Alembic caches for 30, 45, 60, 90, 120, 135, 180.
- `docs/reference/Storyboard.pptx`, `Bedo_Mesu_J.mp4` (also at `public/Bedo_Mesu_J.mp4`), `reference-render.png`, `reference-simulator-force.jpg`, `reference-simulator-steps.jpg`, `Bedo Hydraulic Machines Vocational Training.pdf`.
- `measurements/` — prior measurement JSON from earlier BEDO tasks.

**Absent, and therefore not inspectable:**

- `Logic(final) 2.xlsx` — the workbook the QA report audits. **Not here.** Y38 `#REF!`, Y24→T15 and Y37→T29 cannot be seen. (BLK-01 → F19-AC01, F19-AC02, A04.)
- `Jet force_Mathematical model.xlsx` — the workbook `src/domain/physics.ts` documents itself against. Also not here; the code's transcription is second-hand.
- `Jetforce-1.fbx` / `Jetforce-2.fbx` — neither is here. (BLK-02 → G01–G05.)
- `Jet force_State machine.docx`, `Jetforce_Storyboard.pptx` as named in code comments — only `docs/reference/Storyboard.pptx` is present; whether it is the same file is unconfirmed.
- `BEDO Interim UI Visual Compatibility Guide v0.1` — referenced as authoritative by the report; the guide itself is not in the repo. Only the PDF's reference images (E36–E42) are available.

**No claim is made in any of these documents about having read a spreadsheet or an FBX.**
The PDF's images were read as images; that is all.

## 6. Current phase

**P0 — inventory and baseline. Complete.** No application code was modified. The three
tracking documents are the only files added.

Next is **P1 (C01): F18 + F19** — the volumetric measurement path and the calculation
source. P1 cannot fully close without DEC01 and DEC02; the independent parts (auditing
`flowRateLMin` consumers, gating Q behind a measurement state, building the flowmeter
response path's structure) can proceed once the procedure is defined.

## 7. Decisions taken in this phase

1. Documents live in `docs/`, the project's existing documentation path, at the names the brief specified.
2. Every row starts `open`. Nothing was marked `verified`, because no evidence of the kind the criteria demand has been produced yet. Three rows are `implemented_unverified` where code plainly exists and is unit-tested (UI12-03, EP01, EP03, EP09).
3. The two IMG31 notes are kept apart by section number (7.1 camera gallery, 7.2 Q series). Neither is dropped.
4. `public/Bedo_baked_v2.glb` is treated as read-only unless a finding requires a deliberate re-bake, which must then be recorded.
5. Conflicts between the code's documented equations and the report's screenshots are recorded as conflicts in the ledger (§1 F19), not silently resolved in either direction.

## 8. Obstacles

- BLK-01 through BLK-05 in the ledger. BLK-01 (missing workbook) and BLK-04 (undefined volumetric procedure) together gate most of P1, which is the first phase in the required closure order.
- One E2E test is flaky under full-suite load — see `QA_REPAIR_VALIDATION.md` §3. It must not be mistaken for a regression introduced by later phases.
- `src/components/DeviceModel.tsx` is 3529 lines and `UIOverlay.tsx` 923 with inline styles throughout; UI12-01/02 (theme + component library) will touch both broadly. Sequence that work after the physics phases so it does not churn beneath them.
