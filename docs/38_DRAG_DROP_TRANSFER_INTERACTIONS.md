# 38 — Drag-and-Drop and Physical Transfer Interactions

**BEDO‑021.** The input half of `docs/16`: the learner can now *drag* a deflector onto the rod, and every
transfer BEDO specifies takes the two seconds BEDO specifies. `BUG‑22` is closed, and `BUG‑19` with it.

> **What this task did not do.** No physics, no water, no weight-position correction, no camera or UI
> redesign, no rendering work. Drag is an input and presentation feature; the rules it reaches are
> `BEDO‑020`'s gate and `BEDO‑022`'s scope rule, unchanged and unduplicated.

---

## 1. Primary sources

Every requirement below is quoted from a BEDO document, not inferred. The storyboard and the four
experiment sheets were re-read for this task from
`Measurement of Jet Forces/Phase 1/Jetforce_Storyboard.pptx` and `.../Phase 2/Exp.*.docx`; the evaluation
is `docs/reference/Bedo Hydraulic Machines Vocational Training.pdf`.

### 1.1 That there should be a drag at all

| Source | Words |
|---|---|
| Evaluation PDF §2b | *"Limited Interactivity: The demo relies solely on basic clicks, **lacking essential features like drag-and-drop**."* |
| Exp. 1, step 2 | *"**Drag** the 90° flat deflector to install it in the rod."* (highlighting on the flat deflector) |
| Exp. 1, step 2, Arabic | *"اسحب العاكس المسطح 90° لتركيبه في العمود من الأسفل."* — *drag … to install it in the rod, from below* |
| Exp. 2, step 2 | *"**Drag** the 120° or 180° semi-circular deflector to install it in the rod."* |
| Exp. 3, step 2 | *"**Drag** the 135° conical surface deflector to install it in the rod."* |
| Exp. 4, step 2 | *"**Drag** the 45° oblique surface deflector to install it in the rod."* |

All four sheets say *drag*. All four say the destination is *the rod*. None describes a wrong drop, a
snap, or a duration for the gesture.

### 1.2 The deflector transfer

| Source | Words |
|---|---|
| Storyboard sl. 7, 8, 14 | *"When the user clicks on the deflector, the deflector moves to the tank to install it in the rod **in 2 seconds**."* — repeated for the flat, oblique, conical, hemispherical and cone deflectors, once each |
| Storyboard sl. 14 | *"The color area is the allowed range for clicking."* |
| Storyboard sl. 31 (state C) | Clickable item *Deflectors* → next state **C** → *"The deflector moved to the tank to install it in the rod."* |
| Storyboard sl. 12 | *"the deflector type … will change only when the tank cover is open and the user clicks on the desired deflector"* |
| Storyboard sl. 23 | *"The led will light in green **after the selected deflector is installed in the rod**."* |
| Storyboard sl. 34 (Error 2) | *"When pressing on the deflector while the tank cover is closed"* → *"Remove the tank cover first"* |

**Source-backed:** the start is the tray, the destination is the rod, the duration is **2 seconds**, the
tank must be open, and installing does not change which state the rig is in (C → C).

**Not in any source:** what happens on a wrong drop, whether it snaps, how a refusal recovers.

### 1.3 The weight transfer

| Source | Words |
|---|---|
| Storyboard sl. 15 | *"When the user clicks on the weight, the weight moves to the tank holder."* (50 g, 100 g, 200 g, 500 g) |
| Storyboard sl. 16 | *"the weight moves to the tank holder **in 2 seconds** after the user enters the values"* (custom weights) |
| Storyboard sl. 29, 30, 32 | Clickable item *Weights* → **D** → *"The weight moved to the tank holder **in 2 sec**."* |
| **Storyboard sl. 32, state D** | Clickable item ***Weights on holder*** → **B** → *"**Click** on the weight on holder — the weight **removed from the tank holder in 2 sec**."* |
| Storyboard sl. 33 (Error 1) | *"When pressing on the weights while the tank cover is opened"* → *"Can't add weight because tank cover is open"* |

**Source-backed:** removal is a **click**, not a drag, and it takes **2 seconds**.

**Not in any source:** where the disc goes afterwards. The document says only *removed from the tank
holder*.

