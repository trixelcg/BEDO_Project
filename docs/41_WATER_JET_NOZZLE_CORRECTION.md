# 41 — Water jet / nozzle visual mapping correction

Closes **BUG‑03** — *"the water jet is ~18× too wide"* (`docs/audit/03_BUG_REPORT.md`,
`docs/17 §5.3`).

A visual/simulation‑mapping correction. **No physics changed**: `NOZZLE_AREA_M2`, the flow
and force equations, the momentum factors, the spring model and every experiment value are
byte‑identical, and all 855 pre‑existing tests pass unedited.

---

## 1. The defect, reproduced at HEAD

Measured against the running application at `f5ffd78`, in **model units** (one unit is one
metre of apparatus), not in screen pixels. `scripts/water-jet.mjs` reads the water group's
real bounding box out of the live three.js scene.

| State | Rendered jet width | vs 9.9975 mm bore |
|---|---|---|
| Pump off | not drawn | — ✅ |
| Low flow, n = 0.10 | 18.1 mm | 1.81× |
| **Reading 1, n = 0.40** | **139.7 mm** | **13.98×** |
| **Reading 2, n = 0.50** | **150.5 mm** | **15.05×** |
| **Max flow, n = 1.00** | **172.0 mm** | **17.20×** |
| Flat 90° / semi 180° / conical 135° / oblique 45°, n = 0.40 | 139.7 mm each | 13.98× each |

The audit's "≈18×" is the full‑flow case. Every deflector family rendered the identical
width, so no experiment was using a different nozzle — they were all equally wrong.

Raw capture: `measurements/water-before.json`, screenshots `measurements/water/before/`.

---

## 2. Verified nozzle geometry

