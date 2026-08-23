# 42 — Power switch direction, and loaded-weight visibility

Two reported presentation defects. **One was real; the other was not**, and the measurement
that settled it is the substance of this document.

| Reported | Verdict |
|---|---|
| The power switch rotates in the wrong visual direction | **Real — and worse than reported.** The *axis* was wrong, not the sign. Fixed. |
| Loaded weights disappear when the camera moves, though still loaded in state | **Disproven — no defect.** The discs never vanish and never change identity under camera movement. What the learner sees is the canonical lesson clearing the pan at the reading boundary; the camera flying at the same instant is coincidental. Canonical behaviour preserved. |

No physics changed. No lesson changed.

---

## 1. The switch — reproduction

Measured from the live scene before any edit, at `1edc8c7`.

| | Value |
|---|---|
| Node | `Power_Switch` (GLB node 144, top-level) |
| Node-local T | `(−0.353453, 0.961298, −0.421208)` |
| Node-local R | quaternion `(0.179758, 0.683877, −0.179757, 0.683877)` |
| Pivot | `Power_Switch__pivot` — a `Group` at the knob's bounding-box centre, **identity rotation** |
| OFF pivot rotation | `[0, 0, −0.003894]` (≈ 0) |
| ON pivot rotation | `[0, 0, −1.566903]` (≈ −90°) |
| Marker vertex, OFF → ON | `(−0.652354, −0.103683, −0.766454)` → `(−0.670924, −0.053034, −0.766454)` |
| **Motion** | **Z constant; X and Y change** — the knob turned about the world Z axis |

The semantic state was correct throughout: `isPowerOn` flipped as expected and the green
lamp lit. Only the rendering was wrong.

**What it looked like.** At OFF the knob is an upright red disc on the yellow panel. At ON
it collapsed to a **flat ellipse lying down** — it had tipped out of the panel rather than
turning in it.

---

## 2. Resolving the contradictory source

The storyboard appears to contradict itself:

| Evidence | Observed direction | Confidence |
|---|---|---|
| **Storyboard sl. 29** (state A, *switch off*) — *"The red power switch is off. (Rotate it smoothly 90 degrees **clockwise** to turn it on.)"* | clockwise → ON | **High.** Describes a transition that actually exists from the state being documented |
| **Storyboard sl. 30** (state B, *switch on*) — *"The red power switch is on. (Rotate it smoothly 90 degrees **anticlockwise** to turn it on.)"* | anticlockwise → ON | **Low.** Describes turning **on** a switch it has just said is *already on*. Not a transition that exists |
| **Switch mesh geometry** — bbox 29.8 × 43.8 × 45.0 mm, thinnest across X; round in the YZ plane | Settles the **axis**, not the direction | **High.** Measured from the shipped GLB |
| **`apparatusView.FRONT`** — the operator stands at −X looking along +X | Fixes what "clockwise" means | **High.** Already established and tested |
| Storyboard sl. 16 (valve) — "counterclockwise… opening / clockwise… closing" | Opposite directions for opposite transitions | Supporting |
| Reference video `Bedo_Mesu_J.mp4` | **Not obtainable.** No `ffmpeg` in this environment and headless Chromium cannot decode the file's H.264 | — |
| Reference simulator stills | Show the results UI only; no switch | — |

**Resolution: sl. 29 wins.** Sl. 30 is sl. 29's sentence copied and half-edited — "off"
became "on" and "clockwise" became "anticlockwise", but "to turn it on" was left behind. Read
as *"…anticlockwise to turn it **off**"*, the two slides agree perfectly and describe one
switch: **clockwise on, anticlockwise off.** That is a resolution grounded in the text, not
a coin toss between two equal readings.

---

## 3. Root cause

**The rotation axis was wrong.**

The knob is a disc 44 mm across and 30 mm deep, and its thin dimension is **X**. X is
therefore the axis it faces along, and the operator stands at −X looking down +X. A disc
spins about the axis it faces along. Turning it about **Z** — the operator's left-to-right
axis — tips it out of the panel, which is what the marker measurement shows and what the
screenshot confirms.

