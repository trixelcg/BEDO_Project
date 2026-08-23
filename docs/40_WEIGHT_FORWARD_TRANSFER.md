# 40 — The weight's forward transfer (BEDO‑021b)

`BEDO‑021` built the disc coming **off** the holder. This is the disc going **on**, which
BEDO's storyboard specifies four times over and which the application had been performing
instantly.

```
BEDO-021    holder → tray    ✅
BEDO-021b   tray → holder    ✅  ← this task
```

No physics, no lesson, no gate, no camera, no water. See §15 for what was left alone.

---

## 1. Primary source

Read directly from `Jetforce_Storyboard.pptx` — the real 69 MB deck, not a summary. The
copy in `docs/reference/` is a 165‑byte stub, so the source used is the original at
`Measurement of Jet Forces/Phase 1/Jetforce_Storyboard.pptx`. Text and table structure were
extracted from the OOXML directly, so the **column** each sentence sits in is known, which
turns out to decide the whole design (§4).

### Slide 15 — interaction table

Columns: `Game object | Image | Details | Animation`.

| Game object | Details | **Animation** |
|---|---|---|
| Weights (50 gm) | The color area is the allowed range for clicking | *"When the user clicks on the weight, the weight moves to the tank holder."* |
| Weights (100 gm) | " | *(identical)* |
| Weights (200 gm) | " | *(identical)* |
| Weights (500 gm) | " | *(identical)* |

### Slide 16 — the duration

| Game object | Details | **Animation** |
|---|---|---|
| custom Weights | The color area is the allowed range for clicking | *"When the user clicks on the weight, the weight moves to the tank holder **in 2 seconds** after the user enters the values."* |

### Slides 29, 30, 32 — the state machine

Columns: `Clickable Item | Next State | Transition | Event`.

| State | Clickable | Next | **Transition** | **Event** |
|---|---|---|---|---|
| A — initial | 4. Weights | **D** | Click on the weight | *"The weight moved to the tank holder in 2 sec."* |
| B — trainer operated | 4. Weights | **D** | Click on the weight | *"The weight moved to the tank holder in 2 sec."* |
| D — weights on holder | 4. Weights | **D** | Click on the weight | *"The weight moved to the tank holder in 2 sec."* |
| D | 5. Weights on holder | **B** | Click on the weight on holder | *"The weight removed from the tank holder in 2 sec."* |

### Slide 19 — the spring

> **Deflector spring** — *"According to the equation of X = hF − hw. The deflector spring
> moves downward when the weights are **placed on the holder** and moves upward when the
> weights are **removed from it**."*

### Slide 7 — the equations

The `Condition` column for both `mT = Ʃmy/1000` and `Fac = mT × g` reads
*"When the user clicks on the weight, the weights move to the tank holder."*

### What this settles

| Question | Answer | Source |
|---|---|---|
| Starting location | The weight on the table | sl. 15 game objects; sl. 29 *"The weights and deflectors on the table"* |
| Destination | The tank holder | sl. 15, 16, 29, 30, 32 |
| Duration | **2 seconds** | sl. 16; sl. 29/30/32 |
| Gesture | **A click.** Not a drag | sl. 15/16 *Details*: "the allowed range for clicking"; every state row's *Transition* is "Click on the weight" |
| State changes when | **On the click** | The click is the *Transition*; the movement is the *Event* |
| One at a time? | Not stated either way | — |

**No drag was introduced** (§23 of the brief): BEDO's explicit drag requirement is for the
deflector, and every weight row in the source says *click*.

### The Unity original has nothing to add

`Project_VL-FM009` and `Bedo_Unity/Measurement_of_jet_forces` were both checked. They carry
the device's FBX, textures and materials, and no weight behaviour at all — no animation
clip, no PlayMaker FSM, no script. The jet‑force experiment was never implemented there,
which is why this rebuild exists. **The storyboard is the sole behavioural source.**

---

## 2. Duration

**2 seconds**, unchanged, and shared with every other transfer BEDO specifies:

```ts
export const TRANSFER_SECONDS = 2;
'deflector-install': TRANSFER_SECONDS,
'weight-install':    TRANSFER_SECONDS,   // ← new
'weight-removal':    TRANSFER_SECONDS,
```

