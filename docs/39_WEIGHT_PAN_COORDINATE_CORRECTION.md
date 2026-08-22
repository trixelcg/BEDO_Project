# 39 — Weight / pan coordinate correction (BEDO‑016)

Closes **BUG‑02** — *"Loaded weights render ≈2.2 m away from the weight pan"*
(`docs/audit/03_BUG_REPORT.md §BUG‑02`, Blocker / P0).

This is a spatial correction only. No physics, no lesson, no gate, no camera, no water.
See §17 for what was deliberately left alone.

---

## 1. The defect, reproduced at HEAD

Measured against the running application at `5fc226f`, not taken on trust from the audit.
`scripts/weight-anchor.mjs` drives the built app in a browser, reads the live three.js
scene graph, and re‑derives the pan's position from the rod's own vertices by an algorithm
written independently of the production code.

State **C** — 50 g, 100 g and 200 g on the holder. World units (the apparatus is drawn at
1.8×; divide by 1.8 for metres of real apparatus):

| Disc | Drawn at | Belongs at | Δ | Distance |
|---|---|---|---|---|
| `Weight_50` | `(0.268234, 0.889396, 1.767587)` | `(0.018173, 0.784976, −0.412133)` | `(+0.250061, +0.104420, +2.179720)` | **2.196500** |
| `Weight_100` | `(0.115759, 0.902357, 1.767587)` | `(0.018173, 0.797936, −0.412133)` | `(+0.097586, +0.104421, +2.179720)` | **2.184401** |
| `Weight_200` | `(−0.036716, 0.922281, 1.767587)` | `(0.018173, 0.817860, −0.412133)` | `(−0.054889, +0.104421, +2.179720)` | **2.182910** |

**2.1965 world units = 1.2203 model units ≈ 1.22 m of real apparatus.** The audit's "≈2.18 m"
is reproduced exactly; the spread across denominations is the X term, which is each disc's
own position on the tray.

Two further facts the audit did not record:

- **The invisible click proxies were 1.92–1.93 world units from the discs they represented.**
  The proxy sat at its slot group's origin while the disc was drawn a metre and a half away,
  so the clickable weight and the visible weight were never the same object in space (§13).
- **Y was wrong too.** The audit's table marks Y "correct ✅", but it compared against the
  rod's *crown* — the tip of the retaining post — and that is not the pan. Against the real
  plate the error is a constant **+0.104421** world units (**+0.058014** model, 58 mm of
  apparatus): the discs floated at the very top of the post rather than resting on the plate.

Raw capture: `measurements/weights-before-bedo016.json`. Screenshots: `measurements/weights/before/`.

---

## 2. The exact calculation that was removed

`src/components/DeviceModel.tsx`, in the `stack` memo:

```ts
// pan = [rodBox.centre.x, rodBox.max.y, rodBox.centre.z]   ← apparatus-local
let cum = 0.001;                                            // clear the pan's top face
...
offset: [ pan[0] - proto.position.x,                        // node-local translation
          pan[1] + cum + h / 2 - centre.y,                  // measured bbox centre
          pan[2] - proto.position.z ],                      // node-local translation
```

`proto.position` is a node's translation **relative to its glTF parent**. Three of the four
terms are apparatus‑local; `proto.position` is not, and it is not a position in any sense
that is useful here — see §4.

The slot group was then parked at `offset` and the clone dropped into it carrying its full
baked transform, so the disc was drawn at `offset + bakedCentre` while the click proxy, at
the slot's origin, stayed at `offset`.

---

## 3. Coordinate spaces

| Space | What it is | Example value |
|---|---|---|
| **Mesh‑local** | Vertex coordinates inside a `BufferGeometry`. | `Weight_50` positions, pre‑transform |
| **Node‑local** | A node's TRS relative to its glTF parent. | `(0, 1.238958, −1.231891)`, quat `(0.7071, 0, 0, 0.7071)`, scale `0.01` |
| **Apparatus‑local** | Relative to the `<group>` the whole rig hangs from in `DeviceModel`. | pan surface `(0.010096, 1.433344, −0.228963)` |
| **World** | Apparatus transform applied: position `(0, −1.8, 0)`, scale `1.8` (`src/lib/sceneConfig.ts`). | pan surface `(0.018173, 0.780020, −0.412133)` |

