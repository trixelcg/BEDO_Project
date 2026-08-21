# 36 — Unified Lesson & Apparatus Interaction Gate (BEDO-020)

**Status:** implemented.
**Closes:** `BUG-04`.
**Scope:** which interactions are accepted. Nothing about *what* the lesson teaches changed — the canonical
eleven steps of `BEDO-019` are untouched, byte for byte.

---

## 1. What BUG-04 was

> Guided UI respects lesson progression, but 3D hotspots can still dispatch apparatus actions outside the
> current lesson step.

The guided panel enforced the lesson by **not rendering** the wrong buttons:

```tsx
const show = (control: PanelControl) => !guided || lesson.panelControls.includes(control);
```

That is a presentation choice standing in for a rule. The scene cannot do the same thing — a rig cannot hide
a power switch — and `DeviceModel` gated only the *cursor*, never the click:

```tsx
onPointerOver={() => { if (liveKeys.has(h.key)) document.body.style.cursor = 'pointer'; }}
onClick={() => handleHotspot(h.action)}     // ← no check at all
```

So every hotspot dispatched at every step. Concretely, before this task:

| At step | 3D click | What happened |
|---|---|---|
| 1 — unscrew the plate | power switch | the pump started |
| 2 — install the deflector | the cover | the tank closed again |
| 5 — open the flow valve | power switch | **the pump stopped mid-reading** |
| 1 | a tray weight | discs went on the pan |

None of these are unsafe, which is why the apparatus state machine let them all through: `BEDO-006` answers
*"is this mechanically legal?"* and nothing answered *"is this the step?"* outside the panel's JSX.

The consequence worth naming is the third row. Guided mode could be driven into a state the lesson has no
step for, and the only way back was the reset button.

---

## 2. Architecture

```
    2D panel control                     3D hotspot
            │                                 │
            └───────────────┬─────────────────┘
                            ▼
                    App.interact(interaction)
                            │
                            ▼
          evaluateInteraction()   ← src/interaction/gate.ts (pure)
                            │
              ┌─────────────┴──────────────┐
              ▼                            ▼
      apparatus legality             lesson legality
      attempt(state, action)         step affordances + alwaysAvailable
      → RejectionReason              → LessonBlockReason
              │                            │
              └─────────────┬──────────────┘
                            ▼
                        allowed?
                    ┌───────┴────────┐
                   no                yes
                    │                 │
                    ▼                 ▼
              feedback only    runtime.dispatch(command)
              (nothing              │
               committed)           ▼
                              runner.notify(expectation)
                                    │
                                    ▼
                            step advances / notice
```

**One decision point.** `App.interact` is the only function that reaches `runtime.dispatch` with a learner's
intent, and it cannot be reached without passing the gate first.

### 2.1 Files

| File | Role |
|---|---|
| `src/interaction/gate.ts` | **new.** The policy. Pure, framework-free, ~120 lines of code. |
| `src/App.tsx` | `dispatch()` became `interact()`; `act()` is the apparatus shorthand |
| `src/lib/apparatusGate.ts` | gained `LESSON_BLOCK_PRESENTATION` beside the existing safety copy |
| `src/components/DeviceModel.tsx` | reads `lesson.available`; separates *actionable* from *asked for* |
| `src/types/index.ts` | `LessonView.available` — what the gate will accept, handed to the scene |

`src/interaction/` sits above `domain`, `simulation` and `lesson`, and below `lib` and `components`. It may
import downwards only, which `tests/unit/domain-boundary.spec.ts` enforces the same way it does for the three
layers beneath it.

---

## 3. The API

