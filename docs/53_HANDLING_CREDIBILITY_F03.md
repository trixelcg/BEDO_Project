# 53 — Deflector and weight handling credibility (F03)

Branch `model/bedo-model-02`, on top of `0ebd3f9` (production revision `00178-xug`).
Working-tree change, not committed, not deployed.

**Observed (QA, F03):** deflectors can move off-axis or appear to float during changeover.
Weight installation/removal does not always follow a believable pick–place–stack sequence;
removed weights can remain loose and stacked weights do not always read as seated/snapped.

## 1. What was actually wrong — measured in the running app

Every number below was taken from the local dev build in Chrome, by stepping the R3F frame
loop and reading the scene each frame, in apparatus-local millimetres.

| # | symptom | proven cause | measurement (before) |
|---|---|---|---|
| 1 | Deflector floats away from the rod | The fitted deflector's height was **damped** toward `holderLift` while the rod was set directly, so it trailed whenever the rod moved. | Rod-to-deflector gap −12.2 mm at rest, **+230 mm** for ~0.5 s after the cover opens. |
| 2 | Deflector changeover teleports | On a swap the old deflector was hidden from the rod and shown back on the tray in the same frame; only the new one moved. | Old deflector: rod → tray in 1 frame. |
| 3 | Deflector off-axis on the way in | One eased straight line from the tray to the rod. It converged on the axis only at the very end, arriving from the side. | 304 mm → 0 off-axis linearly; 51 mm off-axis 0.5 s before landing. |
| 4 | Deflector passes through parts | The straight line crossed the pointer post (`JET Force 2_212`) and pointer arm, which stand 63 mm in front of the rod axis. | AABB contact with both. |
| 5 | 45° deflector snaps orientation | The tray copy is stored turned over (22.8×22.8×32.4 mm vs 32.4×23.7×32.2 mm fitted); the flight only translated it. | 98.4° pose change in one frame on arrival. |
| 6 | Disc arrives sideways through the post | Straight line + half-sine arc: the disc was 20–60 mm off the post axis while already below the post tip. | Post passing through the disc face for the last ~0.4 s. |
| 7 | Removing a lower disc pulls it out from under others | Any disc could be removed; the discs above dropped into place in one frame while the removed one flew out sideways through them and the post. | 100 g disc dropped 6.5 mm in 1 frame. |
| 8 | "Clear all" teleports | `REMOVE_ALL_WEIGHTS` had no transfer at all. | All discs pan → tray in 1 frame. |
| 9 | Dragged disc duplicated / drag could not remove | While a pan disc was held its seat still drew it (two copies); and a held disc counted as "departing", which disabled removal, so releasing it always sent it back. | Two copies while held; release never removed. |

## 2. Corrections

* **`src/lib/handlingPath.ts` (new, pure).** Every transfer is planned as
  *depart → carry → approach*: a vertical lift out of wherever the part rests, a carry along a
  cubic Bézier whose end legs are vertical, and a final **vertical move along the destination's
  axis** — down the post for a disc, up onto the bottom of the rod for a deflector. The carry
  gets the smallest half-sine lift that keeps the part's underside over every obstacle (tank,
  disc column on the pan, pointer post and arm, measured live). Each phase is eased rest to
  rest; time is shared by √length so short precise moves are not rushed.
* **Controlled route (QA follow-up, the red line in the QA screenshot).** Every flight now has
  a set *travel height* (`planHandling({ travelHeight })`), so the carry no longer drifts
  sideways while it is still rising or already descending:
  * **disc on:** straight up out of the tray slot (20 mm) → up and over at
    `travelHeightOver(from, to, 50 mm)` → lined up over the post above its tip → straight
    down the post onto its seat;
  * **disc off / Clear all:** the reverse — straight up the post until clear of the tip →
    over → straight down into its own tray slot;
  * **deflector on:** straight up off the tray (25 mm) → level carry at the height 60 mm
    under the fitted position → lined up under the rod → straight up onto the rod (one turn);
    **off** is the mirror image. The deflector flights stay under the rod the whole time, so
    they never cross the raised pan, spring or pointer.
  The Bézier controls sit vertically above the depart/approach points at the travel height,
  so the curve leaves and arrives vertically — measured: a disc drifts < 15 mm sideways over
  its first 100 mm of rise, and is exactly on the post axis from the tip down.
