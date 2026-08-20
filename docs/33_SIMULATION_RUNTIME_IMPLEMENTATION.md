# 33 — Simulation Runtime (BEDO‑008)

Simulation state has an owner, and it is not React.

```
src/domain/          pure physics, apparatus, state machine, spring
      ↑
src/simulation/      ← owns simulation state, calls the state machine, exposes selectors
      ↑
src/lib/useSimulation.ts   useSyncExternalStore — the only file that knows about both
      ↑
App.tsx              lesson + presentation state, and a projection for the components
```

**Zero behaviour change.** Twelve-step lesson unchanged, scene fingerprint identical,
CSV character-identical, 498 tests green.

---

## 1. Why

`App.tsx` held eighteen fields in one `useState` and answered three unrelated questions
with them: what the rig is doing, where the student is, what the screen shows. Everything
downstream of that — the 3D scene, the monitor, the results table — could only be reached
by pushing state through the React tree, and the results table was kept in sync by an
effect with five dependencies that recomputed the physics on every change.

That shape has a ceiling. `docs/15` wants 60 Hz kinetics; you cannot drive those through a
component tree. And the rig cannot be exercised at all without rendering it.

## 2. Files

```
src/simulation/
├── state.ts       SimulationState, createInitialSimulationState, freezing
├── runtime.ts     createSimulationRuntime — dispatch, subscribe, reset
└── selectors.ts   derived views: readings, jet, loaded mass
src/lib/
└── useSimulation.ts   the React adapter (not part of the simulation)
```

Three files. `actions.ts` and `events.ts` from the sketch in `docs/15` were folded in: the
command union is twenty lines and belongs next to the function that interprets it, and
there is no event type at all (§6).

## 3. State ownership

Every field of the old `SimulationState`:

| Field | Old owner | New owner | Class | Derived? |
|---|---|---|---|---|
| `isCoverOpen` | React | **runtime** (`apparatus`) | SIMULATION | no |
| `isPowerOn` | React | **runtime** (`apparatus`) | SIMULATION | no |
| `valveOpening` | React | **runtime** (`apparatus`) | SIMULATION | no |
| `isVolumetricValveOpen` | React | **runtime** (`apparatus`) | SIMULATION | no |
| `selectedDeflectorId` | React | **runtime** (`apparatus`) | SIMULATION | no |
| `loadedWeightsG` | React | **runtime** (`apparatus`) | SIMULATION | no |
| `experimentId` | React | **runtime** | SIMULATION (config) | no |
| `params.pumpFlowLMin` | React | **runtime** | SIMULATION | no |
| `isCalculated` | React | **runtime** (`isActualForceRecorded`) | SIMULATION (measurement) | no |
| `currentRecordIndex` | React | **runtime** (`committedReadingCount`) | SIMULATION (measurement) | no |
| — | — | **runtime** (`activeReadingIndex`) | SIMULATION (measurement) | no |
| — | — | **runtime** (`committedWeightsG`) | SIMULATION (measurement) | no |
| `recordedRows` | React (effect) | **nobody** — `selectReadings` | **DERIVED** | **yes** |
| `mode` | React | React | LESSON | no |
| `currentStep` | React | React | LESSON | no |
| `quizAnswer` | React | React | LESSON (assessment) | no |
| `language` | React | React | PRESENTATION | no |
| `showMonitor` | React | React | PRESENTATION | no |
| `warningMessage` | React | React | PRESENTATION | from a rejection |
| `notice` | React | React | PRESENTATION | from a step/rejection |
| `params.customWeightG` | React | React | PRESENTATION | no |

**Moved out of React: eight fields**, plus two new ones that replace an index-keyed rule.
**Deliberately left in React:** the lesson (`mode`, `currentStep`, `quizAnswer`) because
`BEDO‑018`/`BEDO‑019` own it and moving it twice would be worse than moving it once; and
presentation, which is React's proper business. `customWeightG` stays because it buys a
button on a panel — it changes no physics.

**`recordedRows` is now derived from nothing but authoritative state**, which removes the
effect, its five dependencies, and the possibility of the table disagreeing with the rig.

