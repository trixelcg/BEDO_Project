# 32 — Canonical Lesson Specification (BEDO‑041, re-opened)

**The authoritative answer to what the Measurement of Jet Forces lesson is.** Written from
the primary sources, all of which were read directly for this task.

**Headline:** the canonical procedure is **nine apparatus steps**, followed by a recording
step and a closing step — **eleven numbered steps**, exactly as BEDO's four experiment
sheets specify. **The volumetric-valve step is not part of it**, and BEDO themselves
removed it from their own build in October 2025. The assessment question is real BEDO
content but is **not a numbered step**.

**Nothing in `src/` changes.** The current twelve-step flow stays until an implementation
task is authorised.


> **Implemented by BEDO‑019** — see `docs/35`. Eleven numbered steps, the volumetric valve
> as an always-available affordance, the assessment outside the numbered flow, and the four
> answer-sheet worksheets shipped and opened by the closing step. The evidence below is
> unchanged; only its status is.

---

## 1. Sources read

All paths relative to `/Users/ramial-fuqahaa/Desktop/BEDO_Project/`.

| # | Source | Path | Date |
|---|---|---|---|
| S1 | Storyboard, 38 slides | `Measurement of Jet Forces/Phase 1/Jetforce_Storyboard.pptx` | — |
| S2 | State machine | `Measurement of Jet Forces/Phase 1/Jet force_State machine.docx` | — |
| S3 | Mathematical model | `Measurement of Jet Forces/Phase 1/Jet force_Mathematical model.xlsx` | — |
| S4 | Parameter setting | `Measurement of Jet Forces/Phase 1/Jet force_Parameter setting.docx` | — |
| S5 | Phase 1 breakdown | `Measurement of Jet Forces/Phase 1/phase1_Breakdown.docx` | — |
| S6 | Phase 1 walkthrough, 11 pages | `Measurement of Jet Forces/Phase 1/Steps_phase one.pdf` | — |
| S7 | Experiment sheets ×4 | `Measurement of Jet Forces/Phase 2/Exp.{1..4}*.docx` | — |
| S8 | Answer sheets ×4 | `Measurement of Jet Forces/Phase 2/Exp.{1..4} (Answer sheet).pdf` | — |
| S9 | Reference walkthrough video | `Bedo_Mesu_J.mp4` (also `public/`) | Jul 2025 |
| S10 | **Unity `StepsText`** | `Project_VL-FM009/Assets/New2025/Devices/Experiment1/Scriptable/VL-FM009 StepsText 1.asset` | **19 Oct 2025** |
| S11 | Unity `NotificationText` | same folder, `VL-FM009 NotificationText 1.asset` | 19 Oct 2025 |
| S12 | Unity Bernoulli trainer | `Project_VL-FM009/Assets/LABS/T R A I N E R S/Bernoulli/…/Ex 01 StepsText.asset` | — |
| S13 | Current implementation | `src/domain/experiments.ts` | — |

`docs/reference/Storyboard.pptx` (165 bytes) is a stub and was **not** used.

## 2. Authority

| Tier | Sources | Why |
|---|---|---|
| **1 — Training specification** | S7 experiment sheets, S8 answer sheets | The documents that define what is taught. Four independent copies that agree. |
| **2 — Apparatus/software specification** | S1 storyboard, S2 state machine, S4 parameters | Define the rig, the equations and legality — **not** the procedure |
| **3 — Mathematical authority** | S3 spreadsheet | Numbers only |
| **4 — Reference implementation** | S10/S11 Unity, S9 video, S6 walkthrough | What BEDO built; useful corroboration, but implementations drift |
| **5 — Current implementation** | S13 | Inherited from S9 |

**Finding that reorders the earlier analysis: the storyboard contains no procedure at
all.** Its table of contents is Introduction, Equations, Custom Parameters, Trainer
Hierarchy, Software Hierarchy, Camera View, State Machine. It specifies the *apparatus*.
The lesson procedure exists only in the Phase 2 experiment sheets.

---

## 3. Each source, as written

### S7 — Experiment sheets (Tier 1). **11 numbered steps.**

Identical across all four; only step 2's deflector changes.