A sign flip would not have fixed it. It would have tipped the knob the other way.

---

## 4. Old → new

```ts
// before
const target = state.isPowerOn ? -QUARTER_TURN : 0;
powerPivot.rotation.x = 0;
powerPivot.rotation.z = damp(powerPivot.rotation.z, target, 12);

// after
powerPivot.rotation.z = 0;
powerPivot.rotation.x = damp(powerPivot.rotation.x, powerSwitchTurn(state.isPowerOn), 12);
```

| | Axis | OFF | ON |
|---|---|---|---|
| Before | Z | 0 | **−90°** |
| After | **X** | 0 | **+90°** |

**Why positive.** Clockwise, for an eye at −X looking along +X, is a *positive* turn about
X: the right-hand rule carries +Y to +Z, and for that observer +Y is up and +Z is to the
right — up-to-right is clockwise. A test asserts this from the geometry rather than from the
word.

The mapping now lives in `apparatusView.powerSwitchTurn(isPowerOn)`, so it is a pure
function a test can state. Damping (`damp(..., 12)`) is unchanged — this is not an animation
redesign.

**Verified after the change:** marker `X` is now **constant** (Δ = 0.000000) and the motion
is entirely in the YZ plane; the turn is 90°; ON → OFF returns to rest. The knob no longer
flattens.

---

## 5. The weights — reproduction attempt

Full model, measured live. Loaded a single disc, multiple discs, and **duplicate 50 g
discs**, then recorded every property §4 of the brief asks for at each stage.

| Stage | Discs | `visible` | Parent chain | `frustumCulled` | Positions | **UUIDs** |
|---|---|---|---|---|---|---|
| 3 loaded (50/100/50) | 3 | true | visible | true (three.js default) | correct seats | `97a51779 bf50fcab 50db4cb4` |
| Camera dollied **back** | 3 | true | visible | true | unchanged | **same** |
| Camera **orbited** | 3 | true | visible | true | unchanged | **same** |
| Camera **returned** | 3 | true | visible | true | unchanged | **same** |
| Flow n = 0.4 | 3 | true | visible | true | unchanged | **same** |
| Flow n = 0.8 | 3 | true | visible | true | **all rose +0.04569 together** | **same** |
| Monitor **open** | 2 | true | visible | true | unchanged | **same** |
| Monitor **closed** | 2 | true | visible | true | unchanged | **same** |
| Guided step 6, camera back + orbit | 3 | true | visible | true | unchanged | **same** |

Opacity 1, not transparent, in scene, correct layers, bounding sphere 2.89 against a
5.74-unit disc — correct, so culling had nothing to work around.

**The discs never disappeared and never changed identity.** Same UUIDs throughout rules out
React remounting; `visible` and the parent chain rule out a visibility predicate; stable
positions and correct bounds rule out a transform or culling fault.

---

## 6. What the learner is actually seeing

In guided mode, pressing **OK** to complete a balance step:

```
Step 6 / 11   runtime total "80"   discs 3   ✅ visible
   ↓ press OK
Step 7 / 11   runtime total  —     discs 0
```

The discs go **and the runtime goes with them**. That is the canonical lesson's own step
definition (`src/lesson/currentLesson.ts`):

```ts
{ id: 'balance-reading-1', … onComplete: [{ type: 'END_READING' }, { type: 'REMOVE_ALL_WEIGHTS' }] }
{ id: 'balance-reading-2', … onComplete: [{ type: 'END_READING' }, { type: 'REMOVE_ALL_WEIGHTS' }] }
```

The lesson tidies the pan between readings — and the camera flies to the next step at the
same instant, which is why it reads as "the camera moved and the weights vanished". The
camera is a coincidence, not a cause.

**Root cause category: none of A–F.** It is (G) *not a rendering defect at all* — it is
correct, specified behaviour being misattributed.

---

## 7. The weight report, resolved

**Disproven.** There is no camera-caused disappearance, and there is no rendering defect of
any kind behind the report.