The GLB is mounted as a `<primitive>` child of the apparatus group with no transform of its
own, so **apparatus‑local and the GLB's own scene space coincide**. That is why every
measurement in this document can be read directly out of the binary.

**One model unit is one metre** of real apparatus (`apparatusView.MODEL_UNITS_PER_METRE`).
The 1.8 scale is presentation. Distances are quoted in world units where the subject is what
the learner sees, and in model units where the subject is the physical rig.

Every anchor the loaded weights use is **apparatus‑local**. No value mixes spaces.

---

## 4. Root cause

`Bedo_baked_v2.glb` is a *baked* export: the geometry carries its real coordinates in its
vertices, and the exporter stamped **the same node transform onto every top‑level object** as
the Blender Z‑up → glTF Y‑up conversion.

```
deflector_rod   T = (0, 1.238958, −1.231891)   R = 90° about X   S = 0.01
Weight_Custom   T = (0, 1.238958, −1.231891)   R = 90° about X   S = 0.01
Weight_50       T = (0, 1.238958, −1.231891)   R = 90° about X   S = 0.01
Weight_100      T = (0, 1.238958, −1.231891)   R = 90° about X   S = 0.01
Weight_200      T = (0, 1.238958, −1.231891)   R = 90° about X   S = 0.01
Weight_500      T = (0, 1.238958, −1.231891)   R = 90° about X   S = 0.01
```

So `proto.position` is **not where a weight is**. It is one shared constant, identical for
the rod, for all five discs and for everything else in the export. Subtracting it from the
pan's X and Z did not move a disc *to* the pan; it moved every disc by `−(0, 1.239, −1.232)`
regardless of where it was, which is where the constant `+2.179720` on Z comes from.

The Y term used the measured bounding‑box centre and was internally consistent, which is why
the stack's *spacing* was always right and only its *base* was wrong. That inconsistency —
two axes from a node transform, one from geometry — is the whole of BUG‑02.

The second, compounding error was the target itself: `pan` took the rod's bounding‑box `max.y`,
which is the tip of the retaining post, not the plate. See §5.

---

## 5. The pan: source node and hierarchy

There is **no pan or holder node in the GLB.** The plate is part of `deflector_rod`:

```
Scene (glTF root, identity)
└── deflector_rod [node 154]      T=(0, 1.238958, −1.231891)  R=90°X  S=0.01
```

`deflector_rod` is a top‑level node with no parent but the scene root, and it is one mesh
covering the whole assembly — mount, shaft, collar, pan and post. Its vertical profile,
measured from the binary in apparatus‑local space:

| Feature | Y range | Radius from the rod axis |
|---|---|---|
| Deflector mount / clamp | 1.284555 – 1.318855 | ≤ 0.0163 |
| Shaft | 1.318855 – 1.413181 | (cylinder; vertices at the ends only) |
| Collar | 1.417889 – 1.417897 | 0.017116 |
| Shaft above the collar | 1.422125 – 1.423819 | 0.005015 – 0.005069 |
| **Pan plate** | **1.430594 – 1.433344** | **0.040774** |
| Retaining post | 1.433344 – 1.490356 | ≈ 0.005153 |

The plate is concentric with the shaft — every horizontal slice of the rod has its centre at
`x = 0.010096, z = −0.228963` — so the rod's overall horizontal centre and the pan's centre
are the same point. That is why the *old* X and Z targets were themselves correct; what was
wrong was subtracting a node translation from them.

**Pan top surface: `(0.010096, 1.433344, −0.228963)` apparatus‑local.**
The old anchor, `rodBox.max.y = 1.490356`, is **0.057012 higher** — the post, not the plate.

### The discs are washers

| Mass | Mesh | Thickness | Outer radius | Bore radius | Tray centre (apparatus‑local) |
|---|---|---|---|---|---|
| 10 g | `Weight_Custom` | 0.016518 | 0.028801 | 0.006353 | `(−0.124869, 1.068748, −0.125488)` |
| 50 g | `Weight_50` | 0.005506 | 0.028801 | 0.006353 | `(0.138923, 1.063192, −0.020935)` |
| 100 g | `Weight_100` | 0.008894 | 0.028801 | 0.006353 | `(0.054215, 1.064886, −0.020935)` |
| 200 g | `Weight_200` | 0.013244 | 0.028801 | 0.006353 | `(−0.030494, 1.067110, −0.020935)` |
| 500 g | `Weight_500` | 0.016518 | 0.028801 | 0.006353 | `(−0.115202, 1.068748, −0.020935)` |

