# 59 — Free Mode as an independent experiment (QA F10)

> **Superseded in part by F14 (`docs/61`).** The mode-switch dialog no longer offers
> "Keep the rig as it is". Guided takes back only the rig it left (or a rig at rest at
> step 1); otherwise the choices are Reset (parameters kept) or Stay in Free Mode. The rest
> of this document stands.

Working-tree change on top of F03–F09 (`docs/53`–`58`). Not committed, not deployed.

The QA report numbers this F10. In `QA_REPAIR_LEDGER.md` it is **F11** ("Free Mode
incomplete, unjustified interlocks"). The weight criterion also closes the ledger's F10
rows AC01–AC03.

**Observed (QA, video frames):**

* valve control was restricted;
* power off closed the valve;
* weight interaction was incomplete;
* there was nothing to evaluate the experiment with in Free Mode.

## 1. What was wrong — found in the code

| # | Where | What it did |
|---|---|---|
| 1 | `stateMachine.ts` `SET_VALVE` | Refused unless the pump was running (`VALVE_NEEDS_RUNNING_PUMP`). The flow valve is a hand valve on the delivery line; nothing on the rig stops it turning with the pump off. This was a sequence lock, not one of BEDO's documented guards. |
| 2 | `stateMachine.ts` `POWER_OFF` | Set `valveOpening` to 0. Switching the pump back on then gave no flow until the learner found the valve again. |
| 3 | Data Monitor, free mode | Showed the guided lesson's table. The table only fills from lesson steps, so in free mode it stayed empty (or held an old lesson's rows), and so did the graph, the CSV and the board's rows. |
| 4 | `App.tsx` `handleSetMode` | Switching Free → Guided dropped step 1 ("the rig at rest") onto whatever the rig was doing, without saying so. |

**Already correct, and now pinned by tests:**

* the same mass loads twice and both count;
* a disc comes off by its place in the stack;
* a refused action leaves the state untouched (identity);
* the Data Monitor opens in free mode;
* the gate lets free mode past the lesson's step checks and keeps the apparatus guards.

## 2. The correction

**Interlocks — only BEDO's five remain.** Each one shows its code and a sentence on screen
(`apparatusGate.ts`):

| code | rule |
|---|---|
| error1 | Weights need the tank cover closed. |
| error2 | The deflector needs the cover open. |
| error3 | The cover can't open with the pump running. |
| error4 | The pump can't start with the cover open. |
| error5 | The cover can't open with weights on the carrier. |

`VALVE_NEEDS_RUNNING_PUMP` is gone from the state machine, the gate's presentation and the
tests. The volumetric valve was already free.

**Power off keeps the valve.**

* `POWER_OFF` changes `isPowerOn` and nothing else.
* The flow is `0` because the pump has stopped: `selectJetState` reads
  `isPowerOn ? valveOpening : 0`. The water, carrier force, board and monitor all read that.
* Power on again gives the same flow as before.
* Q_total, the custom mass and the fitted deflector are not touched.

**Free readings — something to evaluate.**

* The runtime holds `freeReadings` (up to `MAX_FREE_READINGS` = 10). Each reading is the
  valve (0 if the pump is off), Q_total, the deflector and the discs on the carrier at the
  moment of recording.
* `RECORD_FREE_READING` needs a fitted deflector and room in the table. The monitor's
  button is disabled with the reason. `CLEAR_FREE_READINGS` empties the table.
* Rows are computed by `computeRow`, the same function as the lesson's table. In free mode
  the monitor's table, graph (F vs Q, or F_th for the F_th path) and CSV use them, and the
  board's two result rows show the first two.
* A free reading records what was on the carrier, so its F_ac (mass × g) is shown at
  once — in the table, the graph's measured curve, the CSV and the board. Free mode has no
  Calculate button; that step (and the assessment question after it) stays in Guided.
* The footer reads "n / 10" in free mode.
* **Reset simulator** clears them; switching mode does not.

**Mode switch.**

* Free → Guided with the rig at rest (pump off, cover shut, valve 0, no discs) switches
  straight away, as before.
* Otherwise a dialog (`ModeSwitchDialog.tsx`, EN/AR, Escape cancels) says Guided continues
  at the lesson's current step (it keeps its place) and offers:
  * **Reset the rig and start at step 1** — the runtime's reset, which keeps Q_total and
    the custom mass (F09), and a fresh lesson. Like Reset simulator, it also clears the
    free readings;
  * **Keep the rig as it is (continue at step N)** — switch without touching anything;
  * **Stay in Free Mode**.
