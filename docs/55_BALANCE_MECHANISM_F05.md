# 55 — Pointer, weight carrier and spring (F05)

Working-tree change on top of F03/F04 (`docs/53`, `docs/54`); not committed, not deployed.

**Observed (QA, F05):** the pointer/reference moved when it should stay fixed; carrier/spring
displacement did not consistently correspond to the applied load; no final mechanical travel
limit was visibly enforced.

## 1. What was wrong — measured in the running app (step 6, 90° deflector, n = 0.4)

| load | pan top (mm) | pointer mid (mm) | deflector → nozzle (mm) |
|---|---|---|---|
| none, jet off (rest) | 1433.96 | 1432.62 | 27.77 |
| jet only | 1438.06 | **1436.72** | 31.87 |
| 50 g | 1435.61 | **1434.37** | 29.41 |
| 80 g (balance) | 1434.13 | **1432.83** | 27.94 |
| 580 g | **1433.96** | 1432.64 | 27.77 |
| 780 g | **1433.96** | 1432.62 | 27.77 |

* **The pointer moved with the load.** Its pivot was set to `rest + deflection` every frame,
  so the reference followed the pan it is read against.
* **An overloaded pan read as balanced.** The spring model floored X = h_F − h_w at zero
  (storyboard sl. 8), so any load above the jet force left the pan exactly at rest — on the
  pointer, which is what balance looks like. 580 g and 780 g against an 80 g target were
  indistinguishable from 80 g.
* **No downward travel, so no downward stop**; and each load change moved the carrier in a
  single frame.

## 2. Corrections

* **Pointer fixed** (`DeviceModel.tsx`). The pivot is set to its authored rest height only.
  It still swings aside about its own pin while the cover is open (never during balancing).
  At rest the pointer spans the pan's top face, so balance = carrier at rest.
* **Signed carrier displacement** (`src/domain/spring.ts`). `springDeflectionMm(jet, load,
  maxTravelMm, maxCompressionMm)`: X = h_F − h_w with h = F / k, k = 200 N/m (the workbook's
  `=W/200*1000`, e.g. 0.4905 N → 2.45 mm). Positive while the jet wins, negative while the load
  wins, clamped to `+maxTravelMm` above and `−maxCompressionMm` below. `maxCompressionMm`
  defaults to 0 — the storyboard floor — so every caller that does not pass it is unchanged.
* **The mechanical stop** (`src/lib/carrierTravel.ts`, new) — see §3. Measured at load for each
  fitted deflector (and the bare rod) and passed as `maxCompressionMm`.
* **Progressive response.** The carrier settles on each new load first-order
  (`settleToward`, 6 /s: 95 % in 0.5 s) — no jump, no overshoot, so its height changes
  monotonically between loads and never passes the pointer on the way.
* **Everything on the carrier rides the same number**: rod, pan, disc stack, fitted deflector,
  spring (compresses/extends about its seat), and the after-impact spray, which follows the
  deflector downward (its column's lower end slides into the nozzle tube, hidden). Above rest
  the spray stays as authored, as before.

## 3. The travel/clearance limit — **for engineering approval**

The workbook gives the force/height relationship but no geometric stop, and `S = 0.035 m` alone
does not establish one (QA IMG07). The stop is therefore defined from the model's own geometry,
with the two engineering choices as named constants in `src/lib/carrierTravel.ts`:

| quantity | value | source |
|---|---|---|
| nozzle mouth | y = 1261.76 mm | `Cylinder012` top (`water-alignment.spec.ts`) |
| deflector → nozzle clearance at rest | 27.77 mm (45/90/120/135/180°), 23.39 mm (30°/60° cones) | fitted deflector bottoms |
| spring | 56.4 mm rest; 6 coil passes of 3.9 mm wire, 9.5 mm pitch | measured off `deflector_spring` |
| spring solid height | (6 + 1) × 3.9 = 27.3 mm → closes by 29.1 mm | derived |
| **`MIN_NOZZLE_CLEARANCE_MM`** | **10 mm** — one nozzle bore | **proposed** |
| **`SPRING_WORKING_FRACTION`** | **0.8** of the closing travel → 23.3 mm | **proposed** |

**Stop = min(clearance at rest − 10 mm, 23.3 mm)**, per fitted deflector:

| deflector | downward travel | clearance at the stop | governed by |
|---|---|---|---|
| 45°, 90°, 120°, 135°, 180° | 17.8 mm | 10.0 mm | nozzle |
| 30°, 60° cones | 13.4 mm | 10.0 mm | nozzle |
| bare rod (no deflector) | 23.3 mm | — | spring |

Upward travel is unchanged: 45 % of the spring's rest height (25.4 mm), the storyboard's "will
not exceed the cover or holder surface".

Every lesson reading balances well inside this range (balance is displacement 0), and in the
lesson's ±10 g window the carrier is within 0.5 mm of the pointer.

To change the stop, change either constant; the scene, the tests and this table's numbers all
follow from them (`f05-acceptance.spec.ts` re-derives the spring constants from the mesh).

## 4. Evidence (after) — running app, step 6, 90° deflector, n = 0.4

Every frame traced; the pointer read 1432.62 mm on all of them.

| step | pan top (mm) | frames moving up / down | deflector → nozzle (mm) | spring (mm) | panel |
|---|---|---|---|---|---|
| rest, jet off | 1433.96 | — | 27.77 | 56.4 | |
| jet only | 1438.06 | — | 31.87 | 60.5 | |
| + 50, + 20, + 10 g (80 g) | 1434.13 | down only | 27.94 | 56.6 | Pointer balanced! |
| + 500 g (580 g) | 1416.20 | 0 / 49 | **10.00** | 38.6 | Unbalanced |
| + 200 g (780 g) | 1416.20 | 0 / 0 | **10.00** | 38.6 | Unbalanced |
| − 200 g (580 g) | 1416.20 | 0 / 0 | 10.00 | 38.6 | Unbalanced |
| − 500 g (80 g) | 1434.13 | 49 / 0 | 27.94 | 56.6 | Pointer balanced! |

Contact sheet: `F05-evidence/F05-balance-and-stop.png` (balanced vs overloaded; pan against the
pointer, and the deflector over the nozzle).

## 5. Tests

* `tests/unit/f05-acceptance.spec.ts` (new, 13): AC1 pointer never written with the carrier's
  lift, pin never written, pointer spans the pan at rest; AC2 monotonic to the stop for every
  deflector and four jet forces, balance at rest, ±10 g within 0.5 mm, overload visibly below,
  settling never overshoots; AC3 nozzle mouth where the water model has it, stop exactly at the
  minimum clearance, spring constants re-measured from the mesh, within the spring's limit;
  AC4 no load up to 1 t, jet on or off, brings any deflector inside the clearance.
* `tests/unit/spring.spec.ts`: +7 for the new parameter (signed, monotonic, stop, storyboard
  floor preserved when no allowance is given).
* Whole unit suite compared with the tree before F05: the only differences are these additions.

## 6. Not verified here — run before merging

`npm run test:ci`, in particular `lesson.e2e.ts` (both balancing readings) and
`weight-transfer.e2e.ts` (discs land on a pan that is now moving towards its new height).
