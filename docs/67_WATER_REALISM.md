# 67 — Realistic water, in sync with the fitted deflector and the weights

This is a working-tree change on top of F03–F19 (`docs/53`–`66`). It is not committed and not deployed.

**Request (user, 2026-09-29):** “create or enhance the water shapes and materials to be realistic and sync with selected deflectors and weights.”

## 1. The shapes were already in sync — verified, not changed

The jet's geometry is rebuilt from state every frame (`src/lib/jetFlow.ts`):

* **Deflector:** `measureWettedSurface` reads the fitted deflector's own underside off its mesh (40 azimuths; the 45° wedge non-axisymmetrically), so the contact point, the film and the leaving angle are the measured surface of whichever deflector is selected — not a lookup table.
* **Weights:** the whole path rides `liftM` = the carrier's holder lift, which includes the signed spring deflection the seated weights produce. Add weight and the deflector, the impact point and every sheet move down together.

Verified live in this pass (dev build, free mode, Q = 27.024 L/min): with the flat 90° plate, +500 g sank the carrier and the film, impact ring and falling curtain rode down with it, still seated on the plate's underside.

## 2. What changed: the material reads as water (`src/lib/waterMaterial.ts`)

The shared water shader (docs/59) drew every sheet as a uniform translucent film. Flat-plate sheets read as a glowing cyan slab; the 180° cup's curtain as a milky bottle. Four terms were added, all carried on the same parcel clock (`uClock − vFlowUv.y`) as the rest of the surface, so they travel with the water:

| term | what it is | where |
|---|---|---|
| `lig` | ligament streaks — a spreading or falling sheet gathers into denser streaks with clearer gaps, stretched along the flow | films and free sheets |
| `impactRing` | the white churned ring where the jet strikes the deflector, `exp(−vRun.z / 0.012)` from the axis, so it rides the impact point wherever the carrier sits | film start, not the hose |
| `droplet` | past the sheet's coherent length, torn patches `discard` except for bright droplet specks — edges disintegrate into drops instead of fading | free-sheet edges |
| streaky floor | the sheet's visibility floor is modulated by `lig` and fresnel, brighter at grazing angles, instead of one flat constant | sheets; runoff keeps its own lower floor |

The colour is streak-modulated (`0.82 + 0.36·lig`), and droplets draw as near-white specks.

**The product-owner visibility rule holds as an average.** `WATER_VISIBILITY` (body/hose/sheet 0.5, runoff 0.18; docs/59) is unchanged; the streak modulation averages to the same 0.5 over a sheet (0.5·(0.5 + 0.9·liḡ) with liḡ ≈ 0.55, fresnel-weighted). Wave amplitudes are unchanged (`water-material.spec` caps them).

## 3. A compile-order regression, caught and pinned

The first cut declared `impactRing` at the rivulet block, **below** the aeration sum that uses it: GLSL refused all three water programs (`'impactRing' : undeclared identifier`) and the water disappeared — the sim itself kept running. The declaration now sits above the sum, and `water-material.spec` gained a test that walks every realism identifier per material kind and fails if any is used before it is declared (comments stripped).

## 4. Verified

* Unit: water-material 16, water-jet 25, water-shape 12, f08-acceptance 14; full suite identical to the docs/66+seams baseline except the one new test; `tsc` clean.
* Live (dev build, fresh boot, shader compile watched — 51 programs, 0 diagnostics):
  * 180° cup: falling curtain with vertical ligament streaks and torn wavy edges, glassy not milky.
  * Flat 90°: radial film with concentric ripples and the churned impact ring at the strike point; the outer edge breaks into a streaky droplet curtain.
  * +500 g on the flat plate: everything rides down with the carrier (§1).

## 5. Housekeeping in the same pass

The boot-stall debug instrumentation from the seam work (docs/66 session) is removed: the `__bedoBoot` breadcrumbs in `DeviceModel`, `CampusEnvironment` and `Scene3D`, and the `__bedoNoSeams` gate — `closeCampusSeams(scene)` runs unconditionally again. The dev-only `__bedoTest.stage()` hook stays (stripped from production builds).