* **`src/lib/rigidFit.ts` (new, pure).** Horn's quaternion method recovers the exact rigid
  transform between a deflector's tray copy and fitted copy (same vertex order). The 45°
  deflector turns over during the carry; flights hang the clone from its point on the rod
  axis, so turning and threading never move it off the axis.
* **`src/interaction/transfer.ts`.** `start(id, kind, delay)`, `fractionOf`, `remainingOf`;
  new kind `deflector-removal` (1.4 s — implementation timing, BEDO specifies only the 2 s
  install); `STACK_CLEAR_STAGGER_SECONDS`.
* **`DeviceModel.tsx`.**
  * Fitted deflector rides `holderLift` exactly (no damping).
  * Swap = the fitted deflector unthreads down the axis (one turn) and goes back to its own
    tray slot; the new one waits on the tray, then lifts, turns into its fitted pose, lines up
    60 mm under the rod and threads up (one turn). Drag-installing a swap holds the new part
    until the old one is off. Reversing a swap mid-flight turns the part round where it is.
  * Disc on: lifted 20 mm out of its slot, over the tank, over the post, straight down.
    Rapid adds may overlap in the air, but each disc reaches the post tip only after the one
    before it has landed.
  * Disc off / Clear all / the lesson clearing the pan: straight up the post until clear of
    the tip, over the tank, set down into its tray slot; a cleared stack comes off top first,
    one disc at a time, and the discs still waiting keep pressing on the spring.
  * Hand drag of the top disc: constrained to the post axis until clear of the tip, then eases
    to the pointer; its seat is drawn empty while held; releasing it removes it.
* **`UIOverlay.tsx`.** Only the top disc's remove button is enabled; the others stay listed,
  disabled, titled "Take off the weights above N g first" (Arabic included).

## 3. Behaviour change to review

**Discs now come off last-on, first-off** — in the 3D scene and in the panel — because they
are threaded on the post. The domain (`stateMachine.ts` `REMOVE_WEIGHT`) still accepts any
index and its tests are untouched; the rule is enforced where the learner interacts. If the
product wants any-disc removal back, it is `index === stack.length - 1` in `DeviceModel.tsx`
(two places) and `onTop` in `UIOverlay.tsx`. Updated for it: `tests/integration/
deflector-scope.spec.tsx` (two cases + one new) and `tests/e2e/lesson.e2e.ts` (overload
recovery now removes 50 g then 200 g).

## 4. Evidence (after)

| check | result |
|---|---|
| Rod-to-deflector gap while the cover opens (416 frames) | constant −12.16 mm |
| Deflector approach phase, off-axis | 0.0 mm (unit: < 1e-9 m) |
| Arrival pose vs fitted mesh (45°, per vertex) | 0.00 mm |
| Swap 90→45→135→30→180: AABB contact with pointer post, arm, tank, raised cover | none (≈2,500 frames) |
| Contact with the rod | only while threading on/off (first ~100 ms of removal, last ~130 ms of install) |
| Disc add 50/500/10, remove top, Clear all: contact with post, arm, cover, tank | none (≈2,000 frames) |
| Disc below the post tip while off-axis | never (on-axis 0.0 mm) |
| Clear all, disc–disc overlap | none; starts at 0.06 / 0.56 / 1.10 s, top first |
| Hand drag of top disc | stays on axis until clear; 150 g → 50 g on release; tray disc re-shown |

Contact sheets of the four sequences were captured from the dev build at exact frame times.

### 4a. QA acceptance criteria — after the controlled-route change

Measured in the local dev build (Chrome, free mode), stepping the R3F frame loop and reading
the scene every frame in apparatus-local space. Contact = live AABB overlap (−0.5 mm
tolerance) with the pointer pin, pointer arm, tank and tank cover.

