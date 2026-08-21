# 35 — Canonical Lesson Migration (BEDO‑019)

The lesson now has **eleven numbered steps**, as BEDO's four experiment sheets specify.
The volumetric-valve instruction is gone from the procedure; the valve is not. The closing
step opens the worksheet BEDO wrote for it, which the application had never surfaced.

**This is a deliberate learner-visible change** — the first since BEDO‑007 — carried out as
the data edit BEDO‑018 was built to make possible.

---

## 1. The canonical eleven

| # | `StepId` | Learner action | Complete when | Source | Confidence |
|---|---|---|---|---|---|
| 1 | `unscrew-cover` | Press the upper plate to unscrew it | cover open | Exp. sheets §1 ×4 | HIGH |
| 2 | `install-deflector` | Install the deflector on the rod | learner confirms | Exp. sheets §2 ×4 | HIGH |
| 3 | `mount-cover` | Press the plate again to mount it | cover shut | Exp. sheets §3 ×4 | HIGH |
| 4 | `power-on` | Turn on the power switch | pump running | Exp. sheets §4 ×4 | HIGH |
| 5 | `set-flow-reading-1` | Slightly open the **flow** control valve | valve ≥ 0.38 | Exp. sheets §5 ×4 | HIGH |
| 6 | `balance-reading-1` | Add weights to balance the pointer | row 1 balanced | Exp. sheets §6 ×4 | HIGH |
| 7 | `increase-flow-reading-2` | Increase the flow valve opening | valve ≥ 0.48 | Exp. sheets §7 ×4 | HIGH |
| 8 | `balance-reading-2` | Add weights to balance the pointer | row 2 balanced | Exp. sheets §8 ×4 | HIGH |
| 9 | `open-monitor` | Switch to the software monitor | monitor open | Exp. sheets §9 ×4 | HIGH |
| 10 | `record-actual-force` | Click Calculate to record F_ac | F_ac recorded | Exp. sheets §10 ×4 | HIGH |
| 11 | `open-answer-sheet` | You finished — open the answer sheet | sheet opened | Exp. sheets §11 ×4 | HIGH |

Not numbered: **the volumetric valve** (affordance, §3) and **the assessment** (§6).

## 2. Old twelve → new eleven

| Old # | Old id | New # | New id | |
|---:|---|---:|---|---|
| 1 | `unscrew-cover` | 1 | `unscrew-cover` | unchanged |
| 2 | `install-deflector` | 2 | `install-deflector` | unchanged |
| 3 | `mount-cover` | 3 | `mount-cover` | unchanged |
| 4 | `power-on` | 4 | `power-on` | unchanged |
| **5** | **`open-volumetric-valve`** | — | — | **removed as a step; valve retained** |
| 6 | `set-flow-reading-1` | 5 | `set-flow-reading-1` | renumbered |
| 7 | `balance-reading-1` | 6 | `balance-reading-1` | renumbered |
| 8 | `increase-flow-reading-2` | 7 | `increase-flow-reading-2` | renumbered |
| 9 | `balance-reading-2` | 8 | `balance-reading-2` | renumbered |
| 10 | `open-monitor` | 9 | `open-monitor` | renumbered |
| 11 | `record-actual-force` | 10 | `record-actual-force` | renumbered |
| 12 | `finish` | 11 | **`open-answer-sheet`** | renumbered **and re-scoped** |

Ten of eleven ids are untouched, which is why no code had to follow the change.

## 3. The volumetric valve

**Removed from the procedure. Kept in the product.**

The evidence (`docs/32 §5.1`): it appears in **none** of the four experiment sheets; the
storyboard's state tables do not list the control at all; BEDO's state-machine document
gives it transitions A→A, B→B, C→C, D→D — *it turns and changes nothing*; and BEDO removed
it from their own Unity `StepsText` in October 2025.

What it still is:

| | |
|---|---|
| In the state machine | unchanged — `OPEN_/CLOSE_VOLUMETRIC_VALVE`, accepted in every state |
| In the simulation runtime | unchanged — `isVolumetricValveOpen` |
| In the 3D scene | unchanged — the same mesh, the same hotspot |
| On the control panel | **now available at every step**, via `Lesson.alwaysAvailable` |
| In the lesson | **nothing.** No number, no highlight, no arrow, no advancement |