Slide 32 lists the two weight moves as one pair on one state, so they get one duration. A
test asserts `durationOf('weight-install') === durationOf('weight-removal')`.

---

## 3. What was missing

`TransferKind` was `deflector-install | weight-removal | return-to-source`. There was no
forward kind and no observer for an arrival: `ADD_WEIGHT` committed and the disc was drawn
on its seat on the next frame. The `E-added` capture in `measurements/weights/before/`
is that behaviour — a disc simply present, one second after the click, with nothing having
moved.

---

## 4. Sequencing — the decision

**Chosen: the runtime commits on the click; the disc takes two seconds to get there.**
Option A of the brief's §12, and it is what the source describes rather than a convenience.

### The evidence

1. **The state tables put the state change on the click.** `Transition` — the thing that
   causes the move to the next state — is *"Click on the weight"*. `Event` — what the
   learner then sees — is *"The weight moved to the tank holder in 2 sec."* Those are two
   different columns and they say two different things.
2. **Slides 15 and 16 file the sentence under `Animation`,** beside a `Details` column that
   only says where the learner may click. The two seconds are explicitly described as the
   animation.
3. **The deflector already works this way.** `SELECT_DEFLECTOR` commits on the click and
   `BEDO-021` animates the install over two seconds, from the identically-worded sl. 7/8/14.
   A weight is the same sentence about a different object.

### Why it is also the right engineering

- **Safety.** The gate must decide at the moment of the gesture. Deferring the commit would
  let an accepted action land after the state that authorised it had changed — a learner
  could click a weight, open the tank cover during the two seconds, and the disc would
  arrive anyway, straight through BEDO's own Error 4, *"Can't add weight because tank cover
  is open"*.
- **Determinism.** `BEDO-021 §22` is explicit that elapsed time stays out of
  `SimulationRuntime`. Committing on arrival would put an animation clock in charge of
  domain state, and the lesson, the readings and the CSV with it.
- **Symmetry.** Removal already commits first. Giving the two directions opposite semantics
  for no source reason would be its own defect.

### The one thing that had to move

Slide 19 says the spring reacts when a weight is **placed on the holder** — not when it is
clicked. Under a commit‑first design the naive reading of `loadedWeightsG` would compress
the spring while the disc was still visibly on the bench, which is the impossible sequence
the brief's §12 warns about.

So the **visual** spring is driven by the mass physically on the pan:

```ts
const seatedMassG = state.loadedWeightsG.reduce(
  (total, massG, index) => (inFlightSeats.has(index) ? total : total + massG),
  0
);
```

`loadedWeightsG` is untouched, so the measured force, the balance window, the readings and
the export are byte‑identical. Only where the disc *is* affects where the spring *sits*.
And it is symmetric: a disc lifted off leaves the seated mass at once, so the spring rises
the moment it is picked up — *"moves upward when the weights are removed from it"*.

---

## 5. Runtime commit timing

On the click, through the unchanged path:

```
tray disc / panel button / keyboard
        ↓  one semantic action
   ADD_WEIGHT
        ↓
  InteractionGate            (BEDO-020, unchanged)
        ↓  accepted
  SimulationRuntime          (append to loadedWeightsG, unchanged)
        ↓  the scene observes the transition
  2 s tray → holder transfer (new)
        ↓
  disc on its BEDO-016 seat
```

No `START_WEIGHT_ANIMATION` or `FINISH_WEIGHT_ANIMATION` exists. `ApparatusAction` is
unchanged. Nothing in `src/domain`, `src/simulation` or `src/lesson` was edited at all —
**all 825 pre‑existing tests pass unedited**, which is the evidence that the semantic layer
never learned about this.

---

## 6. Lesson advancement

Unchanged, and no lesson code was touched.

The two weight steps are `balance-reading-1` and `balance-reading-2`. Their `isSatisfied` is
`readingBalanced(n)` — *not* "a weight was added" — and both advance on `kind: 'confirm'`,
meaning the learner presses OK. So nothing auto‑advances because a disc was clicked, and the
brief's §13 worry about advancing "to a balance/reading state while the required disc is
still visibly in flight" cannot arise: the learner does the advancing.