> **BEDO‑021b — the forward transfer is now complete.** This task built the *return* leg only:
> clicking a weight added it to the holder instantly, and only the disc coming **off** was
> animated. The three rows above describing *"the weight moves to the tank holder"* were
> therefore unimplemented, and are recorded in §13 below as such. `BEDO‑021b` closed that —
> a disc now flies **tray → holder** over the same two seconds, to the seat `BEDO‑016`
> measured, and both directions share one pair of anchors. See **`docs/40`**.

### 1.4 Where a source is silent, this is what was chosen

| Question | No source says | Implementation behaviour | Why |
|---|---|---|---|
| Wrong-target drop | — | Nothing is asked of the gate; the deflector animates back to its tray slot | A miss is not a request. Asking the gate would produce a refusal message for something the learner never asked for |
| Recovery duration | — | **0.35 s**, `RETURN_SECONDS` | Deliberately unlike the two seconds that mean *something happened*. A recovery is not a lesson beat |
| Does it snap? | — | Yes, on an accepted drop the flight ends on the installed mesh's own transform | The sheets say *install it in the rod*, and the rig has exactly one rod |
| Where a removed disc goes | — | Back to the tray slot it came from | The only other place it has ever been, and the tray mesh is already hidden while it is loaded — so the return is what makes the tray whole again |
| Drag as a way to remove a disc | — | Supported, and means exactly what the click means | The gesture the client asked for, mapped to the intent the storyboard specifies. It adds no rule |

---

## 2. Architecture

```
   pointerdown / pointermove / pointerup            useObjectDrag        browser
            │                                       (capture, orbit,
            │                                        pointer ownership)
            ▼
   DragSession  ──── resolveDrop ────► DropOutcome  src/interaction/drag.ts
            │                          commit · activate · return · ignored
            ▼
   interactionFor(source) ─────────► Interaction    ← gesture becomes intent, here
            │                        SELECT_DEFLECTOR · REMOVE_WEIGHT
            ▼
   App.interact ──► evaluateInteraction()           src/interaction/gate.ts  (BEDO-020)
            │         apparatus legality, then lesson legality
            ▼
   SimulationRuntime.dispatch() ──► StateMachine    the only commitment
            │
            ▼  accepted? (a boolean, nothing more)
   TransferSet.start(id, kind)                      src/interaction/transfer.ts
            │
            ▼
   ghost wrapper lerps old → new transform          DeviceModel, per frame
```

### 2.1 Files

| File | Lines | What it owns |
|---|---|---|
| `src/interaction/drag.ts` | 210 | **New.** The gesture: session, threshold, ownership, drop resolution, and the one mapping from a drag source to a semantic `Interaction`. Pure — no React, no three.js, no DOM |
| `src/interaction/transfer.ts` | 180 | **New.** Durations, easing, the set of flights in the air, and reading which disc left the holder between two states. Pure |
| `src/components/useObjectDrag.ts` | 235 | **New.** The browser: pointer capture, pointer ownership, OrbitControls suspension, and one teardown every exit path runs |
| `src/components/DeviceModel.tsx` | +430 | Ghosts, the rod's drop region, the transfer frame loop, drop-target highlight, the dev-only screen probe |
| `src/lib/readiness.ts` | +14 | `markTransfer` — one inert data attribute so a browser test need not sleep |
| `src/App.tsx`, `src/components/Scene3D.tsx` | +40 | `onSelectDeflector` / `onRemoveWeight` now **return whether the gate accepted**, which is the only thing the scene is told; plus `deflectorInstalled` and `runId` (§3.1, §10) |
| `src/lesson/runner.ts` | +12 | `hasCompleted(id)` — "the lesson is past this step", the distinction `hasReached` cannot draw (§3.1) |

`src/interaction/drag.ts` and `transfer.ts` are held to the same import rule as the gate:
`tests/unit/domain-boundary.spec.ts` fails if either grows an import of React, three.js or the DOM.

### 2.2 The drag session

```ts
interface DragSession {
  source: { kind: 'deflector'; deflectorId: number } | { kind: 'weight'; index: number };
  pointerId: number;
  startPoint: { x: number; y: number };
  currentPoint: { x: number; y: number };
  isDragging: boolean;        // latched once the threshold is passed
  overValidTarget: boolean;   // feedback only
}
```

