# 54 — One physical family for the weights (F04)

Branch `model/bedo-model-02`, on top of the F03 working tree (`docs/53`). Working-tree
change, not committed, not deployed.

**Observed (QA, F04):** weight assets do not visually represent their relative mass. Small
labelled weights can look comparable to, or larger than, heavier ones.

**Acceptance criteria:** 10, 20, 25, 50, 100, 200 and 500 g have a coherent progression;
the label is legible at normal inspection distance; the mass hierarchy is understandable
without reading every label.

## 1. What was wrong — measured

| disc | drawn for | diameter | thickness | label |
|---|---|---|---|---|
| `Weight_50` | 50 g | 57.4 mm | 5.5 mm | "50 gm", sideways |
| `Weight_100` | 100 g | 57.4 mm | 8.9 mm | "100 gm", sideways |
| `Weight_200` | 200 g | 57.4 mm | 13.2 mm | "200 gm", sideways |
| `Weight_500` | 500 g | 57.4 mm | 16.5 mm | "500 gm", sideways |
| `Weight_Custom` | **10 g** on the tray; **20 g, 25 g** and every custom mass on the pan and in the air | 57.4 mm | **16.5 mm** | none |

* Every disc was the same diameter; thickness was not in proportion to mass (500 g is 3× the
  50 g disc's thickness for 10× its mass — a 12.3 g/cm³ metal).
* The lightest masses were drawn with the heaviest disc's geometry.
* 20 g had no tray disc; 25 g (the custom control's default) had none either.
* Labels were baked into five 2048² atlases, read upright only from the side of the bench
  (the operator stands at −X, `apparatusView.ts`), and only on the four authored discs.

## 2. The family (`src/lib/weightFamily.ts`, new)

One part, one material, sized from its mass alone:

* **Steel, 7.85 g/cm³** — volume is exactly proportional to mass.
* **One bore, 12.7 mm** — what the authored discs have; it slides over the pan's 10.3 mm post.
* **Diameter** D = 57.4 mm · (m / 500 g)^0.16, pinned to the authored 500 g disc.
* **Thickness** from the volume: t = (m/ρ) / (π/4 · (D² − bore²)).

| mass | diameter | thickness | engraved type |
|---|---|---|---|
| 10 g | 30.7 mm | 2.1 mm | 4.6 mm |
| 20 g | 34.3 mm | 3.2 mm | 5.6 mm |
| 50 g | 39.7 mm | 5.7 mm | 7.2 mm |
| 100 g | 44.4 mm | 9.0 mm | 7.8 mm |
| 200 g | 49.6 mm | 14.1 mm | 8.0 mm |
| 500 g | 57.4 mm | 25.9 mm | 8.0 mm |

Both dimensions rise with mass, so a disc is bigger than every lighter disc in both
directions. (The custom weight is the model's own unlabelled part — see §3.)

**Why 0.16.** Geometric similarity (1/3) shrinks 10 g to a 15.6 mm washer with no room for a
mass. The exponent was measured against the lesson's balancing view: 0.18 left the 10 g
engraving at 5.3 px of cap height; 0.16 gives 6.2 px, while every step up in mass is still at
least 3 % wider and 10 % taller (the tightest step, 20 → 25 g, is a 25 % mass difference:
+3.6 % diameter, +16 % height).

**Stack height.** The heaviest load any lesson balances is 520 g (500 + 20): 31 mm on a 57 mm
post. Every lesson target, made from the fewest discs, fits (unit-tested).

**Finish.** The turned body is the deflectors' own steel (`skjirting.001`: metalness 1,
roughness 0.2, #ced3d7) — the weights are the same kit. The face is the same steel turned
flat (metalness 0.7, roughness 0.32), so it catches the room's light instead of mirroring the
dim ceiling.

**Engraving.** A 512² canvas texture per mass: turning marks and the mass ("500g", as the
panel buttons write it). Type is as large as the face allows (8 mm cap height, capped),
fitted inside the steel between bore and rim; centred in that band when it fits, moved in
towards the bore where the band is widest otherwise. It reads upright from where the lesson
camera looks at the tray (`ANCHOR_VIEW.weights`). Seven 512² textures replace five 2048²
atlases.

## 3. Where the discs stand

* **Tray row.** The tray box has no recesses, so the six fixed denominations stand in one
  row on the authored row's line, 7 mm between rims, **lightest nearest the operator**, out
  to 8 mm short of the box's far carrying handle (`control_lab1_511`). The tray layout is
  measured at load off the authored discs and the handles.
  * *Why lightest-first:* measured from the lesson's balancing view, heaviest-first put the
    10 g engraving at 3.7 px; lightest-first no engraving is under 6 px, and each heavier disc
    is still wider on screen than every lighter one.
* **The custom weight** (`Weight_Custom`) is not part of the family (product-owner direction,
  2026-09-28): it is the disc the custom-weight control sets (5–500 g, 25 g to start), not a
  denomination, so it keeps the model's own part — its 57.4 × 16.5 mm shape, its finish, its
  place by the tank — and **no engraved mass**. On the tray and on the pan, whatever the
  control is set to, it is that part. It steps aside while any custom mass is on the pan or in
  the air, and is not shown when the control is on a mass the row already has.
  It is also **named** as the custom weight, never by its mass: the panel buttons read
  "+Custom weight" / "−Custom weight" ("+وزن مخصص" / "−وزن مخصص"), and hovering the disc
  shows "Custom weight". The running total still counts its mass.
* The stack, the flights (`docs/53`), the removal targets and the click targets are all
  measured off these nodes, so they follow unchanged. A custom mass on the pan is the custom
  weight, never another mass's disc.

## 4. Camera for steps 6 and 8 — behaviour change to review

`ANCHOR_VIEW.weights` is 10 % further back, same direction: (−0.44, 0.34, 0.34) →
(−0.484, 0.374, 0.374). At the old distance, at 1920 × 889, the pan and post ran 47 px off
the top of the frame and the operator's end of the tray off the bottom (the authored 500 g
disc sat there half cut off). At the new distance the whole row, the custom disc and the pan
are in frame and the pointer clears the step's notice banner. No other step's framing
changes.

## 5. Evidence

Browser (local dev build, Chrome, 1920 × 889), `F04-evidence/`:

| file | shows |
|---|---|
| `F04-before-after-tray.png` | same camera, authored discs vs the family |
| `2-step6-lesson-view.jpg` | step 6 reached through the lesson; the whole family in frame and legible |
| `3-stack-on-pan.png` | 200 + 100 + 50 + 20 + 10 g on the pan |

Measured in the running app:

| check | result |
|---|---|
| rendered sizes | 10 g 30.7×2.1 … 500 g 57.4×25.9 mm (per the table) |
| stack 200/100/50/20/10 | every disc–disc gap 1.000 mm; top 1473 mm, post tip ≈ 1491 mm |
| flights (add 500/10/25, Clear all) | no contact with pin, pointer, tank or cover; each disc lands on its own slot (≤ 0.3 mm) and the tray disc reappears |
| custom weight (after the product-owner change) | authored part, 57.4 × 16.5 mm, material "Custom weight", no engraving; "+25g" flies that same part to the pan and empties its tray place |
| hover label on a new disc | "20 g" |
| custom weight labels | panel "+Custom weight" (two cells wide), hover "Custom weight", after adding "−Custom weight" with total 25 g; Arabic "+وزن مخصص" / "−وزن مخصص" |
| console | no errors on load |

## 6. Tests

* `tests/unit/f04-acceptance.spec.ts` (new, 18): AC1 — own disc per mass, strict rise in
  both dimensions, steel density from drawn volume, any custom mass coherent, one bore that
  threads the post, every lesson load fits the post; AC2 — every label fits its face, type
  ≥ the baked labels, ≥ 6 px from the lesson camera, oriented to it; AC3 — one row ordered by
  mass, equal gaps, visible steps, volume order = mass order, wider on screen from the lesson
  camera, clear of both handles, whole tray in the step-6 frame.
* The test helper (`tests/helpers/model.ts`) applies the family exactly as `DeviceModel`
  does, so every geometry spec measures what the app renders.
* `src/lib/transferPath.ts` `arcHeightOver`: now also measures where the route enters and
  leaves the tank's footprint (and samples 256 points, not 48). The 10 g slot's route entered
  between two samples and was lifted 1.8 mm short; `weight-transfer.spec.ts` caught it.
* Updated: `apparatus.spec.ts` (every denomination has its own tray disc; none is
  `Weight_Custom`), `glb-contract.spec.ts` (34 contract names, two made by the family).
* Ran here: f04 18/18, f03 19/19, glb-contract 58/58, holder-anchor 27/27, weight-transfer
  19/19, apparatus 32/32, camera-framing 22/22, handling-path 29/29. Whole unit suite
  compared with the pre-F04 tree: the only differences are the additions above (the specs
  that fail here fail identically before the change — this environment lacks some packages).

## 7. Not verified here — run before merging

`npm run test:ci`. In particular the Playwright specs that click tray discs
(`weight-hotspots.e2e.ts`, `weight-transfer.e2e.ts`, `drag.e2e.ts`) and `camera-follow.e2e.ts`
(steps 6/8 framing).
