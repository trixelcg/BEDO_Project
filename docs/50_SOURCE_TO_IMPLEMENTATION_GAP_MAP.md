# BEDO source-to-implementation gap map

Date: 2026-08-31  
Scope: Measurement of Jet Forces (VL-FM009), Phase 1 and Phase 2 source package, current `phase2/security-remediation` working tree.

## Evidence hierarchy

1. The mathematical workbook and experiment answer sheets control equations, constants, units, and expected calculations.
2. The state-machine document controls apparatus safety transitions.
3. The four experiment procedures control instructional content and required observations.
4. The storyboard, Steps deck, source water caches, and reference recording control interaction, camera, timing, and appearance.
5. Where sources conflict, the newer/more specific source wins only when the conflict can be justified; otherwise the item remains explicitly unresolved.

## Consolidated map

| Area | Source requirement | Current implementation | Status | Evidence / action |
|---|---|---|---|---|
| Core equations | `Q`, `V0 = Q/A`, `V = sqrt(V0^2 - 2gS)`, momentum-force equations by deflector | Centralized in `src/domain/physics.ts`; constants A=0.0000785 m², S=0.035 m, g=9.81 m/s², rho=1000 kg/m³ | MATCH | Workbook formulas and four answer sheets; 57 focused physics tests pass. Preserve. |
| Pump curve | Quartic valve-opening curve, Q_total default 120 L/min | Same coefficients and default | MATCH | Workbook P/Q/R columns; covered by physics tests. |
| Deflectors | Flat 90°, semi-circular 120°/180°, conical 135°, oblique 30°/45°/60° | Seven fixed selectable deflectors with experiment scoping | MATCH | Proposal, experiment sheets, storyboard assets; experiment tests pass. |
| Guided procedure | 11 instructional steps; volumetric valve is an apparatus control, not a numbered lesson step | 11-step guided lesson and separate volumetric-valve affordance | MATCH | Four experiment sheets plus canonical reconciliation; lesson tests pass. |
| Deflector installation | Experiment sheets explicitly say drag; legacy storyboard/build uses click | Drag/drop transfer exists; click-compatible guided interaction retained | ACCEPTED HYBRID | Source conflict; keeping both avoids removing documented behavior. |
| Safety state machine | Five bilingual guards for cover, power, deflectors, and weights | Centralized typed gate; both UI and 3D paths use it | MATCH | State-machine document; 61 state-machine and 17 safety-integration tests pass. |
| Single-weight removal | Storyboard state D requires clicking a holder weight and a 2-second removal | `REMOVE_WEIGHT` exists and animated transfer code is present | MATCH, TEST COMMENT STALE | Current domain/code implements it, but an old negative test/comment still claims absence and should be corrected. |
| Power-off/drain | Source wording says water drains when trainer is turned off | Pump-off shuts flow; presentation tank drains toward zero through current water target logic | PARTIAL / AMBIGUOUS | State document does not provide drain rate. Verify visible behavior; do not invent an engineering drain constant. |
| UI parameters | Deflector type/angle, Q_total, custom mass | Pump flow, custom weight, angle/deflector controls present | MATCH | Parameter-setting document and storyboard. |
| Software monitor | Table, graph, total weight, gravity relationship, deflector identity/angle, calculate, clear/reset, save screen, export | All present; gravity readout added. Deflector name and angle are shown in the monitor header | PARTIAL — four items need source clarification | LED, Export activation, digit format and Clear-vs-Reset remain open; see the UNRESOLVED table. |
| Arabic | Bilingual content and Arabic workflow | Document root now tracks the language (`en/ltr`, `ar/rtl`); the RTL total-weight readout is bidi-isolated | RESOLVED — see status section | 6/6 language E2E; live capture. |
| Accessibility | Every apparatus action should be operable and labeled | All thirteen audited apparatus actions have DOM keyboard parity; the tank cover was the last 3D-only one and now has a button | RESOLVED — see status section | Live parity probe; `cover-accessibility.spec.tsx`. |
| Answer sheets | Four experiment worksheets available at closing step | Four PDFs mapped by experiment and opened in-app | MATCH | Source PDFs and app assets. |
| Water authored shape | Use distinct authored silhouettes for low/30/45/60/90/120/135/180 states | Eight Alembic-derived morph GLBs; topology and frame progression preserved | MATCH | Source caches and repository water-parity measurements. |
| Jet dimensions | Physical nozzle bore is 10 mm; visible authored silhouette must match reference apparatus, not be forced to bore width | Physics uses 10 mm bore; presentation uses reference-calibrated broader silhouette and exact nozzle-to-deflector anchoring | MATCH | Workbook/answer sheets control physics; video/caches control visible silhouette. |
| Jet timing | Startup reaches steady appearance in about 1.15 s and does not loop/seam | One-shot 81-frame morph playback, calibrated to 1.15 s, holds final frame | MATCH | Reference recording and cache analysis. |
| Jet/splash geometry | Shape changes with installed deflector and shows impact/dispersion appropriate to angle | Dedicated water shape per deflector, switched at impact threshold | MATCH WITH VISUAL LIMIT | Source caches are authoritative; jet and splash currently share one material, limiting independent tuning. |
| Tank fill | Tank remains empty at lower reading, fills at higher inflow with drain closed, tops near 90% | Generated tank volume targets 0.90; 6 s fill bound; low/high threshold presentation rule | EVIDENCE-BOUNDED | Recording proves ordering and maximum duration, not a physical tank/drain constant. Keep outside physics. |
| Tank drain | Opening volumetric valve drains visible tank | Target falls to zero; 4 s presentation drain | UNSUPPORTED RATE | Behavior supported, rate not specified by BEDO documents/video. Keep labeled as presentation calibration. |
| Water material | Dark blue-grey transmitted appearance, depth darkening/saturation, visible free-surface reflection, continuous subtle motion | Custom material implements absorption, depth trend, ripple surface, reduced white specular | MATCH WITH KNOWN LIMITS | No true refraction; jet and splash cannot be tuned separately. These are disclosed rendering limits, not equation defects. |
| Water deterministic capture | Repeatable evidence gate should reach scene-ready and generate review views | Preview now resolves content-addressed runtime assets, and the manifest read no longer runs during `vite dev` | RESOLVED — see status section | All eight water states captured; no water code changed. |
| Source completeness | Root `Storyboard.pptx` should be usable | File is a 165-byte stub; full Phase-1 storyboard is usable | SOURCE LIMITATION | Use `Phase 1/Jetforce_Storyboard.pptx` as the real storyboard. |