Every disc has a **centre bore of radius 6.353 mm** and the post is **5.153 mm** in radius.
The discs are annular and slide down the post onto the plate, exactly as a real weight set
does — which independently confirms that the plate, and not the post's tip, is where they
belong. The pan's 40.8 mm radius comfortably clears their 28.8 mm.

Note: **the 10 g disc is the 500 g disc's geometry**, reused. Identical thickness, outer
radius and bore; only the tray position and the label differ. Thickness otherwise rises with
mass, which is why a fixed vertical increment cannot work.

---

## 6. Source‑asset findings, and why the fix is at runtime

The `.blend`, FBX and Unity sources named in the task brief are **not in this repository**.
`assets-source/models/` holds two earlier GLB exports — `Bedo_M.glb` and
`Bedo_model_optimized.glb` — and both carry the same baked, shared node transform, with the
weights authored as `Weight_50 gm`, `Weight_100 gm` and so on. The bake is therefore not a
recent slip in one export; it is how this model has always been delivered.

**The pivots are not mis‑placed in the DCC sense.** There is no object whose origin is wrong
relative to its own geometry in a way that only Blender can repair: the origins are simply
*all the same*, because the export baked the transform into vertices and left one shared
conversion node behind. That is a normal, valid glTF.

| Option | Cost | Risk |
|---|---|---|
| **Runtime anchor correction** (taken) | One measurement at load; no asset change | None to the asset contract; entirely covered by tests |
| Re‑export with per‑object origins | Blender round‑trip, re‑bake, re‑optimise a 26 MB asset | Renames and re‑IDs nodes; breaks `tests/unit/glb-contract.spec.ts`'s 33‑name contract; every other measured anchor, hotspot and drop region would have to be re‑verified |

The runtime correction is mathematically exact — the code measures geometry rather than
compensating for it — so a re‑export would buy nothing and risk the naming contract that
`docs/19` and the GLB contract test depend on. **The production GLB was not modified.**

---

## 7. The authoritative anchor

`src/lib/holderAnchor.ts`. Scene layer, not domain: `src/domain` may not import three.js and
`tests/unit/domain-boundary.spec.ts` enforces that. Nothing about a world position enters the
runtime, the state machine or the lesson — the runtime still knows only
which discs are loaded and what they weigh.

```
deflector_rod geometry
        ↓  measureHolderAnchor()          — the widest lamina on the rod, top face
HolderAnchor { surface, radius, postHeight }   — apparatus-local
        ↓  stackSeats(anchor, thicknesses)
Seat[] { centre, bottom, thickness }           — apparatus-local
        ↓  slot <group position={seat}>
        ↓    disc <group position={recentreOffset(measured)}>
rendered disc, click proxy, removal-flight origin
```

**Strategy chosen: a bbox-derived anchor** — a bbox‑derived anchor computed
entirely in one coordinate space — because options 1 and 2 do not exist in this asset (there
is no named anchor helper, and the node pivot is the shared export constant).

The pan is *found* rather than named, because the model has no node for it. It is identified
the way a person would point at it: **the widest thing on the rod.** Vertices are taken
straight into apparatus‑local by a single composed matrix (`apparatus.matrixWorld⁻¹ ·
mesh.matrixWorld`), never via world space and back; those within `PAN_RIM_FRACTION` (0.9) of
the maximum radius are the plate's rim, and the highest of them is its top face.

That threshold is not tuned: the rim is at 0.040774 and the next widest feature — the collar —
is at 0.017116, so anything from about 0.42 to 1.0 selects the plate alone. A test asserts the
margin rather than the constant.

### One truth, four consumers

The slot group's origin **is** the disc's seat. The disc is recentred *into* the slot and the
click proxy simply sits at the slot's origin, so they cannot drift apart — there is no second
formula for the proxy to disagree with. The same seat drives:

- the rendered disc,
- the invisible hit proxy,
- the start of a removal flight (drag, click, or the 2D panel button),
- the camera's `pan` anchor (`Anchors.pan`), which now points at the real plate.

No lesson step frames the `pan` anchor today, so nothing about the camera changed; when a step
does, it will frame the plate rather than the post's tip.