The balance indicator does turn green on the click rather than on the landing, because the
runtime is authoritative and the source puts the state change on the click (§4). In practice
the two seconds elapse while the learner is reading the indicator and reaching for OK.

---

## 7. The anchors

Both directions resolve through `BEDO-016`'s measurements. **There is no third coordinate.**

| | Tray → holder | Holder → tray |
|---|---|---|
| `from` | `entry.measured` — the disc's own baked tray position | the stack seat |
| `to` | `stackSeats(...)[index].centre` — the stack seat | `entry.measured` |

`entry.measured` is the clone's detached bounding‑box centre: where the disc's geometry
already is, so a disc's home needs no computing and cannot drift. The seat comes from
`stackSeats`, the same function that positions the rendered disc, its click proxy and the
start of a removal.

A test asserts the pair directly — `install.to === removal.from` and
`install.from === removal.to` — and the browser test asserts the same thing at runtime by
reading each flight's actual destination out of the live scene.

**The holder moves during the flight.** The pan rides the cover and the spring, so an
arrival carries `liftsWithCover`, and `holderLift * progress` is added per frame rather than
baked in at launch — the mechanism `BEDO-021` already used for the deflector. No
world‑matrix traversal was added.

---

## 8. Duplicate discs

Preserved exactly. `addedWeightIndex` answers with a **stack position**, never a mass, so
adding a second 50 g disc gives it the seat above the first. Seats are `t + 1 mm` apart and
a test asserts three distinct heights for `[50, 50, 100]`; the browser test adds two 50 g
discs and asserts they share an axis and differ in height.

---

## 9. The route

BEDO specifies the move and the duration and says **nothing** about the path, so this is
implementation, documented here because it is not source‑backed.

A straight line will not do. A weight may only be added while the tank cover is **shut**
(the state machine rejects `ADD_WEIGHT` otherwise — Error 4), and the weight pan is on the
rod **above** that shut cover while the discs are on the bench beside the tank. Measured on
the shipped model, the direct line from the 50 g tray slot to the first seat is inside the
tank's bounding box for `t ∈ [0.57, 0.84]` — the middle third of the flight. A test asserts
that clipping exists, so the arc can never be mistaken for decoration.

`src/lib/transferPath.ts` therefore lifts the disc **over** the lid:

```
y(t) = lerp(fromY, toY, t) + height · sin(π t)
```

- `height` is the **smallest** that keeps the disc above `tankCoverTop + 10 mm` at every
  sampled point where its footprint is over the tank. Derived from the measured tank and
  cover, never chosen; zero when the direct path is already clear.
- The footprint is widened by the disc's own radius, so *all* of it clears, not its centre.
- `sin(π t)` is zero at both ends, so the disc still leaves its tray slot and arrives at its
  seat at exactly the measured anchors — **no route offset survives the landing** (§25 of
  the brief), which a test asserts.

**This also fixes the removal**, which has been passing a disc through the glass since
`BEDO-021` shipped. One lid, one clearance, both directions — §19 below records it as a
defect found and fixed rather than a change of aesthetics.

A deflector is untouched: it is installed through the *open* cover and goes straight to the
rod. `directionOf(kind)` is what tells the two apart, and it returns null for a deflector.

---

## 10. Visibility, frame by frame

The requirement (§17 of the brief) is that one disc is never drawn twice. Measured from the
live scene by `scripts/weight-transfer.mjs`, sampling until the app's own marker goes idle:

### Adding

| Sample | Marker | Ghost | Seat drawn | Seat's proxy | Tray disc drawn |
|---|---|---|---|---|---|
| #0 | active | `(0.2159, 0.3508, −0.0928)` | **no** | **no** | **no** |
| #1 | active | `(0.0539, 0.8270, −0.3545)` — over the lid | **no** | **no** | **no** |
| #2 | active | `(0.018173, 0.786775, −0.412133)` — the seat | **no** | **no** | **no** |
| #3 | active | — | **yes** | **yes** | no |
| #4 | idle | — | yes | yes | no |

### Removing

| Sample | Marker | Ghost | Seat | Tray disc drawn |
|---|---|---|---|---|
| #0 | active | `(0.2269, 0.2766, −0.0751)` | gone | **no** |
| #1 | active | — | gone | **yes** |
| #2 | idle | — | gone | yes |