| Suspected cause | Verdict |
|---|---|
| React remounting | **Ruled out** — every disc kept its UUID across dolly, orbit, return, flow change, monitor toggle and guided-step camera flights |
| `visible = false` / a visibility predicate | **Ruled out** — `visible` and the whole parent chain stayed true at every sample |
| Frustum culling | **Ruled out** — bounds are correct (2.89 sphere against a 5.74-unit disc); `frustumCulled` is left at the three.js default and appears nowhere in the component |
| Material / opacity | **Ruled out** — opacity 1, not transparent, throughout |
| Transform / bounding volume | **Ruled out** — positions unchanged to 1e-6, and under a flow change all three discs rose together by the same 0.04569 |
| A stale `inFlightSeats` | **Ruled out** — the seat un-hides on arrival and stays un-hidden |

**What actually happens.** The canonical lesson clears the pan at each reading boundary:

```ts
{ id: 'balance-reading-1', … onComplete: [{ type: 'END_READING' }, { type: 'REMOVE_ALL_WEIGHTS' }] }
{ id: 'balance-reading-2', … onComplete: [{ type: 'END_READING' }, { type: 'REMOVE_ALL_WEIGHTS' }] }
```

That is deliberate, specified behaviour. The discs leave the holder because the **runtime**
removed them, not because anything failed to draw — the panel total empties in the same
frame. The camera flies to the next step at that same instant, which is the whole reason the
two read as cause and effect. **The camera movement is coincidental.**

**Decision: canonical lesson behaviour is preserved.** `REMOVE_ALL_WEIGHTS` and step
progression are unchanged by this task. Whether a learner should keep their weights across a
reading boundary is a lesson-content question (`docs/32`, `docs/35`, BEDO-019) that four
suites pin, and it is settled as "no change" rather than left open.

What this task did add is the guard: tests that fail if a loaded disc ever becomes
camera-dependent again — one asserting the stack render consults nothing but
`inFlightSeats`, and a full-model browser test that dollies, orbits, returns and changes the
flow against a three-disc stack containing duplicates, requiring every disc to hold its seat
to 1e-6.

---

## 8. The visibility lifecycle, as it stands

```
ADD_WEIGHT accepted
  → tray → holder transfer (2 s); the seat is empty and un-clickable while it flies
  → disc arrives: visible, clickable, seated on the BEDO-016 pan anchor
  → stays visible through camera movement, orbit, zoom, flow change, monitor toggle,
    spring deflection and cover lift, riding the holder
  → REMOVE_WEIGHT / REMOVE_ALL_WEIGHTS / reset / experiment switch
  → holder → tray transfer, or immediate reconciliation for a clear
  → gone
```

One gate, and only one: `visible={!inFlightSeats.has(index)}`. Tests now assert that the
stack render mentions no lesson step, no camera, no panel state and no tray state, that
`frustumCulled` appears nowhere, and that a disc is keyed by `${index}-${grams}` — stack
position and mass, neither of which a camera can change.

---

## 9. Results

| Check | Result |
|---|---|
| Camera back | 3 discs, same UUIDs, positions unchanged |
| Orbit | 3 discs, same UUIDs, positions unchanged |
| Camera returned | 3 discs, same UUIDs, positions unchanged |
| Flow 0.4 → 0.8 | all 3 rose together by 0.04569, still on the pan axis |
| Monitor open/close | unchanged, same UUIDs |
| Single / multiple / duplicate | all persist; duplicates keep distinct seats |
| Switch OFF → ON → OFF | X constant, 90°, returns to rest |
| Scene fingerprint | identical to BEDO-017 bar the chunk hash (at rest the switch is at 0 either way) |
| Idle performance | **769 draws / 217,055 tris / 22 binds / 42 programs** — unchanged |

No new render loop, no new draw call, no duplicated meshes, `frustumCulled` untouched.

---

## 10. Open

1. **The reference video could not be read** in this environment (no `ffmpeg`; headless
   Chromium cannot decode its H.264). The switch direction rests on sl. 29 plus geometry,
   which is sound, but a frame of the real rig being switched on would settle it beyond
   argument.
