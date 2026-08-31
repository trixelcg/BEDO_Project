# 51 — Guided UI readability, hover labels and the weight interaction (BEDO-UX-09)

Four defects were reported against the released guided experience
(`bedo-project-r3f-app-00079-veb`, the UX-06 rebuild): the guided text was too small —
especially in Arabic — the nozzle and the weights had no hover label, and the weights
could not be interacted with.

Nothing frozen was touched. The water body colour, opacity, shader, material, lighting,
GLBs and morph timing; the bore, physics, equations and pump curve; the tank fill/drain,
the volumetric valve, the deflector behaviour, the Software Monitor and Recorded Readings;
the guided workflow and 11-step architecture; the contextual dock placement, the loading
architecture, language persistence, the runtime asset manifests, PERF-06 and the
Cloud Build/release configuration are all byte-identical. The diff is
`src/index.css`, `src/components/DeviceModel.tsx`, `src/components/Scene3D.tsx` (one prop)
and `src/App.tsx` (one line), plus one new test file.

## 1. Readability

Measured at 1366×768 and 1920×1080, in English and Arabic, against a production build.

| Element | Before | After |
|---|---|---|
| Step instruction (`.step-card-primary`) | 15 px | **19 px** |
| Observation / notice (`.step-card-secondary`) | 12 px, `#8fa7ad` | **15 px, `#b8ccd2`** |
| Step title (`.step-card-title`) | unstyled `<h3>` | **15 px, 600** |
| Step badge | 11 px | **14 px** |
| OK button | 13 px | **16 px**, `12px 26px` |
| Footer buttons and status | 11 px | **14 px** |
| Dock controls and weight buttons | 11–12 px | **14 px** |

The footer status text (`.guided-cover-state`) sat directly on the 3D scene and was the
least legible thing on screen; it now has the same chip backing the other footer items
have.

### The collision this introduced, and how it was caught

Enlarging the card made it overlap the footer at 1366×768. The first check did not see it,
because it only asserted that each element fitted the viewport — two elements can each fit
and still sit on top of one another. The probe now asserts the rectangles do not intersect:

```js
const overlap = !(c.bottom <= f.top || f.bottom <= c.top || c.right <= f.left || f.right <= c.left);
```

`.guided-dock` moved 68 → 116 px (short screens 60 → 124 px). Final measured state, all
four cases: `cardFits=true footerFits=true cardFooterOverlap=false overflowX=false`.

## 2. The weight interaction — two independent causes

The report was one symptom ("the weights don't work"); it turned out to be two unrelated
causes that had to be found separately. Cause A made the *wrong* disc install; cause B
made *no* disc reachable in the guided mode learners actually use.

### Cause A: the hit proxies stood in front of one another. **Fixed.**

Every tray hotspot was an invisible sphere sized from the part's longest side
(`radius = max(size) * 0.6`). Around a disc 57.6 mm across and 5.5 mm thick that is a ball
of radius 34.6 mm.

The five discs are a row whose centres are 84.7 mm apart along the apparatus's x axis, and
that row recedes almost straight away from the camera: on screen the four stacked discs are
only ~11 px apart. Measured, the spheres do **not** overlap each other (gap 0.0847 local vs
0.0691 summed radii) — the failure is that the *view ray* aimed at a far disc passes well
inside the nearer discs' spheres, and a raycaster returns the nearest hit.

Measured before the fix, free mode, 1920×1080, clicking each disc's own projected centre:

| Aimed at | Added |
|---|---|
| 10 g (`Weight_Custom`, 75 px clear of the row) | 10 g ✔ |
| 50 g | **200 g** |
| 100 g | **500 g** |
| 200 g | **500 g** |
| 500 g | 500 g ✔ |

A vertical scan of the whole stack found **no pixel anywhere that could add 50 g**. Three
of the five masses were unreachable and the front disc answered for the row.

The discs now get a measured box that hugs the part — thin along the axis that separates
them, so one cannot stand in front of another. This is the same reasoning `DropRegion`
already records for why it is boxes and not spheres. After the fix every disc adds its own
mass, and the scan shows one contiguous, correctly ordered band per disc.

Pinned by `tests/e2e/weight-hotspots.e2e.ts`, which fails with exactly the reported symptom
(`clicking the 50 g disc … Expected: 50, Received: 200`) when the fix is reverted.

### Cause B: the guided panels covered the tray. **Fixed, with target-aware placement.**

At the two steps that ask the learner to add weights (6 and 8), the guided 2D UI was drawn
over the tray. Hit-testing `document.elementFromPoint` at each disc's own projected centre,
guided mode, step 6, before the fix:

| Disc | 1366x768 | 1440x900 | 1920x1080 | 2560x1440 |
|---|---|---|---|---|
| 10 g | `guided-cover-state` | clickable | step card | step card |
| 50 g | `step-card-title` | `glass-card` | `glass-card` | `weight-add-btn` |
| 100 g | step card text | `step-card-primary` | step card | `glass-card` |
| 200 g | clickable | step card | step card text | `step-card-primary` |
| 500 g | `guided-footer-btn` | `guided-footer-btn` | `guided-footer` | `guided-footer-btn` |

**This predated BEDO-UX-09 and was not caused by the readability change.** Measured against
the previous CSS at the same step and viewport, *all four* stacked discs were blocked;
after the readability change three were. The larger card covered no more of the tray than
the old one. It came from the UX-06 rebuild moving the instruction card to the bottom
centre, which is where the tray happens to project.

