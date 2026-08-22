# 16 — Interaction Engine

**Principle:** interaction emits **intent**. It never decides whether the intent is legal. One contract for
every interactable; no per-mesh bespoke handlers.

> **Partly implemented.** `BEDO-020` built the **gate** at the bottom of this pipeline — the single policy
> every 2D control and every 3D hotspot now asks — and closed `BUG-04`. See `docs/36`. `BEDO-021` then built
> the **gesture layer and the 2 s transfer** at the top of it, closing `BUG-22` and `BUG-19`; see `docs/38`.
> What remains is the affordance registry, general hit geometry, the canvas cursor and keyboard parity.
> Section 9 below records the split precisely.

---

## 1. What is wrong today

- 15 invisible spheres, sized by one clamped heuristic (`radius = clamp(bbox·0.6/scale, min, 0.18)`), sit in
  front of the model. The cover's clamps to 0.18 model units ≈ **0.32 m world**, large enough to swallow
  clicks meant for the rod, pointer or deflectors behind it.
- ~~`onPointerOver` checks `liveKeys`; **`onClick` does not** (`DeviceModel.tsx:1172‑1186`). Guided gating is
  therefore cosmetic, and a two-click dead end is reachable (`BUG‑04`).~~ **Fixed by `BEDO-020`:** every click
  passes `evaluateInteraction()` before anything is committed, and the cursor now reads the gate's answer
  rather than the step's highlight, so an always-available part is no longer drawn as dead. `docs/36 §8`.
- `document.body.style.cursor` is mutated globally and can stick on `pointer` forever (`BUG‑18`).
- ~~Hidden tray weights keep firing, so the student can add discs that visibly do not exist (`BUG‑19`).~~
  **Fixed by `BEDO-021` for the weights:** one predicate, `hiddenTrayWeightGrams`, is read by both the
  renderer and the hit test, so a disc that is on the holder — or on its way back to the tray — has no proxy
  at all. The general rule (§5: a proxy exists only while its affordance is enabled) still awaits the
  registry. `docs/38 §12`.
- ~~The only interaction verb is *click*. The evaluation document's second complaint is precisely
  *"relies solely on basic clicks, lacking essential features like drag-and-drop"*.~~ **Fixed by
  `BEDO-021`:** a deflector is dragged onto the rod, a disc is pulled off the holder, and both gestures
  resolve to the same intents the click always sent. `BUG‑22` is closed. `docs/38`.
- No keyboard path at all, and two of the eleven steps have no DOM equivalent (`UX‑04`).

---

## 2. The affordance contract

Every interactable — mesh or DOM — registers one descriptor:

```ts
export interface Affordance {
  id: EquipmentRef;                       // 'cover' | 'valve.flow' | 'weights.50' | …
  kind: 'button' | 'rotary' | 'lever' | 'draggable' | 'dropTarget' | 'transferable';

  /** Where it is. Resolved from measured geometry, never hard-coded. */
  target: { mesh: MeshRef; hitShape: 'auto' | HitShape };

  /** What touching it means. The engine does not know if it is allowed. */
  intent: (gesture: Gesture) => Intent | null;

  /** Accessibility contract — REQUIRED, not optional. */
  a11y: { label: LocalisedText; role: 'button' | 'slider' | 'switch'; keyboard: KeySpec };

  /** For rotary/lever only. */
  range?: { from: number; to: number; axis: 'x' | 'y' | 'z'; snap?: number[] };

  /** For draggable/dropTarget only. */
  accepts?: EquipmentRef[];
}
```

**The `a11y` field is mandatory.** A part that cannot be described and operated from the keyboard cannot be
registered. That is how `UX‑04` and `UX‑12` are fixed structurally rather than by remembering.

---

## 3. Pipeline

```
pointer / keyboard / DOM control
        │
        ▼
  GestureRecogniser        hover · press · click · dragStart/Move/End · wheel
        │
        ▼
  Affordance.intent()      gesture → Intent | null
        │
        ▼
  IntentBus.emit(intent)
        │
        ├─► LessonRunner.isAllowed(intent) ──► false ──► FeedbackBus: 'unavailable' + coaching
        │                                                (never silence — eval PDF §2c)
        └─► true
                │
                ▼
        SimulationRuntime.dispatch(intent)
                │
                ├─► Outcome.ok    ──► FeedbackBus: 'correct'  + domain events
                └─► Outcome.error ──► FeedbackBus: 'error'    + the state machine's message
```

**Exactly one gate**, consulted by every input path. The DOM button and the 3D mesh cannot diverge.