## Source conflicts and unsupported assumptions

- Spring conversion: storyboard slide 8 shows a divisor inconsistent with the workbook’s `/200*1000`. The workbook is computationally complete and is the stronger authority; implementation correctly uses 200 N/m and converts metres to millimetres.
- The experiment sheets omit a numbered volumetric-valve step, while older simulator material includes it. It remains a control but not a canonical numbered lesson step.
- Deflector installation is described as drag in experiment sheets but click in legacy implementation views. Supporting both is safer than silently choosing one.
- Tank fill/drain rates and the inflow threshold are not engineering constants in the supplied documents. They must remain presentation-only unless BEDO supplies tank volume, drain capacity, and measured timing.
- The answer-sheet graph’s visible 0–60 L/min scale conflicts with the workbook/app Q_total default of 120 L/min. Dynamic graph scaling is appropriate; no physics constant should be reduced to fit the old worksheet graphic.

## Incremental fix order

1. Fix and test the confirmed Arabic `lang`/`dir` defect.
2. Repair the deterministic capture/build-preview gate, then rerun water-state visual capture.
3. Correct stale tests/comments that still describe already-implemented single-weight removal as absent.
4. Audit and add the missing software-monitor indicator(s) only where the storyboard meaning is unambiguous.
5. Plan the broader DOM-control/accessibility parity separately; it is larger than a safe local fix.

No water physics or equation change is authorized by the present evidence.

