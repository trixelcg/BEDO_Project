# 31 — Spring Model Correction (BEDO‑007)

The deflector spring was allowed to compress **below its rest position** whenever the
weights outweighed the jet. BEDO's storyboard says it must not. One clamp bound changed;
everything else about the spring is numerically identical.

**This is a deliberate behaviour change** — the first in Phase 2 — so the evidence for it
is the point of this document.

---

## 1. Primary evidence

The sources cited by `docs/13 §4` are **not in this repository**, but they exist one level
above it, and they were read directly for this task:

| Source | Location |
|---|---|
| Storyboard | `../Measurement of Jet Forces/Phase 1/Jetforce_Storyboard.pptx` — 38 slides |
| Mathematical model | `../Measurement of Jet Forces/Phase 1/Jet force_Mathematical model.xlsx` |
| State machine | `../Measurement of Jet Forces/Phase 1/Jet force_State machine.docx` |
| Experiment sheets | `../Measurement of Jet Forces/Phase 2/Exp.{1..4}*.docx` + answer sheets |
| Unity source | `../Project_VL-FM009/`, `../Bedo_Unity/` |
| Blender source | `../Bedo_MJblend.blend` |

> **Worth flagging on its own:** several earlier documents (`docs/27 §1`, `docs/29 §8`)
> record these as missing, because `docs/reference/Storyboard.pptx` inside the repo is a
> 165‑byte stub. They are not missing — they are simply outside the git tree. Everything
> those documents marked "cannot be verified" is verifiable.

### 1.1 Storyboard slide 8 — the equations

Tabulated against one game object, "Deflector spring". Transcribed verbatim from
`ppt/slides/slide8.xml`:

| Equation | Condition |
|---|---|
| `h_w = F_ac / (200×100)` | "If hw ≥ hF **The deflector spring moves downward.** The spring will not exceed the cover or holder surface." |
| `h_F = F_th / (200×100)` | "If hF ≥ hw, **The deflector spring moves upward.** The spring will not exceed the cover or holder surface" |
| `X = h_F – h_w` | "If hF ≤ hw, **The X= 0 and the deflector spring will not move.** The spring will not exceed the cover or holder surface" |

### 1.2 Storyboard slide 19 — the direction

> "Deflector spring — According to the equation of `X = h_F − h_w`, the deflector spring
> moves downward when the weights are placed on the holder and moves upward when the
> weights are removed from it."

### 1.3 What that establishes

| Question | Answer | Source |
|---|---|---|
| What is `h_F`? | The displacement the **jet** force alone would produce, `F_th / k` | sl. 8 |
| What is `h_w`? | The displacement the **weights** alone would produce, `F_ac / k` | sl. 8 |
| Positive direction | **Upward.** The jet lifts, the weights lower | sl. 8, sl. 19 |
| Rest position | `X = 0` — where the spring sits with no net force | sl. 8 |
| Is below-rest travel valid? | **No.** "If hF ≤ hw, The X = 0 and the deflector spring will not move" | sl. 8 |
| Minimum | 0 | sl. 8 |
| Maximum | Geometric: "will not exceed the cover or holder surface" — **no number given** | sl. 8, stated three times |

Slide 8 and slide 19 look contradictory at a glance — one says the spring "moves downward"
when `hw ≥ hF`, the other that it "will not move". They agree once `X` is read as the *net*
displacement it is defined to be: adding weights **reduces** X, which is the downward
movement, until X reaches zero and stops. Nothing travels below rest.

## 2. Units

`Jet force_Mathematical model.xlsx`, sheet 1, the block headed *"spring (height)"*:

```
row 2   X: "h = F / k (stifness)"        W: "N"
row 4   W4: =V4*9.81   -> 0.4905         X4: =W4/200*1000  -> 2.4525
```

`F/200 × 1000` over a force in newtons is `k = 200 N/m` with the answer in **millimetres**,
and 0.4905 N → 2.4525 mm is the tabulated pair that fixes both. This is the same relation
`computeRow` already uses for the `springDeflectionMm` it reports — which is `h_w`.

**One discrepancy between the two primary sources.** The storyboard writes the divisor as
`(200×100)`; for 0.4905 N that gives 2.4525 × 10⁻⁵, not the 2.4525 its own spreadsheet
tabulates. The spreadsheet's formula and figures are taken as authoritative — they are
executable, self-consistent, and already the basis of the 57 pinned physics tests.
(A second block lower in the same sheet, headed `h (cm)`, divides a **kilogram** column by
200 and multiplies by 1000 on one row and 100 on the next. It is scratch work and is
disregarded.)