The tank cover's top is at world `y = 0.6935`; sample #1 of the arrival is at `0.8270`,
comfortably over it. The disc's first sample is the tray anchor to six decimals and its last
is the seat to six decimals.

**Two one‑frame duplicates were found and fixed while measuring this:**

1. The arrival and removal observers were passive effects, so the browser painted one frame
   with the disc on its seat (or the tray disc back) before the ghost existed. Both are now
   `useLayoutEffect`, which puts the ghost on screen in the same commit as the state change.
2. The frame loop decided tray visibility from a `useMemo` over `ghosts` **state**, which
   lags `loadedWeightsG` by a render. It now reads `ghostsRef.current`, which the observer
   fills synchronously. Before the fix a removal showed the tray disc and the ghost together
   for a frame — visible for ~600 ms at the frame rate a 26 MB model reaches on a software
   renderer.

---

## 11. Concurrency

| While… | Add | Remove |
|---|---|---|
| nothing in flight | ✅ | ✅ |
| a disc is **arriving** | ✅ | ❌ |
| a disc is **departing** | ❌ | ❌ |

**Adding stays open while discs arrive**, deliberately deviating from the brief's "one at a
time" default. The hard requirement — *"do not allow two animations to claim the same stack
seat"* — is satisfied by construction: the runtime commits each disc on its own click, so
every disc already owns a distinct seat before it launches. Balancing a reading means three
or four discs in quick succession (80 g is 50 + 20 + 10), and making the learner wait two
seconds between each, with the controls silently inert, would be its own defect.

**Removal waits for a settled pan.** That is the case that genuinely cannot be allowed: a
removal renumbers the stack under a disc still travelling to a seat identified by number,
and it also collides in the `weight:${index}` id namespace. Blocking it removes both.

This is presentation policy and never reaches the gate — nothing is being *disallowed*, it
simply has not finished happening. `WeightAvailability` is reported out of the scene, and
both surfaces obey it: the 2D removal buttons and *Clear all weights* are `disabled` while
anything is in flight, so a control that cannot act does not look as though it can.

---

## 12. Interruption

| Event | Behaviour |
|---|---|
| **Reset** | `runId` bumps; every flight is cancelled and `revealAfterFlight` reconciles each disc to the rule that normally governs it. |
| **Experiment switch** | The same path. |
| **Guided ↔ Free** | The same path. |
| **Monitor opened** | The same path. |
| **`REMOVE_ALL_WEIGHTS` mid‑flight** | A new reconciliation: any arrival whose seat index no longer exists is cancelled and its disc returned to the tray at once. This is what a reading step does when it ends, so it happens in the normal run of the lesson. |
| **Unmount** | The cleanup effect runs; nothing is left holding a clone. |
| **Pointer cancel** | Untouched — a semantically accepted transfer is not a gesture and does not care. |

**No late callback can add a weight.** A cancelled flight is deleted from the `TransferSet`
before it settles, so no arrival is ever reported for it; and nothing about arrival mutates
runtime state in any case, because the disc was committed on the click (§5). That is a
second, structural reason the failure mode the brief's §16 warns about cannot occur here.

---

## 13. Tests

**Unit — 855 total, up from 825.**

| File | Adds |
|---|---|
| `tests/unit/transfer.spec.ts` | `weight-install`'s duration and its equality with removal; `directionOf`; `addedWeightIndex` including duplicates, clears and non‑additions, and that it inverts `removedWeightIndex`; one flight per id; concurrent arrivals; cancellation delivering nothing |
| `tests/unit/weight-transfer.spec.ts` *(new)* | Both directions share one pair of anchors; a roundtrip for every denomination; duplicates get distinct seats; **the straight line provably clips the tank**; every disc clears the lid by the stated margin at every sampled point; the arc is symmetric, contributes nothing at either end, and is zero on a clear route |

`tests/unit/weight-transfer.spec.ts` measures the shipped GLB in place rather than by
cloning, because the tank — unlike the rod and the weights — is **not** a top‑level node: it
sits under a parent that scales it by a hundred, so a detached clone lands seventy units
away. That cost one debugging round and is written down in the spec.

