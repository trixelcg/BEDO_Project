# 34 — Lesson Schema & Runner (BEDO‑018)

A step is a name now, not a number. The three files that each decided progression for
themselves ask one evaluator instead.

```
CURRENT_LESSON (data)
      ↓
LessonRunner            where the learner is; pure, no React
      ↓
isSatisfied / canConfirm   ← the single completion authority
      ↓
commands the finished step asks for
      ↓
SimulationRuntime
```

**Zero behaviour change.** The learner still sees "Step 7 / 12", the same OK button at the
same moment, the same arrow. 556 tests green, scene fingerprint identical.

---

## 1. What it replaced

Progression lived in three places, and they were not the same:

| File | What it decided | How |
|---|---|---|
| `App.tsx` | what happens next | a `switch (currentStep)` with eight cases |
| `UIOverlay.tsx` | whether OK shows | `okVisible` — its own expression over five step numbers |
| `DeviceModel.tsx` | whether the arrow shows | `done` — a *different* expression over eight step numbers |

The two "is this step finished" predicates genuinely disagreed — on steps 1, 3, 4, 11 and
12 — and that disagreement was load-bearing, not a bug: steps 1/3/4 complete by acting
(no OK button, arrow should go), step 2 completes by confirming (OK appears, arrow stays).
Nothing recorded that; you had to read both files and compare.

Plus `READING_FOR_STEP = { 7: 1, 9: 2 }`, the last rule that let a lesson number decide
what the results table showed.

## 2. Files

```
src/lesson/
├── schema.ts          StepId, LessonStepDefinition, LessonExpectation, LessonContext
├── currentLesson.ts   the twelve steps, as data
└── runner.ts          createLessonRunner
src/lib/useLesson.ts   React adapter (outside the lesson core)
```

Step *identity* lives in `src/domain/experiments.ts` beside the bilingual copy, so a step's
name and its words cannot drift apart, and the dependency runs one way.

## 3. The twelve steps

| # | `StepId` | Instruction | Expects | Complete when | Ends by |
|---|---|---|---|---|---|
| 1 | `unscrew-cover` | Press the upper plate to unscrew it | `OPEN_COVER` | cover open | action |
| 2 | `install-deflector` | Drag the deflector onto the rod | `SELECT_DEFLECTOR` | — *(nothing observable)* | confirm, when cover open |
| 3 | `mount-cover` | Press the plate again | `CLOSE_COVER` | cover shut | action |
| 4 | `power-on` | Turn on the power switch | `POWER_ON` | pump running | action |
| 5 | `open-volumetric-valve` | Slightly open the volumetric valve | `OPEN_VOLUMETRIC_VALVE` | valve open | confirm |
| 6 | `set-flow-reading-1` | Open the flow valve | `SET_VALVE` | valve ≥ 0.38 | confirm |
| 7 | `balance-reading-1` | Add weights to balance | `ADD_WEIGHT` | row 1 balanced | confirm |
| 8 | `increase-flow-reading-2` | Increase the opening | `SET_VALVE` | valve ≥ 0.48 | confirm |
| 9 | `balance-reading-2` | Add weights to balance | `ADD_WEIGHT` | row 2 balanced | confirm |
| 10 | `open-monitor` | Switch to the software monitor | `OPEN_MONITOR` | always | confirm **or** opening it |
| 11 | `record-actual-force` | Click Calculate | `RECORD_ACTUAL_FORCE` | F_ac recorded | action |
| 12 | `finish` | You finished! | `ANSWER_QUESTION` | always | terminal |

Also carried per step: `target` (arrow/highlight anchor), `cameraView` (step 1 frames the
whole bench while pointing at the plate), `highlight` (which parts are live),
`panelControls` (which panel sections show), and `onComplete` (simulation commands).

**`displayNumber` is metadata on the definition.** Nothing resolves a step by it.

## 4. Runner API