Transient input state, and only that. Nothing in it is authoritative about the rig, and discarding it at
any moment leaves the simulation exactly as it was. A deflector is identified by its **angle** (the id
`DEFLECTORS` uses) and a disc by its **stack position** (the identity `REMOVE_WEIGHT` takes) — no mesh
name, no uuid and no three.js object crosses this boundary.

### 2.3 Threshold: click vs drag

```ts
DRAG_THRESHOLD_DEVICE_PX = 8;
MIN_DRAG_THRESHOLD_CSS_PX = 3;
dragThresholdPx(dpr) = max(3, 8 / max(dpr, 1));
```

Held constant in **device** pixels rather than CSS pixels. Pointer coordinates are reported in CSS pixels,
so a hard-coded CSS threshold is a different physical distance on every display — 6 CSS px is 6 device px
on a 1× monitor and 12 on a 2× one, which makes the same wrist movement a click on one machine and a drag
on the next. Pointing precision tracks device pixels, so that is what is held. The floor stops a very high
pixel ratio making the threshold so small that the tremor in an ordinary click registers as a drag.

Below the threshold the release resolves to `activate` — which is the storyboard's own gesture, and puts
the identical `Interaction` to the identical gate.

---

## 3. The deflector: source, target, and what a drop means

### 3.1 Source, and the deflector that was not there

**The defect this task had to fix first.** The scene drew a deflector on the rod as soon as the lesson
*reached* step 2 — `hasInstalledDeflector` was `runner.hasReached('install-deflector')` — and a deflector on
the rod is a deflector missing from the tray. So the disc the sheet names in the very sentence *"Drag the
90° flat deflector to install it in the rod"* was already installed and not there to be dragged. A browser
test caught it: dragging the flat disc did nothing at all, and the gesture fell through to OrbitControls and
orbited the bench instead.

That is BEDO's model back to front. The storyboard's initial state is *"The weights and deflectors on the
table"* (sl. 29, state A), a deflector reaches the rod only when the learner puts it there (sl. 31, state C:
*"The deflector moved to the tank to install it in the rod"*), and the green LED lights *"after the selected
deflector is installed in the rod"* (sl. 23) — all of which presuppose an empty rod beforehand.

The fix is two small, semantic pieces:

- `LessonRunner.hasCompleted(id)` — *the lesson is **past** this step*, as against `hasReached`'s *at or
  past*. Standing on the install step is exactly when the tray must still be full.
- `App` remembers that a deflector **was installed**, set on the gate's acceptance and cleared by Reset.
  A learner who simply presses OK at step 2 has still installed the disc the sheet loads with, which the
  `hasCompleted` fallback covers.

`hasInstalledDeflector` is then `deflectorInstalled || hasCompleted('install-deflector')`, and it means what
it says. The knock-on effects are all improvements: the rod is empty at steps 1–2 as BEDO describes; the
install flight has somewhere to fly *to*; and **free mode now seats a deflector too**, which it never did,
because an accepted selection is an accepted selection whatever the mode.

The source itself is the seven tray discs. A press begins a gesture if the disc is on the tray and the
monitor is not open — and **not** if the gate would refuse it. That is deliberate: a wrong-experiment deflector has to be
pickable so the gate can refuse it and the learner can read why (`§1.4`, `BUG‑05`). Whether an interaction
is *allowed* is the gate's question, and asking it in the input layer would be a second copy of the policy,
which is the shape of both `BUG‑04` and `BUG‑05`.

The cursor still tells the two apart: `actionableKeys` (derived from `LessonView.available`, i.e. from the
gate) decides whether a hovered disc offers a `grab` cursor and a highlight, exactly as `BEDO‑020` left it.

### 3.2 Target — two regions, because BEDO names two

| Region | Measured from | Moves? |
|---|---|---|
| The tank | `JET Force 2_205` | static |
| The rod | `deflector_rod` | rides up with the tank cover |

The experiment sheets say *"install it in **the rod**"* and the storyboard says *"the deflector moves to
**the tank** to install it in the rod"* (sl. 7, 8, 14, and again on sl. 31). The tank is the place you carry
it to; the rod is the seat it ends in. Both are accepted.