**Browser — `tests/e2e/weight-transfer.e2e.ts` (new), full model.**
A disc flies on in two seconds and lands on its seat; the same disc flies home and its
flight is aimed at the tray anchor to six decimals; duplicates get their own seats;
removal is disabled while anything is in flight while adding stays enabled; a reset
mid‑flight strands nothing.

---

## 14. Scene fingerprint and performance

### Fingerprint — empty baseline

```
diff measurements/fingerprint-after-bedo016.json measurements/fingerprint-after-021b.json
1010c1010
<       "/assets/index-C4Q7PJXT.js",
---
>       "/assets/index-CO2xmjhW.js",
```

**One line: the JS chunk's content hash.** Renderer, four lights, apparatus transform, 33
tracked mesh world transforms, 16 hotspots, cover glass, `envMapIntensity` census, camera,
request list — all byte-identical to `BEDO-016`. 290 objects, 0 failed requests, 0 console
errors.

### Fingerprint — settled loaded states

Every settled state is identical to `BEDO-016` as well, object for object:

| State | Objects | Draw calls | Triangles |
|---|---|---|---|
| A empty | 287 → 287 | 308 → 308 | 86 958 → 86 958 |
| B one disc | 290 → 290 | 308 → 308 | 86 958 → 86 958 |
| C three discs | 296 → 296 | 308 → 308 | 86 958 → 86 958 |
| D duplicates | 297 → 297 | 310 → 310 | 88 158 → 88 158 |
| G spring lifted | 290 → 290 | 314 → 314 | 91 170 → 91 170 |

The only states that differ are the two captured **mid‑transfer**, and they differ only in
weight objects: a ghost wrapper exists and the arriving seat has given up its click proxy.
That is exactly the difference §27 of the brief permits.

### Idle performance — unchanged

| | Value | BEDO‑016 |
|---|---|---|
| Draw calls / frame | **769** | 769 |
| Triangles / frame | **217 055** | 217 055 |
| Framebuffer binds / frame | **22** | 22 |
| Shader programs | **42** | 42 |

**Nothing new runs at idle.** No `useFrame` was added — the arrival rides the loop that was
already advancing flights. The arc is sized **once per flight** (48 samples of a straight
line, no allocation) and evaluated as one `sin` per frame per disc in the air. No permanent
proxy was added; the in‑flight seat actually gives one *up* while its disc travels.

**During a transfer** the cost is one ghost: `+3` objects for the wrapper, its recentring
group and the clone, and the extra draw calls a disc costs — the same as `BEDO-021`'s
removal, which has been paying it since it shipped. It is released the frame the disc
lands.

---

## 15. Untouched

- **Water** — nozzle, plume, shader, width, drain: not opened.
- **Camera** — including the step‑2 rod framing.
- **UI** — video modal, z‑index, monitor, RTL, button design. The only DOM change is
  `disabled` on the removal controls, which §11 requires.
- **Physics** — no formula, factor, target mass, balance window or spring equation changed.
- **Lesson** — eleven steps, IDs, numbering, instructions, answer sheets, assessment.
- **Gate** — `BEDO-020`'s policy is untouched and every weight action still goes through it.

---

## 16. Files changed

| File | Change |
|---|---|
| `src/interaction/transfer.ts` | `weight-install` kind; `directionOf`; `addedWeightIndex`; source citations corrected to name the Animation/Event columns |
| `src/lib/transferPath.ts` | **New.** The measured arc over the tank |
| `src/components/DeviceModel.tsx` | Arrival observer; arc on both weight flights; in‑flight seats not drawn and not clickable; observers moved to layout effects; tray visibility read from the ref; seated‑mass spring; `WeightAvailability`; dev‑only `weightProbe` |
| `src/components/Scene3D.tsx`, `src/App.tsx`, `src/components/UIOverlay.tsx` | `WeightAvailability` plumbing and the disabled removal controls |
| `tests/unit/transfer.spec.ts`, `tests/unit/weight-transfer.spec.ts`, `tests/e2e/weight-transfer.e2e.ts`, `tests/e2e/helpers.ts` | Tests |
| `scripts/weight-transfer.mjs` | **New.** Samples the flight out of the running app |
| `docs/38`, `docs/23` | Marked complete |