---

## 3. Old model

`DeviceModel.tsx`, before this task:

```ts
const netForce   = jetForceN - weightForceN;                 // newtons
const restH      = springInfoRef.current?.restH ?? 0.065;    // model units
const minDeflection = -0.45 * restH;
const maxDeflection =  0.45 * restH;
const deflection = clamp(netForce / SPRING_RATE_N_PER_M, minDeflection, maxDeflection);
```

`netForce / k` **is** `h_F − h_w` — the equation was already right. The defect was the
clamp: a symmetric ±45 % of the spring's rest height, which let X reach **−25.4 mm**.

## 4. Corrected model

`src/domain/spring.ts`:

```ts
springHeightMm(forceN, rateNPerM = 200)        // h = F/k, in millimetres

springDeflectionMm(jetForceN, weightForceN, maxTravelMm, rateNPerM = 200)
  h_F = springHeightMm(jetForceN)
  h_w = springHeightMm(weightForceN)
  X   = h_F - h_w
  if X <= 0            -> 0            // sl. 8: "X = 0 and the spring will not move"
  return min(X, maxTravelMm)           // sl. 8: "will not exceed the cover or holder surface"
```

| | Old | Corrected | Source |
|---|---|---|---|
| Equation | `h_F − h_w` | `h_F − h_w` | sl. 8 — unchanged |
| Rate | 200 N/m | 200 N/m | xlsx — unchanged |
| Unit | metres (implicit) | **millimetres (explicit)** | xlsx column X |
| Lower bound | **−0.45 × restH (−25.4 mm)** | **0** | sl. 8 |
| Upper bound | 0.45 × restH (25.4 mm) | 25.4 mm, injected | geometry; unchanged value |

Positional arguments, not an options object: this is read once per rendered frame, and a
fresh object sixty times a second is a cost with no reader (§21).

## 5. Maximum travel — what it is and what it is not

**No BEDO source gives a number.** The storyboard states it geometrically, three times:
*"The spring will not exceed the cover or holder surface."*

So none was invented. The domain takes `maxTravelMm` as a parameter and the scene supplies
it, from the model it has actually loaded (`src/lib/apparatusView.ts`):

```ts
SPRING_REST_HEIGHT_MODEL_UNITS = 0.056407   // measured: deflector_spring, 0.101532 world / 1.8
SPRING_TRAVEL_FRACTION_OF_REST = 0.45       // unchanged from the old implementation
springTravelLimitMm(restHeight) = restHeight * 0.45 * 1000   // -> 25.38 mm
```

The **value is deliberately unchanged**, so that BEDO‑007 alters only what the source
requires. Its *status* changed: it is now a scene-measured travel limit passed into the
domain, not a number the physics invented. Deriving the true limit from where the cover and
holder actually sit is open work — the model measurements are in §8 below.

`0.065`, the old hard-coded fallback rest height, is replaced by the measured 0.056407.

## 6. Old vs corrected

Computed by `tests/unit/spring-characterization.spec.ts`, which reproduces the old
implementation verbatim and runs both. Millimetres.

| State | Old | Corrected | Δ | Required by |
|---|---:|---:|---:|---|
| Rest — pump off, tray empty | 0 | 0 | — | — |
| Jet only, n = 0.4, flat | +4.100 | +4.100 | — | — |
| Jet only, n = 0.5, flat | +12.652 | +12.652 | — | — |
| Reading 1 balanced — n = 0.4, 80 g | +0.176 | +0.176 | — | — |
| Reading 2 balanced — n = 0.5, 260 g | −0.005 | **0** | +0.005 | sl. 8 |
| Overloaded — n = 0.4, 380 g | −14.539 | **0** | +14.539 | sl. 8 |
| Weights, pump off — 380 g | −18.639 | **0** | +18.639 | sl. 8 |
| A 500 g disc, pump off | −24.525 | **0** | +24.525 | sl. 8 |
| 180° at full flow | +25.383 | +25.383 | — | ceiling unchanged |

Two sweeps assert the general form of that table: over a 21 × 21 grid of jet and weight
forces, **every** difference between the two models is a case where the old value was
negative and the new one is exactly zero, and wherever the jet outweighs the load the two
agree to 1e‑9.

## 7. Scene mapping

The domain returns millimetres and knows nothing about the model. `src/lib/apparatusView.ts`
holds the scene's half of the contract:

