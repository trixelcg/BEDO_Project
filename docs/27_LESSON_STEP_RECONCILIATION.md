# 27 — Lesson Step Reconciliation (BEDO‑041)

**Question:** the application ships **12** instructional steps; `docs/14 §5` records the experiment sheets as
defining **11**. Which is canonical, and what is the extra step?

**Answer, in one line:** the build is the **union of two BEDO sources that genuinely differ** — BEDO's own
shipped simulator (10 steps) and BEDO's experiment sheets (11 steps). Neither the 12th step nor the extra step
is an implementation invention.

**This document decides nothing in code.** The BEDO‑002 tests stay pinned to the current 12-step behaviour
until a separate authorised task changes it.

---

## 1. What evidence actually exists

Handled first, because the honest answer to "what is canonical" depends on which documents are real and in
front of us.

| Source | In the repository? | Status |
|---|---|---|
| **Reference simulator walkthrough** (`docs/reference/Bedo_Mesu_J.mp4`, 89 s) | ✅ yes | **Primary.** BEDO's own shipped demo. Its step banner is numbered and legible; every step below was read off the video frame by frame. Evidence: `docs/reference/reference-simulator-steps.jpg` |
| **Current implementation** (`src/lib/experiments.ts`) | ✅ yes | **Primary.** |
| **Evaluation summary** (`Bedo Hydraulic Machines Vocational Training.pdf`) | ✅ yes | Primary, but **says nothing about steps** — it is the 2-page UX critique and the POC timeline. Its only binding lines here are "React, Threejs (webGL), Redux (no backend)". |
| **Mathematical model** (`Jet force_Mathematical model.xlsx`) | ❌ **absent** | Transcribed in `docs/13 §1`. Independently corroborated: the reference video's monitor screen shows `Q = 27.024`, `V₀ = 5.74`, `V_th = 5.679` — exactly the row BEDO‑002 pinned. |
| **Experiment sheets** (`Exp. 1–4`, + answer sheets) | ❌ **absent** | Transcribed in `docs/14 §5`. **The 11-step claim rests entirely on that transcription.** |
| **Storyboard** | ❌ **absent** | `docs/reference/Storyboard.pptx` is a **165-byte stub containing only the text "Nada Adel. Rashed"** — not a presentation. `docs/13`/`docs/20` cite specific slide numbers, so a real deck existed for whoever wrote them; it is not checked in. |
| **State-machine document** | ❌ **absent** | Transcribed in `docs/13 §5`. |

> ⚠️ **Three of the four documents this task named are not in the repository.** What follows is therefore
> conclusive about the *simulator* and the *implementation*, and dependent on a colleague's transcription for
> the *sheets*. It cannot be checked against the storyboard at all. §6 states exactly what must be confirmed
> before anyone acts on it.

---

## 2. The reference simulator: 10 steps, read off the video

Transcribed verbatim from the numbered banner (timestamps in the evidence image):