**This part exists** (`BEDO-020`). The pipeline above is drawn with the lesson gate first; the implementation
asks the apparatus first, and `docs/36 §5` gives the reasoning — `attempt()` is pure, so the order costs
nothing, and the safety guard is the more useful sentence when both would refuse. The implemented shape is:

```
2D control / 3D hotspot → App.interact(interaction)
                            → evaluateInteraction({interaction, apparatus, step, lesson, mode})
                                 ├── apparatus legality  → RejectionReason      (red banner)
                                 └── lesson legality     → LessonBlockReason    (blue notice)
                            → runtime.dispatch(...)  → runner.notify(...)
```

`Intent` in this document is `Interaction` in the code, and it is already a semantic intent rather than an
event — which is what lets the gesture layer below be added without the policy changing.

---

## 4. Affordance kinds

| Kind | Gestures | Used by | Spec note |
|---|---|---|---|
| `button` | click, `Enter`/`Space` | power switch, cover, monitor, OK | Power switch rotates 90° (storyboard sl. 29) |
| `rotary` | click-to-toggle, drag-around-axis, arrow keys | flow valve, volumetric valve | *"rotates 90° counterclockwise … for opening"* (sl. 16) |
| `lever` | drag along an axis, arrow keys | — reserved | |
| `transferable` | click → **2 s animated move** | deflectors, weights | *"moves to the tank holder in 2 sec"* (sl. 14–16); the **reverse** is sl. 32's *"click on the weight on holder — the weight removed … in 2 sec"*. `BEDO-022` implemented the semantics and **`BEDO-021` the animation** — `src/interaction/transfer.ts`, `docs/38 §1.2-1.3` |
| `draggable` + `dropTarget` | pointer drag, or keyboard pick-up/put-down | deflector → rod, weight → pan | **Explicitly required** by the evaluation PDF §2b and the Exp. sheets. **Pointer drag done** (`BEDO-021`); keyboard pick-up/put-down on the canvas is still `UX‑04`'s, and the 2D panel is the keyboard route meanwhile — `docs/38 §8` |

### 4.1 Resolving click vs drag

The two authoritative sources disagree, and both are satisfiable:

- **Storyboard (implementation spec):** click → the object moves itself in 2 s.
- **Experiment sheets + evaluation PDF (client requirement):** *drag* the deflector onto the rod.

**Design:** `transferable` supports **both**. A press-and-release performs the 2 s animated transfer; a
press-and-move begins a drag with a live ghost and a highlighted drop target. Keyboard `Enter` on the source
then `Enter` on the target performs the same transfer accessibly. One affordance, three input paths, one
intent. This closes `BUG‑22` without contradicting either document.

**Implemented in `BEDO-021`**, exactly as designed above for the two pointer paths. `resolveDrop` returns
`activate` for a press-and-release under the threshold and `commit` for a drag onto the target, and
`interactionFor` — which is given the *source* and never the outcome — maps both to the same `Interaction`.
`tests/unit/drag-parity.spec.ts` walks every deflector × step × experiment × mode × cover state and asserts
the gate's decision is deep-equal for the dragged and the clicked interaction. The keyboard leg is served by
the 2D panel today; a canvas-native pick-up/put-down waits on the focus and announcement layer (`docs/38 §8`).

---

## 5. Hit geometry

Replace the single clamped-sphere heuristic with per-part hit shapes resolved from measured bounds:

```ts
type HitShape =
  | { shape: 'sphere';  scale?: number }
  | { shape: 'box';     padding?: number }
  | { shape: 'cylinder'; axis: 'x'|'y'|'z'; padding?: number }
  | { shape: 'mesh' };                       // raycast the real geometry
```

Rules:
- `auto` derives a **box** from the part's measured bounds plus a small padding — a far better fit than a
  sphere for plates, levers and discs.
- Overlapping proxies are resolved by **smallest volume first**, not draw order, so a small lever in front of a
  large plate wins.
- A proxy is registered **only while its affordance is enabled**, which removes the invisible-but-clickable
  class of bug (`BUG‑19`) by construction.
- Minimum screen-space size is enforced at ~24 px so small parts stay clickable when the camera is far.

---

## 6. Hover, cursor and highlight

- Hover state lives in a **transient store slice** subscribed to by the outline effect only. It never triggers
  a React render of the scene tree (`PERF‑13`).
- The cursor is set on the **canvas element**, from a `useEffect` with a cleanup, derived from hover state —
  not written imperatively to `document.body` (`BUG‑18`).
- Highlighting is an **outline**, not an emissive repaint. See `docs/17 §6`. The storyboard's phrase is
  *"The color area is the allowed range for clicking"* — the highlight marks the clickable region, it does not
  repaint the part blue (`RND‑05`).