### 3.1 The step-index rule, removed from simulation

The table used to be built from `BALANCE_ROW = { 7: 1, 9: 2 }` — a map from *lesson step
number* to results row. Simulation truth depended on lesson numbering, which is why
`docs/32` could not renumber anything without touching the monitor.

The runtime now knows only `activeReadingIndex` and is *told* which reading is being taken:

```
lesson step 7  →  READING_FOR_STEP  →  BEGIN_READING { index: 1 }  →  runtime
```

`READING_FOR_STEP` is the compatibility adapter, and it lives in `App.tsx` where the
lesson lives. `BEDO‑019` deletes it when steps get stable ids. **Nothing in
`src/simulation/` mentions a step**, and a test asserts that.

## 4. API

```ts
const runtime = createSimulationRuntime(createInitialSimulationState('flat'));

runtime.getState(): SimulationState                     // frozen, stable identity
runtime.dispatch(command): DispatchResult               // { ok, state, changed } | { ok:false, reason }
runtime.subscribe(listener): () => void                 // returns unsubscribe
runtime.reset(experimentId?): SimulationState
```

Deliberately not Redux: no reducer registry, no middleware, no action creators. `dispatch`
is a function with a switch in it.

## 5. Commands

| Command | Effect |
|---|---|
| The ten `ApparatusAction`s | Passed straight to `attempt` — cover, power, valve, volumetric valve, deflector, weights |
| `SET_PUMP_FLOW { lPerMin }` | Q_total; every flow figure follows |
| `SELECT_EXPERIMENT { experimentId }` | Loads that sheet: fresh rig, its default deflector, pump flow kept |
| `BEGIN_READING { index }` | That row follows the tray |
| `END_READING` | Commits the tray into the row; the row stops moving |
| `RECORD_ACTUAL_FORCE` | F_ac joins the table |

**No `NEXT_STEP`.** Lesson progression is not simulation state.

Apparatus commands can be refused. Simulation commands cannot — they are configuration
and bookkeeping, not safety decisions — so they always return `ok: true`, with `changed`
saying whether anything moved.

## 6. State-machine integration

```
dispatch(apparatus command)
        ↓
attempt(state.apparatus, action)         ← BEDO-006, called, never re-implemented
        ↓                    ↓
    accepted             rejected → { ok: false, reason }, state returned by identity,
        ↓                            no subscriber notified
 commit + notify
```

A test greps the runtime's own source for guard-shaped code (`isCoverOpen &&`, `BLOCKED`,
`NEEDS_`) and fails if any appears. There is exactly one place where apparatus legality is
decided, and the 3D scene and the control panel both reach it.

## 7. Subscriptions, and why there is no event type

`listener(state, previous)`. Not a `SimulationEvent` union.

Every consumer that exists or is planned — React's `useSyncExternalStore`, the future
lesson runner, feedback and audio — wants *the new state*; the ones that care what changed
can compare against the previous state, which they are handed. An event stream would be a
second thing to keep correct, with no reader that needs it. `docs/22`'s `DomainEvent` idea
is still available if a consumer ever genuinely wants a stream.

Semantics, each with a test:

- **Rejected → no notification.** Nothing changed; there is nothing to tell.
- **Accepted but unchanged → no notification.** Closing a closed cover is silent.
- **Order is subscription order.**
- **Unsubscribe works**, twice is harmless, and a listener may unsubscribe *itself during a
  notification* — the runtime iterates a copy of the set.

## 8. Selectors

Pure functions of state, no React:

`selectReadings` · `selectActiveReading` · `selectReadingsTaken` · `selectLoadedMassG` ·
`selectJetState` · `selectJetForceN` · `selectIsPumpRunning` · `selectDeflector` ·
`selectAvailableDeflectors` · `selectExperiment`

`selectJetForceN` carries the rule that the jet only acts with the pump running and the
tank shut — previously written inline in `DeviceModel`'s frame loop.

## 9. Immutability