### Stack geometry

```ts
bottom = surfaceBelow + SEATING_CLEARANCE      // 1 mm at model scale
centre = bottom + thickness / 2
```

Each disc rises by its **own measured thickness** — required, since the denominations are
5.5 mm to 16.5 mm — plus one millimetre of seating clearance. That clearance is not a fudge
factor standing in for a coordinate error: two solid faces set exactly coplanar have equal
depth and z‑fight, and real discs do not lie in perfect contact either. It is stated in
millimetres and converted through the existing `mmToModelUnits`.

### Duplicate masses

Seats are assigned by **stack position**, so two 50 g discs get two adjacent, distinct seats
`t + 1 mm` apart — never one shared slot. This preserves BEDO‑022's identity‑by‑position, and
a test asserts three distinct heights for `[50, 50, 100]`.

---

## 8. Movement: the holder is not a fixed point

The rod rides the tank cover when it is unscrewed, and the spring when the rig is loaded. The
frame loop now computes that lift **once**, names it, and gives it to everything that must
share it:

```ts
const holderLift = coverOffsetRef.current + deflection;
rodObj.position.y = baseY(rodObj, MESH.rod) + holderLift;   // the pan
weightStackRef.current.position.set(0, holderLift, 0);      // the discs on it
```

Previously the same expression was written out separately in each place. Naming it makes
"the stack rides exactly what the rod rides" true by construction rather than by two
expressions happening to match.

Re‑parenting the stack under `deflector_rod` would say the same thing, but the rod is a baked
node whose origin is a metre from its geometry and which carries a 0.01 scale — a sibling
group taking the identical lift is the same arithmetic without re‑parenting the asset or
inheriting that scale. **No per‑frame world‑matrix traversal was added.**

The anchor is measured **at rest**, on mount, before any frame has run. It also strips any
lift already applied, so a future dependency change cannot bake a lifted rod into the anchor
and count the same lift twice.

Measured live, state **G** — one 50 g disc against a wide-open valve, which is the only way
to get a positive `h_F − h_w` and actually lift the rod (a heavy stack cancels the jet and
nothing moves):

| | Rest (state B) | Spring lifted (state G) | Change |
|---|---|---|---|
| Pan surface, world Y | 0.780020 | 0.825710 | **+0.045690** |
| Disc centre, world Y | 0.786775 | 0.832465 | **+0.045690** |
| Alignment error | 0.001799 | 0.001799 | **0** |

The pan and the disc rise by the same number to six decimal places, and the disc's seat on
the pan does not change at all.

**The spring equation is untouched** (BEDO‑007, `src/domain/spring.ts`). The only change is
that the discs stay attached to the apparatus the spring moves.

---

## 9. Transfer and proxy integration

### Removal — holder → tray, 2 s

The storyboard's `sl. 32, state D`. The flight now runs between two named points instead of
relying on an implicit zero:

| | Before | After |
|---|---|---|
| `from` | slot offset + stack lift | **the seat** + stack lift |
| `to` | `Vector3()` — the origin, which landed the disc on the tray only because the wrapper carried the clone's whole baked offset | **`entry.measured`** — the tray slot the disc was cloned from, stated |
| wrapper origin | the GLB's distant shared origin | the disc's own centre |

The ghost wrapper is recentred by the same `recentreOffset` the stack slots use, so a disc
being carried follows the pointer *by the point the learner grabbed* rather than by a distant
origin. The drag path, the click path and the 2D panel button all produce the identical
flight. `TRANSFER_SECONDS` is unchanged at **2**: the destination was corrected, not the timing or
the aesthetics.

### Addition — tray → holder

**There is no tray → holder transfer to correct.** `TransferKind` is
`deflector-install | weight-removal | return-to-source`; adding a weight commits state and the
disc appears on the stack immediately. It is easy to assume BEDO‑021 animates both
directions; it animates removal only. This is a real gap against the storyboard
(`sl. 16` — *"the weight moves to the tank holder in 2 sec"*) and is recorded in §18 as
discovered work, not silently added here.

### Hit proxy