| # | Step text (as shown) |
|---|---|
| 1 | Press the upper plate to unscrew it. |
| 2 | **Click** on the deflector to install it in the rod. |
| 3 | Press the plate again to mount it to the tank. |
| 4 | Turn on the power switch of the unit. |
| 5 | **Slightly open the Volumatirc control valve of the unit.** *(BEDO's typo, for "Volumetric")* |
| 6 | Slightly open the flow control valve of the unit to control the flow rate. |
| 7 | Add weights to balance the weight base with the Pointer tip. |
| 8 | Increase the opening of the flow control valve. |
| 9 | Add weights to balance the weight base with the Pointer tip. |
| 10 | Switch to the software monitor. |

The numbering stops at 10. The software monitor that follows has a **Calculate** button and a **Record**
column, but it is a separate screen with no step banner — the actions exist, unnumbered.

Two details worth recording:

- Step 2 says **click**, not drag. `docs/14 §5` notes the *sheet* copy says "drag" and flags the build's click
  as `BUG‑22`. The shipped simulator clicks. Whoever owns `BEDO‑021` should know the two BEDO sources disagree
  here too.
- The build corrected BEDO's "Volumatirc" typo to "volumetric".

---

## 3. The three sources side by side

| Reference simulator (video) | Experiment sheets (per `docs/14 §5`) | Current build |
|---|---|---|
| 1 unscrew plate | 1 unscrew plate | **1** ✅ |
| 2 install deflector | 2 install deflector | **2** ✅ |
| 3 mount plate | 3 mount plate | **3** ✅ |
| 4 power on | 4 power on | **4** ✅ |
| **5 volumetric valve** | — *(absent)* | **5** ⚠️ |
| 6 flow valve | 5 flow valve | **6** ✅ |
| 7 balance (reading 1) | 6 balance | **7** ✅ |
| 8 increase flow | 7 increase flow | **8** ✅ |
| 9 balance (reading 2) | 8 balance | **9** ✅ |
| 10 software monitor | 9 software monitor | **10** ✅ |
| *(Calculate — present, unnumbered)* | 10 click "Calculated" to record F_ac | **11** ⚠️ |
| *(none)* | 11 "You finished!" → open the answer sheet | **12** ⚠️ |

**12 = 10 (simulator) + 2 (sheet-only).** The build implements the union: every instruction either source
gives, and no instruction that neither gives. Nothing was invented.

---

## 4. The three questions, answered

### 4.1 What does the canonical instructional procedure specify?

**There is no single canonical procedure in the available evidence — the two BEDO sources disagree, and the
disagreement is substantive, not clerical.**

- The **shipped simulator** teaches the volumetric valve and stops at the monitor, leaving F_ac unrecorded as a
  numbered instruction.
- The **experiment sheets** omit the volumetric valve and carry the lesson through to recording F_ac and
  reading the answer sheet.

Each source is complete on its own terms. The sheets are the pedagogical document; the simulator is the
product BEDO shipped and asked to have remade. Choosing between them is BEDO's call, not an engineering one.

### 4.2 What does the current 12th step represent?

**Step 12 ("You finished!") is sheet step 11 — a legitimate instruction, with substituted content.**

- The sheet's step 11 is *"You finished! Click the Document tab to view the answer sheet."*
- The build's step 12 is *"You finished! Answer the question below to complete the experiment."*

Same position, same title, different closing activity: the build substitutes an inline quiz for the answer-sheet
document, because the four answer-sheet PDFs are not wired into the app (they are referenced in `docs/14 §5` as
`Phase 2/Exp.{1..4} (Answer sheet).pdf` and are **not in this repository**). That substitution is a content
decision to confirm (`D‑6`), and it does not affect the count.

**The 12th step is not the anomaly.** Counting from the sheets, the extra step is **step 5, the volumetric
control valve.**

### 4.3 Classification of step 5

| Candidate | Verdict |
|---|---|
| A legitimate instruction | ✅ **Yes — in the simulator.** It is step 5 of BEDO's own shipped demo, and the build reproduces its wording. |
| Missing from the source material | ✅ **Yes — in the sheets.** Per `docs/14 §5` it appears in none of Exp. 1–4. |
| UI-only transition | ❌ No. It sets `isVolumetricValveOpen`, and the guided flow forces it true on advance. |
| Duplicated step | ❌ No. It is a distinct control from the flow valve (`hydrolic bensh 1_087` vs `Valve`). |
| Implementation artifact | ❌ **No.** This is the finding that overturns the earlier assumption. |

The **state-machine document** (per `docs/13 §5`) is a third voice: it lists the volumetric tank valve as a
clickable whose transitions are A→A, B→B, C→C, D→D — an affordance that **changes no state**. So the state
machine agrees it is real and disagrees that it should gate progress.

`docs/14 §5`'s recommendation — *"follow the sheets — 11 steps"* — was written without the video evidence and
would **delete an instruction from BEDO's own shipped product**. That recommendation should not be actioned as
written.

---

## 5. Recommendation

> ## ► RESTRUCTURE WITHOUT CHANGING LEARNING CONTENT

Keep all twelve instructions. Change only how the volumetric valve is *presented*, so that the numbered
sequence matches the experiment sheets:

1. **Demote step 5 from a numbered step to a prerequisite action inside step 4** ("Turn on the power switch,
   then slightly open the volumetric control valve"), or to an unnumbered preparatory action shown alongside it.
2. The valve stays clickable, stays highlighted when relevant, and stays required before flow can be set —
   nothing a student does changes.
3. The numbered sequence becomes **1–11**, aligning with the sheets a student may be holding on paper.

Why this and not the alternatives:

| Option | Why not |
|---|---|
| **KEEP 12** | Leaves the app permanently one step out of phase with the printed sheets from step 5 onward. A student following both sees "step 7" in two different places. Acceptable if BEDO declares the simulator canonical — this is the fallback. |
| **CHANGE TO 11 by deleting step 5** | Deletes an instruction BEDO ships in its own demo. On the real rig the volumetric valve controls the measuring-tank drain; silently dropping it teaches an incomplete start-up procedure. Not an engineering decision to make unilaterally. |
| **RESTRUCTURE** ✅ | Loses no instruction, matches the sheets' numbering, and matches the state-machine document's treatment of the valve as state-neutral. The only cost is one presentational change. |

**This recommendation is conditional.** It rests on `docs/14 §5`'s transcription of sheets nobody can re-read
from this repository. Before implementing, someone must confirm against the actual documents (§6). If the
sheets turn out to include the volumetric valve after all, the answer is simply **KEEP 12** and no work is
needed.

---

## 6. What BEDO must confirm before any implementation

1. **Are Exp. 1–4 really 11 steps, with no volumetric-valve step?** Requires the four `.docx` sheets.
2. **Which source is authoritative** where they disagree — the printed sheets, or the shipped simulator?
3. **Step 12's activity:** the real answer sheet (four PDFs exist somewhere), the inline quiz, or both? (`D‑6`)
4. **Step 2:** drag (sheets) or click (simulator)? Affects `BEDO‑021`, not the count.

Also worth recovering into the repository, since three of the four naming sources are missing:
`Exp.{1..4}.docx`, the answer sheets, `Jet force_State machine.docx`, `Jet force_Mathematical model.xlsx`, and
the **real** storyboard deck — the checked-in `Storyboard.pptx` is a 165-byte stub.

---

## 7. Status

- **Decision `D‑2`:** still open — this document supplies the evidence, not the authority.
- **`BEDO‑019`** (rewrite the step list) stays blocked on it.
- **BEDO‑002 tests remain pinned to 12 steps** (`experiments.spec.ts`, `lesson-flow.spec.tsx`,
  `lesson.e2e.ts`). They must not be edited until a task is authorised to change the lesson.