State and its arrays are frozen on commit — once per accepted command, never per frame, so
the cost is irrelevant. A caller that tries `state.apparatus.loadedWeightsG.push(...)`
throws instead of corrupting the rig. `selectReadings` copies the weights into each row, so
a consumer cannot edit a reading in place either.

## 10. Reset

Today's reset does four things at once: rig, lesson, interface and (implicitly) the table.
BEDO‑008 splits the first from the rest without changing what a student sees:

```
handleReset()  →  runtime.reset()          rig + measurements
               →  initialLessonState()     step 1, guided, monitor closed, quiz cleared
                                           language preserved, as before
```

The table needs no clearing because it is derived. Pump flow survives a reset, which is
what the app has always done — reset restores the rig, not the parameters panel.

## 11. React adapter

```ts
const runtime = useSimulationRuntime();          // one per mount, in a ref
const simulation = useSimulationState(runtime);  // useSyncExternalStore
```

`useSyncExternalStore` is React's own contract for an external store: tearing-safe, no
dependency, and nothing for the Zustand migration to undo — a store would subscribe the
same way. Because the runtime returns the same object until something changes, a rejected
action causes no render at all.

`App` then assembles a **`SimulationView`** — the old `SimulationState` shape — from the
runtime, the lesson state and `selectReadings`, and passes it to the components untouched.
It is one-way and derived; nothing writes to it. That is what kept this change out of
`DeviceModel`, `UIOverlay`, `Scene3D` and `SoftwareMonitor` entirely.

## 12. Remaining duplication: none

There is no field with two owners. The projection is not a second copy in the sense §28
warns about — it is recomputed from its sources on every render and cannot be written to.

It is still *debt*: while it exists, components take a prop instead of subscribing to what
they need, so any state change re-renders all of them. That is the cost `docs/11`'s
`PERF‑13` measures, and removing it is UI work (`BEDO‑024`…`027`), not runtime work.

## 13. What comes next

**Zustand (`D‑1`).** The store should *wrap* the runtime, not replace it:

```ts
const useSimulationStore = create((set) => {
  runtime.subscribe((state) => set({ state }));
  return { state: runtime.getState(), dispatch: runtime.dispatch };
});
```

Keeping simulation logic outside the store is what keeps it testable without React. If a
future task collapses the two, everything in `simulation-runtime.spec.ts` needs a renderer.

**The lesson engine (`BEDO‑018`/`019`).** It subscribes to the runtime and decides
progression from state, rather than each handler deciding for itself. The runtime is
already shaped for it: `BEGIN_READING`/`END_READING` are semantic, and `READING_FOR_STEP`
is the only index-keyed rule left — in the lesson's own file.

**60 Hz kinetics (`docs/15`).** Continuous values (water level, spring travel, transfer
animations) should be added to the runtime with a `tick(dt)` and read by the scene through
a subscription, never through props. Nothing here forecloses that.

## 14. Verification

| | |
|---|---|
| Scene fingerprint | **identical** — 290 objects, 4 lights, 33 transforms, 16 hotspots, camera |
| Draw calls / tris / binds / programs | 769 / 217 055 / 22 / 42 — **unchanged** |
| Transferred | 27.02 MB — unchanged |
| CSV export | **15 tests, character-identical** |
| Twelve-step lesson | 15 integration + 3 browser tests, unchanged |
| Safety guards | 17 tests, unchanged |
| Physics / spring / state machine / GLB | 57 / 34 / 61 / 51, unchanged |

## 15. Debt and defects noted, not fixed

- **The view projection** re-renders every component on any change (§12). `PERF‑13`.
- **`READING_FOR_STEP`** is the last index-keyed rule. `BEDO‑019`.
- **The lesson still lives in `App.tsx`** as a switch over step numbers. `BEDO‑018`.
- One behavioural detail, invisible and now correct: the results table used to be empty on
  the very first render and populated by an effect a frame later. Derived state has no such
  gap. No test observed either.
- Everything listed in §33 of the task — the video modal, popup z-index, RTL, row 4,
  deflector scoping, drain on power-off, single-weight removal — remains untouched.
