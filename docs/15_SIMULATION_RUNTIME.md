# 15 — Simulation Runtime

> **Implemented in BEDO‑008 — see `docs/33` for what was actually built.**
>
> Differences from the design below, all deliberate: three files rather than five
> (`actions.ts`/`events.ts` folded in); **no event union** — subscribers receive
> `(state, previous)`, because every consumer that exists wants the state and none wants a
> stream; kinetics and `tick(dt)` are **not** implemented, since nothing continuous exists
> yet to drive; and the store stays out — Zustand will wrap the runtime, not become it.


**Responsibility:** hold apparatus state, apply intents through the domain state machine, and expose derived
values. **Deterministic**, framework-free, headless-testable.

---

## 1. State shape

Split by lifetime and update frequency — the current single 18-field object mixes four unrelated concerns
(`ARCH‑03`).

```ts
/** Discrete. Changes only on user intent. Drives React re-render. */
interface ApparatusState {
  power: boolean;
  coverOpen: boolean;
  volumetricValveOpen: boolean;
  valveOpening: ValveOpening;              // 0..1
  installedDeflectorId: number | null;     // null until step 2 — today it is pre-set
  loadedWeights: Grams[];                  // ordered stack, bottom → top
  pumpFlow: LitresPerMinute;               // custom parameter
  customWeight: Grams;
  machineState: 'A' | 'B' | 'C' | 'D' | 'J';   // from the state machine spec
}

/** Continuous. Ticks at frame rate. MUST NOT drive React re-render. */
interface ApparatusKinetics {
  coverLift: number; screwLift: number; pointerSwing: number;
  springDeflection: Metres;
  tankWaterLevel: number;    // 0..1 — drain on power-off (storyboard sl. 30/32)
  transfers: Transfer[];     // in-flight 2 s animated moves (storyboard sl. 14-16)
  elapsed: number;
}

/** Append-only. One entry per reading the student actually took. */
interface Reading {
  id: ReadingId;
  takenAt: number;                 // injected clock, not Date.now()
  valveOpening: ValveOpening;
  pumpFlow: LitresPerMinute;
  deflectorId: number;
  loadedMassG: Grams;
  jet: JetState;                   // from domain/physics
  measuredForceN: Newtons;
  springDeflectionMm: Millimetres;
  source: 'guided' | 'free';
}
```

### 1.1 Why `Reading[]` replaces the four fixed rows

The storyboard is explicit: **"Fill rows by changing the valve opening"** (sl. 22), and a **Clear** button
"will erase the table and the graph" (sl. 24). Rows are created by the student, not pre-computed.

The current design maps over `ROW_VALVE_SETTINGS = [0, 0.4, 0.5, 0.6]` and calls `computeRow` for **all four**
regardless of what happened, which is the single root cause of three separate bugs:

- `BUG‑14` — row 4 displays `Q = 43.457 L/min`, `V₀ = 9.227`, `F_th = 6.6287 N` for a reading the student never
  took, and its magnitude sets the chart's Y-axis to 8 N, squashing both real readings into the corner.
- `BUG‑15` — the chart's line and its dots use two different filters over that array, producing a phantom
  `F_ac = 0` point.
- `BUG‑06` — Free mode records nothing, because the active row is looked up as `BALANCE_ROW[currentStep]` and
  `currentStep` never advances in Free mode.

An append-only list makes all three impossible. `ROW_VALVE_SETTINGS` survives only as *setpoints the guided
script asks for*, never as table rows.

---

## 2. Runtime object

Framework-free so it can be driven headlessly in tests and in the lesson linter.

```ts
export interface SimulationRuntime {
  getState(): Readonly<ApparatusState>;
  getKinetics(): Readonly<ApparatusKinetics>;
  getReadings(): readonly Reading[];

  dispatch(intent: Intent): Outcome;      // routes through domain/stateMachine.attempt
  tick(dtSeconds: number): void;          // advances kinetics only; never React state

  subscribe(fn: (s: ApparatusState) => void): Unsubscribe;
  subscribeKinetics(fn: (k: ApparatusKinetics) => void): Unsubscribe;
}

export function createSimulation(opts: {
  experiment: ExperimentDef;
  clock?: () => number;                   // injected — determinism
}): SimulationRuntime;
```

**`dispatch` is the only mutation path.** The 3D layer, the DOM controls and the lesson runner all use it.

---

## 3. Determinism

| Source of nondeterminism | Handling |
|---|---|
| `Date.now()` / `new Date()` | Injected `clock`. Default `performance.now`. |
| `Math.random()` | Banned in `simulation/` and `domain/` by lint. The water texture's PRNG moves to `assets/` and is seeded. |
| Frame timing | `tick(dt)` takes dt as a parameter; `dt` is clamped to 0.1 s for stability (keeping the existing correct reasoning at `DeviceModel.tsx:843‑854`) but the **sequence timer uses raw dt**, as the current code already correctly notes. |
| Floating point | Comparisons use explicit tolerances from `domain`, never `===`. |

