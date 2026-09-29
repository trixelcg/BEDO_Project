# QA_REPAIR_LEDGER — VL-FM009 Measurement of Jet Forces

Tracking ledger for the repair programme driven by `Jet_Forces_Requirements_Ledger.md`
and `Jet_Forces_Complete_Report.pdf` (both on the user's Desktop, outside this repo).

**This file does not restate the source.** Each row carries the source ID, the phase it
belongs to, its status, where the work lives, and how it will be proven. The normative
wording stays in the source ledger; read it there.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `open` | Not started. No claim about the current build either way. |
| `in_progress` | Being worked on in the current phase. |
| `implemented_unverified` | Code exists and is believed to satisfy the item, but no evidence of the kind the criterion demands has been produced. |
| `verified` | Evidence exists, recorded in `QA_REPAIR_VALIDATION.md`, and it matches what the criterion actually asks for. |
| `blocked` | Cannot proceed without an input this repository does not contain. The blocker is named in the row. |
| `not_applicable_with_reason` | Out of scope for code repair. The reason is in the row. |

A green `build`, `typecheck` or `lint` never moves a row to `verified`. Physics rows need
numeric evidence; visual rows need rendered evidence; behavioural rows need a driven run.

## Phase map (from source §4, C01–C06)

| Phase | Source | Scope |
| --- | --- | --- |
| P0 | — | Inventory, baseline, unit map, gap list. **This phase.** |
| P1 | C01 | Measurement + calculation path: F18, F19 |
| P2 | C02 | Authoritative runtime state: F09, F10, F11, F15 |
| P3 | C03 | Mechanical logic: F03, F04, F05 |
| P4 | C04 | Water/deflector physics: F08 |
| P5 | C05 | Geometry and visuals: F01, F02, F06, F07 |
| P6 | C06 | Guided/UI/navigation: F12, F13, F14, F16, F17 + UI01–UI12 |
| P7 | C07 | End-to-end regression: A01–A20 |

Cross-references are noted per row; the phase column gives each item exactly one owner.

## Open blockers that gate whole rows

| Blocker | Rows gated | Detail |
| --- | --- | --- |
| BLK-01 | F19-AC01, F19-AC02, A04 | `Logic(final) 2.xlsx` is **not in this repository**; only a values screenshot (P1:AF20, column Y hidden) was supplied on 2026-09-29. Y38 `#REF!` and the Y24→T15 / Y37→T29 cross-block references cannot be inspected, let alone repaired. See `QA_REPAIR_CONTEXT.md` §5. |
| BLK-02 | G01–G05 | Neither `Jetforce-1.fbx` nor `Jetforce-2.fbx` is in this repository. The provenance figures cannot be re-derived. |
| BLK-03 | F05-AC03, F05-AC05, F10-AC04, DEC03 | The geometric travel/clearance stop is an engineering decision the source explicitly declines to give (F05-AC05). `src/domain/spring.ts` correctly refuses to invent one and takes it as a caller parameter. |
| BLK-04 | F18-AC01, DEC02 | The approved volumetric procedure (valve states, completion condition, F_ac record condition) is undefined in the source (DEC02). Volume/duration/tolerance numbers must not be invented. |
| BLK-05 | UI00, UI01-05, UI12-09, DEC05 | Final BEDO UI V3 tokens are TBD by the source's own statement. Structure and behaviour are implementable now; exact tokens are not. |

---

## 1. Findings F01–F19 — required corrections and acceptance criteria

`Files / evidence` records what exists **today**; it is a starting point, not a claim of
compliance. Every row below is `open` unless marked otherwise: nothing in this programme
has been verified yet.

### F01 — Lab orientation and environment placement (P5, High)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F01-REQ01 | P5 | open | `src/lib/roomEnvironment.ts`, `src/components/Scene3D.tsx`, `public/Bedo_baked_v2.glb` | Rebuild attachment/UV/material placement; diff rendered stills against `docs/reference/reference-render.png`. |
| F01-REQ02 | P5 | open | `src/lib/cameraFraming.ts`, `src/lib/apparatusView.ts` | Re-capture every anchor in `apparatusView.ts` after REQ01 lands. |
| F01-AC01 | P5 | open | as above | Rendered still per approved camera; floor below, ceiling above, in all. |
| F01-AC02 | P5 | open | `roomEnvironment.ts` | Still + node-transform dump: no environment surface detached from its parent. |
| F01-AC03 | P5 | open | `Scene3D.tsx` | Rendered stills show the rig inside the room from every approved view. |

Source images: E01 / IMG01 (§7.1) — also drives F06 and F12.

### F02 — Model integrity: gaps, floating parts, intersections, extra geometry (P5, High)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F02-REQ01 | P5 | open | `public/Bedo_baked_v2.glb`, `src/components/DeviceModel.tsx` | Treat as one assembly; audit hierarchy with `npm run glb:nodes`. |
| F02-REQ02 | P5 | open | `scripts/analyze-glb.mjs`, `src/lib/gltfNames.ts` | Fix parenting/anchors, remove stray geometry, re-check approved views. |
| F02-AC01 | P5 | open | `glb:nodes` output | Every visible mesh resolves to a valid parent in the node chain. |
| F02-AC02 | P5 | open | `DeviceModel.tsx` hose meshes | Rendered still per hose end: terminates at a connector, not in air. |
| F02-AC03 | P5 | open | animation paths in `DeviceModel.tsx`, `src/interaction/transfer.ts` | Sample intermediate frames of each animated move, not only the last. |
| F02-AC04 | P5 | open | valve/base region of the GLB | Named node removed from the GLB; asserted in `tests/unit/glb-contract.spec.ts`. |

Note: `docs/OPTIMIZED_GLB` policy — `public/Bedo_baked_v2.glb` is the shipped baseline.
Any geometry change here is a deliberate re-bake and must be recorded, not a side effect.
Source images: E02, E03 / IMG02 (§7.1).

### F03 — Deflector and weight install/remove/snap credibility (P3, High)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F03-REQ01 | P3 | implemented_unverified | `src/lib/handlingPath.ts` (`travelHeight`, `travelHeightOver`), `src/interaction/transfer.ts`, `DeviceModel.tsx` `startFlight` | Controlled route per QA sketch: straight up out of the rest → level/arched carry at a set travel height → straight down the destination axis. Browser frame traces drawn over the scene in `docs/53` §4a. |
| F03-REQ02 | P3 | implemented_unverified | `DeviceModel.tsx` (fitted deflector rides `holderLift` exactly; `DeflectorPose`), `src/lib/rigidFit.ts` (new) | Fitted centres measured on the axis for all seven (≤ 0.1 mm); rod-to-deflector gap constant (−12.16 mm) while the cover opens — was up to +230 mm. |
| F03-REQ03 | P3 | implemented_unverified | `holderAnchor.ts` (unchanged seats); disc arrives down the post (`handlingPath`) | Seats unchanged; arrival on-axis (0.0 mm) below the post tip in every traced frame. |
| F03-REQ04 | P3 | implemented_unverified | `DeviceModel.tsx` drag `onCarry` (post constraint), `heldSeats` | A hand-held pan disc moves only up the post until clear of the tip; its seat is drawn empty while held. |
| F03-AC01 | P3 | implemented_unverified | `tests/unit/f03-acceptance.spec.ts` (AC1), `tests/unit/handling-path.spec.ts` | Every fitted deflector centred on the nozzle axis (< 0.5 mm; browser 0.000–0.001 mm after 10 swaps), rod end inside the deflector, approach phase on the axis. |
| F03-AC02 | P3 | implemented_unverified | `tests/unit/f03-acceptance.spec.ts` (AC2), install queueing in `DeviceModel.tsx` | Every seat 1.000 mm above the one below (browser: 4 gaps, all 1.000 mm); a disc only lines up above the post tip and never stops part-way; 0 frames off-axis below the tip. |
| F03-AC03 | P3 | implemented_unverified | `tests/unit/f03-acceptance.spec.ts` (AC3), `holderAnchor.ts` (unchanged) | Four identical discs stack at one constant pitch (thickness + 1 mm) on one axis; browser: 3 × 50 g at 6.506 / 6.506 mm. |
| F03-AC04 | P3 | implemented_unverified | `tests/unit/f03-acceptance.spec.ts` (AC4), `DeviceModel.tsx` removal observer, `transfer.ts` `STACK_CLEAR_STAGGER_SECONDS` | Removal ends exactly on the disc's tray slot (unit: < 1e-9 m; browser ≤ 0.2 mm) and the tray disc is shown again; Clear all top first. |

Source images: E04, E05, E19, E20 / IMG03, IMG04, IMG15 (§7.1). Cross-ref F10.

### F04 — Weight assets do not represent relative mass (P3, High)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F04-REQ01 | P3 | implemented_unverified | `src/lib/weightFamily.ts` (new), `DeviceModel.tsx`, `apparatus.ts` `WEIGHTS`, `docs/54` | One steel family (7.85 g/cm³, 12.7 mm bore) for every mass: D = 57.4 mm·(m/500 g)^0.16, thickness from volume. Applied to the model at load; 10 g and 20 g get discs of their own. The custom weight keeps the model's own unlabelled part (product-owner direction). |
| F04-REQ02 | P3 | implemented_unverified | `tests/unit/f04-acceptance.spec.ts` (AC1) | Measured on the loaded model: diameter and thickness rise strictly with mass across 10/20/25/50/100/200/500 g, and every disc's drawn volume gives steel's density (±1 %). Before: all five authored discs 57.4 mm; `Weight_Custom` (used for 10/20/25 g) 16.5 mm thick, = the 500 g. |
| F04-AC01 | P3 | implemented_unverified | `f04-acceptance.spec.ts` AC1 + custom-weight block; browser `docs/54` §5 | 10/20/50/100/200/500 g each have their own family disc on the tray row. 25 g is the custom-weight control's starting mass, not a denomination: it is the model's own plain, unlabelled custom disc (product-owner direction, 2026-09-28). |
| F04-AC02 | P3 | implemented_unverified | `f04-acceptance.spec.ts` AC2; `F04-evidence/2-step6-lesson-view.jpg` | Engraved mass on every face, 4.6–8 mm type, upright from the operator; ≥ 6 px cap height for every disc in the lesson's own balancing view (steps 6/8, 1920×889). Close inspection: all legible (`1-after-tray.png`). |
| F04-AC03 | P3 | implemented_unverified | `f04-acceptance.spec.ts` AC3; `F04-evidence/F04-before-after-tray.png` | One row, lightest nearest the operator, equal 7 mm gaps; each heavier disc ≥ 3 % wider and ≥ 10 % taller than the next lighter, and wider on screen from the lesson camera; whole row and pan in the step-6 frame. |

Source images: E06 / IMG05 (§7.1).

### F05 — Pointer, carrier and spring behaviour (P3, Critical)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F05-REQ01 | P3 | implemented_unverified | `DeviceModel.tsx` frame loop (pointer pivot set to its rest height only), `docs/55` | The pointer is a fixed reference: it no longer rides the carrier's deflection; it only swings aside about its pin while the cover is open. Browser: pointer 1432.62 mm on every traced frame across 0→780 g→80 g. |
| F05-REQ02 | P3 | implemented_unverified | `src/domain/spring.ts` `springDeflectionMm(…, maxCompressionMm)`, `lib/carrierTravel.ts` | Carrier follows signed `X = h_F − h_w`: above the pointer while the jet wins, below it while the load wins (the storyboard floor made an overloaded pan read as balanced). Settles first-order, no overshoot (`settleToward`). |
| F05-REQ03 | P3 | implemented_unverified | `carrierTravel.ts` `carrierStop`, `DeviceModel.tsx` | Progressive only while travel remains; stops at min(nozzle clearance, spring working compression), measured per fitted deflector at load. |
| F05-AC01 | P3 | implemented_unverified | `tests/unit/f05-acceptance.spec.ts` (AC1); browser `docs/55` §4 | Pointer mid-height constant (1432.62 mm) over every frame of the load sweep; source check that nothing adds the carrier to it. |
| F05-AC02 | P3 | implemented_unverified | `f05-acceptance.spec.ts` (AC2), `spring.spec.ts` | Every added gram lowers the carrier until the stop, then nothing does (all deflectors, four jet forces). Browser: each load step moves the pan one way only (e.g. +500 g: 49 frames down, 0 up). |
| F05-AC03 | P3 | implemented — **values pending engineering approval** (BLK-03/DEC03) | `carrierTravel.ts` `MIN_NOZZLE_CLEARANCE_MM = 10`, `SPRING_WORKING_FRACTION = 0.8`; `f05-acceptance.spec.ts` (AC3) | Proposed stop: 10 mm deflector-to-nozzle clearance (one nozzle bore), within 80 % of the spring's closing travel (solid ≈ 27.3 mm of 56.4 mm). Governs as 17.8 mm drop (flat/hemi/45°/135°), 13.4 mm (30°/60° cones). Derived from the model geometry, **not** from S = 0.035 m. |
| F05-AC04 | P3 | implemented_unverified | `f05-acceptance.spec.ts` (AC4); browser | Any load up to 1 t, with or without the jet: the deflector keeps ≥ 10 mm to the nozzle mouth (`Cylinder012`, y 1.26176). Browser: 580 g and 780 g both hold the 90° deflector at 10.00 mm. |
| F05-AC05 | P3 | documented — **awaiting engineering sign-off** (BLK-03/DEC03) | `docs/55_BALANCE_MECHANISM_F05.md` §3 | The limit, its derivation and the two constants to approve are documented in one place; changing either constant moves the stop everywhere and the acceptance spec re-checks it. |

Source images: E07, E08, E09 / IMG06, IMG07, IMG33 (§7.1/§7.2). Cross-ref F19-AC05.

### F06 — Materials, normals, transparency, lighting, contact grounding (P5, Medium)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F06-REQ01 | P5 | open | `src/lib/materialFamilies.ts`, `docs/46_MATERIAL_RESPONSE.md`, `docs/47_GLASS_OPTICAL_RESPONSE.md` | Normals/sorting/PBR/AO pass; diff rendered stills. |
| F06-REQ02 | P5 | open | `materialFamilies.ts` (LED / display families) | Status light and wall board get intentional device materials. |
| F06-AC01 | P5 | open | GLB normals | Render at grazing angles; no flipped faces or sorting artefacts. |
| F06-AC02 | P5 | open | `materialFamilies.ts` | Sample rendered pixel values on black metal under the scene lighting. |
| F06-AC03 | P5 | open | `Scene3D.tsx` `ContactShadows` | Rendered still shows contact shadow under each seated object. |
| F06-AC04 | P5 | open | `materialFamilies.ts` | Green LED reads as a controlled indicator, not a flat glow. |
| F06-AC05 | P5 | open | wall board material | Board reads as an LED/TV surface. |

Caution: colour probes in an ACES tone-mapped pipeline are unreliable — compare against a
disabled build rather than reading absolute shader colours. Source: E10–E12 / IMG08–IMG10.

### F07 — Selection highlight is too gold and masks the material (P5, Medium)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F07-REQ01 | P5 | implemented_unverified | `src/lib/selectionOutline.ts`, `docs/56` | No surface recolour: the deployed gold emissive clone was replaced by an outline (BEDO-LOOK-04, undeployed); F07 masks that outline off the part with the stencil and removes the depth pre-pass that turned the glass tank opaque. |
| F07-REQ02 | P5 | implemented_unverified | same; `labPostProcessing.ts`, `Scene3D.tsx` (stencil buffers) | Two-tone contour: 2.5 px pale amber `#ffe2a0` + 2 px dark keyline; material, geometry and transform never written. |
| F07-AC01 | P5 | implemented_unverified | `tests/unit/f07-acceptance.spec.ts` (AC1); browser `docs/56` §1 | Pixels of the highlighted part changed (interior): 50 g 0.2 %, 180° 0 %, 30° 0 %, custom 0 %, tank 0.1 % — was 3–10 % (tank 97 %) before F07, 48–96 % in the deployed build. |
| F07-AC02 | P5 | implemented_unverified | `f07-acceptance.spec.ts` (AC2) `outlineContrast`; `docs/56` §3 | ≥ 3 : 1 against every background luminance; measured 5.2 / 4.1 / 8.6 : 1 on white / grey / black (gold alone: 1.6 / 1.35 / 6.7). |
| F07-AC03 | P5 | implemented_unverified | `f07-acceptance.spec.ts` (AC3) | Part geometry shared and unmodified, outline outside the asset hierarchy, screen-pixel widths (≤ 3 / ≤ 5 px), not pickable, no shadows. |

Source: E13 / IMG11 (§7.1). IMG11 carries an in-image YouTube link as a style reference
only; it was not opened and is not evidence.

### F08 — Water/VFX not physically coupled (P4, Critical)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F08-REQ01 | P4 | implemented_unverified | `src/lib/jetFlow.ts` (new), `src/lib/jetFlowMesh.ts` (new), `DeviceModel.tsx`, `docs/57` | Water is one path per azimuth recomputed each frame from `state.live` (v0, Q), the fitted deflector (`hasInstalledDeflector`, not carried) and `holderLift`. The eight authored caches are no longer drawn. |
| F08-REQ02 | P4 | implemented_unverified | `jetFlow.buildJetPath` | No contact: a straight column from the nozzle (continuity widening only) to the cover, then down the wall. No film or sheet. |
| F08-REQ03 | P4 | implemented_unverified | `measureWettedSurface`, `buildJetPaths` | Contact at the deflector's measured underside; film along it; release at the rim at the deflector's angle (the 45° wedge per azimuth); gravity; follows cover/wall/tube to the floor pool. |
| F08-AC01 | P4 | implemented_unverified | `f08-acceptance.spec.ts` AC1; browser `docs/57` §3 | No deflector: column 1261.8 → 1355.7 mm, r 5.00 → 5.23 mm, no film/sheet, 0 penetrations. |
| F08-AC02 | P4 | implemented_unverified | spec AC2; browser §3 | Jet → surface gap = the 0.6 mm film offset on all 40 azimuths, all seven deflectors (browser 0.44–0.67 mm). Was 7.5 mm short (90°), and 24 mm short at reading 1. |
| F08-AC03 | P4 | implemented_unverified | spec AC3; browser §3 | First strike: 30° cover, 45° cover/level by azimuth, 60° wall 1327, 90° 1285, 120° 1247, 135° 1218, 180° curtain to floor; pairwise distinct. |
| F08-AC04 | P4 | implemented_unverified | spec AC4 (all deflectors × 4 flows × 40 azimuths); browser 0 points inside a solid | Was: caches 19–29 mm into the base. |
| F08-AC05 | P4 | implemented_unverified | spec AC5; browser: every path ends at 1083.0 mm (floor + 2 mm) | No fade band. The pool shows landing rings and foam. |
| F08-AC06 | P4 | implemented_unverified | spec AC6; browser §3 flow table | v0 = domain's; column 5.46 → 5.00 mm; 60° strike 1300 → 1327 mm → cover; pattern advects at the water's speed. |
| F08-AC07 | P4 | implemented_unverified | spec AC7; browser §3 | +500 g: deflector −16.48, contact −16.50, strike −16.3 mm; cleared: exact return. |
| F08-VIS (user, 2026-09-29) | P4 | verified (visual) | `waterMaterial.ts` realism terms (ligaments, impact ring, edge droplets, streaky fresnel floor); `docs/67`; driven run 2026-09-29 | “Realistic and in sync with deflectors and weights.” Sync was already structural (measured undersides + `liftM`), re-verified live: +500 g moves film, ring and curtain with the carrier. `water-material.spec` 16 pins terms, caps and declaration order; `WATER_VISIBILITY` averages unchanged. |

Water caches are authored in rig space (scale 0.01, no fitting) — walk the whole node
chain when checking transforms. Source: E14–E16 / IMG12, IMG13 (§7.1). Cross-ref F18.

### F09 — Controls not bound to one authoritative state (P2, Critical)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F09-REQ01 | P2 | implemented_unverified | `src/simulation/state.ts`, `runtime.ts`; `docs/58` | Q_total, the custom disc's mass, "a deflector is fitted" and each reading's Q_total/deflector are runtime state; App keeps no copy (`f09-acceptance.spec.ts` AC1, AC3, AC6). |
| F09-REQ02 | P2 | implemented_unverified | `UIOverlay.tsx`, `App.tsx`; `docs/58` §1–2 | Every Parameters control dispatches to the runtime; the custom slider is disabled with its reason while discs move; the duplicate deflector buttons are removed. |
| F09-REQ03 | P2 | implemented_unverified | `UIOverlay.tsx` Parameters (F09) panel | An editor over the runtime: Q_total and custom mass editable, deflector/law/k and v₀, force, load, balance read-only from `state.live`. |
| F09-AC01 | P2 | implemented_unverified | `SET_CUSTOM_WEIGHT`; `f09-acceptance.spec.ts` AC1; browser `docs/58` §3 | Custom 55 → 35 g on the carrier: load 105 → 85 g on panel, Steps, board and monitor; balance to "Balanced"; rod −1.051 → −0.070 mm. |
| F09-AC02 | P2 | implemented_unverified | carrier reads `state.live.jetForceOnCarrierN`; AC2; `docs/58` §3 | Q_total 120 → 60: Q 15.714 → 7.857 L/min, F 0.8199 → 0.1646 N everywhere; rod +1.647 → −1.630 mm (was fixed at +1.647). |
| F09-AC03 | P2 | implemented_unverified | `domain/forceLaw.ts`, `deflectorFitted`; AC3; `docs/58` §3 | 90° → 45°: k 1.000 → 0.500 and F 0.8199 → 0.4100 N on panel, board and monitor; the fitted deflector's law; water path follows the fitted wedge. |
| F09-AC04 | P2 | implemented_unverified | Parameters panel; AC4 | Labelled sliders with units and `aria-valuetext`; every derived figure carries its unit. |
| F09-AC05 | P2 | implemented_unverified | `runtime.ts` `reset()`, `SELECT_EXPERIMENT`; AC5 | Reset restores the rig and keeps both parameters alike (the custom mass used to reset alone); Restore defaults via the runtime. No Save/Load (DEC06). |
| F09-AC06 | P2 | implemented_unverified | AC6; `docs/58` §1 | Deflector chosen only on the tray/Steps; monitor law = fitted deflector's (IMG25); readings keep their Q_total. |

Source: E17, E18 / IMG14, IMG25 (§7.1). IMG25 flags a 90° / k = 1.000 label shown beside
a 1.707 coefficient expression — an image observation to audit, **not** proof the
internal calculation uses 1.707. `apparatus.ts` gives 90° a `momentumFactor` of 1.0 and
135° a factor of 1.707, so the pairing in the screenshot needs explaining. Cross-ref F19.

### F10 — Weight actions not atomic (P2, High)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F10-REQ01 | P2 | implemented_unverified | `runtime.ts` commits once per accepted command; `state.ts` `freezeSimulationState`; `docs/59` | One commit per weight action, all dependents derived (`f10-free-mode.spec.ts` AC3). |
| F10-AC01 | P2 | implemented_unverified | `runtime.ts` `dispatch` — rejection returns state by identity; `f10-free-mode.spec.ts` AC3 | A refused add (error1) leaves the state identical. |
| F10-AC02 | P2 | implemented_unverified | `stateMachine.ts` `ADD_WEIGHT`; `f10-free-mode.spec.ts` AC3 | 50 g twice → [50, 50], load 100 g. Browser not re-run (`docs/59` §5). |
| F10-AC03 | P2 | implemented_unverified | `stateMachine.ts` `REMOVE_WEIGHT` (by stack index), `tests/unit/weight-removal.spec.ts`, `f10-free-mode.spec.ts` AC3 | Remove by index and remove all; the stack and the total follow. |
| F10-AC04 | P2 | **blocked** (BLK-03) | capacity/travel limit undefined | Limits must come from the approved physical constraint, not a UI cap. |

Source: E19, E20 / IMG04, IMG15 (§7.1).

### F11 — Free Mode incomplete, unjustified interlocks (P2, Critical)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F11-REQ01 | P2 | implemented_unverified | `gate.ts` `FREE_MODE` bypass; free readings (`RECORD_FREE_READING`); `docs/59` | Whole experiment in Free Mode: set up, run, load, record, evaluate in the monitor. Driven in the browser (`docs/59` §6). |
| F11-REQ02 | P2 | implemented_unverified | `stateMachine.ts` guards, `apparatusGate.ts`; `f10-free-mode.spec.ts` AC1 | Only BEDO's error1–error5 remain, each with its code and wording; the valve-needs-pump lock is removed (DEC04, `docs/59` §3). |
| F11-REQ03 | P2 | implemented_unverified | `App.tsx` `handleSetMode` / `handleConfirmGuided`, `ModeSwitchDialog.tsx` | A mode change never touches the runtime; Free → Guided mid-run asks. `SELECT_EXPERIMENT` (a new sheet) still resets the rig by design. |
| F11-AC01 | P2 | implemented_unverified | `stateMachine.ts` `SET_VALVE`, `OPEN_VOLUMETRIC_VALVE`; AC1 | Both valves operate at rest, cover open, pump on and loaded. |
| F11-AC02 | P2 | implemented_unverified | `stateMachine.ts` `POWER_OFF`; `selectors.ts` `selectJetState`; AC2 | Power off keeps the valve (0.4), Q_total, custom mass and deflector; flow and force 0; power on restores the same flow. |
| F11-AC03 | P2 | implemented_unverified | `stateMachine.ts` weight actions; AC3 | Add, repeat, remove by index, remove all; guards error1/error5 apply. Capacity limit still BLK-03. |
| F11-AC04 | P2 | implemented_unverified | `SoftwareMonitor.tsx` Record/Clear, `selectFreeReadings`; AC4; `docs/59` §6 | Free readings (≤ 10) fill the table, graph, CSV and board rows by the lesson's `computeRow`, with F_ac shown at once. |
| F11-AC05 | P2 | implemented_unverified | `App.tsx`, `ModeSwitchDialog.tsx`; AC5 | Switching keeps the rig, parameters and readings; only the dialog's "Reset" resets (and keeps Q_total and the custom mass). |

Source: E21, E22 / IMG16 (§7.1). Cross-ref DEC04.

### F12 — Camera clipping and out-of-bounds (P6, High)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F12-REQ01 | P6 | open | `src/components/Scene3D.tsx:719-725` — `OrbitControls` with `minDistance 0.6`, `maxDistance 8`, `maxPolarAngle π/2 + 0.25` | The polar limit currently permits going **below** the horizon; audit against approved space. |
| F12-REQ02 | P6 | open | `Scene3D.tsx`, `src/lib/roomEnvironment.ts` | No clipping through rig, walls, floor, ceiling. |
| F12-REQ03 | P6 | open | `src/lib/cameraFraming.ts`, `src/lib/apparatusView.ts` | Reliable reset/default view plus a preset selector that preserves state. |
| F12-AC01 | P6 | open | `Scene3D.tsx` | Sweep the reachable camera volume; render; no penetration. |
| F12-AC02 | P6 | open | `Scene3D.tsx` | Enumerate reachable extremes; no invalid under/behind/ceiling view. |
| F12-AC03 | P6 | open | `cameraFraming.ts`, `tests/e2e/camera-follow.e2e.ts` | Switch preset; assert weights, flow, deflector, readings, step unchanged. |
| F12-AC04 | P6 | open | not implemented — no camera gallery exists | Numbered/thumbnail gallery. Cross-ref UI10. |

Source: E23 / IMG17 (§7.1), IMG01 (§7.1).

### F13 — Walkthrough video player traps the user (P6, High)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F13-REQ01 | P6 | implemented_unverified | `src/components/WalkthroughVideo.tsx` (portal, `interactive`, Escape); `docs/60` | Close and Escape return to the simulator with no reload or state loss (browser, `docs/60` §3). |
| F13-REQ02 | P6 | implemented_unverified | `WalkthroughVideo.tsx` controls; `server.ts` byte ranges | Play/Pause, ±10 s and timeline; controls in their own row; the server serves 206 ranges so seeks land. |
| F13-AC01 | P6 | implemented_unverified | `walkthrough-video.spec.tsx` AC1; `f13-walkthrough-video.spec.ts`; browser | Real clicks: Video opens over the docked monitor; Close exits, focus returns; Escape closes the video only. |
| F13-AC02 | P6 | implemented_unverified | `walkthrough-video.spec.tsx` AC2; `docs/60` §3 | Old server: seekable [0,0], seeks → 0. New: 60 → 60, 12 → 12, 70 → 70 (headless Chromium, VP9 copy). |
| F13-AC03 | P6 | implemented_unverified | `walkthrough-video.spec.tsx` AC3; `docs/60` §3 | Seek to 70, play: +1.46 s in 1.5 s; pause holds. |
| F13-AC04 | P6 | implemented_unverified | player imports no simulation; `walkthrough-video.spec.tsx` AC4; browser | Valve, pump, load, free readings and board identical before and after open → seek → close/Escape. |

Source: E24 / IMG18 (§7.1).

### F14 — Guided progression not synchronised with state (P6, Critical)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F14-REQ01 | P6 | implemented_unverified | `schema.ts` `condition`, `runner.sync`, `App.tsx` layout-effect sync; `docs/61` | Every state-shaped step finishes on the runtime's state after every commit; the Steps view and card read the same runner. |
| F14-REQ02 | P6 | implemented_unverified | `StepProgress.tsx` (new), `LessonView.progress` | Browser walk `docs/61` §3: the list changes on the same action that changes the rig. |
| F14-REQ03 | P6 | implemented_unverified | `experiments.ts` steps 9–11; `f14-guided-progress.spec.ts` | Every quoted control (EN/AR) is a real button label; Calculate located "under the results table" in the monitor. |
| F14-AC01 | P6 | implemented_unverified | balance steps `condition`; AC1; browser | 70 → 80 g: step 6 → 7 with no OK; 240 → 260 g: step 8 → 9. Also via disc removal and Q_total. |
| F14-AC02 | P6 | implemented_unverified | `StepProgress.tsx`, `index.css` `.step-row.*`; AC2 | Check/Done, arrow/bold/edge/Now, hollow/dim/Next; `aria-current="step"`. |
| F14-AC03 | P6 | implemented_unverified | `StepProgress.tsx` effect keyed on current step; AC3; `steps-view.spec.tsx` | Scroll count unchanged by weight clicks and note dismissal; +1 on the step change; list-only `scrollTo`. |
| F14-AC04 | P6 | implemented_unverified | rows are inert `<li>`; `App.tsx` `guidedWouldRecogniseRig`; AC4 | No handler/button/tab stop; Guided takes back only the rig it left (F10 "Keep" removed). |
| F14-AC05 | P6 | implemented_unverified | `currentLesson.ts`; `UIOverlay.tsx` note "Got it"; AC5 | Eleven procedure steps only; assessment unnumbered; notes no longer offer a second OK. |
| F14-AC06 | P6 | implemented_unverified | `runner.ts` complete guards; `StepInstructionCard.tsx` completed form; finished row; AC6 | Step 11 = "Open the answer sheet"; then "Complete" badge, "You finished!", no OK, "11 of 11 done". |
| F14-AC07 | P6 | implemented_unverified | `UIOverlay.tsx` dock + Steps toggle; AC7 | The step card stays throughout Guided; the list can be hidden/shown (footer "Steps", ×). |

Source: E25, E26 / IMG19, IMG25 (§7.1). IMG25 notes a Calculate button **is** visible in
one screenshot, so F14 is about the action's availability and path per state — not a claim
that the control is absent everywhere. `currentLesson.ts` has a `record-actual-force` step
and `runtime.ts` a `RECORD_ACTUAL_FORCE` command; reconcile the wording against both.

### F15 — Live, recorded and balance states not separated (P2, High)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F15-REQ01 | P2 | implemented_unverified | `selectors.ts` `selectReadingStatuses`; `SoftwareMonitor.tsx` Live/Recorded sections; `DeviceModel.tsx` board rows; `docs/62` | One status per row (reference/recorded/live/pending) drives table, graph, board and CSV. |
| F15-REQ02 | P2 | implemented_unverified | `isValidMeasurement`; `END_READING`, `RECORD_ACTUAL_FORCE`, `RECORD_FREE_READING` guards | Flow > 0, load > 0, balanced within ±10 g, jet on the carrier; Calculate needs both readings. |
| F15-AC01 | P2 | implemented_unverified | `selectRecordedReadingCount`; `f15-recorded-state.spec.ts` AC1; browser `docs/62` §3 | Asserted after every command of the procedure; 50 g on reading 1 reads 0 / 2 (was 1 / 2). |
| F15-AC02 | P2 | implemented_unverified | `selectActualForceBlocker`, `selectFreeReadingBlocker`; AC2 | Defined from existing rules only (balance tolerance, fitted deflector, jet on carrier); DEC02's volumetric part stays open (`docs/62` §2). |
| F15-AC03 | P2 | implemented_unverified | `SoftwareMonitor.tsx`, `index.css` `.mon-live-section`/`.mon-row.is-*`; AC3; `recorded-state.spec.tsx` | Dashed Live section vs solid Recorded section; live/pending rows show no numbers and say so. |
| F15-AC04 | P2 | implemented_unverified | `ResetDialog.tsx`, `App.tsx` `resetSummary`; monitor Reset removed; AC4 | Dialog lists what is cleared (with counts) and kept (with values); browser `docs/62` §3. |

Source: E27, E28 / IMG20 (§7.1). IMG20's Q = 27.024 L/min and F_th = 2.5303 N with a live
zero weight and a 2/2 counter is a snapshot to reconcile — the source is explicit that the
two being shown together does not by itself prove the history wrong.

### F16 — Layout, responsive behaviour, control-state readability (P6, High)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F16-REQ01 | P6 | implemented_unverified | `index.css` `.guided-shell` grid (safe-area padding, rails, centre, bottom row); `UIOverlay.tsx` shell; `docs/63` | Nothing hand-positioned; dock/footer in flow; popups in the centre column; close controls stay reachable (monitor Close at 1280–2560). |
| F16-REQ02 | P6 | implemented_unverified | `.guided-centre`; aside weights rail; `docs/63` §3 | Canvas centre unobstructed at every audited state and size. |
| F16-AC01 | P6 | implemented_unverified | In-page audit at 1280×720, 1366×768, 1440×900, 1920×1080, 2560×1440 (EN + AR, 15 states each); `docs/63` §3 | 0 clipped, 0 obscured, 0 overlaps, 0 off-viewport, 0 word-per-line. Was: dock top −97 px, 4 overlaps. |
| F16-AC02 | P6 | implemented_unverified | `.guided-dock` / `.step-progress-list` / rails `overflow-y: auto; min-height: 0`; monitor `minmax(0, 1fr)`; `f16-layout-states.spec.ts` | 0 horizontal overflow in any panel (docked monitor was 407 px content in 268 px). |
| F16-AC03 | P6 | implemented_unverified | `:focus-visible` ring, disabled (dashed/faded/desaturated), `button.is-selected` bar + `aria-pressed`, popup words + icons, success ticks, `--danger-fill`, `.is-danger`; `f16-layout-states.spec.ts` | 0 enabled labels under 4.5:1 at any size (was 1.00 monitor button, 2.59–3.89 others). |
| F16-AC04 | P6 | implemented_unverified | CSS grid + `@container dock` step-card layout; no `bottom:` offsets | Reflows from 1280 to 2560 wide; step card stacks below 620 px dock width. |

Target resolutions/aspect ratios are undefined — see DEC05; F16 was verified at the sizes `docs/23`/`51` used plus 1280×720. Source: E29 / IMG19, IMG21. Not run here: vitest/jsdom and Playwright (`docs/63` §5).

### F17 — Hover identification and anchored component info (P6, Medium)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F17-REQ01 | P6 | implemented_unverified | `src/domain/componentInfo.ts`; `lib/cursorTooltip.ts` three-line tooltip; new proxies in `DeviceModel.tsx`; `docs/64` | Every reviewed part names itself and its function on hover (driven in the browser, EN + AR). The cover had no label before; pointer, spring, carrier, flowmeter scale and installed deflector had no proxy. |
| F17-REQ02 | P6 | implemented_unverified | `components/ComponentCard.tsx` | Right-click on any part, or click on an informational part with no control behind it, opens the card; Escape / close button; focus shows the compact card. |
| F17-REQ03 | P6 | implemented_unverified | `anchorIdOf` (`vlfm009.<part>[.<where>][.<variant>]`); `lib/componentAnchor.ts`; `hoverProxy` | Stable anchor ids; the hover path calls no handler (`f17-component-info.spec.ts` AC3). |
| F17-AC01 | P6 | implemented_unverified | `COMPONENTS`; browser hover per part (`docs/64` §3) | Flowmeter = the bench's measuring-tank scale (`Rectangle002/003`), identification only; the measurement itself is F18 (DEC02/BLK-04). |
| F17-AC02 | P6 | implemented_unverified | `describeComponent` read by tooltip, card and focus card; inline `labelFor` removed | Asserted in `f17-component-info.spec.ts` AC2. |
| F17-AC03 | P6 | implemented_unverified | `hoverProxy`; operational clicks unchanged; card is presentation state (5 `runtime.dispatch`) | Right-clicks on every part left the rig unchanged (`docs/64` §3). |
| F17-AC04 | P6 | implemented_unverified | `placeCard`; per-frame anchor projection | Every card inside the viewport, clear of its anchor, 14–22 px from the part, EN + AR. |
| F17-EXT (user, 2026-09-29) | P6 | verified (driven run) | tooltip off while the camera moves: `setCursorTooltipCameraMoving` + `CameraMotionGate` (frame-level camera watch, 8-still-frame release); `docs/68` | `f17-component-info.spec.ts` 18; live: hover shows, rotation hides for the whole motion, the last label returns on its own after settle. |

Source: E30 / IMG22 (§7.1) — a static screenshot does not by itself prove hover is absent
at runtime; this needs a driven check, not an assumed fix. Driven check done at 1366×768 (`docs/64` §3); not run here: Playwright, touch devices (`docs/64` §5).

### F18 — Volumetric flow-measurement scenario not implemented end-to-end (P1, Critical)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F18-REQ01 | P1 | open — **measurement rolled back at the user's request (2026-09-29)** | `docs/65` | A stopwatch measurement gating Q was built and then removed: no measurement step at the flow valve. Q stays live from the valve opening. |
| F18-REQ02 | P1 | open | — | No measured state exists after the rollback; both modes read the same live Q as before. |
| F18-AC01 | P1 | implemented_unverified (**visual only**) | `lib/measuringTank.ts`; `DeviceModel.tsx` (column shader on `Rectangle002` with the model's `TUBE` texture, basin water in `Bing Sink`) | Valve shut (rest) → sight tube and measuring tank fill at the jet's flow; open → drain (3 L/s, invented, presentation only). Nothing reads the level (`f18-visual-water.spec.ts`). |
| F18-AC02 | P1 | open — by decision | `physics.ts` `flowRateLMin(n)` | Q is not gated behind a measurement (user decision, 2026-09-29). |
| F18-AC03 | P1 | open | `boardReadout.ts`, `SoftwareMonitor.tsx`, `physics.ts` | Unchanged: every surface reads the one live Q. |
| F18-AC04 | P1 | open | — | The visual water behaves the same in Free Mode. |

Source: E31–E33 / IMG23 (§7.1), IMG13. This is the largest single gap in the programme.

### F19 — Live values, recorded results and workbook not consistent (P1, Critical)

| ID | Phase | Status | Files / evidence | How to verify |
| --- | --- | --- | --- | --- |
| F19-REQ01 | P1 | implemented_unverified; approval pending (DEC01) | `physics.ts` reproduces `Logic(final) 2.xlsx` Flat block row for row (user screenshot, 2026-09-29); `docs/66` §1 | `f19-calculation-consistency.spec.ts` AC04. Approving the workbook's Flat block as the source is BEDO's call. |
| F19-AC01 | P1 | **blocked** (file needed) | screenshot has column Y hidden and stops at row 20 | Y38 `#REF!` needs `Logic(final) 2.xlsx` itself. |
| F19-AC02 | P1 | partly done from values; formulas **blocked** (file needed) | `docs/66` §3: Oblique block V/F_th offset, Oblique `h (cm)` column = Flat hW ÷ 100, Flat hF +0.03 cm, `#NUM!` at n = 0 | Y24→T15, Y37→T29 need the formulas. |
| F19-AC03 | P1 | implemented_unverified | one quartic, A, g, s, L/min conversion in `physics.ts`/`units.ts`; the 3D carrier's inline `9.81` routed through `gramsToNewtons` | Spec fails on any second copy in `src`. |
| F19-AC04 | P1 | implemented_unverified | live readout = recorded row = CSV = workbook at n = 0.4; board/monitor/3D read selectors | `f19` spec; IMG24's 185.620 series reproduced as Q_total = 200. |
| F19-AC05 | P1 | implemented_unverified (stop value still BLK-03) | `springHeightMm` pure; limits are caller parameters; no 0.035 in `spring.ts` | `f19` spec AC05. |
| F19-AC06 | P1 | done (sequencing) | F09–F15 closed; F18 measurement rolled back by decision | Regression run 2026-09-29 against the supplied values. |

**Numeric conflicts to reconcile, carried from the source (do not resolve by assumption):**

| Ref | Source value | This build | Note |
| --- | --- | --- | --- |
| IMG31 §7.2 | Q series 0, 6.9537984, 15.7144704, 43.4568384, 84.7129344, 111.372 L/min at n = 0…1, QT = 120 | `flowRateLMin` gives exactly this series | **Resolved (F19):** the P0 note was wrong; the quartic reproduces the series digit for digit (`docs/66` §1). |
| IMG24 §7.1 | live Q = 185.620 L/min, V0 = 39.410, V = 39.401, F_th = 121.8668 N, A = 7.850e-5 m² | n = 1 at Q_total = 200 (Parameters range 20–200) | **Resolved (F19):** same mapping and equations, reproduced exactly. |
| IMG24 §7.1 | table Q rows 0, 26.191, 45.040, 72.428 | `ROW_VALVE_SETTINGS = [0, 0.4, 0.5, 0.6]` at Q_total = 200 | **Resolved (F19):** reproduced exactly. |
| IMG31 §7.2 | Manual row Q = 25 L/min | no manual-entry path exists | Same equations give 5.308 / 5.243 / 2.158 N / 219.949 g (`f19` spec). |
| IMG32 §7.2 | `#NUM!` at zero flow in impact velocity, F_th, mass and the Oblique 45 spring height | `physics.ts` clamps `impactVelocitySquared` at 0 | Workbook repair proposed: `IF(V0²<2gs,0,…)` (`docs/66` §3.1); needs the file. |
| IMG33 §7.2 | `hW` in mm under Flat but cm under Oblique 45; `hF` in cm; Oblique column 0.25, 0.05, 0.10, 0.25, 0.00 | `spring.ts` works in mm throughout | F19: rows 15–17 = Flat X5–X7 ÷ 100 (a cross-block reference with a ÷100 where cm needs ÷10); expected 0.25, 0.49, 0.98, 2.45 cm (`docs/66` §3.3). Needs the formulas. |
| IMG07 §7.1 | 2885 g load showing 28.302 N; `S = 0.035 m` | `TRAVEL_HEIGHT_M = 0.035` | The source states this is evidence data, not an approved load limit, and that `S` alone does not fix the mechanical stop. |
| IMG25 §7.1 | 90° labelled k = 1.000 beside a 1.707 expression | `apparatus.ts`: 90° → 1.0, 135° → 1.707 | Audit the display, not the coefficients. |

Source: E34, E35 / IMG07, IMG24, IMG25, IMG31–IMG33.

---

## 2. UI target specification UI00–UI12 (all P6 unless noted)

Governing rule: the **BEDO Interim UI v0.1 guide outranks the older screenshots**, and the
final UI V3 tokens are not settled. Structure and behaviour are in scope now; exact
colours, fonts, icons, radii, shadows and motion timings are not (UI00, BLK-05).

**Shell gap:** the current build is a left-sidebar overlay (`src/components/UIOverlay.tsx`,
`src/components/ExperimentIntro.tsx`). There is **no interim bottom navigation**, no Main
Settings panel, no Experiments catalog panel, no Controls & Views surface and no Custom
Parameters panel. UI03, UI04, UI06, UI09 and UI10 are therefore largely greenfield, and
their rows below say so rather than pretending otherwise.

| ID | Status | Files / evidence | How to verify |
| --- | --- | --- | --- |
| UI00 | blocked (BLK-05) | — | Token set stays configurable; structure ships now. |
| UI01-P | open | `UIOverlay.tsx`, `Scene3D.tsx` | Rig is the visual centre, not a HUD. |
| UI01-01 | open | `src/index.css`, `#f58220` used in `UIOverlay.tsx:473` | Dark lab UI, BEDO orange for selected/important. |
| UI01-02 | open | `index.css` | Contrast and size/weight hierarchy measured. |
| UI01-03 | open | `index.css`, `.glass-card` | Flat panels with subtle transitions. |
| UI01-04 | open | `UIOverlay.tsx` | Hover/selected/disabled/focus/warning/success distinct; progress not colour-only. |
| UI01-05 | blocked (BLK-05) | inline styles throughout `UIOverlay.tsx` | Tokens must be centralised to stay replaceable. Cross-ref UI12-01. |
| UI02-P | open | `UIOverlay.tsx` header region | Top-safe region communicates lab + mode without changing state. |
| UI02-01 | open | `ExperimentIntro.tsx` shows "Measurement of Jet Forces"; **"VL-FM009" does not appear in `src/`** | Add the identity code to the shell/header. |
| UI02-02 | open | no session identity exists | Bind to real session data or show nothing. Cross-ref DEC06. |
| UI02-03 | open | `UIOverlay.tsx:464-482` mode buttons; `App.tsx:641` `isGuided` | Selected mode equals the accepted runtime mode. |
| UI02-04 | open | `runner.ts`, `runtime.ts` | Mode change preserves flow, valve, deflector, weights, recorded data. Cross-ref F11-AC05. |
| UI03-P | open | — | Adopt the interim shell, not the legacy per-lab bottom tabs. |
| UI03-01 | open | **not implemented** | Build the 3/4-slot bottom bar: Main Settings, Experiments, Controls & Views, Custom Parameters. |
| UI03-02 | open | **not implemented** | Bar sits in the bottom safe area, reflows, leaves no dead gap. |
| UI03-03 | open | partial — utilities scattered in `UIOverlay.tsx` | Separate compact right-side utilities from scientific parameters. |
| UI03-04 | open | no shared confirmation pattern exists | One confirmation surface for destructive actions. |
| UI03-05 | open | `StepInstructionCard.tsx` | Steps stays a Guided progress surface, not a permanent bottom tab. |
| UI04-P | open | `ExperimentIntro.tsx`, `src/domain/experiments.ts` (4 families, 11 deflector entries) | One catalog/detail experience. |
| UI04-01 | open | `experiments.ts` carries title + objective per family | Render each variant with title and short description. |
| UI04-02 | open | objectives exist (`objectiveEn`/`objectiveAr`); **no documents concept exists** | Expose Objectives and Documents from the selected item. |
| UI04-03 | open | not implemented | Documents replace Objectives in the same detail region. |
| UI04-04 | open | not implemented | Objectives scroll; documents belong to the selected experiment only. |
| UI04-05 | open | not implemented | Changing experiment scrolls detail to top and defaults to Objectives. |
| UI04-06 | open | not implemented | Intentional localized empty/disabled state when there are no documents. |
| UI04-07 | open | `ExperimentIntro.tsx` `onStart` | Start Experiment is the clear primary action. |
| UI05-P | open | `src/lesson/runner.ts` | Steps is a live view of rig state. Cross-ref F14-REQ01. |
| UI05-01 | open | `StepInstructionCard.tsx` | Completed/Current/Upcoming with icon + emphasis. |
| UI05-02 | open | `StepInstructionCard.tsx` | Auto-scroll on step change only; manual scroll not overridden. |
| UI05-03 | open | `gate.ts` | Step rows informational; cannot skip apparatus state. |
| UI05-04 | open | `AnswerSheet.tsx` | Questions/popups are not numbered steps. |
| UI05-05 | open | `runner.ts` | Completion is a dedicated state. |
| UI05-06 | open | `StepInstructionCard.tsx` | Compact Current Step subtitle persists, not learner-dismissable mid-step. |
| UI05-07 | open | `currentLesson.ts` 11 steps | Step text matches implemented controls and the approved measurement sequence. Gated by F18. |
| UI06-P | open | **no settings panel exists** | Options menu showing only what works in the browser build. |
| UI06-01 | open | `src/lib/languagePreference.ts` exists; no hints/UI-scale/audio/tooltip settings | Categorized settings for the items that are real. |
| UI06-02 | open | `Scene3D.tsx` `OrbitControls` | Expose sensitivity only if the controller supports it. |
| UI06-03 | open | `docs/20_RENDERING_BUDGET.md` | Expose quality/FPS/VSync only if functional. |
| UI06-04 | open | — | Do **not** add Resolution or Window Mode from the legacy reference. |
| UI06-05 | open | no narrator | If shown, the toggle must control a real feature. Cross-ref DEC06. |
| UI07-P | open | `UIOverlay.tsx` | Correct surface per message class. |
| UI07-01 | open | `UIOverlay.tsx` | Non-blocking notifications where the background stays usable. |
| UI07-02 | open | no message-box component | Compact blocking box for real decisions. |
| UI07-03 | open | `AnswerSheet.tsx` | Full dialog only for structured content. |
| UI07-04 | open | `AnswerSheet.tsx` | One question family and feedback treatment. |
| UI07-05 | open | `apparatusGate.ts` reason codes | Severity alone does not justify a modal. |
| UI08-P | implemented_unverified | `DeviceModel.tsx` `hoverProxy` (F17) | Identify parts without confusing hover with an action. See `docs/64`. |
| UI08-01 | implemented_unverified | `lib/cursorTooltip.ts` (F17) | Title + short function + how to open the card; follows the pointer. |
| UI08-02 | partly implemented | `ComponentCard.tsx` (F17) | Title, function, details (figures derived from the physics) and use, anchored to the part. **No image**: none is supplied for any part, and none was invented. |
| UI08-03 | implemented_unverified | `domain/componentInfo.ts` (F17) | Both views read one definition. Cross-ref F17-AC02. |
| UI08-04 | implemented_unverified | `anchorIdOf`, `lib/componentAnchor.ts` (F17) | Stable anchor id per part, projected each frame. Flowmeter anchor = the bench measuring-tank scale (`vlfm009.flowmeter`); no separate flowmeter model exists (F18). |
| UI08-05 | implemented_unverified | `hoverProxy`; focus card (F17) | Hover/focus informational only (`f17-component-info.spec.ts` AC3). |
| UI09-P | implemented_unverified | `UIOverlay.tsx` Parameters (F09) | Parameters edits the real simulation. See F09-REQ03, `docs/58`. |
| UI09-01 | open | not implemented | Reusable middle-panel editor. |
| UI09-02 | implemented_unverified | `domain/parameters.ts`; `SET_PUMP_FLOW`, `SET_CUSTOM_WEIGHT` | Only Q_total and the custom mass are editable, validated to the panel's ranges. |
| UI09-03 | implemented_unverified | `selectors.ts` `selectLiveReadout` | Every displayed value maps to runtime state and drives dependents (F09-AC01–03). |
| UI09-04 | open | `src/domain/units.ts` | Reusable toggle/slider/input/choice with labels and units. |
| UI09-05 | implemented_unverified | `runtime.ts` `reset()`; Restore defaults; no Save/Load | Reset (rig) and Restore defaults (parameters) are separate, and the panel says which does what. |
| UI09-06 | implemented_unverified | Parameters panel; `forceLaw.ts` | Duplicate deflector control removed; one force law source. |
| UI10-P | open | `src/lib/cameraFraming.ts`, `apparatusView.ts` | Predictable approved views that preserve the experiment. |
| UI10-01 | open | **no gallery exists** | Numbered thumbnail gallery. Cross-ref F12-AC04. |
| UI10-02 | open | `tests/e2e/camera-follow.e2e.ts` | Switching cameras preserves all experiment state. |
| UI10-03 | open | `Scene3D.tsx:719-725` | Approved profiles prevent clipping. Cross-ref F12-AC01. |
| UI10-04 | open | not implemented | Thumbnail/number makes the destination clear. |
| UI10-05 | open | `UIOverlay.tsx` | Camera controls live in Controls & Views, not the science panel. |
| UI11-P | open | `languagePreference.ts`, `isAr` branches throughout `UIOverlay.tsx` | Whole interface correct in both languages and aspect ratios. |
| UI11-01 | open | `languagePreference.ts`, `tests/unit/language-preference.spec.ts` | Both languages selectable from Main Settings (panel not yet built). |
| UI11-02 | open | `DeviceModel.tsx:3513` sets `dir` on the tooltip; broader RTL layout unaudited | Real RTL layout and alignment, not translated strings alone. |
| UI11-03 | open | `tests/e2e/language.e2e.ts` | Language change preserves experiment, step, parameters, weights, flow, readings. |
| UI11-04 | open | `UIOverlay.tsx` | Navigation anchors to safe edges. |
| UI11-05 | open | `UIOverlay.tsx` | No clipped buttons, hidden close controls or overlapping instructions. |
| UI11-06 | open | `index.css` | Scrollable content stays in its own region. |
| UI12-P | open | — | UI replaceable by V3 without re-implementing experiment logic. |
| UI12-01 | open | inline styles dominate `UIOverlay.tsx` and `DeviceModel.tsx` | Centralise colours, typography, spacing, states. |
| UI12-02 | open | no shared component library | Reusable Button, Toggle, Slider, Panel, Modal, Tooltip, StepRow, ExperimentCard. |
| UI12-03 | **implemented_unverified** | `src/simulation/runtime.ts`, `state.ts`, `selectors.ts`, `tests/integration/runtime-ownership.spec.tsx` | Authoritative state already sits outside visual components. Needs a driven confirmation that no visual component owns truth. |
| UI12-04 | open | `runtime.ts` typed commands; `tests/e2e/helpers.ts` | Semantic actions, no DOM position/text parsing. |
| UI12-05 | open | `UIOverlay.tsx` | No dead controls; incomplete ones hidden or clearly disabled. |
| UI12-06 | open | `src/domain/experiments.ts`, `src/lesson/currentLesson.ts` — partly separated | Separate metadata, objectives, documents, steps, notifications under one definition. |
| UI12-07 | open | `src/lesson/schema.ts`, `runner.ts` — a lesson loader exists; no experiment/content loader | ExperimentLoader populates Experiments, Steps and component descriptions. |
| UI12-08 | open | not implemented | PopupManager / anchor-based path for component popups. |
| UI12-09 | blocked (BLK-05) | — | Keep final visual tokens configurable. |

Source images: E36–E42 / IMG26–IMG31 (§7.1). IMG27 warns that the reference panel's
Bernoulli content must not be carried into Jet Forces. IMG28 keeps the Steps reference but
the newer rule forbids fake numbered steps and a mandatory Steps tab. IMG29's legacy
settings list (Resolution, Window Mode, Framerate, Narrator…) is reference only — UI06
governs. IMG30 records a PlayMaker/scriptable-events intent from a Unity reference: the
**behaviour** is in scope via semantic actions; the Unity library is not. IMG31 (§7.1)
shows eight thumbnails as an example, **not** a required camera count.

---

## 3. Geometry / provenance G01–G05

| ID | Phase | Status | Files / evidence | Reason |
| --- | --- | --- | --- | --- |
| G01 | — | not_applicable_with_reason (BLK-02) | `Jetforce-1.fbx` / `Jetforce-2.fbx` are not in this repository | Reported 159/159 mesh instances and 45,813 triangles cannot be re-derived. Provenance observation, not repair work. |
| G02 | — | not_applicable_with_reason (BLK-02) | `public/Bedo_baked_v2.glb` is present; the FBX side is not | 92 exact-name matches / 62.3% / 80.9% normalized cannot be re-checked. |
| G03 | — | not_applicable_with_reason (BLK-02) | — | The 45-mesh local-bounds evidence needs both files. |
| G04 | — | not_applicable_with_reason (BLK-02) | `npm run glb:report` can count the GLB side only | 45,813 vs 45,723 (−90 tri, ~0.20%) is one-sided here. |
| G05 | — | not_applicable_with_reason | `package.json` pins `gltfpack 1.2.0`; `docs/45_GLB_PRODUCTION_OPTIMIZATION.md` | Consistent with the report. These are production operations, and the source is explicit they are not an ownership conclusion. |

These rows are recorded so the scope is complete. They are **not** an ownership or
contractual finding and must not be restated as one.

---

## 4. Closure order C01–C08

| ID | Status | Meaning here |
| --- | --- | --- |
| C01 | open | P1. F18 + F19. Starts after this phase. |
| C02 | open | P2. F09, F10, F11, F15. |
| C03 | open | P3. F03, F04, F05. |
| C04 | open | P4. F08, only after P1–P3 make flow and mechanical position reliable. |
| C05 | open | P5. F01, F02, F06, F07. |
| C06 | open | P6. F12, F13, F14, F16, F17 + UI01–UI12. |
| C07 | open | P7. Full regression, both modes, every required deflector and reading. |
| C08 | open | Release gate. **No QA-approved claim while any Critical is open.** Currently F05, F08, F09, F11, F14, F18, F19 are all open. |

Note on C01: repairing the calculation source early is allowed; it does **not** license
declaring the final equation regression passed early (F19-AC06).

---

## 5. Final acceptance checklist A01–A20 (P7)

All twenty are `open`. The source itself marks every one "غير مختبر في هذه المهمة" — not
tested in that task — and nothing in this phase changes that.

| ID | Status | Gated by | How it will be verified |
| --- | --- | --- | --- |
| A01 | open | F18 | Drive the full volumetric measurement in Guided and Free Mode. |
| A02 | open | F18, BLK-04 | Flowmeter/tank response visible and tied to volumetric-valve state. Visual-only fill/drain in place (`docs/65`); awaiting acceptance. |
| A03 | open | F19 | One Q/velocity/force dataset identical across workbook, board and Data Monitor. Code side done (`docs/66`); workbook repairs need the file. |
| A04 | open | **BLK-01** | Workbook `#REF!` and cross-block references repaired/audited. Cannot start without the file. |
| A05 | open | F05, BLK-03 | Pointer fixed; carrier/spring stop at the approved limit. |
| A06 | open | F03, F10 | Weights add/remove/repeat with correct snapping and atomic updates. |
| A07 | open | F08 | No-deflector free jet; deflection starts at real contact. |
| A08 | open | F08 | Pattern changes with deflector and flow; water reaches the receiver. |
| A09 | open | F11 | Independent Free Mode run with justified interlocks only. |
| A10 | open | F14 | Step state always matches apparatus state and available controls. |
| A11 | open | UI03 | Interim BEDO shell with no dead or duplicated controls. |
| A12 | implemented_unverified | F16, DEC05 | Apparatus stays the primary focus at target aspect ratios. Centre clear at 1280–2560 (`docs/63`); final sizes pend DEC05. |
| A13 | open | UI04 | Objectives/Documents integrated into the selected experiment detail. |
| A14 | open | UI06 | Only functional WebGL-relevant settings visible. |
| A15 | open | F17, UI08 | Tooltips and anchored descriptions for reviewed components. |
| A16 | open | F12, UI10 | Presets/gallery work without clipping or changing state. |
| A17 | open | UI11 | English/Arabic/RTL without resetting state. |
| A18 | open | F13 | Walkthrough closes, seeks and returns reliably. |
| A19 | open | F01, F02, F06, F07 | Visual review of orientation, integrity, materials, lighting, highlight. |
| A20 | open | all | Every required deflector and reading retested against one authoritative source. |

---

## 6. Engineering package EP01–EP10

These describe what BEDO must receive; most are deliverables, not code repairs.

| ID | Status | Where it stands |
| --- | --- | --- |
| EP01 | implemented_unverified | Full source in this repository; `node_modules` excluded by `.gitignore`. Needs a completeness confirmation, not new code. |
| EP02 | open | Tested revision: branch `phase2/security-remediation` at `484be85`, clean tree. Deployment URL and build identifier to be attached per phase. |
| EP03 | implemented_unverified | `package.json`, `package-lock.json`, `tsconfig*.json`, `.oxlintrc.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts` all present. No `.env.example` — confirm none is required. |
| EP04 | open | Commands are in `QA_REPAIR_CONTEXT.md` §3; Node/npm versions recorded there. Needs a clean-install reproduction. |
| EP05 | open | Unit/integration via vitest, E2E via Playwright. Baseline results in `QA_REPAIR_VALIDATION.md`. |
| EP06 | in_progress | Ownership map drafted in `QA_REPAIR_CONTEXT.md` §4. |
| EP07 | open | Control → state → calculation → 3D/VFX → readout mapping. Partly derivable from `runtime.ts` + `selectors.ts`; to be written out. |
| EP08 | in_progress | Known gaps and blockers listed in this ledger and `QA_REPAIR_CONTEXT.md` §5. |
| EP09 | implemented_unverified | Direct production dependencies in `package.json`: react, react-dom, three, @react-three/fiber, @react-three/drei, lucide-react, @google-cloud/storage. External runtime resources to be confirmed (`src/lib/assetUrl.ts`, `public/runtime-manifest.json`). |
| EP10 | open | Final completeness confirmation, after the above. |

---

## 7. Decisions required before implementation can be approved (DEC01–DEC07)

Each blocks the rows named. None may be resolved by picking a plausible default.

| ID | Blocks | The specific question |
| --- | --- | --- |
| DEC01 | F19-REQ01, A03 | Which workbook is the approved calculation source — `Logic(final) 2.xlsx` (named by the report) or `Jet force_Mathematical model.xlsx` (which `src/domain/physics.ts` documents itself against)? **F19:** the code reproduces `Logic(final) 2.xlsx`'s Flat block exactly (the reported Q-series conflict was a P0 misreading); approving that block is what remains. |
| DEC02 | F18-AC01, F15-AC02, BLK-04 | The exact volumetric procedure: valve states, tank and flowmeter response, what completes the measurement, and what makes F_ac recordable. No volumes, durations or tolerances are given anywhere and none may be invented. |
| DEC03 | F05-AC03/04/05, F10-AC04, BLK-03 | The spring/carrier travel limit, the minimum safe nozzle-to-deflector clearance and the permitted weight capacity, as numbers. `S = 0.035 m` is explicitly **not** sufficient. |
| DEC04 | F11-REQ02, F11-AC02, F11-AC05 | Which Free Mode interlocks are legitimate physics/safety, and what is preserved vs cleared on mode switch, reset and exit. |
| DEC05 | F16-AC01, F16-AC04, A12, UI00 | Approved camera angles, target aspect ratios and devices; final UI V3 visual tokens. Structure can proceed now. |
| DEC06 | F09-AC05, UI02-02, UI06-02/03/05 | Which optional features actually exist: Save/Load, Narrator, camera sensitivity, quality, framerate, VSync, user identity. Conditional mention is not a requirement to display. |
| DEC07 | EP01–EP10 | Acceptance of the engineering package against the tested revision, and the named owner for every implementation item. |

---

## 8. Image-note index (source §7)

The source's §7.1 and §7.2 both contain an **IMG31**. They are kept distinct by section
number throughout this ledger and are never merged.

| Note | Section | Subject | Rows it drives |
| --- | --- | --- | --- |
| IMG01 | 7.1 | Ceiling/lab inversion, lighting, room bounds | F01, F06, F12 |
| IMG02 | 7.1 | Under-tray disconnected piece; upper assembly separation | F02 |
| IMG03 | 7.1 | Deflector changeover frames (not playable video) | F03 |
| IMG04 | 7.1 | Weight install/remove frame sequence | F03, F10 |
| IMG05 | 7.1 | 10 g vs 50 g apparent size | F04 |
| IMG06 | 7.1 | Before/after load; 2885 g → 28.302 N (evidence, not a limit) | F05 |
| IMG07 | 7.1 | Worksheet columns; Flat / Oblique 45 blocks; `#NUM!`; `S = 0.035 m` | F05, F19 |
| IMG08 | 7.1 | Weight base faces/normals/transparency | F06 |
| IMG09 | 7.1 | Green LED appearance | F06 |
| IMG10 | 7.1 | "That should be led tv" | F06 |
| IMG11 | 7.1 | "Highlight is too goldish"; in-image video link, not used as evidence | F07 |
| IMG12 | 7.1 | Spread without contact/deflector; high-flow scene | F08 |
| IMG13 | 7.1 | Red circle on the base; water must interact with it | F08, F18 |
| IMG14 | 7.1 | Parameters values vs unmoved apparatus | F09 |
| IMG15 | 7.1 | Natural motion through the whole weight operation | F03, F10 |
| IMG16 | 7.1 | Power/valve restrictions; incomplete Free Mode | F11 |
| IMG17 | 7.1 | Camera under/inside the assembly | F12 |
| IMG18 | 7.1 | Walkthrough player loading and playing frames | F13 |
| IMG19 | 7.1 | "Pointer balanced" while still asking for weights; word-by-word wrap; Calculate | F14, F16 |
| IMG20 | 7.1 | Q = 27.024, F_th = 2.5303 N, live 0 g, two rows, 2/2 counter | F15 |
| IMG21 | 7.1 | Recording instructions near valve/flowmeter; crowded buttons | F16, F14, F18 |
| IMG22 | 7.1 | Close-up of weights/deflectors; static shot does not prove hover missing | F17 |
| IMG23 | 7.1 | Flowmeter view, tank/valve context, volumetric valve open | F18 |
| IMG24 | 7.1 | Q = 185.620 L/min, 3.094e-3 m³/s, V0 = 39.410, V = 39.401, F_th = 121.8668 N, ⌀10 mm, A = 7.850e-5 m², 0 g; table 0 / 26.191 / 45.040 / 72.428 | F19 |
| IMG25 | 7.1 | 90° labelled k = 1.000 beside a 1.707 expression; Calculate button visible | F09, F14, F19 |
| IMG26 | 7.1 | Persistent Shell reference (duplicated); one mode, centred selector | UI02, UI03 |
| IMG27 | 7.1 | Experiment Panel redesign; Bernoulli content not transferable | UI04, UI11 |
| IMG28 | 7.1 | Steps panel redesign; no fake numbered steps, no mandatory Steps tab | UI03, UI05 |
| IMG29 | 7.1 | Legacy settings list kept as reference only | UI06 |
| IMG30 | 7.1 | Device Inputs/Equations; PlayMaker intent, not the Unity library | UI09, UI12 |
| IMG31 | **7.1** | Camera Gallery; eight thumbnails are an example, not a required count; Arabic/English + real RTL | UI10, UI11 |
| IMG31 | **7.2** | Full-precision Q series 0 / 6.9537984 / 15.7144704 / 43.4568384 / 84.7129344 / 111.372 at QT = 120; Manual row Q = 25 | F19 |
| IMG32 | 7.2 | `#NUM!` at zero flow in impact velocity, F_th, mass and Oblique 45 spring height | F19 |
| IMG33 | 7.2 | `hW` mm under Flat vs cm under Oblique 45; `hF` cm; column 0.25 / 0.05 / 0.10 / 0.25 / 0.00 | F05, F19 |

---

## 9. Coverage honesty (source §9)

- COV01 — Text coverage is complete across findings, criteria, UI lists, closure, checklist, package and captions. Small text inside an image is not searchable text; §7 notes carry it.
- COV02 — E01–E42 counts **appearances**, not unique images. IMG rows are readings of images, not live tests.
- COV03 — Converting the report, or completing this ledger, is not release approval. C08 remains the gate.
