# 61 — Guided progression on the experiment's own state (F14)

Working-tree change on top of F03–F13 (`docs/53`–`60`). Not committed, not deployed.

**Observed (QA, E25/E26, IMG19, IMG25):**

* The build said "Pointer balanced!" while the step still read "Add weights to balance…"
  with an OK beside it.
* A later step named a "Calculate" button without saying where it was.
* Step state, instruction text and control availability were three sources of truth.

## 1. What was wrong — found in the code

| # | Where | What it did |
|---|---|---|
| 1 | `currentLesson.ts`, balance steps 6 and 8 | `advance: confirm when readingBalanced`. The runner knew the reading balanced (the indicator said so) but kept the step current until OK was pressed. The screenshot is exactly that state. |
| 2 | Steps 1, 3, 4, 10 (`action`) and 9 (`confirm` + `alsoCompletesOn`) | Finished only by *their* action, through `notify`. Reaching the goal any other way left the step current: the monitor opened before step 9, a balance reached by taking a disc *off* (`REMOVE_WEIGHT` carried no expectation), a Q_total or custom-mass change (F09) that balanced the reading, or a return from Free Mode. |
| 3 | `UIOverlay` / `StepInstructionCard` | There was no Steps view in Guided Mode, only the one card, so completed and upcoming steps were not shown anywhere. |
| 4 | Step 11 "You finished!" | A numbered stand-in for completion. After it, the card showed "Step 11 / 11" plus a completion line. |
| 5 | Step 10 "Click the “Calculate” button **on the table**" | The button is under the results table, in the Data Monitor, and only there. Step 9's "Switch to the software monitor" named no control; the control is "Open Data Monitor". |
| 6 | Observation popups | Dismissed with **OK**, beside the step card's own **OK**, so they read as a second step to confirm (IMG19: the jet-push note and step 8 both showing OK). |
| 7 | F10's "Keep the rig as it is" | Handed Guided a rig its steps disagreed with, for example step 1 while the pump was running. In Guided the gate refuses the pump switch at step 1, and the cover can't open with the pump on, so the learner was stuck. |

## 2. The correction

**A step whose goal is a state of the rig finishes on that state.**

* **New advance kind `condition`** (`schema.ts`). `runner.sync(context)` finishes the
  current step the moment `isSatisfied` holds, and `notify` does the same for a
  `condition` step. This covers steps 1, 3, 4, 6, 8, 9 and 10.
* **What stays as it was:**
  * `confirm` for 2 (install) and 5 and 7 (settle the valve — a dragged slider passes
    the setpoint on its way);
  * `action` for 11 (open the answer sheet).
* **Runner guards:** once complete, the runner neither confirms nor advances, and
  `hasCompleted` reports every step done.
* **App** asks the runner after every commit, in a `useLayoutEffect` on the lesson
  context. It covers every route, and runs before paint, so no frame shows the rig done
  with the step still current. The dispatch sites stay at five
  (`domain-boundary.spec.ts`).
* **Step 9** is done when the monitor is on screen (`LessonContext.monitorOpen`),
  including a monitor opened earlier.
