# 21 — State Architecture

**Principle from the brief: do NOT create a giant global store.** Five state categories, each with a distinct
lifetime, update frequency and owner.

---

## 1. What is wrong today

One `useState<SimulationState>` in `App.tsx` holds 18 fields spanning four unrelated concerns, threaded down as
~20 individual props to four unmemoised components.

Consequences measured in the audit:

- Opening a toast, dragging a settings slider, switching a sidebar tab or answering the quiz **re-renders the
  1 197-line `DeviceModel`** (`ARCH‑02`, `PERF‑13`).
- `recordedRows` is *derived* data stored *inside* the state it derives from, written by a `useEffect` →
  `setState` round trip, costing an extra render per interaction — and its dependency list has already drifted
  (`state.valveOpening` is missing), which is half of `BUG‑06` (`CQ‑11`).
- `pointerOffset` is declared, initialised to `0.0`, and never read or written again — dead state (`CQ‑04`).
- `handleSelectExperiment` resets the entire object, silently discarding the student's mode choice.
- 60 Hz simulation values (spring deflection, cover lift, pointer swing) live in refs *outside* React, invisible
  to it, mutated from a 272-line `useFrame` that also calls a React setter mid-frame (`ARCH‑08`).

---

## 2. The five categories

| # | Category | Lifetime | Frequency | Home | Persistence |
|---|---|---|---|---|---|
| 1 | **Persistent application** | Across sessions | Rare | Zustand + `persist` | `localStorage` |
| 2 | **Lesson** | Per lesson attempt | Per step (~12×) | Zustand (`lessonStore`) | `sessionStorage` (resume) |
| 3 | **Simulation — discrete** | Per experiment run | Per user intent | Zustand (`apparatusStore`) over the runtime | `sessionStorage` |
| 4 | **Simulation — continuous** | Per frame | **60 Hz** | **Refs inside the runtime. NOT in React.** | never |
| 5 | **Transient interaction** | Milliseconds | Per pointer move | Zustand transient / refs | never |
| 6 | **Scene / view** | Per view change | Occasional | `cameraStore` + refs | preference only |

### 1 — Persistent application

```ts
interface AppState {
  language: 'en' | 'ar';
  reducedMotion: 'auto' | 'on' | 'off';
  cameraFollowsLesson: boolean;
  audioEnabled: boolean; audioVolume: number;
  hintsEnabled: boolean;                       // docs/12 D-5
  completedExperiments: Record<ExperimentId, CompletionRecord>;
}
```
**Zustand + `persist`.** Language must also drive `<html lang>`/`dir` (`BUG‑09`). Completion records survive a
refresh, which the app currently cannot do at all (`UX‑26`).

### 2 — Lesson

```ts
interface LessonState {
  lessonId: LessonId; mode: 'guided' | 'free';
  currentStepId: StepId; completedSteps: StepId[];
  acknowledged: boolean; hintShown: boolean;
  quizAnswers: Record<QuestionId, number>;
}
```
**Zustand**, `sessionStorage`-backed so a refresh resumes. Owned by `LessonRunner`; components read, never write
directly. This is the category that must **not** be conflated with simulation state — the reference proves they
are two machines (`docs/13 §5`), and conflating them is the root cause of `BUG‑06`.

### 3 — Simulation, discrete

`ApparatusState` from `docs/15 §1`, plus `readings: Reading[]`.
**Zustand binding over the framework-free runtime.** The store is a thin adapter so the runtime stays headless
and testable. Mutation only through `dispatch(intent)`.

### 4 — Simulation, continuous ★

`ApparatusKinetics` — cover lift, screw back-out, pointer swing, spring deflection, tank level, in-flight
transfers, elapsed time.

**These never enter React.** They live in refs owned by `SimulationRuntime`, advanced by `runtime.tick(dt)` from
a single `useFrame`, and read by scene components inside their own `useFrame`.

```tsx
function SpringPointer() {
  const refs = useApparatusRefs();
  const runtime = useSimulationRuntime();
  useFrame((_, dt) => {
    runtime.tick(dt);                       // once per frame, from the root
    const k = runtime.getKinetics();        // ref read — no subscription, no render
    refs.pointerPivot.position.y = refs.pointerPivot.userData.restY + k.springDeflection;
  });
  return null;
}
```

**This is the mechanism that fixes `PERF‑13`.** A value changing 60 times a second must never be a React state
update. Where a continuous value must reach the DOM (e.g. a live force readout), it is throttled to ~10 Hz
through a dedicated selector, or written directly to a ref'd DOM node.

### 5 — Transient interaction