```ts
type InteractionAffordance = HighlightKey | PanelControl;
//   'cover' | 'deflectors' | 'power' | 'volumetricValve' | 'flowValve' | 'weights'
// | 'monitor' | 'answerSheet'

type Interaction =
  | { kind: 'apparatus';    action: ApparatusAction }
  | { kind: 'presentation'; action: 'OPEN_MONITOR' | 'RECORD_ACTUAL_FORCE' | 'OPEN_ANSWER_SHEET' };

type InteractionDecision =
  | { allowed: true;  why: 'EXPECTED' | 'ALWAYS_AVAILABLE' | 'FREE_MODE' }
  | { allowed: false; blockedBy: 'apparatus'; reason: RejectionReason }
  | { allowed: false; blockedBy: 'lesson';    reason: LessonBlockReason;
                                              affordance: InteractionAffordance };

evaluateInteraction({ interaction, apparatus, step, lesson, mode }): InteractionDecision
```

Pure, total, deterministic, and it mutates nothing it is given — asserted directly.

### 3.1 Semantic, never numeric

The gate reasons in **affordances**, not step numbers, button ids or mesh names. A step already declares
which parts it invites (`highlight`) and which panel sections it shows (`panelControls`), and in
`currentLesson.ts` those two agree on every apparatus group:

| # | step | highlight | panelControls |
|---:|---|---|---|
| 1 | `unscrew-cover` | `cover` | — |
| 2 | `install-deflector` | `deflectors` | `deflectors` |
| 3 | `mount-cover` | `cover` | — |
| 4 | `power-on` | `power` | `power` |
| 5 | `set-flow-reading-1` | `flowValve` | `flowValve` |
| 6 | `balance-reading-1` | `weights` | `weights` |
| 7 | `increase-flow-reading-2` | `flowValve` | `flowValve` |
| 8 | `balance-reading-2` | `weights` | `weights` |
| 9 | `open-monitor` | — | `monitor` |
| 10 | `record-actual-force` | — | `monitor` |
| 11 | `open-answer-sheet` | — | `monitor`, `answerSheet` |

`cover` has no panel control (the plate is mesh-only); `monitor` and `answerSheet` have no highlight (a screen
is not part of the rig). Their union is the step's interaction surface, which is why **one** gate can serve
both surfaces without either one owning the rule.

Renumbering, merging or dropping a step changes the policy for free. That is the property `BEDO-018` bought,
and this is the first task to spend it.

### 3.2 Why the affordance and not the expectation

An expectation-only gate would have been simpler and wrong. `REMOVE_ALL_WEIGHTS` is no step's expectation, and
it is the only way out of an overloaded pan — gating on expectations alone would strand a learner who added
one disc too many at step 6. `CLOSE_VOLUMETRIC_VALVE` and `POWER_OFF` are likewise nobody's expectation.
Keying on the affordance the step invites keeps every recovery path a step already offered.

The cost is granularity: at steps 9–11 the `monitor` affordance covers both opening the monitor and pressing
Calculate. In practice the window is empty — opening the monitor completes step 9 immediately
(`alsoCompletesOn: 'OPEN_MONITOR'`), so Calculate is never reachable while step 9 is current. Refining below
the affordance would mean re-deriving the completion logic in a second place, which is the duplication
`BEDO-018` removed.

---

## 4. Guided vs Free

| | Guided | Free |
|---|---|---|
| Apparatus safety | enforced | **enforced** |
| Lesson expectation | enforced | not consulted |
| Always-available | honoured (moot — everything is available) | everything available |
| Decision reason | `EXPECTED` / `ALWAYS_AVAILABLE` | `FREE_MODE` |

Free mode returns after the apparatus check and never reaches the lesson branch, so lesson state cannot
restrict exploration even though the runner is still mounted and still tracking a step. Asserted for every
affordance at every one of the eleven steps.

---

## 5. Precedence: apparatus first

When an action is **both** unsafe and off-script, the learner is told about the rig.

`BEDO-020 §15` suggests evaluating the lesson first and §16 asks for a documented choice. We evaluate the
**apparatus** first, for three reasons:

1. **It costs nothing and commits nothing.** `attempt()` is pure and returns the state it was given, by
   identity, when it refuses. `BEDO-020 §12` — decide before the authoritative change — is satisfied either
   way, so ordering is free to be chosen on merit.