| criterion | browser measurement | unit test (`f03-acceptance.spec.ts`) |
|---|---|---|
| **AC1** deflector centreline on the nozzle/jet axis, on its mount | 10 swaps (45, 135, 180, 30, 90, 45, 120, 60, 135, 90): fitted centre 0.000–0.001 mm off the nozzle axis; rod end 11.7 mm inside the deflector (12.0 mm below its top) for all but 60° (see §7); every outgoing deflector ends on its own tray slot; contacts: none | centre < 0.5 mm for all; rod end inside the fitted part; tray → fitted is a rigid move (residual < 0.5 mm); approach phase on the axis; ends on the fitted centre |
| **AC2** no hovering between stack locations | stack 50/50/50/200/10: every disc–disc gap 1.000 mm; 0 frames with a disc below the post tip while off the axis; contacts: none | every seat 1 mm above the one below; lined-up point above the tip; lands exactly on the seat; on the axis for the whole descent |
| **AC3** repeated weights, consistent spacing | 3 × 50 g: pitch 6.506 / 6.506 mm (5.506 mm disc + 1 mm) | four identical discs of every denomination: one constant pitch, one axis |
| **AC4** removal returns to storage | −10 g: ends 0.2 mm from its tray slot, tray disc shown again; Clear all (4 discs): top first (200 g lands at frame 80, then the 50 g discs at 96 / 114 / 134), each on its tray slot (≤ 0.1 mm); contacts: none | ends exactly on the tray slot; leaves straight up the post, clear of the tip before moving sideways |

Route traces (red, one yellow dot every 4 frames) drawn over the rendered frames:
`F03-evidence/5-weight-on-redline-route.png`, `6-weight-off-redline-route.png`,
`7-deflector-swap-route.png`.

## 5. Tests

* `tests/unit/handling-path.spec.ts` (new): 27 cases — on-axis arrival and departure, no
  collision with post/pan/stack (cylinder model), over the tank, over the pointer post and
  arm, below the rod until lined up, continuity, rest at waypoints, phase timing, lift
  hand-over, delayed flights, `remainingOf`, rigid fit.
* `tests/unit/handling-path.spec.ts` now 29 cases (adds "rises almost straight up out of the
  tray before it moves across" and "never comes at the stack from the side"; continuity is a
  speed cap, < 1.5 m/s).
* `tests/unit/f03-acceptance.spec.ts` (new): 17 cases, the four QA acceptance criteria
  against the shipped GLB (see §4a).
* `tests/unit/switch-weight-visibility.spec.ts`: the slot-visibility expectation follows the
  held-disc change (`!inFlightSeats.has(index) && !heldSeats.has(index)`).
* Ran here: `f03-acceptance.spec.ts` 17/17, `handling-path.spec.ts` 29/29,
  `switch-weight-visibility.spec.ts` 15/15, earlier `handling-path.spec.ts` 27/27 and the existing `transfer.spec.ts` 27/27 (pure
  modules, via a local runner — the npm registry was unreachable from this environment).
  `tsc` clean on the new pure modules under the project's flags.

## 6. Not verified here — run before merging

`npm run test:ci` (typecheck, oxlint, full vitest, Playwright). In particular
`weight-transfer.e2e.ts`, `drag.e2e.ts`, `lesson.e2e.ts` and `camera-follow.e2e.ts` exercise
these flights with a real pointer; their assertions are about destinations and timing, which
are unchanged, but they have not been run against this change.

## 7. Noticed, not changed

* **60° deflector mount (model data):** the authored fitted copy `Cone_surface_deflector_60.001`
  has its flat top face flush with the rod end (0.17 mm overlap); every other deflector is
  authored threaded ~12 mm onto the rod. It touches the rod, so it does not float, but it
  does not read as screwed on. That is the GLB's fitted pose, which the simulator reproduces
  exactly; changing it is a model fix.

* **F04** (the 10/20/25 g discs reused `Weight_Custom`, as thick as the 500 g): resolved in
  `docs/54_WEIGHT_FAMILY_F04.md`.
* The panel's **Open/Close tank cover** snaps the cover (no unscrew animation); only the 3D
  click animates it. The deflector now stays on the rod either way.
