# 62 — Live, recorded and reset, separated (F15)

Working-tree change on top of F03–F14 (`docs/53`–`61`). Not committed, not deployed.

**Observed (QA, E27/E28, IMG20):**

* recorded-reading counters disagreed with the table's rows;
* success states appeared for zero or invalid-looking data;
* live values sat beside historical rows with nothing to tell them apart.

## 1. What was wrong — found in the code, then measured

| # | Where | What it did |
|---|---|---|
| 1 | `UIOverlay` "Recorded readings n / 2" | Counted lesson rows with **mass on them**, which included the row being balanced. With 50 g on the carrier at step 6, nothing recorded, it read **1 / 2**. `selectReadingsTaken` had the same rule. |
| 2 | Monitor table | Four rows that looked alike: the valve-shut zero, recorded readings, the row being balanced (showing the live tray) and row 4, which the lesson never takes (full F_th, and F_ac 0.0000 after Calculate). IMG20's live 0 g beside 2 / 2 is this. |
| 3 | `RECORD_ACTUAL_FORCE` | Accepted unconditionally (ledger F15-AC02). Calculate then printed F_ac for every row, zeros included. |
| 4 | `END_READING` | Committed whatever was on the carrier. |
| 5 | `RECORD_FREE_READING` (F10) | Recorded any rig: zero flow, an empty carrier, an unbalanced pointer. The live "balanced" test even passes an empty carrier with no jet (0 g against 0 N). |
| 6 | Board result rows (`DeviceModel`) | "Recorded" meant "has mass", so the live row printed as a result. |
| 7 | CSV | Row 4 exported a theoretical force and an F_ac of zero (`BUG-14`). |
| 8 | Monitor | The live panel sat *under* the "Recorded Readings" heading. |
| 9 | Resets | "Reset simulator" reset on the spot. The monitor's unlabelled **Reset**, beside Export, did the same whole-simulator reset. Neither said what it cleared. |

## 2. The correction

**One definition of "recorded"** (`selectors.ts`), used by the runtime, the panel, the
monitor's table and graph, the board and the CSV:

* A **valid measurement**: water flowing, a load on the carrier, and that load within the
  existing `BALANCE_TOLERANCE_G` (±10 g) of the mass that balances the jet. Only then is
  mass × g the jet force.
* A row's **status** is one of:
  * `reference` — row 1, the valve-shut zero;
  * `recorded` — taken, and a valid measurement;
  * `live` — being balanced now;
  * `pending` — not taken.
* **The count** everywhere is the number of `recorded` rows among readings 1–2
  (`selectRecordedReadingCount`). In free mode it is the free table's length, which only
  ever holds valid readings.

**Prerequisites, enforced by the runtime.** A refused command changes nothing, and the UI
disables the control and states the reason.

* `END_READING` commits only a valid measurement, with the jet actually on the carrier
  (deflector fitted, pump on, tank shut). The lesson ends a reading only when it balances,
  so this never refuses a lesson step.
* `RECORD_ACTUAL_FORCE` (Calculate) needs both readings recorded and none in progress.
  Otherwise the monitor shows the reason: "Record both readings first — n of 2 recorded."
  or "Finish balancing the current reading first."
* `RECORD_FREE_READING` needs, in order:
  * room in the table — "Table full";
  * a fitted deflector;
  * water on it — "No jet on the carrier…";
  * a load — "Load the carrier…";
  * a balance — "Not balanced — needs ≈ 34 g more".

  When all hold, the hint reads "Balanced — Record takes this load as F_ac."
* **No volumetric numbers are invented.** Ledger DEC02 / BLK-04 said the F_ac prerequisite
  set was undefined in the source. These prerequisites use only rules the simulator
  already had: the balance tolerance, the fitted deflector and the jet reaching the
  carrier. DEC02's volumetric part (tank and flowmeter response) stays open.

**Live and recorded, separated.**

* **The monitor has two sections.**
  * "Now — live values, not recorded": a dashed cyan frame around the live panel,
    gravity and total weight.
  * "Recorded readings n of m": a solid frame around the table and Calculate.
* **Each row states what it is,** in a new last column, "Status" (Arabic "الحالة"):
  "Reference · valve shut", "✓ Recorded", "● Balancing now — see Live" or "Not recorded".
  * A live or pending row shows **no numbers**; the live numbers are in the Live section.
  * F_ac appears only on a recorded row.
  * Rows are styled by status as well: italic for the reference, a dashed band for live,
    dimmed for pending.
* **The graph** plots only the reference and recorded readings.
* **The board** prints a result row only when it is recorded.
* **The CSV** keeps the same eleven columns and four rows, and the same formatting for a
  recorded reading. A live or pending row exports its schedule (Row, Q_total, n) and
  blanks, which fixes `BUG-14`. F_ac is written only for a recorded reading once recorded.
  The reference row keeps its true zeros, and no F_ac.

**Reset, explicit.**

* **"Reset simulator"** (sidebar and footer) asks first whenever there is something to
  lose, in an `alertdialog`.
  * **This clears:** the rig; guided progress (step N, back to step 1); n recorded lesson
    readings, and their F_ac once recorded; n free readings. Each is listed only when
    present.
  * **This keeps:** Q_total and the custom weight (with their values), the experiment, the
    mode and the language.
  * Buttons: **Yes, reset** or **Cancel** (focused; Escape cancels).
  * With the rig at rest at step 1 and nothing recorded it resets directly, since there is
    nothing to clear.