| # | Step (Exp. 1) | Highlight | Popup after |
|---|---|---|---|
| 1 | Press the upper plate to unscrew it. | upper plate | — |
| 2 | Drag the 90° flat deflector to install it in the rod. | flat deflector | — |
| 3 | Press the plate again to mount it to the tank. | plate | — |
| 4 | Turn on the power switch of the unit. | power switch | — |
| 5 | **Slightly open the flow control valve** of the unit to control the flow rate. | flow control valve | "the water jet pushes the deflector upward" |
| 6 | Add weights to balance the weight base with the Pointer tip. | weights | "the shape of water impinging the deflector" |
| 7 | Increase the opening of the flow control valve. | flow control valve | "the water jet pushes the deflector upward" |
| 8 | Add weights to balance the weight base with the Pointer tip. | weights | — |
| 9 | Switch to the software monitor. | — | — |
| 10 | Click on the "Calculated" button at the table to record the value of F_ac. | — | table/graph readings; "Save Screen"/"Export Data" |
| 11 | You finished! Click on the "Document" tab to view the answer sheet. | the button | — |

Between the step‑10 popups and step 11 sits an **unnumbered** assessment block:
`❓ Multiple Choice | اختيار من متعدد` with options and a marked correct answer. Exp. 1, 3, 4
are MCQ; Exp. 2 is True/False. **There is no volumetric-valve step in any of the four.**

### S8 — Answer sheets (Tier 1). Not an answer key.

Three pages: the derivation, a symbol table, then **a blank worksheet** — `Q = ____`,
`V₀ = Q/A = ____`, `V² = V₀² − 2gS = ____`, `F_th = ρAV² = ____`,
`F_ac = total weight = total mass × g = ____`, an empty 9‑column results table
(Q / F theoretical / F actual) and an empty F‑vs‑Q graph, 0–60 L/min.

So step 11's "Document tab" hands the student **a calculation exercise to complete by
hand**, not the answers. (It also states `F_ac = total mass × g` — a third independent
confirmation of the 1:1 lever finding from `docs/29 §8`.)

### S10 — Unity `StepsText`, 19 Oct 2025 (Tier 4). **9 steps.**

```
1 Press the upper plate to unscrew it.
2 Click on the deflector to install it in the rod.
3 Press the plate again to mount it to the tank.
4 Turn on the power switch of the unit.
5 Slightly open the flow control valve of the unit to control the flow rate.
6 Add weights to balance the weight base with the Pointer tip.
7 Increase the opening of the flow control valve.
8 Add weights to balance the weight base with the Pointer tip.
9 Switch to the software monitor.
```

**No volumetric step.** This is BEDO's newest artefact of any kind, and its step 5 is the
flow control valve — matching the experiment sheets exactly. Steps 10 and 11 of the sheets
(Calculate, You finished) are simply absent from the list.

### S11 — Unity `NotificationText`, same date and folder. **10 entries.**

```
Cover · Defelctor pres Ok to Continue · Cover · Power · Volumatric Valve ·
"…jet pushes the deflector upward…" · "…shape of water impinging…" ·
"…jet pushes the deflector upward…" · " press Ok to Continue . " ·
Click On the softwere Montior Or Press Ok to Continue.
```

These are the per-step target captions, and there are **ten of them against nine steps**,
with `Volumatric Valve` at position 5. **BEDO's own current project is internally
inconsistent**: the step text was shortened to nine and the caption list was not. Which is
exactly how the volumetric step came to exist and then half-vanish.

### S9 — Reference video (Tier 4). **10 numbered steps.**