`alwaysAvailable` is the one schema addition this task made. Without it the valve would
have been reachable only from the 3D scene in guided mode — a capability regression
dressed up as a spec alignment. With it, the control behaves as the state-machine document
describes: always clickable, never consequential.

`tests/integration/canonical-lesson.spec.tsx` holds five tests whose only job is to stop a
future "cleanup" from deleting the valve along with its step.

## 4. The answer sheet

BEDO's closing step is *"You finished! Click the 'Document' tab to view the answer sheet."*
The application had no such document.

**The assets exist and are now shipped.** Copied unmodified from BEDO's Phase 2 delivery:

| Source | Shipped as | Size |
|---|---|---:|
| `Exp.1 (Answer sheet).pdf` | `public/answer-sheets/flat.pdf` | 239 KB |
| `Exp.2 (Answer sheet).pdf` | `public/answer-sheets/semi.pdf` | 259 KB |
| `Exp.3 (Answer sheet).pdf` | `public/answer-sheets/conical.pdf` | 259 KB |
| `Exp.4 (Answer sheet).pdf` | `public/answer-sheets/oblique.pdf` | 250 KB |

Provenance is recorded in `public/answer-sheets/README.txt`, beside the files.

**They are not answer keys.** Each is a blank worksheet: the student computes Q, V₀, V²,
F_th and F_ac by hand and plots F against Q (`docs/32 §3`). That is the closing activity
BEDO designed, and it is why substituting the inline quiz for it was wrong.

### 4.1 Mapping

`ANSWER_SHEETS: Record<ExperimentId, string>` in `src/domain/experiments.ts`, keyed by
**stable experiment id, never by file order** — a mistake there would hand a student the
wrong worksheet with no visible symptom. `answerSheetFor(id)` returns `null` for an
experiment with no sheet, and the closing step's button simply does not render; nothing
opens the wrong document. All four mappings are tested, including that each file is a real
PDF and that no two experiments share one.

### 4.2 Presentation

`src/components/AnswerSheet.tsx` — a header, an iframe, Close, and "Open in new tab".

**Fetched only when opened.** The boot trace still shows 15 requests and 27.02 MB, with no
answer sheet among them.

**It renders as a sibling of the software monitor, not inside the UI overlay.** That is
deliberate: `.ui-container` carries `pointer-events: none` and hands it back only to
children marked `interactive`, and the walkthrough video modal — which is inside it and is
not marked — cannot be closed at all (`docs/28 §11`). Mounting the sheet where
`SoftwareMonitor` already lives means it structurally cannot inherit that defect, so **the
existing bug needed no fix and got none.** A test asserts the sheet closes.

## 5. The assessment

**Preserved, and no longer numbered.**

BEDO's sheets place the question as an unnumbered block between step 10's popups and step
11, and BEDO's own Bernoulli trainer keeps its MCQ in a separate `Questions` asset outside
`StepsText` (`docs/32 §5.3`). It stays exactly where a learner already finds it — in the
software monitor, once F_ac is recorded — with the same questions, the same answers and
the same bilingual explanations. What changed is that it is no longer a step: the
`ANSWER_QUESTION` expectation is gone from the type union, which is the strongest available
form of that guarantee.

## 6. Completion

There is no step 12.

```
step 11 (open-answer-sheet)  →  learner opens the sheet
                             →  runner.isComplete = true
                             →  "✅ Experiment complete." beside step 11 of 11
```

The runner already modelled this: completing the last step leaves `currentStepId` where it
is and sets `isComplete`. The panel renders a completion line rather than advancing to a
number that does not exist.

## 7. Content preservation

| Old content | New location | Preserved? |
|---|---|---|
| Steps 1–4 copy | steps 1–4 | ✅ verbatim |
| Step 5 "Volumetric valve" / "Slightly open the volumetric control valve" | **removed from the procedure**; the control remains on the panel at every step | ⚠️ the *instruction* is gone — deliberately, per `docs/32` |
| Steps 6–11 copy | steps 5–10 | ✅ verbatim |
| Step 12 title "You finished!" | step 11 title | ✅ verbatim |
| Step 12 body "Answer the question below…" | replaced by "Open the answer sheet to record and check your results." | 🔄 re-scoped to the sheets' own closing instruction |
| The four observation popups | unchanged, on the same steps | ✅ verbatim |
| The four assessment questions | unchanged, in the monitor | ✅ verbatim |
| Arabic throughout | updated alongside English | ✅ |