```
jet force, weight force            (newtons, from the verified physics)
        ↓
src/domain/spring.ts               X, in millimetres, clamped to [0, maxTravel]
        ↓
mmToModelUnits(mm) = mm / 1000     1 model unit = 1 metre
        ↓
DeviceModel: spring scale.y = 1 + deflection / restHeight   (damped, unchanged)
             pointer / rod / pin  local Y += deflection      (damped, unchanged)
```

`1 model unit = 1 metre` is measured, not assumed: the glass tank is 0.317 model units tall
and 0.181 wide — a ~32 cm bench-top tank.

**Animation is untouched** (§16). The domain produces the target; the existing `damp()`
still eases toward it at the same rate. No timing moved into the domain, no new `useFrame`.

## 8. Model geometry, measured

From the live scene graph of `Bedo_baked_v2.glb` (world units, apparatus scale 1.8):

| Part | min Y | max Y | height | height ÷ 1.8 |
|---|---:|---:|---:|---:|
| `deflector_spring` | 0.677964 | 0.779497 | 0.101532 | **0.056407** |
| `Tank_cover` | 0.640165 | 0.693532 | 0.053367 | 0.029648 |
| `deflector_rod` | 0.512198 | 0.882641 | 0.370443 | 0.205802 |
| `Pointer` | 0.764402 | 0.790811 | 0.026409 | 0.014672 |
| `JET Force 2_212` (pin) | 0.664143 | 0.816617 | 0.152475 | 0.084708 |

## 9. Verification

### Behaviour, in the running app

`scripts/spring-states.mjs` (new) drives the app into five states, records the world
transform of every part the deflection moves, and screenshots each in fixed framing.
Spring `scale.y`, where 1.0 is rest:

| State | Before | After | |
|---|---:|---:|---|
| A — rest | 1.000000 | 1.000000 | unchanged |
| B — jet at n = 0.4, no weights | 1.045942 | 1.045942 | unchanged |
| C — n = 0.4 balanced by 80 g | 1.003172 | 1.003172 | unchanged |
| D — n = 0.4 overloaded with 380 g | **0.742827** | **1.000000** | corrected |
| E — 380 g with the pump off | **0.670051** | **1.000000** | corrected |

Screenshots: `measurements/spring/{before,after}/`, same clip, same camera, same lighting.

### Everything that did not change

Across all five states and four tracked parts, **84 field comparisons are identical** and
the only differences are in states D and E, in exactly four parts — `deflector_spring`,
`Pointer`, `deflector_rod` and `JET Force 2_212` — every one of them driven by the same
deflection value. In both corrected states all four now sit at the rest position.

The standard scene fingerprint is captured at rest, where X is zero under both models, and
is **identical in every section**: 290 objects, 4 lights, the apparatus transform, all 33
tracked meshes, all 16 hotspots, the cover material, the camera.

Draw calls 769, triangles 217 055, framebuffer binds 22, programs 42 — **unchanged**.

## 10. Tests

| Suite | Count | |
|---|---:|---|
| `spring.spec.ts` | 22 | The specification: `h = F/k` against the spreadsheet's tabulated pair, `X = h_F − h_w`, the floor at zero, the ceiling, the lesson's own readings, totality |
| `spring-characterization.spec.ts` | 12 | Old vs corrected, row by row, plus two grid sweeps proving the difference is *only* the floor |
| `physics.spec.ts` | 57 | **Unchanged and green** — no equation, constant or expected value touched |
| `state-machine.spec.ts` | 61 | Unchanged |
| `lesson-flow.spec.tsx` | 15 | Unchanged |
| `glb-contract.spec.ts` | 51 | Unchanged |

No existing test protected the below-rest behaviour, so none had to be revised — the old
clamp was never asserted anywhere. Had one existed, §19 would have required documenting it
here rather than editing it quietly.

## 11. Found but deliberately not touched

- **The `(200×100)` discrepancy** between storyboard and spreadsheet (§2). Resolved in
  favour of the spreadsheet for this task; worth raising with BEDO, since it is *their*
  inconsistency and only one of the two can be right.
- **The travel limit is still an implementation choice**, not a derived geometry (§5).
- **`docs/27` and `docs/29` record the primary sources as missing.** They are not; they sit
  outside the repository. `BEDO‑041`'s conclusion in particular was reached without them
  and should be revisited now that the experiment sheets and the state-machine document
  can actually be read.
- Everything in §22 of the task — the video modal, popup z-index, RTL, deflector scoping,
  the fabricated row, lesson gating — remains untouched and assigned elsewhere.