2. **The safety message is the more useful sentence.** *"You can't add weights while the tank is open"* is one
   of BEDO's five documented guards, written by them, translated by them, and true of the physical apparatus a
   student will later stand in front of. *"Follow the highlighted step first"* is a fact about the software.
   For a training simulator, the first is the lesson.
3. **It preserves shipped behaviour.** Every expectation in `tests/integration/safety-guards.spec.tsx` was
   written against the app as it behaved before any of this, and each one performs a guarded action at
   whatever step the test happens to be standing on. Lesson-first would have re-labelled several of those
   refusals as "wrong step" and silently retired the guard copy at exactly the moments it was written for.
   All 574 pre-existing tests pass unedited, which is the evidence.

The one consequence to be aware of: a learner who fixes the safety condition may then meet the lesson block.
Two refusals in a row is slightly worse than one — and it is the correct order to *learn* them in, since the
safety rule is about the machine and the step rule is about the procedure.

---

## 6. Lesson rejection vs apparatus rejection

| | Apparatus | Lesson |
|---|---|---|
| Type | `RejectionReason` | `LessonBlockReason` |
| Values | the five guards + `VALVE_NEEDS_RUNNING_PUMP` | `NOT_EXPECTED_IN_CURRENT_STEP` |
| Presented as | red blocking banner (`warning`), carries `error1`–`error5` | blue notice |
| Copy | `REJECTION_PRESENTATION` | `LESSON_BLOCK_PRESENTATION` |
| English | *"You can't open the tank while the power is on."* | *"Follow the highlighted step first."* |
| Arabic | (unchanged) | *"يرجى اتباع الخطوة الحالية أولاً."* |

The two unions are disjoint and a test asserts it, because the presentation layer chooses between a red banner
and a blue notice by looking at nothing else.

**One sentence, not one per step** — `BEDO-020 §11` is explicit that the feedback system is a later task. The
typed `LessonBlockReason` (and the `affordance` it carries) is what that system will consume; the sentence
exists so a blocked click reads as *"not yet"* rather than as a dead control.

---

## 7. Always-available actions

`Lesson.alwaysAvailable` — introduced by `BEDO-019` when the volumetric valve lost its step number — is read
by the gate as metadata. The valve is **not named anywhere in `src/interaction/gate.ts`**; a test removes the
metadata and asserts the permission disappears with it, and a second test scans the source for the string in
any conditional.

Verified at all eleven steps: open and close both accepted, neither advances the lesson, and the valve still
obeys the apparatus (it is refused when the rig would refuse it).

---

## 8. The 3D path, and one defect avoided

The scene now receives `lesson.available` — the gate's own answer — and distinguishes two things it used to
conflate:

| | source | drives |
|---|---|---|
| `liveKeys` | `step.highlight` | the pulsing highlight and the guide arrow — **what the step asks for** |
| `actionableKeys` | `lesson.available` (the gate) | the pointer cursor and the cover animation — **what is permitted** |

They differ by exactly the always-available affordances. Before this, the volumetric valve was drawn with a
default cursor at every step *and dispatched anyway* — the pointer said dead, the click said live.

**The cover animation.** `DeviceModel` plays the unscrew sequence locally and calls `onCoverClick` when it
finishes. Left alone, a blocked click at step 4 would have lifted the plate for a second and dropped it back —
precisely the "moves then snaps back" failure `BEDO-020 §12` names. The animation is now withheld when the
gate would refuse, while the click is still forwarded so the learner gets the notice. This is not the
component deciding legality: the gate decided, and the answer was handed down as data.

Nothing else in the scene changed. The fingerprint is identical in every section.

---

## 9. Remaining direct dispatch paths

Five call sites reach `runtime.dispatch` in `App.tsx`, each audited, and
`tests/unit/domain-boundary.spec.ts` fails if a sixth appears:

| # | Site | Why it is not a bypass |
|---|---|---|
| 1 | inside `interact()` | **the authorised commit point** — the gate has already answered |
| 2 | `applyAdvance()` | replays the commands a *finished step* declares in `onComplete` (`BEGIN_READING`, `END_READING`, the reading setpoint). Authored by the lesson, not the learner. |
| 3 | `handleCalculate()` | immediately after `interact()` returned true, for a command with no apparatus rule |
| 4 | `handleSelectExperiment()` | `SELECT_EXPERIMENT` — session setup. Resets the rig and the lesson; gating it would prevent switching experiment mid-lesson. |
| 5 | `handleSetParams()` | `SET_PUMP_FLOW` — a Custom Parameters value, panel-only, available in both modes. Not an apparatus action and not part of the procedure. |

No component holds the runtime at all. Components receive callbacks from `App`, which a per-file test
asserts — a component that cannot reach `dispatch` cannot open a second path, which is what made `BUG-04`
possible in the first place.

The guided confirm (`OK`) needs no gate: `runner.confirm()` already re-checks `advance.when` before advancing,
so a stale or programmatically-invoked button cannot skip a step. `BEDO-020 §8` is satisfied there by
`BEDO-018`'s design rather than by new code.

---

## 10. Continuous input

`BEDO-020 §13` asks about drag lifecycles. The flow valve is the only candidate and it is **not** continuous:
the 2D control is an `<input type="range">` whose `onChange` fires one `SET_VALVE` per committed value, and
the 3D hotspot is a click that jumps to the step's setpoint. Every input is a discrete setpoint, each gated
independently, so there is no in-flight manipulation that could outlive its permission. Nothing was built for
a lifecycle that does not exist; when `docs/16`'s `rotary` affordance introduces real dragging, the gate is
already the right shape for it — it takes an intent, not an event.

---

## 11. Scope held

Not touched, per `BEDO-020 §18`, `§21`, `§32`: the eleven steps, their ids, numbering, instructions, the
answer sheets, the assessment's separation from the numbered flow, completion semantics, weight placement,
single-weight removal (`BEDO-023`), the video modal, popup z-index, RTL, water, rendering or the camera.

Two observations recorded but deliberately not acted on:

- **Custom Parameters is live during a guided reading.** `SET_PUMP_FLOW` changes `Q_total` and therefore the
  target masses, and the panel is on screen throughout. It is not an apparatus action and gating it was not
  asked for; it is a lesson-design question — should a guided run let the student change the pump? — and
  belongs to whoever owns the lesson content.
- **Guided mode blocks all apparatus actions at steps 9–11.** Those steps invite no apparatus affordance, so
  this follows from the policy rather than being a decision of its own. It is invisible in practice because
  the monitor covers the scene from step 9 onward.

---

## 12. Verification

| | Before | After |
|---|---|---|
| Vitest | 574 | **637** (+63) |
| Playwright | 11 | **13** (+2) |
| Pre-existing tests edited | — | **0** |
| Scene fingerprint | — | **identical in all 10 sections** |
| Draw calls / triangles / FB binds | 769 / 217 055 / 22 | 769 / 217 055 / 22 |
| Boot requests / transfer | 15 / 25.92 MB | 15 / 25.92 MB |
| JS raw | 1 236 770 B | 1 239 070 B (+2 300) |
| JS gzip | 343.82 kB | 344.39 kB (+570 B) |
| CSS | 7 170 B | 7 170 B |

New tests: 35 pure gate tests (`tests/unit/interaction-gate.spec.ts`), 18 integration tests including the
`BUG-04` regression (`tests/integration/interaction-gate.spec.tsx`), 10 boundary and no-bypass audits
(`tests/unit/domain-boundary.spec.ts`), and 2 browser tests — a wrong-step 3D interaction that is refused and
then recovers, and the bilingual lesson notice.

The strongest single result is that **all 574 pre-existing tests pass without a single edit**. A task that
changes interaction behaviour on purpose and breaks nothing that was already asserted is a task that changed
only what it meant to.