Was an invisible sphere at the slot's origin, with its radius clamped between two hand‑picked
numbers (`max(min(h/2, 0.02), 0.006)`) to stop stacked discs swallowing one another. It is now
a cylinder of the disc's **own measured radius and thickness**, at the slot's origin — which
is the disc's centre. There is nothing left to tune, the target is the disc's real footprint,
it cannot reach into a neighbour, and it is far easier to hit than the old 6 mm ball. Measured
proxy‑to‑disc offset: **1.930381 → 0.000000**.

---

## 10. After: measured

Same state C, same capture tool, same framing.

| Disc | Drawn at | Belongs at | Distance | Proxy offset |
|---|---|---|---|---|
| `Weight_50` | `(0.018173, 0.786775, −0.412133)` | `(0.018173, 0.784976, −0.412133)` | **0.001799** | **0** |
| `Weight_100` | `(0.018173, 0.801536, −0.412133)` | `(0.018173, 0.797936, −0.412133)` | **0.003600** | **0** |
| `Weight_200` | `(0.018173, 0.823260, −0.412133)` | `(0.018173, 0.817860, −0.412133)` | **0.005400** | **0** |

**X and Z error is exactly zero** — every disc is on the pan's axis to the last digit. The
entire residual is the deliberate seating clearance, accumulating at 1 mm of model (0.0018
world) per disc, which is what the capture tool's "belongs at" column does not model.

**2.1965 → 0.0018 world units. A factor of 1220.**

Raw capture: `measurements/weights-after-bedo016.json`. Screenshots: `measurements/weights/after/`.

### Tolerance, and why this one

- **Justification.** One model unit is one metre of apparatus, and the discs are 5.5 mm to
  16.5 mm thick. A seating clearance has to be far below the thinnest disc to be invisible
  and far above float noise to prevent z‑fighting. **1 mm** is 18 % of the thinnest disc and
  0.6 % of its 57.6 mm diameter.
- **Centre alignment:** horizontal error **0.000000**; vertical error ≤ 1 mm per disc of stack
  height, all of it the intended clearance.
- **Seating:** every disc's underside is **above** the surface below it — measured `seatGap`
  is positive at every position, so nothing intersects the pan or the disc beneath it.
- **On screen:** 1 mm of model is 1.8 mm of world at a pan 73 mm in radius. Not resolvable.

---

## 11. Visual acceptance

`measurements/weights/{before,after}/`. Each state has a wide shot in fixed framing and a
`-holder.png` close‑up centred on the pan's own projected position — identical framing before
and after, because the pan does not move.

| | State |
|---|---|
| A | Empty holder |
| B | One 50 g disc |
| C | 50 g + 100 g + 200 g |
| D | Duplicate masses: 50 g, 50 g, 100 g |
| E | One second after a fourth disc is asked for — **no flight to catch**, which is the §18.1 finding |
| F | Mid‑flight, 1 s into a 2 s removal |
| G | Pump on at n = 0.5 — the spring displaces the rod and its pan |

**A is pixel‑comparable before and after**: with an empty pan the scene builds no stack, so
nothing changed. From B onward the discs appear on the plate, threaded on the post, centred,
not floating and not intersecting. Before, they were off‑screen behind the bench.

---

## 12. Tests added

`tests/unit/holder-anchor.spec.ts` — 27 tests, against the **shipped GLB** rather than a
synthetic rod, via a new `tests/helpers/model.ts` that parses `Bedo_baked_v2.glb` into a real
three.js scene graph in Node.

| Brief § | Test |
|---|---|
| §19 anchor coordinate space | The anchor transformed by the apparatus matrix equals `(0.018173, 0.780020, −0.412133)` — the number `scripts/weight-anchor.mjs` read out of the browser by a separate route |
| §19 | **"takes no axis from a node translation"** — the rod's whole translation is pushed into a parent group so `rod.position` becomes `(0,0,0)` with no vertex moved; the anchor must not budge. This is BUG‑02 itself, and it fails instantly if any axis reads `position` |
| §19 | The anchor is unchanged under three different apparatus transforms, including a rotated, 3.5× one |
| §20 stack positions | Shared X/Z; strictly increasing Y; spacing equals each disc's own thickness plus the clearance; ordering matches; no disc reaches into the one below; empty stack places nothing |
| §20 duplicates | `[50, 50, 100]` produces three distinct heights |
| §21 transform hierarchy | Pan and seats move by one and the same apparatus transform, at a scale and a rotation |
| §22 moving holder | Rest, spring‑deflected, cover‑unscrewed, and both together: the anchor rises by exactly the rod's lift and never slides sideways; a disc's height above the pan is identical at every lift |
| §23 interaction proxy | The recentred clone's centre lands on the slot's origin, which is where the proxy sits — the proxy has no formula of its own to disagree with |
| Regression | The disc's distance from its seat is < 0.5 mm; and the removed calculation, kept as a counter‑example, still reproduces **1.2203 / 2.1965** |
| Geometry | Pan found is the plate not the crown; discs fit the pan; the rim threshold has a 2.4× margin; the whole disc set outgrows the post (§18.2) |