* **The monitor's unlabelled "Reset" is removed.** There is one whole-simulator reset,
  and it is named.
* **"Clear readings"** (free mode) is labelled as clearing the free readings only.
* **The Free → Guided dialog** now says resetting clears the rig, the lesson progress and
  all recorded readings.

## 3. Evidence — dev build, Chrome, a fresh tab

**Guided, Exp. 1:**

| moment | panel | monitor | table rows (status: Q … F_ac) | board | Calculate |
|---|---|---|---|---|---|
| step 6, 50 g on, monitor open | **0 / 2** (was 1 / 2) | 0 of 2 | reference 0.000 … — · live — … — · pending — · pending — | blank, blank | disabled: "Finish balancing the current reading first." |
| 80 g — reading 1 balanced | 1 / 2 | 1 of 2 | reference · **recorded 15.714 … 80, 0.8199, —** · pending · pending | 15.714, blank | disabled: "Record both readings first — 1 of 2 recorded." |
| 260 g — reading 2 balanced | 2 / 2 | 2 of 2 | reference · recorded · **recorded 27.024 … 260, 2.5303** · pending | 15.714, 27.024 | enabled |
| Calculate | 2 / 2 | 2 of 2 | F_ac 0.7848 and 2.5506 on the two recorded rows only; reference and pending "—" | F_ac 0.7848, 2.5506 | "F_ac recorded" |

* **Reset simulator** (a real click) opened the dialog.
  * Clears: "The rig: cover, pump, valve, weights and deflector"; "Guided progress: step 11
    (back to step 1)"; "2 recorded lesson readings and their F_ac".
  * Keeps: "Q_total 120 L/min and the custom weight 25 g"; "The experiment: Exp. 1 — Flat
    surface deflector"; "The mode and the language".
  * Focus was on Cancel. **Yes, reset** → step 1.
* **Free mode:**
  * fitted, pump off: Record disabled, `NO_FLOW`;
  * valve 0.4: `NO_LOAD`;
  * 50 g: `NOT_BALANCED`, "needs ≈ 34 g more";
  * 80 g: enabled, "Balanced — Record takes this load as F_ac";
  * Record → "1 of 10", row `1 15.714 … 80 0.8199 0.7848 ✓ Recorded`.

## 4. Tests

**New:**

* `tests/unit/f15-recorded-state.spec.ts` — 16 tests, all passing:
  * **AC1:** the live tray is not counted; the count equals the recorded rows after every
    command of the procedure; every surface reads that one number; `END_READING` refuses
    an unbalanced or pump-off reading; 0 g on 0 N is not a measurement; free mode.
  * **AC2:** Calculate is refused before, and during, a reading and allowed once both are
    recorded; the reason is shown; F_ac appears on recorded rows only; each free-reading
    blocker in order.
  * **AC3:** two sections, dashed and solid; non-recorded rows show no numbers; the status
    column and its labels; the graph plots reference and recorded only; the CSV values
    per status.
  * **AC4:** the reset dialog's lists and when it appears; the runtime reset clears
    readings and F_ac and keeps the parameters; one named reset; "Clear readings"
    scoped.
* `tests/integration/recorded-state.spec.tsx` (jsdom):
  * 0 / 2 with 50 g on;
  * the counts through the walk;
  * the live row blank, with its sections present;
  * Calculate disabled with the reason, then enabled;
  * F_ac on recorded rows only;
  * the free-mode blocker sequence;
  * the reset dialog: its lists, Cancel, Yes, not shown at rest, and no monitor Reset.

**Updated:**

* `simulation-runtime.spec.ts`: a fitted, running rig for readings; Calculate's
  prerequisites; the live row is no longer counted.
* `weight-removal.spec.ts` and `lesson-schema.spec.ts`: the same rig; F_ac after both
  readings.
* `f10-free-mode.spec.ts`: free readings need a balance; zero flow is refused.
* `tests/helpers/app-harness.tsx`: `resetSimulator()` confirms the dialog.
* `lesson-flow`, `canonical-lesson`, `monitor-live`, `runtime-ownership`:
  `resetSimulator()`; the table read by status; F_ac read from its own column.
* `runtime-ownership`: two tests had read the lesson table in free mode, which F10 had
  broken. They now read the table in Guided and the live Q panel.
* `export-contract`: nine table columns; the CSV rows as above; a new test that the row
  being balanced exports blank.

**Whole unit suite:** unchanged apart from these. `tsc`: only the existing TS2345 in
`DeviceModel.tsx`.

## 5. Not verified here — run before merging

* **CI:** `npm run test:ci` and the Playwright e2e. The jsdom and e2e specs were updated
  by reading, not by running (no vitest/jsdom/Playwright here).
* **The CSV change is a change to a published interface.** It keeps the same columns and
  rows, but row 4 and a mid-reading row now export blanks where they used to carry
  invented values. If a downstream sheet reads row 4's F_th, it will see an empty cell.
* **Arabic layout** of the two sections and the dialog: not looked at.
