# 16 — Interaction Engine

**Principle:** interaction emits **intent**. It never decides whether the intent is legal. One contract for
every interactable; no per-mesh bespoke handlers.

---

## 1. What is wrong today

- 15 invisible spheres, sized by one clamped heuristic (`radius = clamp(bbox·0.6/scale, min, 0.18)`), sit in
  front of the model. The cover's clamps to 0.18 model units ≈ **0.32 m world**, large enough to swallow
  clicks meant for the rod, pointer or deflectors behind it.
- `onPointerOver` checks `liveKeys`; **`onClick` does not** (`DeviceModel.tsx:1172‑1186`). Guided gating is
  therefore cosmetic, and a two-click dead end is reachable (`BUG‑04`).
- `document.body.style.cursor` is mutated globally and can stick on `pointer` forever (`BUG‑18`).
- Hidden tray weights keep firing, so the student can add discs that visibly do not exist (`BUG‑19`).
- The only interaction verb is *click*. The evaluation document's second complaint is precisely
  *"relies solely on basic clicks, lacking essential features like drag-and-drop"*.
- No keyboard path at all, and two of the twelve steps have no DOM equivalent (`UX‑04`).

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

---

## 4. Affordance kinds

| Kind | Gestures | Used by | Spec note |
|---|---|---|---|
| `button` | click, `Enter`/`Space` | power switch, cover, monitor, OK | Power switch rotates 90° (storyboard sl. 29) |
| `rotary` | click-to-toggle, drag-around-axis, arrow keys | flow valve, volumetric valve | *"rotates 90° counterclockwise … for opening"* (sl. 16) |
| `lever` | drag along an axis, arrow keys | — reserved | |
| `transferable` | click → **2 s animated move** | deflectors, weights | *"moves to the tank holder in 2 sec"* (sl. 14–16) |
| `draggable` + `dropTarget` | pointer drag, or keyboard pick-up/put-down | deflector → rod, weight → pan | **Explicitly required** by the evaluation PDF §2b and the Exp. sheets |

### 4.1 Resolving click vs drag

The two authoritative sources disagree, and both are satisfiable:

- **Storyboard (implementation spec):** click → the object moves itself in 2 s.
- **Experiment sheets + evaluation PDF (client requirement):** *drag* the deflector onto the rod.

**Design:** `transferable` supports **both**. A press-and-release performs the 2 s animated transfer; a
press-and-move begins a drag with a live ghost and a highlighted drop target. Keyboard `Enter` on the source
then `Enter` on the target performs the same transfer accessibly. One affordance, three input paths, one
intent. This closes `BUG‑22` without contradicting either document.

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
