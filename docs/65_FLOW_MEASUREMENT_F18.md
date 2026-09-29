# 65 — F18: measurement rolled back, water kept as a picture

This is a working-tree change on top of F03–F17 (`docs/53`–`64`). It is not committed and not deployed.

## What happened

1. A first F18 pass built a stopwatch measurement.
   * Closing the volumetric valve filled the measuring tank.
   * The learner timed the column.
   * Q, V₀, V and F_th, the board, the Data Monitor and every reading waited for that measured Q.
   * Steps 5 and 7 finished only once Q was measured.
2. On 2026-09-29 the user asked for that pass to be rolled back:
   * the flow-control-valve steps get no measurement step;
   * the water reflects the rules, **just for visual**.

   Two follow-up answers came with the request:
   * **Volumetric valve at rest:** closed, as before F18.
   * **Flow-measurement panel:** removed entirely.

## What is in the tree now

**Rolled back to the F17 state.** The file set was restored from the last copies synced before F18 began:

* the runtime, state and selectors;
* physics (`jetFromFlow` and `measuredFlowLMin` are gone);
* the lesson and schema;
* the overlay, monitor, board, reset dialog and step card;
* `App`, `types`, `apparatus` and `apparatusView`;
* `stateMachine` (the valve rests closed);
* the CSS;
* every test touched by F18.

With that restored:

* steps 5 and 7 are "set the valve, OK" again;
* Q and everything after it is live from the valve opening, as before;
* readings need no measurement.

**Kept, visual only: `src/lib/measuringTank.ts` plus about 40 lines in `DeviceModel.tsx`.**

| Aspect | Behaviour |
|---|---|
| Volumetric valve **shut** (its rest state) | The bench measuring tank collects the flow the jet delivers (`state.live.flowRateLMin`). |
| Volumetric valve **open** | The tank drains. |
| Range | 0 to 60 L, the top graduation of the scale. |
| Column | The sight tube fills using the model's own full-tube texture (`TUBE`). |
| Litre positions | Read off the scale texture: row = 3601.21 − 59.0421·L. |
| Basin | The basin (`Bing Sink`) fills to the same height. |
| State | The volume is presentation state in the frame loop. A Reset or a new sheet (`lesson.runId`) empties it. |
| What reads it | Nothing: no value, reading, step or panel. |

Because the valve rests shut, the tank starts filling as soon as the pump runs. At the first setpoint (15.7 L/min) it reaches the 60 L mark in about 4 minutes. After that it stays full until someone opens the valve. That is the rule, followed as-is.

**Removed:**

| File | What it was |
|---|---|
| `src/domain/flowMeasurement.ts` | The measurement's domain rules |
| `src/components/FlowMeterPanel.tsx` | The flow-measurement panel |
| `src/lib/simClock.ts` | The clock the runtime was given |
| `tests/helpers/measure.ts` | The test measurement helper |
| `tests/unit/f18-flow-measurement.spec.ts` | The measurement spec |

These were removed here. On the user's machine deleting was not available, so each was overwritten with a stub that says so: an empty `export {}`, and a skipped test for the spec. Nothing imports them, and they can be deleted. Until they are, `domain-boundary.spec.ts` will flag the stray `src/domain/flowMeasurement.ts`.

**Other changes:**

* The flowmeter's component card (F17) now says the column is a picture and that no value is taken from it.
* A new spec, `tests/unit/f18-visual-water.spec.ts`, pins four things:
  * the fill and drain rules;
  * the 0–60 L range;
  * that only the scene imports the water module;
  * that the simulation, lesson and panels know nothing of a measurement.

## Invented, flagged

The drain rate, `DRAIN_RATE_L_PER_S` = 3 L/s, is presentation only (DEC02). It sets how quickly the picture empties and nothing else.

## Checks

* **Unit suite:** identical to the F17 baseline. The only difference is that the F17 spec's one earlier failure now passes; the new visual-water spec's 7 tests all pass.
* **tsc:** only the known `DeviceModel` TS2345.
* **Integration and e2e specs:** back to their F17 versions.