---

## 7. Keyboard parity

| Interaction | Keyboard |
|---|---|
| Focus next interactable | `Tab` / `Shift+Tab` through a roving-tabindex list ordered by lesson relevance |
| Activate button | `Enter` / `Space` |
| Rotary / slider | `←` `→` (fine), `Home` / `End` (limits), `PageUp/Down` (coarse) |
| Transfer | `Enter` on source → target list announced → `Enter` on target |
| Cancel a drag | `Escape` |
| Named camera views | `1`–`4` |
| Reset view | `0` |

Every affordance is mirrored by a DOM control in `ui/controls/`, so the canvas is always an enhancement.

---

## 8. Tests

| Suite | Asserts |
|---|---|
| `affordance.spec.ts` | Every registered affordance has a resolvable mesh, a hit shape, and a complete `a11y` descriptor |
| `gating.spec.ts` | A disallowed intent never reaches `dispatch`; **`BUG‑04` regression**: clicking the cover at step 2 produces coaching feedback and does not toggle the cover |
| `intent.spec.ts` | Each gesture maps to the expected intent; drag and click produce the *same* intent |
| `parity.spec.ts` | **Every apparatus action is reachable from the DOM** — enumerates affordances and asserts a matching control exists. This is the `UX‑04` regression guard. |
| `hitshape.spec.ts` | Overlap resolution picks the smallest volume; disabled affordances are unregistered |


---

## 9. Implementation status

| Piece | Status |
|---|---|
| **One gate for every input path** | **done** — `src/interaction/gate.ts`, `BEDO-020`, `docs/36` |
| Lesson vs apparatus legality kept separate | **done** — distinct reason types, distinct presentation |
| Guided / Free policy | **done** |
| Always-available affordances | **done** — read from `Lesson.alwaysAvailable`, nothing hardcoded |
| Semantic intents (not events) | **done** — the gate takes an `Interaction`, never a gesture |
| Actionable vs asked-for, exposed to the scene | **done** — `LessonView.available` |
| Coaching feedback on a blocked intent | **minimal** — one typed reason, one sentence, bilingual. The toast/audio/animation system is still a separate task. |
| Weight removal as an affordance | **done** — `REMOVE_WEIGHT` by stack position, gated on the same `weights` affordance as adding one, from panel and scene alike (`BEDO-022`, `docs/37 §8-10`) |
| Deflector scope as a *value* rule | **done** — the one place the gate looks past the affordance group, because a tray of seven discs is one group with seven meanings (`BUG-05`) |
| **Pointer drag-and-drop (§4)** | **done** — `src/interaction/drag.ts` + `src/components/useObjectDrag.ts`, `BEDO-021`, `docs/38` |
| **Click and drag produce one intent (§4.1)** | **done** — `interactionFor(source)`; proved exhaustively against the gate |
| **2 s physical transfers (§4)** | **done** — `src/interaction/transfer.ts`; the duration is BEDO's, quoted in `docs/38 §1` |
| **Drop target resolved from measured bounds (§5)** | **done, for the rod** — a bounding sphere off `deflector_rod`, tested in apparatus space so it rides the cover |
| **Disabled affordances unregister their proxy (§5, `BUG‑19`)** | **done, for the weights** — one predicate for the renderer and the hit test |
| **OrbitControls coordination** | **done** — suspended for the gesture, restored on every exit including cancel and unmount |
| `Affordance` registry (§2) | not started |
| `GestureRecogniser` as a general recogniser (§4) | partial — drag is a session model, but rotary/lever gestures are still discrete setpoints |
| Hit geometry (§5) | not started for the hit proxies — still the clamped-sphere heuristic |
| Cursor on the canvas rather than `document.body` (§6, `BUG‑18`) | not started — drag follows the existing convention rather than half-changing it |
| Keyboard parity (§7) | not started on the canvas; every action has a DOM control today (`docs/38 §8`) |

The gating tests in §8's table now exist as `tests/unit/interaction-gate.spec.ts` and
`tests/integration/interaction-gate.spec.tsx`, including the `BUG‑04` regression described there. §8's
`intent.spec.ts` exists as `tests/unit/drag.spec.ts` (gesture → intent) and `tests/unit/drag-parity.spec.ts`
(drag and click produce the *same* intent, and the same gate decision), joined by
`tests/unit/transfer.spec.ts`, `tests/unit/object-drag.spec.tsx` and `tests/e2e/drag.e2e.ts`. The
`affordance`, `parity` and `hitshape` suites await the registry.
