# 30 — Apparatus State Machine (BEDO‑006)

The five safety guards were React event handlers. They are now a pure function, and the
React handlers ask it.

```
click (DOM or 3D mesh)
        ↓
ApparatusAction              intent, not a control
        ↓
attempt(state, action)       src/domain/stateMachine.ts — pure, total, deterministic
        ↓
{ ok: true, state, changed } | { ok: false, state, reason }
        ↓
src/lib/apparatusGate.ts     reason → the bilingual copy, warning or notice
        ↓
React state
```

**Zero behaviour change.** All 17 React safety-guard tests pass untouched, the twelve-step
lesson is unchanged, the scene fingerprint is identical.

---

## 1. Why

`Jet force_State machine.docx` defines rules about a physical rig. They lived inside
`App.tsx` as five `if` statements spread across five event handlers, which meant the 3D
scene's click handlers reached the same rules by a different path — and when two paths
encode the same rule, they eventually disagree. That is `BUG‑04`.

One pure function, consulted by everything, makes that class of bug structurally
impossible. It also makes the rules *readable*: the whole safety specification is now
about eighty lines you can hold in your head, with no React in the way.

---

## 2. State model

Only what a safety rule actually reads. `SimulationState` has eighteen fields; the
apparatus has six.

```ts
interface ApparatusState {
  readonly isCoverOpen: boolean;
  readonly isPowerOn: boolean;
  readonly valveOpening: number;          // n, 0..1
  readonly isVolumetricValveOpen: boolean;
  readonly selectedDeflectorId: number;   // by angle
  readonly loadedWeightsG: readonly number[];
}
```

Deliberately absent: the lesson step, the language, the recorded rows, the monitor, the
quiz, the mode, the camera, anything React. No apparatus rule depends on any of them —
and if one ever appears to, that is a sign the rule is a lesson rule (§7).

`restingState(deflectorId)` is the rig at power-up: shut, off, drained, tray empty.

---

## 3. Action model

Intents, not controls. The cover is one button in the UI, but "open it" and "close it" are
different actions with different rules, and only one of them can be refused. The caller
decides which intent a click means.

```ts
type ApparatusAction =
  | { type: 'OPEN_COVER' }              | { type: 'CLOSE_COVER' }
  | { type: 'POWER_ON' }                | { type: 'POWER_OFF' }
  | { type: 'SET_VALVE'; opening: number }
  | { type: 'OPEN_VOLUMETRIC_VALVE' }   | { type: 'CLOSE_VOLUMETRIC_VALVE' }
  | { type: 'SELECT_DEFLECTOR'; deflectorId: number }
  | { type: 'ADD_WEIGHT'; massG: number }
  | { type: 'REMOVE_ALL_WEIGHTS' };
```

`massG` carries its unit, per the BEDO‑005 convention.

---

## 4. Result contract

```ts
type TransitionResult =
  | { ok: true;  state: ApparatusState; changed: boolean }
  | { ok: false; state: ApparatusState; reason: RejectionReason };
```

- **A refusal changes nothing.** `result.state` is the input, returned *by identity* —
  asserted with `toBe`, not `toEqual`.
- **`changed: false`** means the action was legal but there was nothing to do: closing a
  closed cover, selecting the deflector already fitted. The state comes back by identity
  there too. Modelling these as no-ops rather than refusals keeps callers from having to
  know the current state before they can ask.
- **No effects layer.** `docs/22`'s `DomainEffect` idea was considered and dropped: every
  caller already knows what it asked for, because it dispatched an explicit intent. Adding
  an event stream would be machinery with no reader. `§11` of the task explicitly allows
  skipping it.

## 5. Rejection reasons

Codes, never sentences. The domain has no language.

| Reason | Guard | Meaning |
|---|---|---|
| `WEIGHTS_BLOCKED_BY_OPEN_COVER` | error1 | Weights may not go on the tray while the tank is open |
| `DEFLECTOR_NEEDS_OPEN_COVER` | error2 | The rod is inside the tank; the cover comes off first |
| `COVER_BLOCKED_BY_POWER` | error3 | The tank may not be opened while the pump runs |
| `POWER_BLOCKED_BY_OPEN_COVER` | error4 | The pump may not start while the tank is open |
| `COVER_BLOCKED_BY_WEIGHTS` | error5 | The tray must be cleared before the tank is opened |
| `VALVE_NEEDS_RUNNING_PUMP` | — | Not a documented guard: the pump is not running |

