# 58 — One experiment state (F09)

Working-tree change on top of F03–F08 (`docs/53`–`57`). Not committed, not deployed.

**Observed (QA, F09):** parameters and visible controls were not bound to one
authoritative simulation state.

* Flow and weight values changed in the UI while the board, the 3D apparatus, the water and
  the Data Monitor stayed the same or showed different values.
* In Free Mode the Parameters tab updated its own numbers, while the working controls sat
  under Steps.

## 1. What was wrong — found in the code, measured in the app

A simulation runtime already existed (`src/simulation`, BEDO-008), and the pump flow already
went through it. Five things did not.

| # | Where | What it did |
|---|---|---|
| 1 | `DeviceModel.tsx`, the carrier | Computed the jet force with `jetState(valve, deflector)` and **no Q_total**. The panel's pump flow reached the board and the monitor but never the carrier, the spring or the pointer. |
| 2 | `App.tsx` `ui.customWeightG` | The custom disc's mass was React UI state. A disc already on the carrier kept the mass it was loaded at, so the carrier, balance and monitor ignored the panel. Reset set it back to 25 g while keeping Q_total. |
| 3 | `App.tsx` `ui.deflectorInstalled` + lesson fallback | "A deflector is on the rod" was interface state. Until one was fitted, the board, the monitor and the carrier all acted on the sheet's default deflector while the scene drew a bare rod. |
| 4 | `SoftwareMonitor.tsx` | Printed the loaded *experiment's* force law beside the *fitted deflector's* k. In free mode that put "F = 1.707 ρAV²" beside a 90° plate at k = 1.000 (QA IMG25). |
| 5 | `selectors.ts` `selectReadings` | Recomputed every row with the current Q_total and deflector, so changing Q_total rewrote readings already taken. |

On top of these, the Parameters tab had its own set of deflector buttons: a second control
path for a variable whose control is the tray and the Steps list.

## 2. The correction

**One state.** `SimulationState` owns:

* `pumpFlowLMin`;
* `customWeightG` (new);
* `deflectorFitted` (new);
* per-row `committedPumpFlowLMin` / `committedDeflectorIds` (new).

App keeps no copy of any of them; every surface reads them through the selectors.

* **Custom weight** — `SET_CUSTOM_WEIGHT`.
  * A custom disc already on the carrier *is* that disc, so its entry in `loadedWeightsG`
    takes the new mass. The stack, load, spring, pointer, balance and monitor follow.
  * The mass can never be a tray denomination (`domain/parameters.ts`). Otherwise
    "the custom disc" and "the 20 g disc" could not be told apart on the carrier.
  * The slider's stops are 5–495 g in 5 g steps, skipping 10, 20, 50, 100, 200 and 500.
* **Pump flow** — `SET_PUMP_FLOW`, now validated to the panel's range (20–200 L/min, 5 L/min
  steps). The carrier's force is `state.live.jetForceOnCarrierN`, the runtime's figure at the
  student's Q_total.
* **Deflector fitted.**
  * An accepted `SELECT_DEFLECTOR` fits the deflector, including the one already selected.
  * The install step's `onComplete: FIT_DEFLECTOR` covers a guided learner who confirms it
    untouched (`docs/38 §3.1`).
  * Reset and a new sheet start with a bare rod.
  * Until a deflector is fitted, the jet force on the carrier is 0, the board marks no chip
    and prints F_th as a dash, and the monitor shows "None fitted".
* **Live balance** — `selectLiveReadout` adds:
  * `deflectorFitted`;
  * `jetForceOnCarrierN` (fitted, pump on, tank shut);
  * `balancingMassG`;
  * `isBalanced`, the table's own ±10 g test.

  Free mode, where no reading is being taken, now has a balance answer.
* **Force law** — `domain/forceLaw.ts` gives the fitted deflector's own law and k.
  * flat: `F_th = ρ·A·v²`, k = 1;
  * oblique: `F_th = ρ·A·v²·sin²θ`, k = sin²θ;
  * semi-circular and conical: `F_th = ρ·A·v²·(1 − cos β)`, k = 1 − cos β.

  The monitor, the Parameters tab and the Experiments tab (as "On the rod now") use it. k
  is `DeflectorDef.momentumFactor`, the number the physics uses.
* **Readings are records.** `END_READING` stores the Q_total and deflector each row was
  taken with. A later change to Q_total moves only rows not yet taken.

**The Parameters tab is an editor over the runtime.**

* **Editable:**
  * Q_total, labelled "Pump delivery at full valve", in L/min, with the flow through the
    nozzle now;
  * "Custom weight disc mass", in g. It says whether the disc is on the carrier or the
    tray, and is disabled, with the reason, while discs are moving.
* **Read-only:**
  * the deflector on the rod, with its equation and k, and where to change it;
  * v₀ (m/s), the jet force on the carrier (N), the load on it (g and N), and the balance
    in words.
