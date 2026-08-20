# 18 — Camera System

**One controller. Named semantic views. The lesson requests intent, never a position.**

---

## 1. What is wrong today

- `CameraRig` and `OrbitControls` both write `camera.position` and `controls.target`, coordinating through a
  `pending` ref and an abort listener — two controllers sharing one camera (`RND‑11`).
- Nine per-step anchors with hand-tuned offsets and no framing intent: no target FOV, no "keep the tank in
  shot", no collision avoidance, no awareness of the 380 px sidebar covering the subject (`RND‑14`).
- Verified results: step 3 frames the cover **against the sky** with no tank visible; steps 5, 6 and 8 put the
  camera **inside the bench cabinet** with the near plane clipping the cabinet wall.
- Steps 5→9 fly *under the bench → up to the tank → under the bench → up to the tank* — four full traversals in
  five steps (`RND‑13`).
- `OrbitControls` bounds are wrong for an interior: `maxDistance 8` lets the student orbit outside the room and
  look at the backs of the walls (visible because everything is `doubleSided`); `minDistance 0.6` pushes the
  camera through the bench. No `minPolarAngle`, no pan bounds, no reset (`RND‑12`).
- No `prefers-reduced-motion` handling and no way to disable camera automation — a vestibular accessibility gap
  (WCAG 2.3.3).

---

## 2. What the reference actually specifies

Storyboard slides 26–27 define **four named camera views**, reached by clicking a **camera icon**, each with a
"next view" and a "previous view":

| View | Frames |
|---|---|
| `deflectorsAndWeights` | the tray of deflectors and the weight set |
| `pointer` | the pointer and the balance scale |
| `tank` | the tank, jet and deflector |
| `softwareMonitor` | the data screen |

**There is no per-step camera flight in the reference.** The nine-anchor system is an invention, and it is the
source of the disorientation. Adopting the four named views is both more faithful and a large simplification.

Add one more for the operator's default:

| View | Frames |
|---|---|
| `overview` | the whole bench from where the operator stands (−X, per `apparatus.ts:269`) |

---

## 3. Design

```ts
export type NamedView = 'overview' | 'deflectorsAndWeights' | 'pointer' | 'tank' | 'softwareMonitor';

export interface ViewSpec {
  /** What must be visible — resolved from measured bounds, not hard-coded positions. */
  subject: EquipmentRef[];
  /** Additional geometry that must stay in frame so the student keeps their bearings. */
  context?: EquipmentRef[];
  /** Direction to approach from, in apparatus-local space. */
  approach: Vector3Tuple;
  /** Fraction of the *unoccluded* viewport the subject should fill. */
  fill?: number;              // default 0.55
}
```

The director computes the position rather than storing one:

```ts
function frame(view: ViewSpec, viewport: Viewport): { position: Vector3; target: Vector3 } {
  const bounds  = unionBounds([...view.subject, ...(view.context ?? [])]);
  const sphere  = bounds.getBoundingSphere();
  const safeFov = effectiveFov(viewport);              // accounts for the UI-occluded region
  const dist    = sphere.radius / Math.sin(safeFov / 2) / (view.fill ?? 0.55);
  const pos     = sphere.center.clone().addScaledVector(dir(view.approach), dist);
  return { position: avoidGeometry(pos, sphere.center), target: sphere.center };
}
```

This structurally fixes three defects:
- **subject + context** means a landmark is always in frame — no more "cover against the sky".
- **`avoidGeometry`** ray-casts from the target toward the proposed position and pulls the camera back outside
  any solid it would sit inside — no more "camera inside the cabinet".
- **`effectiveFov`** accounts for occlusion (see §5).

---

## 4. Single controller

`CameraDirector` **owns** the camera. `OrbitControls` is mounted with `makeDefault` but is driven through the
director, never alongside it.

```ts
interface CameraDirector {
  goTo(view: NamedView, opts?: { instant?: boolean }): Promise<void>;
  focus(ref: EquipmentRef): Promise<void>;
  fit(refs: EquipmentRef[]): Promise<void>;
  reset(): Promise<void>;
  cycle(direction: 1 | -1): void;     // the storyboard's camera-icon behaviour
  readonly state: 'idle' | 'transitioning' | 'userControlled';
}
```

**State machine.** `idle → transitioning` on request; `transitioning → userControlled` if the student grabs the
view (the existing abort-on-`controls.start` behaviour is correct and is kept); `userControlled → idle` on
`reset()` or a new explicit request. The lesson may *suggest* a view; a student who has taken control is never
yanked back mid-gesture.

**Transitions.** Position and target eased together, ~1.0 s, `easeInOutCubic`, frame-rate independent, with
`invalidate()` requested only while a transition or damping is active (`docs/17 §3`).

---

## 5. Viewport occlusion

The training rail occupies a fixed region of the viewport. The director accounts for it via
`camera.setViewOffset`, so the subject is centred in the **visible** area rather than the full canvas
(`RND‑14`). At 1920×1080 with a 380 px rail this shifts the optical centre by 190 px; at 1366×768 the rail
narrows and the offset follows.

---

## 6. Bounds

Constrained to the operator's working volume rather than the room:

| Constraint | Value | Reason |
|---|---|---|
| `minDistance` | 0.8 | Prevents pushing through the bench |
| `maxDistance` | 3.0 | Prevents orbiting outside the walls |
| Polar angle | 0.15π – 0.55π | Keeps a plausible standing eye height; no floor-cam, no ceiling-cam |
| Azimuth | front 180° | The rig faces −X; every other side is its back or a wall |
| Pan | clamped to a box around the bench, or disabled | Prevents losing the apparatus entirely |
| Near / far | 0.05 / 50 | Near plane tight enough for close-ups without z-fighting |
| Damping | 0.05, enabled | Unchanged — it is correct today |

---

## 7. Lesson integration

A step declares `view: 'tank'` — a **semantic** name, not a position. The director resolves it against current
measurements and viewport. Consequences:

- Steps that share a view produce **no camera movement at all**. With the four reference views, the flow-valve
  and balance steps stop ping-ponging (`RND‑13`).
- Re-exporting the model moves the anchors automatically; no constants to re-tune.
- The camera icon lets the student cycle views manually, as the reference intends.

---

## 8. Accessibility and preferences

| Setting | Behaviour |
|---|---|
| `prefers-reduced-motion: reduce` | All transitions become instant cuts. Automatic view changes are suppressed unless the student presses the camera control. |
| "Camera follows the lesson" toggle | User-facing preference, persisted. Default on; off means the lesson only *suggests* a view via a subtle affordance. |
| Keyboard | `1`–`4` named views, `0` reset, arrow keys orbit, `+`/`−` dolly — all within the same bounds. |
| Announcements | A view change announces its name to the live region ("View: tank"). |

---

## 9. Tests

| Suite | Asserts |
|---|---|
| `framing.spec.ts` | For every named view: subject fully inside the unoccluded viewport; context ≥ 1 landmark visible; distance within bounds |
| `collision.spec.ts` | **`RND‑11` regression** — for every view, the computed position is not inside any apparatus/bench mesh |
| `occlusion.spec.ts` | With a 380 px rail at 1920×1080, 1440×900 and 1366×768, the subject's screen-space centre lies in the visible half |
| `controller.spec.ts` | Only one writer touches `camera.position` per frame; user interrupt cancels a transition; reset restores overview |
| `reducedMotion.spec.ts` | With the media query forced, no interpolated transition occurs |