A session is therefore `(initialState, Intent[], dt[])` → deterministic final state. This enables replay,
makes the E2E test stable, and would let an instructor scrub a student's session later.

---

## 4. Derived values — selectors, never stored

`recordedRows` is currently *stored* in the same state it is derived from, written by a `useEffect`, causing a
second render on every interaction and a dependency list that has already drifted (`CQ‑11`, and the missing
`valveOpening` dependency is half of `BUG‑06`).

```ts
selectJetState(s)          → domain.jetState(s.valveOpening, s.installedDeflectorId, s.pumpFlow)
selectSpringDeflection(s)  → domain.springDeflection(F_th, F_ac, k, maxTravel)
selectBalance(s)           → { balanced, deltaG, direction: 'tooLight'|'ok'|'tooHeavy' }
selectFlowState(s)         → { flowing, plume: WaterShapeKey, jetReachesDeflector }
selectChartSeries(r)       → { theoretical: Point[], measured: Point[] }   // ONE source, both series
```

All memoised on their inputs. Nothing derived is ever written back into state.

### 4.1 Plume selection becomes physics, not a magic number

Storyboard sl. 6: *"If v_th ≤ 0, the water out of the nozzle forms the water shape **before impact**. If
v_th > 0, the water impacts the deflector, the water shape **after impact** will form."*

```ts
export const selectFlowState = (s: ApparatusState) => {
  const jet = selectJetState(s);
  const flowing = s.power && !s.coverOpen && s.valveOpening > 0;
  const reaches = jet.theoreticalV > 0;          // v² = v₀² − 2gs > 0
  return { flowing, jetReachesDeflector: reaches,
           plume: reaches ? getDeflector(s.installedDeflectorId).water : 'low' };
};
```

This deletes `valveOpening > 0.22` (`DeviceModel.tsx:1023`) and `valveOpening > 0.05` (`:1020`). The crossover
falls out of the physics at `v₀ = √(2gs) = 0.829 m/s` ⇒ `Q ≈ 3.9 L/min` ⇒ **n ≈ 0.115** — and it moves
correctly when the student changes the pump flow rate, which the magic threshold never did.

---

## 5. Behaviours to add (all specified, none implemented)

| # | Behaviour | Source | Task |
|---|---|---|---|
| S‑1 | **Weight removal** — clicking a weight on the holder returns it to the tray in 2 s | Storyboard sl. 32; state machine `D →(weight-on-holder)→ B` | BEDO‑023 |
| S‑2 | **Tank drains on power-off** — *"The water will gradually drain from the tank if the valve is opened"* | Storyboard sl. 30, 32 | BEDO‑010 |
| S‑3 | **2-second animated transfers** for deflector-install and weight-load | Storyboard sl. 14–16 | BEDO‑022 |
| S‑4 | **Spring clamps at zero**, does not go negative | Storyboard sl. 8 | BEDO‑009 |
| S‑5 | **No deflector installed initially** — `installedDeflectorId: null` until step 2 | Storyboard sl. 23 (LED lights *after* install) | BEDO‑008 |
| S‑6 | **Apply / Warning / Reset** semantics for custom parameters | Storyboard sl. 12 | BEDO‑029 |
| S‑7 | Valve rotates but does not change value while the pump is off | State machine `A →(valve)→ A` | BEDO‑008 |

S‑7 is worth noting: the current build shows a *notice* ("Turn on the power switch before opening the valve")
and refuses the change. The spec says the valve **rotates without changing its value**. Small, but it is the
difference between a rig that feels physical and one that argues with you.

---

## 6. React binding

```ts
export const useApparatus = create<ApparatusSlice>()(...)   // discrete state only
```

- Components subscribe with **selectors**, never to the whole object.
- `ApparatusKinetics` is **not** in the store. It lives in refs read inside `useFrame`, updated by
  `runtime.tick()`. This is the mechanism that prevents 60 Hz values from triggering React renders
  (`PERF‑13`) — see `docs/21 §4`.
- The scene reads volatile values through `runtime.getKinetics()` inside the frame loop, not through a closure
  over render-time props (`ARCH‑08`).

---

## 7. Tests

| Suite | Asserts |
|---|---|
| `runtime.spec.ts` | Every state-machine transition via `dispatch`; errors do not mutate; intents are idempotent where they should be |
| `readings.spec.ts` | A reading is appended only on an explicit record action; guided and free produce identical rows for identical inputs; Clear empties both series |
| `determinism.spec.ts` | Same intents + same dt sequence → byte-identical final state, run twice |
| `selectors.spec.ts` | Plume crossover at `v_th = 0`; balance direction; chart series derived from one source |
| `drain.spec.ts` | Tank level monotonically decreases after power-off and never goes negative |