```ts
const runner = createLessonRunner(CURRENT_LESSON);

runner.getState()               // { mode, currentStepId, isComplete }
runner.getCurrentStep()         // the definition
runner.setMode('guided' | 'free')

runner.isSatisfied(context)     // the arrow
runner.canConfirm(context)      // the OK button
runner.confirm(context)         // OK pressed        → AdvanceResult
runner.notify(expectation, ctx) // an action happened → AdvanceResult
runner.hasReached(stepId)       // semantic ordering, not a number
runner.reset()
runner.subscribe(listener)
```

```ts
type AdvanceResult = {
  advanced: boolean;
  commands: readonly SimulationCommand[];  // what the caller should dispatch
  completedStepId: StepId | null;          // whose observation popup to raise
};
```

**The runner never writes to the simulation.** It returns the commands and the caller
dispatches them, so the rig has exactly one mutator.

## 5. The completion evaluator

`isSatisfied(context)` on each step, where `context` is `{ simulation, readings }`. Pure,
deterministic, no React, no three.js. Every condition reads state — none depends on a
click having happened.

Two notions, because the old code needed two and pretending otherwise would change
behaviour:

- **`isSatisfied`** — the goal is reached. Drives the guide arrow.
- **`advance.when`** — the OK button may appear. For steps 5–10 this is the same
  condition; for step 2 it is `cover is open`, because installing a deflector leaves
  nothing observable behind and the step has no completion condition of its own.

`install-deflector` is the one step whose `isSatisfied` is permanently false. That is
exactly what shipped, and it is now written down rather than implied by an omission.

## 6. Expected actions

`LessonExpectation` reuses the simulation's vocabulary — `OPEN_COVER`, `POWER_ON`,
`ADD_WEIGHT` — so an expectation and the command that satisfies it are the same word.
Two have no apparatus equivalent: `OPEN_MONITOR` (a screen) and `ANSWER_QUESTION`.

Nothing is tied to a button id or a mesh name.

## 7. Migration, file by file

### `App.tsx`

| Before | After |
|---|---|
| `switch (currentStep)` — 8 cases setting the next number, valve, reading index and weights | `runner.confirm(context)` → `applyAdvance` dispatches the step's own `onComplete` |
| `READING_FOR_STEP = { 7: 1, 9: 2 }` | `BEGIN_READING { index }` is data on the step that starts the reading |
| `advance(prev, from, to)` at four call sites | `runner.notify(expectation, context)` |
| `snapToReadingSetpoint(opening, step)` with `step === 6` / `=== 8` | reads the setpoint off the current step's own `SET_VALVE` command |
| `currentStep === 8 ? SECOND : FIRST` | the current step's setpoint, defaulting to the first |
| `noticeFor(mode, step)` | the completed step's `noticeEn`/`noticeAr`, looked up by id |
| `currentStep` in React state | the runner owns it; React observes via `useSyncExternalStore` |

### `UIOverlay.tsx`

| Before | After |
|---|---|
| `okVisible` — five step-number comparisons | `lesson.canConfirm` |
| `valveReady` — its own copy of the snap-margin rule | gone; it was half of `canConfirm` |
| `balanceRow = currentStep === 7 ? 1 : currentStep === 9 ? 2 : null` | `lesson.activeReadingIndex` — simulation state since BEDO‑008 |
| `show(6, 8)`, `show(7, 9)`, `show(10, 11, 12)`… | `show('flowValve')`, `show('weights')`, `show('monitor')` |
| `Step ${currentStep} / ${TOTAL_STEPS}` | `lesson.displayNumber` / `lesson.totalSteps` — display only |

### `DeviceModel.tsx`

| Before | After |
|---|---|
| `done` — eight step-number comparisons deciding the arrow | `lesson.isSatisfied` |
| `liveKeys` — a chain of `s === 1 \|\| s === 3`… | `lesson.highlight`, mapped to meshes |
| `state.currentStep >= 2` for the mounted deflector | `lesson.hasInstalledDeflector` |
| imports of `FIRST_READING_VALVE`, `SECOND_READING_VALVE`, `VALVE_SNAP_MARGIN` | none — it no longer reasons about the valve |