## Status after BEDO-AUDIT-02 and BEDO-AUDIT-03

Working tree only. Nothing committed, deployed, or released; production remains
`bedo-project-r3f-app-00052-72v` at 100%.

### RESOLVED

| Item | Source | Fix | Evidence |
|---|---|---|---|
| Document `lang`/`dir` not tracking the language | Live browser; audit BUG-09 | `useEffect` in `src/App.tsx` sets `lang=en/dir=ltr` and `lang=ar/dir=rtl` | 6/6 `language.e2e.ts`; live capture shows the sidebar genuinely mirroring |
| Arabic total-weight readout garbled | Live browser (RTL) | `direction: ltr; unicode-bidi: isolate` on the readouts | Rendered `g × g = 0.000 N 0` → now `0 g × g = 0.000 N`; pinned by `monitor-fields.spec.tsx`, which fails if the isolation is removed |
| Gravity display absent | Storyboard sl. 23 | Readout added, sourced from `GRAVITY_MS2` so it cannot drift from the equations | `monitor-fields.spec.tsx`; live EN + AR |
| Tank cover had no DOM/keyboard control | Storyboard; accessibility | Labelled sidebar button raising the same intent through the same gate as the mesh | `cover-accessibility.spec.tsx` (4); live: focus → Space/Enter opens, Step 1 → 2 |
| Cover refusal not announced | Accessibility review | `role="alert"` on the safety popup, `role="status"` on the notice | Live: interlocked press → `role=alert`, "You can't open the tank while the power is on." |
| Contradictory toggle semantics | ARIA toggle-button pattern | `aria-pressed` removed; the button re-labels itself instead | A changing action label plus a pressed state invites the reading that *closing* is active |
| Stale test claiming single-weight removal absent | Repository | Test removed | `REMOVE_WEIGHT` verified across domain, gate, transfer, runtime and both UI paths; 82/82 pass |
| `vite.config.ts` read a production manifest at config load | Integration robustness | Read moved into `configurePreviewServer` | Dev starts with no manifest (HTTP 200); preview fails loudly; release gates still fail closed |

### UNRESOLVED — SOURCE CLARIFICATION REQUIRED

These are open questions about intent, **not defects in the build**.

| Requirement | Slide | Why it cannot be implemented from the source |
|---|---|---|
| Green "installed" LED | sl. 23 | `selectedDeflectorId` is non-nullable and the domain defines it as *which deflector is on the rod*: selection and installation are one fact, so the LED would be permanently green and convey nothing. Needs a definition of "installed" distinct from "selected". |
| Export Data "active after filling out the table" | sl. 24 | The table is pre-populated from the fixed `ROW_VALVE_SETTINGS`, so a genuinely empty table never occurs. Which state counts as "filled" — any reading, or after Calculate — is not decidable from the slide. A guard was written and then removed rather than ship unreachable code that merely looks like compliance. |
| "Maximum 4 digits" | sl. 22, 23 | Ambiguous between 4 significant figures and 4 characters; the slides show both `9.81` and `1000`. Changing it would alter displayed physics precision. |
| "Clear" vs the app's "Reset" | sl. 22, 24 | The slide's Clear erases the table and graph. The app's monitor Reset resets the whole simulator (`runtime`, `runner`, lesson state). Gating or renaming it on the slide's wording would remove the user's ability to reset. |

### KNOWN IMPLEMENTATION LIMITS

- **DOM parity: no gap remains.** All thirteen audited apparatus actions have full DOM
  keyboard parity. The flow valve is a native `input[type=range]` and is Arrow-key
  operable once the pump is running; with the pump off it is inert by domain rule, not by
  an accessibility fault. Deflector *removal* has no domain intent at all — selecting
  another deflector replaces it — so it is not applicable rather than missing.
- Water rendering limits recorded earlier stand unchanged: no true refraction, and jet and
  splash share one material. Disclosed rendering limits, not equation defects.
- No water physics, constant, GLB, shader, material, geometry, or timing was changed in
  either audit pass.