That is not generosity for its own sake, and the second region is not decoration — **without it the drag is
impossible at the very step that asks for it.** Measured on the shipped build at 1440 × 900: at step 2 the
plate is unscrewed, the rod rides up with it, and the camera has flown to the tray. The rod then projects to
`(-296, -1858)` — roughly two and a half viewport heights above the top of the screen. The tank projects to
`(210, 9)` and is in frame. A learner cannot aim at a target they cannot see, and neither can a test; see
`§13` for the framing question this leaves open.

Both regions are **measured boxes**, padded 15 %, tested by ray–AABB in the apparatus's own space:

- Not a mesh hit — a single triangle on a thin vertical pin is not something anyone can be asked to hit
  with an object in hand.
- Not spheres — a sphere around a tall glass column is either too small to contain it or wide enough to
  swallow the bench beside it.
- Not hard-coded — derived from real bounds, so a re-exported part takes its region with it and nothing in
  the identity contract changes.
- Local, not world — the rod rides up with the cover and down with the spring, so the live
  `coverOffset + deflection` is added on Y at test time rather than baked in when the scene loaded.

Feedback is the highlight the rest of the scene already uses, applied to **whichever region the pointer is
actually over** — so it is always a part the learner can see. A wrong target never lights.

### 3.3 Valid drop

```
release over the rod
   → onSelectDeflector(id)            App.interact, the one path
   → evaluateInteraction()            apparatus legality, then lesson legality
   → runtime.dispatch()               committed
   → true
   → TransferSet.start('deflector:90', 'deflector-install')     2 s
   → ghost flies from where it was released to the installed transform
   → ghost hidden, installed mesh revealed, same frame
```

The destination is read off the **installed mesh's own resting transform**, not written down anywhere, so
the deflector lands exactly where the already-shipped installed state puts it.

### 3.4 Invalid drop

Released away from the rod: **the gate is never asked.** A miss is not a refused interaction — there is no
notice, no banner, nothing committed, nothing to undo — and the deflector animates back to its tray slot
over 0.35 s.

Released on the rod but refused (wrong experiment, tank shut, wrong step in guided mode): the gate answers,
`App` shows the message it has always shown for that reason, and the deflector animates back the same way.
`DEFLECTOR_NOT_IN_EXPERIMENT` still reads *"This experiment uses a different deflector."*; the five safety
guards still read what BEDO wrote. Nothing about the feedback changed.

### 3.5 Why the drag never moves the real mesh

```
authoritative apparatus state (the GLB's own nodes)
        +
temporary drag presentation transform (a cloned ghost in a wrapper group)
```

While a gesture or a flight is live, **neither** copy of that deflector is drawn — the shelf is empty
because the learner is holding it, the rod is empty because it has not arrived — and a clone rides the
pointer. On commit the ghost is thrown away and the real installed mesh appears, in the same frame, so the
swap is never a blink. On cancel the ghost is thrown away and the tray copy comes back. There is no state
to unwind because none was written: `SimulationRuntime` never sees a pointer coordinate.

---

## 4. Lesson progression: on the accepted action, not on the animation

**Decision: the semantic action commits immediately, and the animation never gates the lesson.**

Reasons, in order of weight:

1. **BEDO's own state machine transitions on the click.** Storyboard sl. 31 lists *Deflectors → C* as the
   transition and *"the deflector moved to the tank to install it in the rod"* as the event. The two
   seconds are the event's animation, not a precondition of the transition.
2. **It is what the runner already does.** `SELECT_DEFLECTOR` calls `runner.notify`, and step 2's
   `advance` is `confirm` — the learner presses OK, as the sheets' *"Press … again"* / numbered-step flow
   expects. Nothing about that changed.
3. **A blocked learner is worse than an early one.** Gating progression on an animation means an
   interrupted or dropped frame can strand the lesson.

So: the runtime is authoritative the instant the gate accepts; the transfer is presentation catching up.

---

## 5. The weight: click, drag, and the two-second return

> **Superseded in part by BEDO‑021b (`docs/40`).** Everything below still holds for the
> removal. What changed is that the *arrival* is now a transfer too, so the flow is
> symmetric: `ADD_WEIGHT` → gate → runtime → `'weight-install'` flight, 2 s, tray slot →
> holder seat. Both directions use `entry.measured` for the tray and `stackSeats` for the
> seat, and both are carried over the shut tank cover rather than through it.