| | |
|---|---|
| `NOZZLE_AREA_M2` | `0.0000785` m² (`src/domain/physics.ts`, verified against BEDO's `Jet force_Mathematical model.xlsx`) |
| Implied bore | `d = 2√(A/π)` = **0.0099975 m = 9.9975 mm** |
| Nozzle mesh | `JET Force 2_214` → `JET_Force_2_214` |
| Jet origin | the nozzle mesh's **top face**, already measured by `setNozzleLip` |
| Jet axis | the nozzle mesh's own X/Z centre — vertical, resolved in apparatus‑local space |

The constant's comment claims a "10 mm bore"; `tests/unit/water-jet.spec.ts` now checks
that claim rather than trusting it.

---

## 3. Primary sources

`Jetforce_Storyboard.pptx` sl. 18 lists the water as **two separate game objects**:

| Game object | Details | Animation |
|---|---|---|
| **Water shape before impact** | "According to the equation of …" | *"When the user open the valve, The water out of the nozzle forms the water shape before impact."* |
| **Water shape after impact** | "According to the equation of …" | *"When the water impacts the deflector, the water shape after impact will form according to the deflector shape. The water moves the deflector upward."* |

Slides 6 and 7 add: *"When the user moves the slider downward, the water flows through the
tank to form the water shapes that depend on **the velocity equation**."*

**What that settles**

- There are **two** shapes, not one: the column leaving the nozzle, and the spray leaving
  the deflector.
- The after‑impact shape follows **the deflector**, which is why there is one asset per
  deflector angle.
- The shapes depend on the **velocity** equation — which supports velocity driving
  animation, and says nothing that would make the *bore* depend on flow.

**What no source specifies**: the startup curve, the plume's spread factor, and the jet's
surface detail. Those are implementation, and are named as such below rather than dressed
up as geometry.

The `Details` column names an equation as a picture rather than text, so the equation
itself was not machine‑readable from the deck; nothing here depends on it.

---

## 4. The calculation that was removed

`src/components/DeviceModel.tsx`, frame loop:

```ts
const scaleXZ = ((tankBounds.width * 0.95) / fit.width) * flowIntensity;   // jet
const scaleXZ = (tankBounds.width * 0.10) / fit.width;                     // startup
```

`tankBounds.width` is the **glass tank**, 181.044 mm across. So the jet's width was 95 % of
the vessel the jet happens to sit inside, modulated by a hand‑tuned `flowIntensity` ramp
(`0.7 + 0.3·…`) that made the bore grow with the valve.

---

## 5. Root cause

Three faults compounding:

1. **BEDO's two water objects were collapsed into one.** The seven deflector‑named GLBs are
   the *after‑impact* shapes; the code used them as the *before‑impact* jet, stretched from
   the nozzle to the deflector. Their authored aspect is ≈1.3 — they are sprays, not columns
   — so nothing about them was ever going to read as a jet.
2. **The surviving object was sized from the tank**, a scene proportion with no physical
   relationship to the nozzle. 181 mm against a 10 mm bore is the 17.2×.
3. **Width was made a function of flow.** `flowIntensity` scaled the bore with the valve
   opening, which no source supports and physics contradicts: the nozzle does not dilate.

---

## 6. The corrected mapping

`src/lib/waterJet.ts` — one module, no scattered scale maths.

```
NOZZLE_AREA_M2                       (domain, verified, untouched)
      ↓  d = 2√(A/π)
NOZZLE_DIAMETER_M            9.9975 mm
      ↓  × MODEL_UNITS_PER_METRE
NOZZLE_DIAMETER_MODEL_UNITS
      ↓  jetScale(assetWidth, assetHeight, gap)
rendered jet cross-section = the bore, exactly
```

- **Cross‑flow** is scaled to the bore, and to nothing else. It takes no valve opening, no
  tank, no viewport — `jetScale` has no parameter that could carry one.
- **Along‑flow** is stretched to the *measured* nozzle‑to‑deflector gap, so the column
  spans the distance it actually has to cross.
- **The plume** is scaled from the **deflector's own measured diameter** × `PLUME_SPREAD`,
  uniformly, preserving each asset's authored silhouette.

`PLUME_SPREAD = 1.6` is the single presentation number in the water mapping. No BEDO source
gives a figure for how far the spray extends past the deflector; it is exported, documented
and tested rather than buried in the frame loop.

**`tankBounds` is gone from the component entirely** — it existed only to size the jet, and
a test asserts the identifier no longer appears in `DeviceModel.tsx`.

---

## 7. Origin and direction

Both were already correct and are now verified rather than assumed.

| | Measured |
|---|---|
| Radial offset of the jet from the nozzle axis | **0.000000** |
| Gap between the jet's base and the nozzle lip | **0.000000** — no floating gap |
| Jet axis | apparatus‑local vertical, taken from the nozzle mesh's own X/Z centre |

The jet is parked on the lip and extends upward by the gap; it is not centred on the
midpoint any more, because a column that grows during startup must grow *out of* the
nozzle rather than away from both ends.

---

## 8. Water asset audit

All eight parse, all carry UVs, none was re‑exported.

| Asset | Size (authored units) | Aspect | Role | UV sets |
|---|---|---|---|---|
| `Water_low` | 5.079 × 17.481 × 5.083 | **3.44** | **before‑impact jet** | `TEXCOORD_0` |
| `Water90_Flat` | 16.827 × 21.994 × 16.841 | 1.31 | after‑impact, flat 90° | `TEXCOORD_0`, `TEXCOORD_1` |
| `Water180_HemiSphere` | 16.827 × 23.420 × 16.841 | 1.39 | after‑impact, semi 180° | `TEXCOORD_0`, `TEXCOORD_1` |
| `Water30`, `Water120`, `Water135` | — | ≈1.3 | after‑impact; **authored lying down** (long axis Z, no rotation node) — stood up at runtime | `TEXCOORD_0` |
| `Water45_Oblique`, `Water60_Cone` | — | ≈1.3 | after‑impact | `TEXCOORD_0` |

**`Water_low` is BEDO's "water shape before impact".** Its aspect is 3.44 against the
physical jet's 3.50 — a 10 mm bore climbing the 35 mm `TRAVEL_HEIGHT_M` — which is 1.7 %
apart, while every other shape is near 1.3. The code had been using it only as a "startup
trickle" below n = 0.22 and throwing it away above that. A test identifies it by aspect
rather than by filename.

The assets are structurally sound; the fault was entirely in how they were scaled.

---

## 9. UV / banding — diagnosed, deliberately not changed

| | |
|---|---|
| **Asset data** | every shape carries `TEXCOORD_0`; **three** also carry `TEXCOORD_1` — `Water90_Flat`, `Water180_HemiSphere` and `Water45_Oblique` (this entry originally said two; corrected by the re-inspection in `docs/43 §2`) |
| **Shader assumption** | the ripple layers are sampled by **world position** — `vWPos.xz * 6.0`, `vec2(vWPos.x - vWPos.z, vWPos.y * 2.5) * 5.0` — not by `vUv` |
| **Consequence** | a world‑space planar projection on a group that is scaled non‑uniformly and moved every frame, which is the banding the audit saw |

**Resolved by `docs/43`** — though not as expected: the authored UVs turned out to be unusable
(they address no texture, are laid out as a per-primitive atlas, and reverse direction between
primitives), so the ripple is now sampled from a surface coordinate derived from each mesh's
own geometry. The original assessment below stands as the reason it was deferred rather than
attempted here.

The apparent fix is to sample the authored UVs. It is **not** applied here: swapping the
projection changes the look of all eight shapes and needs its own visual pass across every
deflector, which is a shader task rather than a mapping task, and this brief says to fix it
only if it can be done cleanly. Recorded as water debt in §13, with a test that pins the
UV data so the finding cannot rot.

---

## 10. After: measured

| State | Jet width | Error vs bore | Plume |
|---|---|---|---|
| Pump off | not drawn | — | not drawn |
| Low flow, n = 0.10 | **10.00 mm** | **−0.00 %** | not drawn (jet still climbing) |
| Reading 1, n = 0.40 | **10.00 mm** | **−0.00 %** | 52.0 mm |
| Reading 2, n = 0.50 | **10.00 mm** | **−0.00 %** | 52.0 mm |
| Max flow, n = 1.00 | **10.00 mm** | **−0.00 %** | 52.0 mm |
| Flat 90° / semi 180° / conical 135° / oblique 45° | **10.00 mm** each | **−0.00 %** | 52.0 mm |

**17.20× → 1.00×.** The width is identical at every flow state and for every deflector
family, which is the point: the nozzle does not change.

Tolerance: `JET_WIDTH_TOLERANCE = 0.02` (2 %), tighter than the brief's 5 % because nothing
is estimated — the bore is a verified constant and the asset width is measured off its own
vertices. Observed error is below 1e‑9.

Raw capture: `measurements/water-after.json`, screenshots `measurements/water/after/`.

---

## 11. Performance

| | Before | After |
|---|---|---|
| Idle (perf baseline) | 769 draws / 217,055 tris / 22 binds / 42 programs | **identical** |
| Free‑mode idle | 308 draws / 86,958 tris / 36 programs | **identical** |
| Flowing, n = 0.40 | 314 draws / 91,170 tris / 39 programs | 323 / 94,212 / 39 |

**Idle is unchanged.** While water is flowing the cost rises by **+9 draw calls and +3,042
triangles**, with no new shader programs: that is BEDO's second water shape being drawn.
Justified — the source specifies two objects and the app was drawing one. No
post‑processing was added, and the water is still hidden whenever the pump is off.

---

## 12. Scene fingerprint

Empty baseline differs in exactly two lines: the JS chunk hash, and `objectCount`
290 → **291** — the one extra `Group` that holds the jet separately from the plumes.
Renderer, four lights, apparatus transform, 33 tracked mesh world transforms, 16 hotspots,
cover glass, `envMapIntensity` census and camera are byte‑identical. No forbidden
difference: nothing touched weights, pan, deflectors, camera, lights, cover, UI or the
apparatus root.

---

## 13. Known remaining water debt

1. ~~**The shader ignores the assets' UVs** (§9).~~ **Fixed** — see `docs/43`.
2. **`TRAVEL_HEIGHT_M` disagrees with the model.** The constant says the jet climbs
   **35 mm**; the measured nozzle‑lip‑to‑deflector gap in the shipped GLB is **184 mm**, a
   factor of 5.3. The visual necessarily uses the measured gap — a jet scaled to 35 mm
   would leave a 149 mm hole — but the constant feeds `impactVelocitySquared` in
   `computeRow`. Either the model is not to scale in that dimension or the constant is
   wrong. **Not touched**: §4 forbids physics changes, and resolving it needs BEDO source
   evidence, not a judgement call here.
3. **No drain behaviour.** Storyboard sl. 29/30 says *"The water will gradually drain from
   the tank if the valve is opened"*; the tank never fills or drains. Out of scope.
4. **The plume's spread is presentation.** `PLUME_SPREAD = 1.6` has no source backing.

---

## 14. Files changed

| File | |
|---|---|
| `src/lib/waterJet.ts` | **new** — the physical→scene mapping |
| `src/components/DeviceModel.tsx` | jet and plume drawn as BEDO's two objects; `tankBounds` removed |
| `tests/unit/water-jet.spec.ts` | **new** — 16 tests |
| `scripts/water-jet.mjs` | **new** — model‑unit measurement harness |
| `docs/41` (this), `docs/17`, `docs/23` | documentation |