* **The balance stays visible.** A balance step ends with `END_READING` only, so the discs
  just balanced stay on the carrier. Reading 1's discs come off as reading 2 begins
  (step 7's `onComplete`); reading 2's stay for F_ac.
  * This also removes the "weights disappear" cause recorded in `docs/42 §7`.
  * The table's Mass column is unchanged (80 g and 260 g).
  * The monitor's Total Weight at step 10 now reads 260 g, the tray as it stands.

**The Steps view** (`StepProgress.tsx`, new) shows all eleven steps, driven by
`LessonView.progress`. The runner answers it from the same state as the card.

| | icon | emphasis | word |
|---|---|---|---|
| Completed | check (green) | normal | "Done" |
| **Current** | arrow (orange) | **bold**, orange edge and tint, `aria-current="step"` | "Now" |
| Upcoming | hollow circle | dimmed | "Next" |

* **Not a menu.** Rows are `<li>` elements with no handler, button, link or tab stop, and
  the view cannot reach the runner.
* **Scrolling:** it scrolls only when the current step changes, and only within its own
  list (`scrollTo` on the list, never `scrollIntoView`). A learner reading an earlier step
  is not pulled away.
* **Where it sits:** top left, or top right at the weight steps, where the dock moves aside
  to the left. The footer's **Steps** button (`aria-pressed`) and the list's × put it away
  and bring it back.
* **The compact step card persists** throughout Guided Mode, whether the list is open or
  not.
* **Completion is a state:**
  * the list ends with an unnumbered "Experiment complete — Finished" row;
  * the card switches to its completed form: "Complete" badge (no step number), "You
    finished!", no OK, and the answer sheet button;
  * step 11 is named for its action, "Open the answer sheet".
* **Popups are not steps:**
  * observation notes are dismissed with **Got it** (`aria-label="Dismiss note"`);
  * the assessment question stays unnumbered in the monitor, as before.

**Instructions name real controls:**

* Step 9: Press “Open Data Monitor” to switch to the software monitor.
* Step 10: In the Data Monitor, press “Calculate” under the results table to record F_ac.
* Step 11: Press “Open the answer sheet” to record and check your results.

The Arabic copy quotes the Arabic labels. A test extracts every quoted control name from
the step copy and notes and checks each one is a button label in the build.

**Returning to Guided** (supersedes F10's "Keep"):

* Guided takes back, silently, either the exact rig it left (volumetric valve aside) or the
  lesson still at step 1 with the rig at rest and a bare rod.
* Otherwise the dialog offers **Reset the rig and start at step 1** (Q_total and the
  custom mass kept, F10) or **Stay in Free Mode**.

## 3. Evidence — dev build, Chrome, a fresh tab, Exp. 1

Each line is read back from the page after the action. The list reads left to right, steps
1–11: D = done, N = now, - = next, F = the finished row.

```
start           | Step 1 / 11 | N---------- | OK:n | carrier 0 g
cover opened    | Step 2 / 11 | DN--------- | OK:y | carrier 0 g
deflector OK    | Step 3 / 11 | DDN-------- | OK:n |
cover closed    | Step 4 / 11 | DDDN------- | OK:n |
pump on         | Step 5 / 11 | DDDDN------ | OK:n |
valve 0.4       | Step 5 / 11 | DDDDN------ | OK:y |
flow OK         | Step 6 / 11 | DDDDDN----- | OK:n | carrier 0 g   | Unbalanced (target ≈ 80 g)
+50g            | Step 6 / 11 | DDDDDN----- | OK:n | carrier 50 g  | Unbalanced
+20g            | Step 6 / 11 | DDDDDN----- | OK:n | carrier 70 g  | Unbalanced
+10g (=80 g)    | Step 7 / 11 | DDDDDDN---- | OK:n | carrier 80 g            ← balanced → next step, no OK
valve 0.5       | Step 7 / 11 | DDDDDDN---- | OK:y | carrier 80 g            ← reading 1's discs still on
flow 2 OK       | Step 8 / 11 | DDDDDDDN--- | OK:n | carrier 0 g   | Unbalanced (target ≈ 260 g)
+200/+20/+20    | Step 8 / 11 | DDDDDDDN--- | OK:n | 200 → 220 → 240 g
+20g (=260 g)   | Step 9 / 11 | DDDDDDDDN-- | OK:n | carrier 260 g
monitor opened  | Step 10 / 11| DDDDDDDDDN- | OK:n |
Calculate       | Step 11 / 11| DDDDDDDDDDN | OK:n |
answer sheet    | Complete    | DDDDDDDDDDDF| OK:n | "11 of 11 done", "You finished!"
```

**Mode switch:**

* At step 2, Free → Guided with nothing touched: no dialog, still step 2.
* Free → close the cover → Guided: the dialog, with only "Reset the rig and start at
  step 1" and "Stay in Free Mode". Reset → step 1, cover closed.

**Looked at:**

* mid-run at step 6: the list on the right, the current row bold with arrow and "NOW",
  and the weight controls aside on the left;
* the completed state.

## 4. Tests

**New:**

* `tests/unit/f14-guided-progress.spec.ts` — 22 tests, all passing:
  * **AC1:** balance finishes on the balance, with no OK; also when a Q_total change is
    what balances it; App syncs in a layout effect with the monitor in the context; every
    step's advance kind is pinned; step 9 finishes with a monitor opened earlier; the
    balance stays on the carrier.
  * **AC2:** an icon and a word for each status, `aria-current`; the current row is bold
    and edged, upcoming rows dimmed; the view is built from the runner.
  * **AC3:** scrolls only on a step change, within the list.
  * **AC4:** rows have no handler, button or tab stop; the view cannot reach the runner;
    Guided takes back only its own rig.
  * **AC5:** only procedure steps are numbered; notes say "Got it", not OK.
  * **AC6:** step 11 is named for its action; the completed card and the finished row
    exist; the runner is inert once complete.
  * **AC7:** the card persists; the Steps toggle is present.
  * **Controls:** every quoted control (EN and AR) is a real button label; Calculate is
    under the table in the monitor; no "Document" tab is named.
* `tests/integration/steps-view.spec.tsx` (jsdom):
  * statuses at the start;
  * the balance marks done immediately, with no OK;
  * the scroll count moves only on a step change;
  * clicking a row changes nothing;
  * completion ends with 11 done plus the finished row;
  * hide and show the list;
  * the list is absent in Free Mode;
  * silent return to Guided, or a reset-only dialog.

**Updated for the new semantics:**

* `lesson-runner.spec.ts`: the walk uses `sync` for condition steps; new tests for
  balancing by taking a disc off, step 9 by monitor state, and free mode.
* `switch-weight-visibility.spec.ts`: one tray clear, at step 7.
* `experiments.spec.ts`: step 11's title.
* `f10-free-mode.spec.ts`: the mode-switch rule.
* `tests/helpers/app-harness.tsx` `walkLesson`: no OK at 6 and 8; reading 2 loaded as
  200 + 20 + 20 + 20, because 200 + 50 = 250 g already balances 257.9 g.
* `canonical-lesson`, `lesson-flow`, `deflector-scope`, `monitor-live`, `export-contract`
  (Total Weight 260 g at step 10), and `tests/e2e/lesson.e2e.ts`.

**Whole unit suite:** unchanged apart from these. `lesson-runner` keeps its 2 known local
shim failures (`not.toHaveBeenCalled`). `tsc`: only the existing TS2345 in
`DeviceModel.tsx`.

## 5. Not verified here — run before merging

* **CI:** `npm run test:ci`, and the Playwright e2e. The jsdom integration specs, including
  every one edited above, and the e2e need the real vitest/jsdom/Playwright, which this
  environment does not have. They were updated by reading, not by running.
* **The other three experiments in the browser.** Exp. 2's walk is in
  `canonical-lesson.spec.tsx` (balances at 170 g and 520 g).
* **Arabic layout** of the Steps view: RTL mirrors it through `inset-inline-*`, not looked
  at.