An older build. Step 5 reads *"Slightly open the Volumatirc control valve of the unit"*
(BEDO's typo). Steps 1–4 and 6–10 match the sheets' 1–4 and 5–9. Numbering stops at 10;
the monitor's Calculate button exists but is not a numbered step. Evidence:
`docs/reference/reference-simulator-steps.jpg`.

### S6 — Phase 1 walkthrough (Tier 4). A third, different opening.

Page 1's banner reads **"1 Turn on the main power ON/OFF switch"**, highlighting the red
bench panel — a step that appears in no other jet-forces source. The rest is a feature
tour (clicks on cover, deflector, custom weight panel, valve slider), not a procedure.

### S1 — Storyboard (Tier 2). No procedure; state tables **without** the volumetric valve.

Clickables on slides 29–32: `1. Power switch · 2. Valve · 3. Deflectors · 4. Weights ·
5. Weights on holder · 6. Cover · 7. Software monitor`. Also specifies two behaviours the
app has never had: *"The water will gradually drain from the tank if the valve is opened"*
on power-off (sl. 30, 32) and *"The weight removed from the tank holder in 2 sec"* (sl. 32).

### S2 — State machine (Tier 2). The volumetric valve's only specification.

Lists `3. Volumetric tank valve` among the clickables, and its transitions are
**A→A, B→B, C→C, D→D** — it can be clicked in every state and **changes nothing**. Five
errors, one monitor view. No lesson steps anywhere in the document.

### S12 — Bernoulli trainer (Tier 4). BEDO's house pattern for endings.

```
1..9   apparatus procedure
10     Open experiments panel to see the objectives and access the documents
11     Click on the "Document" tab to view the answer sheets.
12     Select the answer sheet.
13     You finished! you can now select another experiment.
```
…and the assessment lives **outside** that list, in a separate
`Quesitons/EX01 Multiple Choice Quesiton.asset`. VL‑FM009 has **no** question asset at all.

---

## 4. Cross-source matrix

`—` absent · `A` present as a numbered step · `c` present as a clickable/affordance only

| Learner action | S7 sheets | S1 storyboard | S2 state machine | S10 Unity | S9 video | S13 R3F |
|---|---|---|---|---|---|---|
| Select experiment | — (one sheet each) | — | — | — | c | c |
| Unscrew / open cover | **1** | c | c | **1** | **1** | **1** |
| Install deflector | **2** (drag) | c | c | **2** (click) | **2** (click) | **2** (click) |
| Mount cover | **3** | c | c | **3** | **3** | **3** |
| Power on | **4** | c | c | **4** | **4** | **4** |
| **Volumetric valve** | **—** | **—** | **c** (state-neutral) | **—** | **5** | **5** |
| Flow valve, reading 1 | **5** | c | c | **5** | 6 | 6 |
| Add weights, reading 1 | **6** | c | c | **6** | 7 | 7 |
| Increase flow, reading 2 | **7** | c | c | **7** | 8 | 8 |
| Add weights, reading 2 | **8** | c | c | **8** | 9 | 9 |
| Open software monitor | **9** | c | c (state J) | **9** | 10 | 10 |
| Record F_ac ("Calculated") | **10** | c | — | — | c | 11 |
| Assessment question | unnumbered block | — | — | — (separate asset in Bernoulli) | — | inside 12 |
| Open answer-sheet document | **11** | — | — | — | — | **absent** |
| "You finished" | **11** | — | — | — | — | **12** |
| Remove single weight | — | sl. 32 | c (D→B) | — | — | absent |
| Drain on power-off | — | sl. 30/32 | — | — | — | absent |

---

## 5. Conclusions

### 5.1 The volumetric valve — **not a numbered step. Option D.** `HIGH`

| Question | Answer |
|---|---|
| Explicitly numbered instructional step? | **No** — in none of the four experiment sheets |
| Prerequisite embedded in another step? | No — no sheet mentions it at all |
| Only in the reference simulator? | It was: video build only, and **BEDO removed it** by Oct 2025 |
| Does the storyboard specify it? | **No** — absent from its state tables and from `phase1_Breakdown` |
| Does the state machine model it? | **Yes, but as a state-neutral clickable** (A→A, B→B, C→C, D→D) |
| Do experiment sheets mention it? | **No** |
| Required for physically correct setup? | Not for these four experiments. `Jet force_Parameter setting.docx` gives `Q = ΔV/Δt` — the volumetric tank is for *measuring* flow by timing a volume, an activity none of the four sheets performs |
| Once per experiment, or initialisation? | Neither; it is not part of the procedure |

**Recommendation: D — not part of the learner flow**, while remaining an always-available
clickable exactly as S2 specifies: it turns, and it changes nothing. That is the only
representation any Tier‑1 or Tier‑2 source supports.

### 5.2 Calculate — **a numbered step (10).** `HIGH`

All four sheets number it. It happens once per experiment run, after both readings.
BEDO's Unity build has not implemented it as a step, but the training specification is
unambiguous and outranks the implementation.

### 5.3 Assessment — **not a numbered step.** `HIGH`

It is real BEDO content (present in all four sheets) but appears as an **unnumbered block**
between step 10's popups and step 11. BEDO's own engine confirms the shape: in the
Bernoulli trainer the MCQ is a separate `Questions` ScriptableObject, outside `StepsText`.
It should be a first-class *assessment* attached to the experiment, not a procedure step.

### 5.4 "You finished" — **the terminal numbered step (11), and it carries an action.** `HIGH`

The sheets number it and give it a task: *"Click on the 'Document' tab to view the answer
sheet."* Bernoulli lists the same idea as its final steps entry. So it is not a bare
completion screen — though the *action* (open the worksheet) is the substantive part, and
**the current app implements neither the document nor the four answer-sheet PDFs**.

### 5.5 Four experiments — **one reusable procedure, four instances.** `HIGH`

- The four sheets are identical except step 2's deflector name and the closing question.
- Unity has **one** `Experiment1` folder with **one** `StepsText`, not four.
- What varies: deflector(s) and default angle, the force law, the objective text, the
  assessment question, the answer sheet.
- What is constant: all nine apparatus steps, both readings, the recording step.
- **Deflector selection** happens inside step 2, with the cover open — never a separate
  "choose your experiment" step in any source.
- **Reset between experiments**: no source specifies one. Bernoulli's ending — *"you can now
  select another experiment"* — implies returning to a selection screen; the current app
  resets the whole simulation state on experiment change. `LOW` confidence; leave
  configurable.

### 5.6 Why the reference simulator shows ten `HIGH`

Because that build inserted the volumetric valve at position 5, shifting sheet steps 5–9 to
6–10, and never numbered Calculate or the closing step. The Oct 2025 project shows the
correction in progress: `StepsText` is back to nine and matches the sheets, while
`NotificationText` still carries `Volumatric Valve` at position 5. **The ten was a build
artefact, not a specification.**

---

## 6. Canonical model for BEDO‑008

Numbering is presentation. The engine should key on stable ids.

```
Lesson  (Measurement of Jet Forces, VL-FM009)
 └── Experiment  ×4        flat | semi | conical | oblique
      ├── deflectors, default angle, force law, objective        ← varies
      ├── Procedure  — the same nine steps for every experiment
      │     unscrew-cover · install-deflector · mount-cover · power-on
      │     set-flow-reading-1 · balance-reading-1
      │     increase-flow-reading-2 · balance-reading-2 · open-monitor
      ├── Recording      record-actual-force        (sheets §10)
      ├── Assessment     one question per experiment (unnumbered, separate)
      └── Closing        open-answer-sheet          (sheets §11)
```

### 6.1 Stable ids

| id | Sheet # | Display | Notes |
|---|---|---|---|
| `unscrew-cover` | 1 | 1 | |
| `install-deflector` | 2 | 2 | sheets say **drag**; every build clicks (`BUG‑22`) |
| `mount-cover` | 3 | 3 | |
| `power-on` | 4 | 4 | |
| `set-flow-reading-1` | 5 | 5 | flow control valve |
| `balance-reading-1` | 6 | 6 | |
| `increase-flow-reading-2` | 7 | 7 | |
| `balance-reading-2` | 8 | 8 | |
| `open-monitor` | 9 | 9 | |
| `record-actual-force` | 10 | 10 | |
| `open-answer-sheet` | 11 | 11 | terminal; "You finished!" |

Not steps: `open-volumetric-valve` (affordance, always available, state-neutral),
`assessment` (attached to the experiment), `select-experiment` (navigation).

**`step id ≠ display number`.** No business logic may key on an index —
`if (step === 7)` is exactly what makes inserting or removing one step a cross-cutting
change, which is how the twelve-step flow drifted from the specification in the first
place. `BALANCE_ROW = {7: 1, 9: 2}` in `App.tsx` is the current instance of that problem.

### 6.2 Numbering recommendation

**1–11, matching the experiment sheets**, because a student may hold the printed sheet
while using the simulator and the two must agree. The volumetric valve keeps its
affordance and loses its number.

---

## 7. Current 12 steps, classified

| R3F | Title | Class | Canonical id |
|---|---|---|---|
| 1 | Unscrew the upper plate | **EXACT** | `unscrew-cover` |
| 2 | Install the deflector | **EXACT** (interaction differs: drag vs click) | `install-deflector` |
| 3 | Screw the tank cover | **EXACT** | `mount-cover` |
| 4 | Power switch | **EXACT** | `power-on` |
| 5 | **Volumetric valve** | **UNSUPPORTED** | — (affordance only) |
| 6 | Adjust the flow valve | **EXACT** | `set-flow-reading-1` |
| 7 | Balance the pointer (1) | **EXACT** | `balance-reading-1` |
| 8 | Increase the flow rate | **EXACT** | `increase-flow-reading-2` |
| 9 | Balance the pointer (2) | **EXACT** | `balance-reading-2` |
| 10 | Open the software monitor | **EXACT** | `open-monitor` |
| 11 | Record the actual force | **EXACT** | `record-actual-force` |
| 12 | You finished! | **COMBINED** — merges the closing step with the sheets' unnumbered assessment, and drops the answer-sheet document | `open-answer-sheet` + `assessment` |

**One step lacks primary-source support: step 5.** Ten of twelve are exact. The twelfth is
a faithful-but-merged rendering of the closing step plus the assessment.

---

## 8. Conflicts

| # | Topic | Source A | Source B | Resolution | Confidence |
|---|---|---|---|---|---|
| C1 | Volumetric valve as a step | S9 video, S13 R3F: numbered step 5 | S7 ×4, S1, S5, **S10**: absent | **Not a step.** Tier 1 unanimous; BEDO's own newest build agrees | **HIGH** |
| C2 | Step count | S10: 9 · S9: 10 · S7: 11 · S13: 12 | | **11.** S10 stops before the recording/closing steps that S7 specifies | **HIGH** |
| C3 | Install interaction | S7: "Drag the deflector" | S9/S10/S13: click | Unresolved — sheets say drag, every implementation clicks. `BUG‑22`/`BEDO‑021` | MEDIUM |
| C4 | Assessment placement | S7: unnumbered block in the sheet | S13: inside step 12 | Separate assessment structure, per S12's house pattern | **HIGH** |
| C5 | Closing action | S7: open the answer-sheet document | S13: inline quiz, no document | Both — the document is missing and should be added; `D‑6` | MEDIUM |
| C6 | Volumetric valve in the state machine | S2: listed as clickable | S1 storyboard state tables: absent | Keep as clickable; S2 is the later, more complete revision | MEDIUM |
| C7 | Unity internal | S10 `StepsText`: 9 | S11 `NotificationText`: 10 with `Volumatric Valve` | BEDO's own bug — the caption list was not updated | **HIGH** |
| C8 | Phase 1 opening step | S6: "Turn on the main power ON/OFF switch" | All others: "Press the upper plate" | Superseded Phase‑1 build | MEDIUM |
| C9 | Spring divisor | S1 sl. 8: `F/(200×100)` | S3: `=W4/200*1000` | Spreadsheet; resolved in `docs/31 §2` | **HIGH** |
| C10 | Drain on power-off, single-weight removal | S1 sl. 30/32, S2 | S13: neither implemented | Real gaps — `BEDO‑010`, `BEDO‑023` | **HIGH** |
| C11 | Answer-sheet graph range | S8: 0–60 L/min | S13: Q_total default 120 L/min | Worksheet may predate the 120 L/min default | LOW |

Anything below `HIGH` should be configurable in BEDO‑008 rather than hard-coded.

---

## 9. What this changes about earlier documents

`docs/27`'s recommendation — *restructure to 11, keeping the volumetric instruction because
BEDO ships it* — was **reasonable on the evidence then available and is wrong now**. It
rested on the video being BEDO's current build. It is not: the Oct 2025 Unity project
removed that step. The instruction is not "shipped by BEDO" any more; it is a leftover.

`docs/14 §5`'s original recommendation (follow the sheets, 11 steps) was right, and
`docs/27` overturned it on weaker evidence. It stands.