**The component was not restructured.** Three expressions were replaced by three props.

### `Scene3D.tsx`

`focusTarget` and the `currentStep === 1 ? 'overview'` camera override both come from the
lesson view now (`target`, `cameraView`).

## 8. Numbers left in production, and why

| Where | What | Why it stays |
|---|---|---|
| `currentLesson.ts` | `displayNumber: 1…12` | Display metadata. `BEDO-019` edits these. |
| `domain/experiments.ts` | `id: 1…12` on the copy | The number printed in the step card. |
| `UIOverlay` | `lesson.displayNumber`, `lesson.totalSteps` | Rendering "Step 7 / 12". |
| `selectReadings`, `BEGIN_READING` | row indexes 0–3 | Table rows, not lesson steps. The four rows are a property of the results table. |

`tests/unit/domain-boundary.spec.ts` fails the build if any production file compares a
step against a number, switches on one, or declares a `Record<number, number>`.

## 9. BUG‑04, precisely

`BUG-04` is *3D clicks are not consistently step-gated*. It has two halves.

- **Knowledge duplication — fixed.** There is now one expected-action and completion
  authority. A 3D click and a panel click reach the same runner, and the arrow and the OK
  button can no longer disagree.
- **Gating — unchanged, deliberately.** `DeviceModel`'s hotspots still dispatch at any
  step; the apparatus guards refuse unsafe ones, and the lesson does not refuse
  unexpected ones. Enforcing `expectation` at the hotspot would reject actions the app
  currently permits — a **behaviour change**, and BEDO‑018 makes none.

Everything needed is in place: `runner.getCurrentStep().expectation` is the question an
interaction gate would ask. Turning it on belongs to `BEDO-020`, with its own before/after.

## 10. The path to BEDO‑019

The canonical structure in `docs/32` — eleven steps, the volumetric valve demoted to an
affordance, assessment separated from the closing step — is now a **data edit**:

1. Delete the `open-volumetric-valve` entry from `CURRENT_LESSON` and its copy from
   `buildSteps`. The valve keeps its apparatus command and its affordance; it loses its
   number.
2. Renumber `displayNumber` 1…11. No code follows.
3. Split `finish` into `open-answer-sheet` and a separate assessment structure.
4. Update the content in `domain/experiments.ts`, keyed by the same ids.
5. Update the BEDO‑002 expectations that pin twelve — deliberately, as a content change.

No file outside those two knows how many steps there are, or which one is which.

## 11. Verification

| | |
|---|---|
| Lesson schema / runner tests | **21 + 17**, including a full twelve-step parity walk |
| Boundary and no-index audits | **50** (was 30) |
| `lesson-flow.spec.tsx` | 15 tests, **unchanged** — the parity contract |
| Safety guards / CSV / runtime | 17 / 15 / 40, unchanged |
| Physics / spring / state machine / GLB | 57 / 34 / 61 / 51, unchanged |
| Scene fingerprint | **identical** |
| Draw calls / tris / binds / programs | 769 / 217 055 / 22 / 42 — unchanged |
| Playwright | 11 passed, including the twelve-step browser walk |

## 12. Debt noted, not fixed

- **Lesson gating (`BUG-04`, second half)** — `BEDO-020`.
- **The `SimulationView` projection** still re-renders every component on any change
  (`PERF-13`). `LessonView` is memoised the same way and adds no render frequency: lesson
  state changes at the rate a person presses buttons.
- **`install-deflector` has no completion condition** because nothing marks a deflector as
  installed. `docs/15` proposes `installedDeflectorId: null` initially, which would give it
  one — a simulation change, not a lesson one.
- Everything in §31 of the task — the 11-step migration, the video modal, popup z-index,
  RTL, row 4, deflector scoping, drain on power-off, single-weight removal — untouched.