* **Restore defaults** (120 L/min, 25 g) goes through the same runtime path.
* **Reset simulator** restores the rig and keeps both parameters, the same way for both.
  The tab says so. There is no Save/Load (DEC06).

**Unchanged:**

* the physics (`physics.ts`);
* the state machine;
* the gate;
* the lesson steps, apart from the install step's `onComplete`.

The runtime's dispatch sites in App stay five: the Parameters panel's is one loop
(`domain-boundary.spec.ts`).

## 3. Evidence — running app (local dev build, Chrome, free mode)

The 90° deflector was fitted, the pump running, valve 0.4. Each line is read back from the
Parameters panel, the in-scene board (`__bedoBoard`), the Data Monitor and the carrier rod
in the scene.

| change | panel / board / monitor | carrier rod (spring, `deflector_rod`) |
|---|---|---|
| start, Q_total 120, empty carrier | Q 15.714 L/min, v₀ 3.336 m/s, F 0.8199 N, 90°, k = 1.000, "Needs ≈ 84 g more" | at its upper stop |
| + 50 g disc | load 50 g, "Needs ≈ 34 g more" | **+1.647 mm** = (0.8199 − 0.4905) N / 200 N/m |
| Q_total → 60 | Q 7.857, v₀ 1.668, F 0.1646 N on panel and board, "≈ 33 g too heavy" | **−1.630 mm** = (0.1646 − 0.4905) / 200. Before F09 it stayed at +1.647. |
| Q_total → 120, + custom disc, mass → 55 g | load 105 g on panel, Steps and board; "≈ 21 g too heavy" | **−1.051 mm** = (0.8199 − 1.030) / 200 |
| custom mass → 35 g | load 85 g; "Balanced (within ±10 g)"; board "85 g × g = 0.834 N"; monitor Total Weight 85 g, 0.834 N, F_th 0.8199 N, law "F_th = ρ·A·v² · k = 1" | **−0.070 mm** |
| before any deflector | panel "None fitted — the jet runs straight to the cover", jet force 0 N | — |
| weights off, pump off, tank open, **45°** fitted, tank shut, pump on, valve 0.4 | k = 0.500 on panel, board ("45° k=0.500") and monitor; jet force **0.4100 N** = 0.8199 × 0.5 on all three; monitor law "F_th = ρ·A·v²·sin²θ · k = sin²45° = 0.500"; Experiments tab: the sheet's law, then "On the rod now: Oblique surface (45°) — F_th = ρ·A·v²·sin²θ, k = sin²45° = 0.500"; the water path has column, film, free sheet and run-off | — |

The Steps list showed the stack as "−50g, −Custom weight". The +Custom weight button's
accessible name carries the mass: "Add custom weight (55 g)".

## 4. Tests

**New:** `tests/unit/f09-acceptance.spec.ts`, 25 tests, all passing.

* **AC1:** a custom disc on the carrier takes the new mass. Load, force, balance and the
  active row follow; fixed discs never change; denominations and off-grid values are
  refused. App keeps no copy.
* **AC2:** Q_total reaches flow, v₀, the carrier force and the balancing mass. DeviceModel
  has no `jetState(` call left. The water and hose read the live state. The panels read the
  flow from the runtime.
* **AC3:**
  * the rod starts bare; fitting is runtime state, including re-selecting the selected
    deflector;
  * the install step fits the deflector on confirm;
  * the law and k are the fitted deflector's, and agree with the force for all seven;
  * the monitor no longer prints `experiment.lawEn`.
* **AC4:** labels, units and `aria-valuetext` on both sliders; units on every derived
  figure.
* **AC5:** Reset and sheet change keep both parameters; Restore defaults goes through the
  runtime; no Save/Load.
* **AC6:**
  * the Parameters tab has no deflector buttons;
  * a reading keeps its Q_total;
  * one value of each parameter reaches every surface.

**Updated for F09:**

* `simulation-runtime.spec.ts`: the initial-state fixture, and the jet force needs a fitted
  deflector.
* `board-readout.spec.ts`: plus one test for the bare rod.
* `domain-boundary.spec.ts`: the two new domain modules; the Parameters dispatch site's
  note.

**Whole unit suite:** unchanged apart from these.

## 5. Not verified here — run before merging

* **CI:** `npm run test:ci`.
* **Guided run end to end.** The install step now fits through `FIT_DEFLECTOR`; the unit
  tests pin it, but a full guided run in the browser was not repeated after this change.
* **The other five deflectors in the browser.** 90° and 45° were driven; all seven are pinned
  by AC3.
* **A foreground tab.** The page was in a background tab, so Chrome paused its frame loop;
  the scene was stepped by hand (`__frames`) for the carrier readings. Values are exact, but
  motion was not watched live.