Suite: **798 → 825 tests, all passing.**

### Browser regression (BEDO‑021 must still work)

`tests/e2e/drag.e2e.ts` against the real 26 MB apparatus, `BEDO_E2E_FULL_MODEL=1` —
**6 passed (18.7 m)**:

| Test | |
|---|---|
| Transfer instrumentation reports the scene idle while nothing is in flight | ✅ |
| Real pointer drag: refuses another experiment's deflector, then installs the right one | ✅ |
| A deflector dropped away from the rod changes nothing at all (missed drop) | ✅ |
| Free mode lets any mechanically valid deflector be dragged in | ✅ |
| Dragging does not swing the camera, and navigation survives the drag (orbit lifecycle) | ✅ |
| **Removes one disc over two seconds and leaves the rest balanced** (weight-removal transfer) | ✅ |

Plus the standard suite — lesson, language, readiness, safety: **17 passed, 5 skipped**
(the five that need the full model, run above).

---

## 13. What was removed

- The mixed‑space `offset` expression (§2).
- `pan[0] - proto.position.x` and `pan[2] - proto.position.z` — the node‑translation terms.
- `rodBox.max.y` as the pan's height.
- `let cum = 0.001` — the bare literal is now `SEATING_CLEARANCE_MM = 1`, stated in
  millimetres and converted through `mmToModelUnits`.
- `hitRadius: max(min(h * 0.5, 0.02), 0.006)` — two empirical clamps, replaced by the disc's
  measured radius and thickness.
- `to: new THREE.Vector3()` as a removal destination — an implicit origin that worked only
  because of the baked offset it was cancelling.

**No fallback offset was left in place.** There is no compensating constant anywhere in the
new path; when the rod cannot be measured, `measureHolderAnchor` returns `null` and the scene
draws no stack rather than drawing one somewhere invented.

---

## 14. Performance

**Idle baseline, unchanged.** `measurements/perf-bedo016.json`:

| | Value | Expected |
|---|---|---|
| Draw calls / frame | **769** | 769 ✅ |
| Triangles / frame | **217 055** | 217 055 ✅ |
| Framebuffer binds / frame | **22** | 22 ✅ |
| Shader programs | **42** | 42 ✅ |

**Loaded states**, before vs after, from the same capture tool in the same seven states:

| State | Objects before | Objects after | Δ | Draw calls | Triangles |
|---|---|---|---|---|---|
| A empty | 287 | 287 | **0** | 308 → 308 | 86 958 → 86 958 |
| B one disc | 289 | 290 | +1 | 308 → 308 | 86 958 → 86 958 |
| C three discs | 293 | 296 | +3 | 308 → 308 | 86 958 → 86 958 |
| D duplicates | 294 | 297 | +3 | 310 → 310 | 88 158 → 88 158 |
| E four discs | 296 | 300 | +4 | 310 → 310 | 88 158 → 88 158 |
| F mid‑removal | 295 | 299 | +4 | 310 → 310 | 88 158 → 88 158 |
| G spring lifted | 289 | 290 | +1 | 314 → 314 | 91 170 → 91 170 |

**Draw calls and triangles are identical in every state**, loaded or not. The `+1 object per
loaded disc` is the recentring `Group` — a transform node, never drawn — and the hit proxy is
invisible, so it costs no draw call in either version (it went from a 10×8 sphere, 140
triangles, to a 24‑segment cylinder, 96, which only affects raycast work).

**No new per‑frame work.** The anchor is measured **once**, when the model loads: three walks
over `deflector_rod`'s ~6 400 vertices reusing one `Vector3`. The stack memo already ran on
`loadedWeightsG` and still does. No `useFrame` was added, and naming `holderLift` removed two
duplicate additions per frame rather than adding any. No world‑matrix traversal per frame, no
re‑parenting, and no helper geometry ships to production.