The sixth is not one of BEDO's five, and the app has always presented it differently — a
blue notice rather than a red blocking banner. `src/lib/apparatusGate.ts` preserves that:
it maps each reason to `severity`, the `errorN` code (carried on `warningMessage` as
before, though nothing reads it), and the exact English and Arabic copy the app shipped.

A test asserts the presentation map and the reason union have precisely the same keys, so
neither can grow an orphan.

---

## 6. Transition table — **CURRENT** behaviour

Every row is what the application does today. Guard column empty means unconditional.

| State | Action | Guard | Result | Rejection |
|---|---|---|---|---|
| cover shut | `OPEN_COVER` | pump off **and** tray empty | cover opens | `COVER_BLOCKED_BY_POWER` if the pump runs; else `COVER_BLOCKED_BY_WEIGHTS` if loaded |
| cover open | `OPEN_COVER` | — | no-op (`changed: false`) | — |
| cover open | `CLOSE_COVER` | — | cover closes | — |
| cover shut | `CLOSE_COVER` | — | no-op | — |
| pump off | `POWER_ON` | cover shut | pump starts | `POWER_BLOCKED_BY_OPEN_COVER` |
| pump on | `POWER_ON` | — | no-op | — |
| pump on | `POWER_OFF` | — | pump stops **and `valveOpening` → 0`** | — |
| pump off | `POWER_OFF` | — | no-op | — |
| any | `SET_VALVE` (opening > 0) | pump running | valve set to that opening exactly | `VALVE_NEEDS_RUNNING_PUMP` |
| any | `SET_VALVE` (opening = 0) | — | valve shut | — |
| any | `OPEN_/CLOSE_VOLUMETRIC_VALVE` | — | toggles that flag only | — |
| cover open | `SELECT_DEFLECTOR` | — | deflector changes | — |
| cover shut | `SELECT_DEFLECTOR` | — | — | `DEFLECTOR_NEEDS_OPEN_COVER` |
| cover shut | `ADD_WEIGHT` | — | disc appended to the tray | — |
| cover open | `ADD_WEIGHT` | — | — | `WEIGHTS_BLOCKED_BY_OPEN_COVER` |
| any | `REMOVE_ALL_WEIGHTS` | — | tray emptied, **even with the tank open** | — |

Three details that are behaviour, not accident, and are pinned as such:

1. **Guard precedence.** When both apply to `OPEN_COVER`, the running pump is reported
   before the loaded tray — error3 before error5.
2. **Power-off shuts the valve.** A restart never resumes at the previous flow.
3. **Clearing the tray is unguarded**, including while the tank is open — that is how a
   student recovers from error5.

### **SPECIFIED BUT NOT IMPLEMENTED**

From `docs/13 §5`'s transcription of the state-machine document. Both are **left
unimplemented**, and `state-machine.spec.ts` asserts their *absence* so the gap stays a
visible fact rather than an assumption:

| Document | Status | Owner |
|---|---|---|
| `weight-on-holder → B (weight removed, 2 s)` — remove a single disc by clicking it | Not implemented. The only removal is all-or-nothing. | `R‑3` → **BEDO‑023** |
| `A → B on power-off: water drains` | Not implemented. Power-off shuts the valve and nothing else; the domain has no water level at all. | `R‑13` → **BEDO‑010** |

---

## 7. State machine vs lesson engine

The distinction this task asked to establish, made concrete:

| | Question | Where |
|---|---|---|
| **State machine** | Is this mechanically and safely valid *right now*? | `src/domain/stateMachine.ts` |
| **Lesson engine** | Is this what the student was asked to do at this step? | `App.tsx` today; `BEDO‑018` later |

Two rules were sitting in the apparatus handlers that are really lesson rules, and they
stayed on the lesson side:

- **Valve snapping.** Setting the valve within `VALVE_SNAP_MARGIN` of a reading setpoint
  snapped it to 0.4 or 0.5 — but *only* on steps 6 and 8. That exists so the readings land
  on the openings the results table is computed at. It is now
  `snapToReadingSetpoint(opening, step)` in `App.tsx`, applied **after** the gate accepts,
  so a refused setting never moves the valve at all. The domain accepts whatever opening
  it is handed.
- **Step advancement.** `advance(prev, 1, 2)` and friends are passed into the dispatch as
  a callback. The state machine has no idea a lesson exists.

Nothing else in the apparatus handlers referenced `currentStep`.

---

## 8. Old handler → new transition

| `App.tsx` handler | Old rule, in place | Now |
|---|---|---|
| `handleCoverClick` | `if (!isCoverOpen) { if (isPowerOn) raise('error3'); if (loadedWeightsG.length) raise('error5') }` then toggle | dispatches `OPEN_COVER`/`CLOSE_COVER`; guards live in the machine; lesson advance 1→2 / 3→4 stays in the handler |
| `handleSelectDeflector` | `if (!isCoverOpen) raise('error2')` | `SELECT_DEFLECTOR` |
| `handleTogglePower` | `if (!isPowerOn && isCoverOpen) raise('error4')`; toggle; zero the valve when stopping | `POWER_ON`/`POWER_OFF`; the valve reset is now part of the `POWER_OFF` transition |
| `handleToggleVolumetricValve` | unguarded toggle | `OPEN_`/`CLOSE_VOLUMETRIC_VALVE` |
| `handleSetValve` | `if (!isPowerOn && val > 0)` → notice; then step-dependent snapping | `SET_VALVE`, with snapping moved to `snapToReadingSetpoint` on the lesson side |
| `handleAddWeight` | `if (isCoverOpen) raise('error1')` | `ADD_WEIGHT` |
| `handleClearWeights` | unguarded | `REMOVE_ALL_WEIGHTS` |
| `raise(code)` + `ERRORS` table | built the bilingual message inline | `withRejection` + `REJECTION_PRESENTATION` in `src/lib/apparatusGate.ts` |

One deliberate difference, and it is a strict improvement: the old guards read `state`
from the render closure while the mutation used `setState(prev => …)`. The new dispatch
evaluates the guard against `prev`, so a decision can no longer be made against a stale
snapshot. Unobservable in every existing test; two very fast clicks were the only way to
tell, and the closure version was the wrong one.

---

## 9. What was left alone on purpose

- **No range check on `valveOpening`.** The slider constrains 0..1, so nothing out of
  range can reach the domain from the UI, and rejecting it would be a *new* product
  restriction. Current behaviour is pinned by a test that documents it as a candidate
  rather than an endorsement.
- **No deflector validation.** Any id is accepted; `getDeflector` falls back to the flat
  plate downstream. Scoping the choice to the loaded experiment is `BUG‑05` → `BEDO‑022`.
- **No weight-denomination check.** The Custom Parameters panel can mint a weight, so the
  domain must not police the set.
- **Duplicate weights are two discs**, not an error.

---

## 10. Tests

| Suite | Count | What it proves |
|---|---:|---|
| `tests/unit/state-machine.spec.ts` | **61** | The rules themselves: five guards, every action against valid and invalid states, precedence, no-ops, immutability against deep-frozen inputs, determinism, totality, the whole guided sequence as pure transitions, and both unimplemented behaviours asserted absent |
| `tests/integration/safety-guards.spec.tsx` | 17 | **Unchanged.** That the React adapter still maps onto those rules, in both languages and both modes |

Keeping both layers is the point: if the domain and the UI ever drift apart, one of the
two suites goes red. The React tests were not rewritten to match the new internals — they
were left exactly as BEDO‑002 wrote them and simply kept passing.

---

## 11. Integration points for BEDO‑008

What is done, and what is deliberately still open:

- ✅ `App.tsx` routes **every** apparatus action through `attempt`. The panel and the 3D
  scene both arrive at the same gate, because the 3D hotspots call the same `App`
  handlers.
- ✅ The domain state is derived from and folded back into `SimulationState` by
  `toApparatusState` / `withApparatusState` — the two functions `BEDO‑008` will delete when
  the runtime owns the state directly.
- ⏳ React `useState` is still the storage. No store was introduced; `BEDO‑008` owns that,
  and `D‑1` has settled it as Zustand.
- ⏳ `BUG‑04` is **prepared, not fixed.** Apparatus *safety* now has one gate, but 3D clicks
  still bypass *lesson* gating: `DeviceModel`'s hotspots dispatch at any step. Closing that
  needs the lesson runner to expose `isAllowed(intent)` — `BEDO‑018`/`BEDO‑020`.
- ⏳ `RejectionReason` → message mapping lives in `src/lib/apparatusGate.ts`. When the UI
  is rebuilt it should read from there rather than re-encoding copy.