The storyboard's gesture is a **click** and that is what the disc on the holder is: a press and release
under the threshold resolves to `activate`. Pulling it off works too, and means the same thing — one
intent, two ways to express it, no second policy. There is no drop target because there is no destination
in any source; a disc released anywhere is a disc taken off.

```
click or drag-off a disc
   → onRemoveWeight(index)            by stack position — BEDO-022's identity rule, unchanged
   → gate → runtime → true
   → 'weight-removal' flight, 2 s, holder → tray slot
   → tray disc revealed when it lands
```

Duplicate denominations stay distinguishable throughout: the intent carries a **position**, not a mass, so
removing one of two 100 g discs removes one of them and leaves the other. `tests/unit/weight-removal.spec.ts`
and the browser suite both still assert that.

### 5.1 The 2D panel animates too

`REMOVE_WEIGHT` also arrives from the panel's per-disc buttons, which the scene knows nothing about. So the
scene **observes the state transition** rather than being told by whichever control caused it
(`BEDO‑021 §22`): `removedWeightIndex(previous, next)` reads which position emptied, and the flight starts
from there. The panel button and the disc in the tank therefore produce the same two-second move, and
neither surface knows the animation exists.

`REMOVE_ALL_WEIGHTS` — the lesson tidying up between readings — animates nothing. It is not a learner
taking a weight off, and BEDO gives it no transfer.

### 5.2 The deflector needs a second trigger

Removal always changes state, so observing the transition is enough. Selection does not: in Exp. 1 the rig
already carries the 90° flat disc, so installing it is accepted and changes nothing. The scene therefore
starts the install flight on the **gate's `true`**, and the state observer catches the panel's changes.
Both name the same flight id, and starting a flight already in the air is a no-op, so there is exactly one
ghost either way.

---

## 6. OrbitControls

Navigation is suspended for the life of the gesture — **from the press**, not from the moment the threshold
is passed. three's `OrbitControls` begins orbiting on `pointerdown`, so waiting for the threshold means the
first few pixels of every drag also swing the camera. It checks `enabled` in both its `pointerdown` and its
`pointermove` handler, so clearing the flag inside our own `pointerdown` stops it whichever order the two
listeners run in.

`enabled` is restored — to whatever it was, not to `true` — on **every** exit:

| Exit | Restored by |
|---|---|
| Drop accepted | `onPointerUp` → `teardown` |
| Drop refused | `onPointerUp` → `teardown` |
| Dropped on nothing | `onPointerUp` → `teardown` |
| `pointercancel` (touch cancelled by a scroll, a context menu, focus loss) | native listener → `abandon` |
| `lostpointercapture` while the gesture is still open | native listener → `abandon` |
| Component unmount | effect cleanup → `abandon` |
| Reset, experiment switch, mode switch, monitor opened | `drag.cancel()` → `abandon` |

`pointercancel` and `lostpointercapture` are native listeners on the canvas rather than props on the hit
proxy, because R3F handles both itself — it uses them to flush its hover bookkeeping — and never forwards
either to an object's handlers.

There is one regression test per row in `tests/unit/object-drag.spec.tsx`, plus a browser test that drags a
deflector, checks the camera did not move, and then orbits the canvas to check navigation came back.

---

## 7. Pointer capture and multiple pointers

Capture is taken on the canvas at `pointerdown` and released in the single `teardown`, so the gesture
survives the pointer crossing another mesh or leaving the canvas. `capture.current` and `session.current`
are cleared **before** the release call, because `releasePointerCapture` queues a `lostpointercapture`
event and the listener has to be able to tell *the browser took this away* from *we finished with it*.

Desktop is the primary target and no mobile UX is promised, but nothing is built on mouse events:

- Pointer events throughout, so a touch or a stylus behaves rather than throws.
- One gesture at a time. A second pointer landing on another deflector while one is in hand is ignored.
- Moves and releases from a pointer that does not own the session are ignored.
- Secondary buttons do not begin a gesture.
- A browser that refuses to capture still gets a working drag while the pointer stays over the scene.

---

## 8. Accessibility and the 2D fallback