---

## 15. Scene fingerprint

`scripts/scene-fingerprint.mjs` captures the **empty baseline**: renderer, four lights, the
apparatus transform, 33 tracked mesh world transforms, 16 click hotspots, the cover glass,
the `envMapIntensity` census, the camera and the request list.

```
diff measurements/fingerprint-before-bedo016.json measurements/fingerprint-after-bedo016.json
1010c1010
<       "/assets/index-DwNVh7Xs.js",
---
>       "/assets/index-C4Q7PJXT.js",
```

**One line: the JS chunk's content hash.** Every other section is byte-identical — 290 objects,
4 lights, 33 tracked meshes, 16 hotspots, 0 failed requests, 0 console errors, before and after.

Forbidden differences — camera, lighting, deflectors, water, room/apparatus root, cover,
unrelated hotspots — **none**. The 16 hotspots are unchanged in radius and world position;
the weight proxies are not among them because an empty pan has no stack.

Intentional differences appear only in **loaded** states, and only in the three places §32
permits: loaded-weight transforms, the loaded-weight proxies, and the removal flight tied to
those corrected coordinates. Measured above (§14): +1 transform node per loaded disc, zero
change in draw calls or triangles.

---

## 16. Files changed

| File | Change |
|---|---|
| `src/lib/holderAnchor.ts` | **New.** The authoritative anchor, the stack seats, the one recentring conversion |
| `src/components/DeviceModel.tsx` | Anchor measured from the rod's plate; stack rebuilt in one space; slot origin is the seat; proxy is the disc; ghosts recentred; `holderLift` named and shared |
| `tests/helpers/model.ts` | **New.** Parses the shipped GLB into a three.js scene graph for Node tests |
| `tests/unit/holder-anchor.spec.ts` | **New.** 27 coordinate tests |
| `scripts/weight-anchor.mjs` | **New.** Before/after alignment capture, cost census and screenshots |
| `docs/17_SCENE_ARCHITECTURE.md` | Coordinate‑space conventions |
| `docs/23_IMPLEMENTATION_ROADMAP.md` | BEDO‑016 marked complete |
| `measurements/` | `weights-{before,after}-bedo016.json`, `fingerprint-{before,after}-bedo016.json`, `perf-bedo016.json`, `weights/{before,after}/*.png` |

---

## 17. Untouched, on purpose

The brief is explicit that these stay separate, and they do.

- **Water jet** — nozzle, plume, shaders, GLBs, width, drain: not opened.
- **Camera** — including BEDO‑021's finding that the rod is off‑screen during step 2.
  The `pan` anchor's *value* is now the real plate, but no lesson step frames it, so no camera
  behaviour changed.
- **UI** — video modal, z‑index, RTL, monitor styling, custom parameters: not opened.
- **Physics** — `momentumFactor`, the force law, target masses, the balance window and
  the experiment factors are byte‑identical. Loaded mass is unchanged; only where the disc is
  drawn changed.
- **Spring** — `springDeflectionMm` and its travel limit are untouched.
- **Lesson** — eleven steps, IDs, numbering, instructions, answer sheets, assessment: no
  change.
- **Interaction gate** — the gate operates on semantic action identity, not coordinates,
  and was not modified.

---

## 18. Newly discovered

1. **No tray → holder transfer exists.** Storyboard `sl. 16` and `sl. 29/30/32` specify
   *"the weight moves to the tank holder in 2 sec"*, and BEDO‑021 built only the reverse.
   Adding a weight is instantaneous. Now that the destination is correct and proven, this is
   a small piece of work — and it is the recommended next task.
2. **A full disc set overflows the retaining post.** The five discs total 60.7 mm plus
   clearance; the post is 57.0 mm. The runtime imposes no cap, so a large enough stack rises
   past the post's tip. A test records the arithmetic. Nothing a lesson does reaches it —
   the stacks the eleven steps build are well under — so it is noted, not fixed.
3. **The 10 g disc is the 500 g disc's mesh.** Identical thickness, radius and bore. Harmless,
   but it means the two look the same on the holder.
4. **The audit's BUG‑02 entry understates the defect.** It marks Y correct because it compared
   against the rod's crown. The Y error is real and constant at 58 mm of apparatus (§1).
