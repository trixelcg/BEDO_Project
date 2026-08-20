# 27 — Lesson Step Reconciliation (superseded)

> ## ⚠️ Superseded by [`docs/32_CANONICAL_LESSON_SPEC.md`](32_CANONICAL_LESSON_SPEC.md)
>
> This document's conclusion was **wrong**, and it is kept only as a record of how.

---

## What this document said

Written during BEDO‑002/003, it concluded:

> **RESTRUCTURE WITHOUT CHANGING LEARNING CONTENT** — keep all twelve instructions,
> demoting the volumetric valve from a numbered step to a prerequisite, because deleting
> it "would delete an instruction from BEDO's own shipped product."

It reached that by decoding the reference walkthrough video frame by frame, finding ten
numbered steps with *"Slightly open the Volumatirc control valve"* at position 5, and
treating that as BEDO's current, authoritative behaviour.

It also recorded, correctly at the time, that the experiment sheets, the state-machine
document and the storyboard **could not be read**, and that its conclusion was conditional
on someone confirming them.

## Why it was wrong

Both premises failed.

1. **The sources were never missing.** They sit one directory above the repository — the
   real 38-slide storyboard, the state-machine document, all four experiment sheets and all
   four answer sheets. Only the in-repo `docs/reference/Storyboard.pptx` stub is empty, and
   that stub is what led three documents to describe the originals as unavailable.

2. **The video is not BEDO's current build.** `Project_VL-FM009/…/VL-FM009 StepsText 1.asset`,
   dated **19 October 2025**, lists **nine** steps whose fifth is the *flow* control valve.
   BEDO removed the volumetric step themselves. What survives in their project is a stale
   caption — `NotificationText` still has ten entries with `Volumatric Valve` at position 5
   — which is an inconsistency inside their own repository, not an instruction.

With the sheets readable, the picture is unambiguous: **no experiment sheet contains a
volumetric-valve step**, and the storyboard's own state tables do not list the control at
all. The step this document argued to preserve is supported by exactly one superseded
build.

## The corrected conclusion

**Eleven numbered steps**, as the four experiment sheets specify: nine apparatus steps, then
`record-actual-force`, then `open-answer-sheet`. The volumetric valve remains an
always-available, state-neutral clickable — which is all the state-machine document ever
claimed for it. The assessment question is real BEDO content but is not a numbered step.

`docs/32` carries the evidence, the cross-source matrix, the conflict table with confidence
levels, and the model BEDO‑008 should be built against.

## The lesson worth keeping

A conclusion drawn from the newest artefact you happen to have is not a conclusion drawn
from the newest artefact. This document named its own missing evidence and stated its
conclusion as conditional — that is what made the error recoverable. The failure was not
looking one directory up.