* Guided → Free never changes the rig.
* `handleSetMode` has no dispatch and no reset; only the "reset" choice resets.

**Dispatch sites** in App stay five. The monitor's Record/Clear go through the same
`runSessionCommands` loop as the Parameters panel (`domain-boundary.spec.ts`, comment
updated).

**Unchanged:** the physics, the gate, the lesson steps, and the sheet change
(`SELECT_EXPERIMENT` resets the rig; it is an explicit choice of a new experiment, not a
mode change).

## 3. Decision taken (DEC04)

The ledger's DEC04 asks which free-mode interlocks are legitimate. The ones kept are the
five BEDO documents as `error1`–`error5`. The valve-needs-pump lock is not in that list and
has no physical basis on the rig, so it is removed. If BEDO wants it back, it is one guard
in `stateMachine.ts` and one row in `apparatusGate.ts`.

The weight capacity limit (F10-AC04) is still **blocked** by BLK-03. There is no approved
number, and no UI cap is invented.

## 4. Tests

**New:** `tests/unit/f10-free-mode.spec.ts`, 16 tests, all passing.

* **AC1:**
  * the flow valve turns at rest, with the cover open, with the pump on and with discs
    loaded;
  * the volumetric valve likewise;
  * exactly the five guards, each `error1`–`error5` with wording.
* **AC2:**
  * power off keeps the valve at 0.4, gives 0 flow and 0 force, and power on returns the
    same flow;
  * Q_total, the custom mass and the deflector are unchanged.
* **AC3:**
  * 50 g twice gives 100 g;
  * remove by index;
  * remove all;
  * a refused add returns the identical state.
* **AC4:**
  * readings match `jetState` and the loaded mass, and carry F_ac (shown at once, no
    Calculate in free mode);
  * pump off records 0 flow;
  * a deflector is needed, the table stops at 10, and Clear empties it;
  * App, monitor, CSV and board read the free rows.
* **AC5:**
  * `handleSetMode` doesn't touch the runtime;
  * the dialog guards Free → Guided, only "reset" resets, and the parameters survive the
    reset;
  * readings survive until Reset.

**Updated:**

* `state-machine.spec.ts`
* `simulation-runtime.spec.ts` ("the valve stays set when the pump stops")
* `live-readout.spec.ts` (+1: zero flow with the pump off)
* `interaction-gate.spec.ts`
* `domain-boundary.spec.ts` (comment)
* `tests/integration/lesson-flow.spec.tsx` ("lets free mode turn the valve before the pump
  is running")
* `tests/integration/monitor-live.spec.tsx` (two "recorded row stays frozen" tests return
  to Guided through "Keep" to see the lesson's rows, since free mode shows its own)
* `tests/integration/deflector-scope.spec.tsx` (two tests pass through "Keep")

**Whole unit suite:** unchanged from F09 apart from these. `simulation-runtime` still has
its 5 known local shim failures. `tsc`: only the existing TS2345 in `DeviceModel.tsx`.

## 5. Not verified here — run before merging

* **CI:** `npm run test:ci`. The integration spec (`lesson-flow`) and `interaction-gate`
  need the real vitest/jsdom and were not run here.
* **Guided run end to end** after these changes, and the CSV download itself (the
  export's F_ac column is pinned by the source check, not downloaded here).
* **The integration specs updated for F10** (`monitor-live`, `deflector-scope`,
  `lesson-flow`): they now pass through the dialog's "Keep" choice or expect free rows.

## 6. Evidence — running app (local dev build, Chrome, free mode)

Driven through the page's own buttons and slider (background tab, frames stepped).

| action | result |
|---|---|
| Free Mode, pump off, valve → 0.4 | slider 0.4, no popup |
| cover open, 90° fitted, cover shut, pump on, +50 g, +50 g | stack "−50g" ×2, Total Weight 100 g × g = 0.981 N |
| pump off, pump on | valve still 0.4 |
| Record reading; remove one 50 g; valve 0.6; Record reading | table row 1: 15.714 L/min, 100 g, F_th 0.8199, F_ac 0.9810; row 2: 43.457 L/min, 50 g, F_th 6.6287, F_ac 0.4905; bar "2 / 10"; board rows `15.714 | 0.9810`, `43.457 | 0.4905`; no Calculate button |
| Guided Mode (rig running) | dialog: "continues the procedure at step 1 … kept either way", focus on Reset |
| Escape | dialog gone, still free |
| Guided Mode → Keep | Step 1 / 11; back in free: valve 0.6, pump running, one 50 g disc — nothing changed |
| Guided Mode → Reset | rig reset; Q_total 120 L/min kept |