The only learner-visible instruction that disappears is the volumetric-valve step, which is
exactly what the evidence requires and nothing more.

## 8. Test expectations changed on purpose

Every one of these pinned the twelve-step behaviour BEDO‑002 protected. BEDO‑019 is the
authorised task to change them.

| Test | Was | Now | Evidence |
|---|---|---|---|
| `experiments.spec.ts` | `TOTAL_STEPS === 12`, ids 1–12 | `=== 11`, ids 1–11 | Exp. sheets ×4 |
| `experiments.spec.ts` | step titles incl. "Volumetric valve" | without it | `docs/32 §5.1` |
| `experiments.spec.ts` | targets incl. `volumetricValve` | without it | ″ |
| `experiments.spec.ts` | notices on steps `[6,7,8,11]` | on the same steps, now by **id** | renumbering only |
| `lesson-schema.spec.ts` | twelve ids, `finish` | eleven ids, `open-answer-sheet` | ″ |
| `lesson-runner.spec.ts` | twelve-step walk | eleven-step walk | ″ |
| `lesson-flow.spec.tsx` | "completes all twelve steps" | "…all eleven steps"; closes on the sheet | ″ |
| `lesson.e2e.ts` | `Step 1 / 12`, twelve-step walk | `Step 1 / 11`, eleven-step walk | ″ |
| `language.e2e.ts`, `readiness.e2e.ts` | `Step 1 / 12`, `الخطوة 1 / 12` | `/ 11` | ″ |
| `runtime-ownership.spec.tsx` | `Step 1 / 12` | `Step 1 / 11` | ″ |
| `assets.spec.ts` | twelve served assets | seventeen — the four sheets and their provenance note | §4 |
| `bundle.spec.ts` | `dist/` file list | + the answer sheets | §4 |

No assertion was weakened. The physics, spring, state-machine, simulation-runtime, CSV and
GLB suites are **untouched** — 57 / 34 / 61 / 40 / 15 / 51, all green without an edit.

## 9. New tests

`tests/integration/canonical-lesson.spec.tsx` — 15 tests in three groups:

- **the valve is an affordance, not a step** (5) — no number, still on the panel at every
  step, still operable from panel and 3D, and operating it does not advance the lesson
- **the assessment survives, unnumbered** (3) — not a step, still reachable, answering does
  not disturb numbering
- **the lesson ends at eleven** (7) — eleven everywhere, no twelfth step, the closing step
  opens the right sheet, completion is a state, the sheet closes, each experiment gets its
  own sheet, reset returns to 1 / 11

Plus five answer-sheet mapping tests in `assets.spec.ts` and a payload guard in
`bundle.spec.ts`.

## 10. Scene and performance

| | Before | After |
|---|---|---|
| Scene fingerprint | — | **identical in every section** — 290 objects, 4 lights, 33 transforms, 16 hotspots, camera |
| Draw calls / triangles / binds / programs | 769 / 217 055 / 22 / 42 | **unchanged** |
| Boot requests | 15 | **15** — no answer sheet among them |
| Boot transfer | 27.02 MB | **27.02 MB** |
| JS raw / gzip | 1 228 560 / 337 KB | 1 236 770 / 338 KB (+8.2 KB — the sheet component) |
| CSS | 7 170 B | 7 170 B |
| `dist/` | 56.25 MB | 57.24 MB (+0.98 MB of worksheets, on disk) |
| Answer sheet, on demand | — | 239–259 KB, once, when asked for |

The step‑5 removal changes **lesson-driven** state — one fewer highlight target, one fewer
camera trip under the bench — but no apparatus geometry, and the fingerprint is captured at
rest, where it is identical.

## 11. Deferred

- **`BUG-04` lesson gating** — `BEDO-020`. The valve is a good example of why: it is
  clickable at any step and inert, which is correct, but the same is currently true of
  every other control.
- **The video modal still cannot be closed** (`docs/28 §11`). Untouched — the answer sheet
  avoids the defect by construction rather than fixing it.
- **The answer sheet is an iframe.** Adequate and small; a proper viewer, download and
  print flow is product work.
- **The worksheet's graph axis reads 0–60 L/min** while the app's default pump flow is
  120 L/min (`docs/32 §8`, C11). BEDO's inconsistency, not the app's; worth raising.