Drag did not make the lesson mouse-only, and nothing was removed to make room for it.

| Path | Deflector | Weight |
|---|---|---|
| Pointer drag (new) | tray disc → rod | disc → anywhere |
| Click in the scene | tray disc | disc on the holder |
| 2D panel — real `<button>`s, in the tab order, `Enter`/`Space` | *Select deflector* list | `+50g` … and *Remove 200 g* per loaded disc |

All three produce the identical `Interaction` and reach the identical gate.
`tests/unit/drag-parity.spec.ts` proves it exhaustively: for every deflector, every step, every experiment,
both modes and both cover states, the decision on the dragged interaction is deep-equal to the decision on
the panel's. The panel remains the accessibility path, the testability path and the recovery path.

A dedicated keyboard *pick-up / put-down* on the canvas itself (`docs/16 §7`: focus, `Enter` on the source,
`Enter` on the target, `Escape` to cancel) is **not** in this task. It needs the focus ring, the roving
tabindex and the announcement layer that `UX‑04`/`BEDO‑036` owns; adding a bare key handler without them
would be an accessibility claim the app could not honour. The panel already gives every action a keyboard
route today, so nothing is unreachable in the meantime.

---

## 9. Guided and Free

**Guided.** A drag only commits when the gate permits it. A wrong-step drag, a wrong-experiment deflector
and a safety refusal all return the object cleanly, and in no case does the apparatus visually reach a
state the runtime rejected — the ghost is a presentation transform and the real mesh never moved.

**Free.** The learner may drag any of the seven deflectors; experiment scope does not apply, which is
`deflectorsSelectableIn`'s existing answer and not a new rule. Apparatus safety still applies: the tank
must be open. Weight removal is likewise purely mechanical.

Free mode also **gains** something it never had: a deflector dragged onto the rod is now visibly on the rod.
It never was before, because `hasInstalledDeflector` asked the lesson runner how far it had got and the
runner idles on step 1 in free mode. Since §3.1 that question is *"has one been installed"*, and an accepted
selection is an accepted selection whichever mode it happened in. The panel's `k` readout and the monitor
followed the choice already; now the apparatus does too.

---

## 10. Interruption

| Event | What happens |
|---|---|
| Reset | `drag.cancel()`, every flight cancelled, every original restored under its normal rule |
| Experiment switch | same |
| Mode switch | same |
| Monitor opened | same |

A restart is signalled by `LessonView.runId`, bumped by Reset and by loading another sheet. Deliberately not
"the step went back to the first one": that would mean the scene following a step number, and a step boundary
is not a restart — cancelling on every one would abort a transfer the learner is still watching.

| Event | What happens |
|---|---|
| Component unmount | same, plus capture released and orbit restored |
| Pointer cancelled mid-drag | gesture abandoned, object returned, nothing asked of the gate |

The scene cannot end with a floating deflector, a half-removed disc, a locked camera or a stale pointer
capture, because all six run the same two routines: `abandon` (input) and `revealAfterFlight` (scene).
`revealAfterFlight` does not remember what it hid — it re-applies the rule that normally governs the part —
so an interrupted transfer lands the scene in exactly the state it would have been in had nothing been
dragged at all.

---

## 11. Performance

- **No new frame loop.** The ghosts are advanced inside `DeviceModel`'s existing `useFrame`.
- **No React renders during a drag.** The session lives in refs and the ghost's `position` is written
  imperatively; state changes twice per gesture (raise, drop), never per pointer move.
- **No hidden duplicate models at rest.** A ghost is created when a gesture starts and disposed when the
  flight lands; at idle the scene contains what it contained before this task.
- **One fewer hit proxy while a disc is loaded.** Hidden tray weights no longer register a proxy at all
  (§12), so idle proxy count is ≤ the previous count, never more.
- The transfer stopwatch runs on **real** delta, like the unscrew sequence, so BEDO's two seconds are two
  seconds and not two seconds' worth of clamped frames.
- The `data-bedo-transfer` attribute is written only when the answer changes, never per frame.

Measured on the shipped build, headless Chromium/SwiftShader, 1440 × 900:

| | Draw calls | Triangles | Scene objects | Meshes | Mean rAF |
|---|---|---|---|---|---|
| Idle, step 1 | 769 | 217 055 | 290 | 219 | 456 ms |
| Idle, step 2 (plate up) | — | — | 290 | 219 | 735 ms |
| **Carrying a deflector** | — | — | **294** | **221** | 670 ms |
| **Mid two-second transfer** | — | — | **294** | **221** | 642 ms |
| Idle, installed | 769 | 217 055 | 290 | 219 | 623 ms |

Idle draw calls, triangles, framebuffer binds (22) and shader programs (42) are **identical to the frozen
baseline** (`docs/11 §2`), and the scene fingerprint matches `after-bedo022.json` in all ten sections apart
from the JS chunk's content hash. The +4 objects / +2 meshes while carrying are the ghost's wrapper group
and the cloned deflector; they exist only between `pointerdown` and the flight landing. The rAF intervals
are within the software renderer's own noise — the drag samples are lower than the idle ones — so there is
no measurable per-frame cost to a gesture. JS grew 10 KB (1 240 895 → 1 251 320 B).

---

## 12. `BUG‑19`, and why it had to be fixed here

> *Hidden tray weights remain clickable (invisible click targets).* — `docs/audit/03 BUG‑19`

A tray disc's mesh is hidden the moment its denomination is on the holder, while its click proxy carried on
firing, so a learner could keep adding discs that visibly were not there. That was a nuisance with a click.
It would be worse now: a drag has to start from something the learner can see and pick up, and starting one
on an invisible object is not a gesture anybody can make sense of.

The fix is one predicate — `hiddenTrayWeightGrams` — read by **both** the renderer and the hit test, so the
two cannot drift apart again. It also covers the new case: a disc on its way back to the tray is hidden for
the two seconds it is in flight, so it is never in two places at once.

Deliberately **not** widened. `BUG‑19`'s general form is `docs/16 §5`'s rule that a proxy exists only while
its affordance is enabled, which belongs with the affordance registry. This is the weights, because the
weights are what BEDO‑021 touches.

---

## 13. Known issues left alone

| Issue | Why not here |
|---|---|
| `BUG‑02` — the pan sits ~2.18 m from where the weights are placed | A coordinate-system correction. This task animates between the existing source and destination anchors and moves neither (`BEDO‑021 §25`). **Closed by `BEDO‑016` — `docs/39`** |
| The **tray → holder** transfer the storyboard specifies four times | Not built here; adding a weight was instantaneous. **Closed by `BEDO‑021b` — `docs/40`** |
| The removal's path passes through the closed glass tank | Not noticed here. The pan is above the shut cover and the discs are beside the tank, so a straight line clips it. **Closed by `BEDO‑021b`**, which carries both directions over the lid |
| `BUG‑18` — the cursor is written to `document.body` | The canvas-cursor fix is `docs/16 §6`. This follows the existing convention rather than half-changing it; every path that sets it also clears it |
| `docs/16 §5` hit geometry — one clamped sphere per part | Unchanged. The rod's **drop** region is a measured sphere, but the hit proxies are as `BEDO‑020` left them |
| Keyboard pick-up / put-down on the canvas | `UX‑04` / `BEDO‑036` — see §8 |
| The affordance registry (`docs/16 §2`) | Still not started. Drag is wired to the existing hotspots, not to a registry |

---

## 14. Validation

| Gate | Result |
|---|---|
| `tsc -p tsconfig.app.json --noEmit` | clean |
| `tsc -p tsconfig.test.json` | clean |
| `oxlint` | 2 warnings, both pre-existing (one is `scripts/`, one a `pick` dependency this task reduced from two occurrences to one) |
| Vitest | **798 passed**, 30 files — the 737 that existed before, unedited bar one module-list update, plus 61 new |
| Playwright, stub model | 17 passed, 5 skipped (the drag suite, which needs the real asset) |
| Playwright, `BEDO_E2E_FULL_MODEL=1 drag.e2e.ts` | **6 passed** — real pointer drags against the 26 MB apparatus |
| Production build | clean; `__bedoTest` absent from `dist/` (`bundle.spec.ts`) |
| Scene fingerprint | identical to `after-bedo022.json` bar the JS chunk hash |
| Perf baseline | 769 draws / 217 055 tris / 22 FB binds / 42 programs — the frozen baseline exactly |