```ts
interface InteractionState {
  hovered: EquipmentRef | null;
  focused: EquipmentRef | null;
  dragging: { source: EquipmentRef; ghost: Vector3 } | null;
  manipulating: EquipmentRef | null;
}
```
Zustand, consumed via **transient subscription** (`subscribe` with `getState`, no re-render) by the outline
effect and the cursor controller. Only the DOM controls that genuinely need to re-render subscribe reactively.

### 6 — Scene / view

`cameraStore`: `{ currentView, directorState }`. The camera's actual position/quaternion stay on the Three.js
object — never mirrored into React.

---

## 3. Placement decision table

| State | Where | Why |
|---|---|---|
| `language` | Zustand + persist | Cross-cutting, rare, must survive refresh |
| `reducedMotion`, `audioEnabled`, `hintsEnabled` | Zustand + persist | User preferences |
| `completedExperiments` | Zustand + persist | Progress across sessions |
| `mode`, `currentStepId` | Zustand (`lessonStore`) | Read by UI, scene and gating |
| `readings[]` | Zustand (`apparatusStore`) | Read by monitor + chart + export |
| `power`, `coverOpen`, `valveOpening`, `loadedWeights`, `installedDeflectorId` | Zustand (`apparatusStore`) | Discrete, intent-driven |
| `recordedRows` / chart series / balance | **Derived selector** — never stored | Fixes `CQ‑11`, `BUG‑14`, `BUG‑15` |
| `jetState`, `springDeflection` (values) | **Derived selector** from `domain/physics` | Single source of truth |
| `coverLift`, `pointerSwing`, `tankLevel`, transfers | **Refs in the runtime** | 60 Hz — must not render React |
| `hovered`, `dragging` | Zustand transient | High frequency, presentation-only |
| Camera position | Three.js object | Never mirror engine state into React |
| `showMonitor`, `activePanel`, `showVideo`, `showSettings` | **Local `useState`** in the owning component | Pure UI, no other consumer |
| `warningMessage`, `notice` | **FeedbackBus**, not state | Events, not state — fixes `BUG‑13` layering |
| Lesson resume | `sessionStorage` | Survives refresh within a session |
| Deep link to a step/experiment | **URL** (`?exp=flat&step=7`) | Shareable; instructor can link a student to a step |

---

## 4. Preventing unnecessary renders

1. **Selector subscriptions only** — `useApparatus(s => s.valveOpening)`, never `useApparatus()`.
2. **Transient subscriptions** for 60 Hz consumers — `useStore.subscribe(sel, cb)` with no component subscription.
3. **Category separation** — UI-only state never crosses into the canvas subtree.
4. **`React.memo` on scene components** as a backstop, with stable `useCallback` handlers.
5. **Derive, never store** — no `useEffect` → `setState` for computable values.
6. **Debounce/commit settings sliders** — currently every `input` event fires a full re-render.
7. **One `useFrame` at the root calls `tick`**; subsystem frames only read.

**Acceptance:** with the perf HUD open, dragging a slider or opening a toast produces **zero** re-renders of
any `scene/` component. Verified by `renderCount.spec.tsx` (`docs/22 §5`).

---

## 5. Data flow

```
   user gesture / DOM control
            │
            ▼  Intent
      IntentBus ──► LessonRunner.isAllowed ──► FeedbackBus (if denied)
            │
            ▼
   SimulationRuntime.dispatch ──► domain/stateMachine.attempt
            │                              │
            │                              └──► DomainEvent[] ──► FeedbackBus ──► outline/toast/audio
            ▼
      apparatusStore (discrete)  ──selector──► UI re-renders
            │
            └── kinetics refs (60 Hz) ──useFrame──► scene mutates Object3D
```

**One direction. One mutation path. One gate.**

---

## 6. ⚠️ Decision required: Redux or Zustand

The evaluation PDF specifies *"React, Threejs (webGL), **Redux** (no backend)"*.

| | Redux Toolkit | **Zustand** |
|---|---|---|
| Named in the evaluation doc | ✅ | ❌ |
| Selector subscriptions | ✅ | ✅ |
| **Transient (render-free) subscriptions** | ✗ requires `store.subscribe` + manual plumbing | ✅ **first-class** — the `PERF‑13` fix |
| Idiomatic with R3F | rarely used | the community default |
| Already in the dep tree | no | **yes** (transitive via R3F) |
| Boilerplate | slices, actions, thunks | a function |
| DevTools / time-travel | excellent | good (devtools middleware) |
| Multiple scoped stores | possible, unusual | natural |

**Recommendation: Zustand**, for the transient-subscription capability, which is the specific mechanism that
keeps 60 Hz simulation values out of the React render path — the largest structural performance problem in the
current build. Redux Toolkit would work, but adds ceremony without benefit here.

**This is your call**, since the evaluation document names Redux. If Redux is contractual, the architecture is
unchanged — only §2's "home" column changes, and the 60 Hz category stays in refs either way.