#### Why a camera nudge was not the fix

Three framings for the `weights` anchor were measured first, and none clears it:

| `weights` offset | Result |
|---|---|
| `[-0.44, 0.34, 0.34]` (shipped) | 3 of 4 blocked |
| `[-0.44, 0.18, 0.34]` | 2 of 4 blocked, 500 g pushed off screen (y=808 > 768) |
| `[-0.62, 0.30, 0.42]` | 4 of 4 blocked |

The tray runs diagonally through the lower-centre of the frame, which is where the
reference-aligned card sits. Re-composing the approved framing to dodge the HUD is the
wrong lever.

#### What was done instead

The tray's projection is remarkably stable across sizes — measured at **x 0.37-0.64 and
y 0.70-0.98 of the viewport** at 1366x768, 1440x900, 1920x1080 and 2560x1440 alike. That is
exactly the dock-and-footer band, so at the one step whose instruction is *"add weights"*
the HUD steps aside: the dock moves to the left margin, the global actions to the right,
and the centre channel is left clear. Widths are capped in `vw`, so the clearance holds at
every size rather than at the one it was tuned on.

`lesson.target === 'weights'` is the condition — the lesson's own answer to what the step
is about, not a step number. Everywhere else the reference-aligned bottom-centre layout is
byte-identical.

After the fix, all five discs are `clickable` at all four sizes in **both** English and
Arabic, with no HUD self-collision and nothing off screen.

## 3. Click-to-install, and the flight

`onAddWeight` was already the authoritative path and it already animated; nothing new was
built. Measured at each supported size, clicking each disc's own projected centre:

| Disc | Installed | Airborne | Travelled |
|---|---|---|---|
| 10 g | 10 g | yes | 0.745 m |
| 50 g | 50 g | yes | 0.810 m |
| 100 g | 100 g | yes | 0.780 m |
| 200 g | 200 g | yes | 0.780 m |
| 500 g | 500 g | yes | 0.808 m |

5/5 at 1366x768, 1440x900, 1920x1080 and 2560x1440, each ending `landed=true` on the seat,
the flight itself ~2.4 s — the storyboard's two seconds. Removal is untouched and still
works: 500 g installed, removed, `seats 0`, total 0 g.

### Two false alarms, both mine

Worth recording because each looked exactly like a product defect:

- **"500 g installs 0 g."** The probe waited on `data-bedo-transfer="idle"`, which is still
  `idle` at the instant the click lands, so the wait returned immediately and the total was
  read before the add had happened. Fixed by waiting for the runtime to acknowledge the
  click first.
- **"200 g does not register at 1920x1080."** `Clear all weights` sets the domain total to
  zero long before the discs have flown home, and a disc in flight is hidden on the tray
  with no hit proxy. The probe clicked into the gap. Fixed by waiting on
  `weightProbe.flying()` rather than on the marker.

Neither was a defect in the application.

## 4. Weight drag placement never existed

Dragging a tray disc to the holder adds nothing, and the cursor never becomes `grab`.
That is by design, not a regression:

- `git log -S "handlersFor(source)"` returns only `5fc226f`, which attached drag to
  **deflector** hotspots only.
- `drag.ts` defines `REQUIRES_DROP_TARGET = { deflector: true, weight: false }`, and its
  comment cites the storyboard: *"click on the weight on holder — the weight removed from
  the tank holder in 2 sec"* (sl. 32, state D). Weight drag is a **removal** gesture.
- `{...drag.handlersFor({ kind: 'weight', index })}` is attached only to **installed**
  discs, for that removal.
- `959edf8` added the tray disc's *click* action, never a drag source.

So the model is click-to-add / drag-to-remove. BEDO-UX-10 confirmed this is the intended
behaviour and withdrew the drag-to-install request: **click** the physical weight and it
goes into place. Not implemented, by instruction.

## 5. Hover labels

Both are derived, so neither can drift from the value it describes: the mass comes from
`WEIGHTS`, and the bore is computed back out of `NOZZLE_AREA_M2` — the constant the
momentum equations use — as `2 * sqrt(A / pi) * 1000` = 10 mm.

- Weight: `50 g` … `500 g` (identical in both languages, matching the existing readouts).
- Nozzle: `Nozzle — 10 mm bore` / `الفوهة — قطر 10 مم`.

The nozzle had no proxy at all, so it gained one — **hover-only**. It takes no click and
stops no event, so a press aimed at whatever is behind it still gets there, and it never
offers the pointer cursor a control would. Labelling is deliberately kept off `hoveredKey`,
which drives the glow and must stay restricted to parts the gate would accept.

`pointer-events: none` is load-bearing rather than cosmetic: the chip is drawn over the
proxy that raised it, so anything else would let the label swallow its own trigger and
flicker. Asserted in the test, not assumed.

## 6. Verification

- typecheck, lint (0 errors; the 2 warnings pre-date this work), production build
- 1054/1054 unit and integration tests, 44 files
- default (stub) E2E: 19 passed, 18 skipped
- `BEDO_E2E_FULL_MODEL=1` on the real apparatus for the new suite: 5 tests covering hotspot
  identity, click-to-install, the visible flight, removal, both tooltips, and HUD clearance
  at four viewports
- live at 1366x768, 1440x900, 1920x1080 and 2560x1440, English and Arabic
- both fixes verified to **fail** when reverted: the click test reports
  `Expected: 50, Received: 200`, and the HUD test reports
  `Weight_50: behind step-card-title`, `Weight_500: behind guided-footer-btn`
