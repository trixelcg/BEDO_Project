# 06 — UX Report

Evaluated by walking the complete twelve‑step guided procedure end to end in a real browser, in both languages,
at three viewport widths, plus Free mode and the Software Data Monitor.

**The pedagogical test applied throughout:** *does the student learn that the jet force depends on flow rate and
deflector geometry, and can they carry out the procedure the way they would at the real bench?* Several findings
below are not cosmetic — they defeat that objective.

---

## Index

| ID | Title | Severity | Difficulty | Priority |
|---|---|---|---|---|
| UX‑01 | 15–20 s of black screen with no feedback — the first impression is "broken" | **Blocker** | Moderate | P0 |
| UX‑02 | The student cannot see the two things they are asked to observe | **Blocker** | Moderate | P0 |
| UX‑03 | The app tells the student the answer ("target ≈ 80 g") | Critical | Easy | P0 |
| UX‑04 | Two of twelve steps are mouse‑only — no keyboard, no panel equivalent | Critical | Moderate | P0 |
| UX‑05 | A two‑click dead end with no recovery path but Reset | Critical | Easy | P0 |
| UX‑06 | Free mode is advertised but non‑functional | Critical | Moderate | P0 |
| UX‑07 | Unusable below ~800 px; content silently disappears | High | Moderate | P1 |
| UX‑08 | RTL is a no‑op — Arabic is second‑class | High | Moderate | P1 |
| UX‑09 | The walkthrough video autoplays 28 MB and cannot be seeked | High | Easy | P1 |
| UX‑10 | Camera automation is disorienting and cannot be turned off | High | Easy | P1 |
| UX‑11 | No progress model, no way back, no way to review a step | High | Easy | P1 |
| UX‑12 | No accessibility layer at all | High | Hard | P1 |
| UX‑13 | Error and observation popups are visually identical, one is mislabelled | Medium | Trivial | P2 |
| UX‑14 | Step 2 instructs an interaction that does not exist | Medium | Easy | P1 |
| UX‑15 | Balance feedback is buried in a scrolled panel, not next to the pointer | High | Easy | P1 |
| UX‑16 | A developer tuning panel is the most prominent control on screen | High | Easy | P1 |
| UX‑17 | Native `alert()` used for four user‑facing messages, untranslated | Medium | Trivial | P2 |
| UX‑18 | No completion state, no score, no way to retry the quiz | Medium | Easy | P2 |
| UX‑19 | The results table shows numbers the student never measured | High | Easy | P1 |
| UX‑20 | "Save Screen" saves the wrong screen | Medium | Trivial | P2 |
| UX‑21 | Reset is unguarded and discards everything silently | Medium | Trivial | P2 |
| UX‑22 | Two competing primary actions at step 10 | Low | Trivial | P3 |
| UX‑23 | No onboarding — the student is dropped straight into step 1 | Medium | Easy | P2 |
| UX‑24 | Weight buttons are unordered and un‑removable individually | Low | Easy | P2 |
| UX‑25 | Monitor layout: empty left column, overflowing right column | Medium | Easy | P2 |
| UX‑26 | No persistence — a refresh loses everything | Medium | Moderate | P2 |
| UX‑27 | No audio feedback of any kind | High | Moderate | P1 |

---

### UX‑01 — The first impression is a black screen

**Severity:** Blocker **Priority:** P0

For 15–20 seconds after navigation, a first‑time student sees **a completely black viewport** with a partially
rendered sidebar. There is no spinner, no percentage, no logo, no "Loading the laboratory…" — nothing that
distinguishes "loading" from "broken". On a school connection the download alone adds ~20 s on top of this
(`PERF‑04`).

Vocational students are the least likely audience to give a page the benefit of the doubt. Most will reload,
which restarts the whole thing.

**Fix.** A branded, bilingual DOM loading screen driven by drei's `useProgress()`, showing a real percentage and
what is loading, plus a first‑time tip. Combine with the asset work in `PERF‑01`/`PERF‑04` so the wait becomes
~2–4 s. See `BUG‑01`.

---

### UX‑02 — The student cannot see the two things the lesson asks them to observe

**Severity:** Blocker **Priority:** P0

The guided script raises two observation popups:
- Step 6/8: *"Notice that the water jet pushes the deflector upward."*
- Step 7: *"Notice the shape of water impinging the deflector."*

Neither is observable in the current build:

1. **The deflector is invisible.** The jet is drawn ~18× too wide (`BUG‑03`) and completely engulfs the
   deflector, the rod and the impact point. There is no "shape of water impinging" to see — just a frosted
   cylinder.
2. **The upward push is imperceptible.** Spring deflection is clamped to ±45 % of the spring's rest height
   (`DeviceModel.tsx:955‑958`), and once the student adds balancing weights the net force — and therefore the
   deflection — approaches zero *by design*. The pointer movement is sub‑pixel at typical framings.
3. **Nothing changes when flow increases** (`BUG‑21`), so step 8's whole premise is invisible.

These three together mean **the core physical phenomenon the experiment teaches is not depicted**.

**Fix.** `BUG‑03` (jet scale), `BUG‑21` (flow response), plus: exaggerate pointer deflection for legibility
(a common and appropriate choice in training sims — label it as such), add a visible scale behind the pointer,
add impact spray, and frame steps 6–9 so the deflector face is unobstructed.

---

### UX‑03 — The app gives away the answer

**Severity:** Critical **Priority:** P0

At steps 7 and 9 the sidebar prints **"Unbalanced (target ≈ 80 g)"**. The task is to *discover* the balancing
mass by observing the pointer — that is the measurement. Printing the target reduces the exercise to arithmetic
on a number the app already told them.

**Root cause.** `UIOverlay.tsx:544‑545` renders `activeRow.idealMass` unconditionally.

**Fix.** Show only balance *state* (too light / balanced / too heavy) derived from the pointer, and make the
pointer itself the primary readout. Reveal the exact target only after the student commits a reading, as
feedback. If a coaching mode is wanted, make it an explicit opt‑in ("Show hint").

---

### UX‑04 — Two of twelve steps are mouse‑only

**Severity:** Critical **Priority:** P0

The sidebar mirrors most apparatus controls (power, valves, weights, deflectors) as panel buttons. **It does not
mirror the tank cover.** `UIOverlay` has no control for steps 1 or 3 — the only way to unscrew and re‑seat the
plate is to click an invisible sphere on a `<canvas>`.

Consequently:
- A keyboard‑only user cannot start the experiment.
- A screen‑reader user cannot start the experiment.
- A user with a trackpad and poor motor control must hit a 3D target.
- Any WebGL pointer‑event failure locks the student out of the entire lesson.

**Fix.** Every apparatus action must have a DOM control. That is both the accessibility fix and a robustness
fix. See `UX‑12`.

---

### UX‑05 — A two‑click dead end

**Severity:** Critical **Priority:** P0

Reproduced: at step 2, clicking the (un‑highlighted) cover closes the tank; the step does not advance; selecting
a deflector then raises *"Remove the tank cover first"*; nothing indicates that the cover is now the thing to
click. Only `Reset simulator` — which discards all progress — escapes. See `BUG‑04`.

**Fix.** Gate clicks on `liveKeys`, and make guarded actions explain the recovery ("Open the tank cover again to
continue").

---

### UX‑06 — Free mode is advertised but does not work

**Severity:** Critical **Priority:** P0

The mode selector is the second thing in the sidebar, and Free mode's card promises *"interact with any part of
the rig, in any order."* In Free mode the student can turn things on and add weights, but **no reading is ever
recorded**: the results table stays at 0 g on all four rows, the balance indicator never appears, `F_ac` is
never captured, and the table reports four fixed valve settings regardless of the valve the student set. See
`BUG‑06`.

**Fix.** Give Free mode a first‑class "Record reading" action and a growing results table. This is also the mode
an instructor would use for demonstration, so it deserves better than the guided path, not worse.

---

### UX‑07 — Unusable below ~800 px

**Severity:** High **Priority:** P1

At 500 px the sidebar's entire middle section — step card, OK button, valve slider, weight buttons, monitor
button — **silently disappears**. Header, tabs and footer remain, giving no clue that content is missing. At
820 px the sidebar consumes 46 % of the viewport and the breakpoint has not yet fired. See `BUG‑12`.

Vocational training labs commonly issue tablets. This needs a decision and a real layout, not a `max-height`.

---

### UX‑08 — Arabic is second‑class

**Severity:** High **Priority:** P1

Arabic students get: an LTR layout with the panel on the left; exclamation marks and colons on the wrong side
of sentences; `<html lang="en">` so screen readers use an English voice; and a **fully English** Scene Settings
panel. The content translation itself is good — the *presentation* is not. See `BUG‑09`.

Additional gaps: no Arabic‑Indic numeral option; the results table and CSV export are English‑only; the CSV
header is English even in Arabic mode; `Cairo` is loaded as a font but `Inter` is listed first in the stack, so
Arabic falls through to a system font.

---

### UX‑09 — The walkthrough video

**Severity:** High **Priority:** P1

Clicking "Video" opens a modal that immediately begins downloading and playing a **28 MB** file with sound, with
no poster, no size warning, and **no ability to seek** because the server does not support `Range`
(`BUG‑25`, `ARCH‑11`). The modal has no Esc handler, no focus trap, and no captions. Chrome's autoplay policy
will often block it, leaving a frozen‑looking player.

**Fix.** Transcode, add `poster` + `preload="none"`, remove `autoPlay`, add bilingual captions, make it a proper
dialog, and serve with `Range` from a CDN.

---

### UX‑10 — Camera automation cannot be turned off

**Severity:** High **Priority:** P1

Each step change flies the camera for 1.25 s. Between steps 5 and 9 it travels under the bench, up to the tank,
back under the bench and back up — four full traversals (`RND‑13`). Once inside the bench cabinet the near plane
clips the cabinet wall, which is genuinely confusing. There is no "disable camera movement" preference, which is
also a vestibular‑accessibility requirement (WCAG 2.3.3 Animation from Interactions).

**Fix.** Fewer, gentler transitions (`RND‑13`); respect `prefers-reduced-motion`; add an explicit toggle; add a
"Reset view" button since aborting a flight by dragging leaves the student wherever they stopped.

---

### UX‑11 — No progress model, no way back

**Severity:** High **Priority:** P1

The only progress affordance is a badge reading "Step 7 / 12". There is no step list, no completed/upcoming
indication, no way to go back and re‑read step 5, and no way to jump. If a student misreads step 6 they cannot
return to it — the state machine only moves forward, and `Reset` is the only reverse gear.

**Fix.** A persistent step rail with completed/current/upcoming states; a read‑only "review step" affordance
that does not rewind the apparatus; and per‑step help.

---

### UX‑12 — No accessibility layer

**Severity:** High **Priority:** P1

Measured against the running app's accessibility tree:

| Issue | Evidence |
|---|---|
| `<html lang="en">` fixed; no `dir` | `index.html:2`; Arabic content announced in English |
| Range/number inputs unlabelled | Tree reads `textbox "1" type="range"` ×12 — no name |
| Icon‑only buttons unnamed | Settings close button appears as `button` with no name |
| Focus rings removed | `outline: none` on `.btn-primary` (`index.css:348`) and `.btn-secondary` (`:379`); no `:focus-visible` rule anywhere |
| Modals not dialogs | `SoftwareMonitor`, the video modal and the settings panel have no `role="dialog"`, `aria-modal`, focus trap, or Esc handler |
| Popups not announced | Warning/notice have no `role="alert"` / `aria-live`, so screen readers never hear the five safety guards |
| Canvas has no alternative | No `tabindex`, no ARIA, no keyboard path; two steps are canvas‑only (`UX‑04`) |
| Colour‑only encoding | Chart series distinguished by colour, and both colours are the same orange (`BUG‑11`) |
| Contrast | `#5c7a82` axis labels on `#030d10` ≈ 4.0:1 — below AA for small text |
| No reduced‑motion support | Camera flights, pulsing highlights and bobbing arrow all ignore `prefers-reduced-motion` |
| Touch targets | Weight buttons are ~54 × 30 px; 3D hotspots have no minimum screen size |

**Fix.** Treat the DOM panel as the accessible interface of record: every apparatus action available as a
labelled, focusable control; live regions for state changes; a real focus‑visible style; dialog semantics;
`lang`/`dir` bound to the language state. Target WCAG 2.1 AA — for a publicly funded vocational product this is
likely a procurement requirement, not a nicety.

---

### UX‑13 — Error and observation popups look the same

**Severity:** Medium **Priority:** P2

Both use `.warning-popup`, both appear top‑centre, both have an "OK" button. The observation variant only
differs by an inline background/border override — and it **keeps the red danger box‑shadow** (`BUG‑26`), so a
neutral teaching note glows red. Neither is announced to assistive tech, and neither auto‑dismisses or can be
dismissed with Esc.

**Fix.** Distinct components: a blocking `Alert` for the five safety guards (with the recovery action), and a
non‑blocking `Observation` toast for teaching notes, ideally anchored near the thing being observed.

---

### UX‑14 — Step 2 instructs a drag that does not exist

**Severity:** Medium **Priority:** P1

*"Drag the Flat surface (90°) onto the rod to install it."* There is no drag handling in the codebase; the
interaction is a click. See `BUG‑22`. Drag‑to‑install is the more faithful and more memorable interaction and is
worth implementing rather than rewording.

---

### UX‑15 — Balance feedback is in the wrong place

**Severity:** High **Priority:** P1

The one piece of feedback that matters at steps 7 and 9 — "are we balanced?" — lives at the bottom of a
scrolled sidebar, where it is **clipped in half and often entirely off‑screen** (`BUG‑10`). The student's eyes
are on the pointer, three hundred pixels away in the 3D view.

**Fix.** Put the balance readout in the scene: a small `<Html>` badge or a rendered scale beside the pointer,
showing over/under and the pointer's deviation. The sidebar keeps a secondary copy.

---

### UX‑16 — A developer panel is the most prominent control on screen

**Severity:** High **Priority:** P1

"Scene Settings" sits in the top‑right of the production app, above everything else, and opens a panel of 12
rendering parameters and full apparatus transforms — English‑only, with a "Capture Camera" button that lies
(`BUG‑23`) and a "Save Config" button that **changes the scene for every future visitor** (`ARCH‑13`). A
curious student can trivially make the app unusable for their whole class.

**Fix.** Remove from production builds.

---

### UX‑17 — Native `alert()` for user‑facing messages

**Severity:** Medium **Priority:** P2

Four `alert()` calls (`App.tsx:129, 131, 134, 410`) — blocking, unstyled, browser‑chrome, English‑only. They are
also a hazard in this codebase specifically: an `alert()` blocks the rAF loop and the WebGL context while open.

---

### UX‑18 — No completion state

**Severity:** Medium **Priority:** P2

After answering the quiz, nothing happens. No congratulation, no summary, no score, no "try another experiment",
no export prompt, no way to retry the question (`disabled={answered}` is permanent). Step 12's card just says
"You finished!" in the sidebar behind the monitor.

**Fix.** A completion panel: what they measured, how F_ac compared to F_th (a percentage error is the real
learning outcome), the quiz result, and clear next actions — retry, export, next experiment.

---

### UX‑19 — The table shows numbers the student never measured

**Severity:** High **Priority:** P1

Rows 1 and 4 of the results table are fabricated, and row 4 carries a fully computed `Q = 43.457 L/min`,
`V₀ = 9.227`, `F_th = 6.6287 N` (`BUG‑14`). A student who trusts the app will report fabricated data; one who
notices will lose trust in all of it. The chart is skewed by the same row and shows a phantom `F_ac = 0` point
(`BUG‑15`).

---

### UX‑20 — "Save Screen" saves the wrong screen

**Severity:** Medium **Priority:** P2

The button is in the Software Data Monitor's header, but it captures `document.querySelector('canvas')` — the
**3D scene hidden behind the monitor** (`SoftwareMonitor.tsx:114‑121`). A student pressing it while looking at
their results gets a picture of the apparatus instead.

---

### UX‑21 — Reset is unguarded

**Severity:** Medium **Priority:** P2

"Reset simulator" sits permanently at the bottom of the sidebar and, in one click, discards all progress,
readings and the quiz answer with no confirmation and no undo. It is also the *only* escape from several dead
ends (`UX‑05`), which makes accidental presses more likely.

---

### UX‑22 — Two competing primary actions at step 10

Orange "OK" and green "Open Data Monitor" both do the same thing by two code paths (`BUG‑32`).

---

### UX‑23 — No onboarding

**Severity:** Medium **Priority:** P2

The student arrives at step 1 with no explanation of what the apparatus is, what they are measuring, what Free
vs Guided mean, that the view can be orbited, or that the highlighted part is clickable. The objective and force
law are buried in the "Experiments" tab, which most students will never open. `experiments.ts` already contains
excellent `objectiveEn/Ar` text — it is simply never shown at the right moment.

**Fix.** A short bilingual intro card before step 1: the objective, the force law, the controls, and how to
orbit. Reuse the existing content.

---

### UX‑24 — Weight buttons

**Severity:** Low **Priority:** P2

`+10 +20 +50 +100 / +200 +500 +25` — the custom weight is appended out of order (`BUG‑35`). There is no way to
remove a single weight: only "Clear all weights", which forces the student to rebuild the whole stack after an
overshoot. On the real bench you lift one disc off.

**Fix.** Sort ascending; make loaded weights individually removable (click the disc in 3D or a chip in the
panel); show the stack as a list.

---

### UX‑25 — Monitor layout imbalance

**Severity:** Medium **Priority:** P2

`grid-template-columns: 3fr 2fr` gives the four‑row table a column with ~250 px of empty space beneath it, while
the right column (chart + quiz) overflows and requires scrolling — during which the header, including the only
**Close** button, scrolls away. The single `@media (max-width: 1024px)` rule stacks them, at which point the
chart's fixed 400×250 `viewBox` is the only thing that adapts.

---

### UX‑26 — No persistence

**Severity:** Medium **Priority:** P2

A refresh, a crash, a context loss (`BUG‑33`), or a closed tab loses every reading and the quiz answer. There is
no `localStorage`, no session, no resume. Combined with the ~20 s reload cost (`UX‑01`), a single accidental
refresh is a serious setback.

**Fix.** Persist `SimulationState` to `localStorage` on change and offer "Resume where you left off".

---

### UX‑27 — No audio

**Severity:** High **Priority:** P1

See `BUG‑30`. In a procedural training simulator, audio is a primary confirmation channel. There is currently no
way to *hear* the pump start, no way to hear flow increase, no click when a valve turns, no clink when a weight
lands, and no distinct tone for the five safety errors. The only audio in the product is inside the walkthrough
MP4.

---

## What the UX gets right

Worth keeping:

- **The Guided/Free split and the twelve‑step script** map cleanly onto how the real lab session runs, and the
  step copy is faithful and bilingual.
- **The five safety guards are the right five** — they teach real interlocks (don't open a pressurised tank,
  don't power up with the tank open, remove weights first), and the error messages explain *why*.
- **The step‑gated control panel** (`show(...)` in `UIOverlay`) is a sound idea: showing only the control the
  current step needs keeps a complex rig approachable.
- **The observation notices** are pedagogically well placed — they just point at things that are not currently
  visible (`UX‑02`).
- **Bilingual content is complete and good quality** across steps, errors, notices, experiment objectives, force
  laws and quizzes. Only the *presentation* fails (`UX‑08`).
- **CSV export** is a genuinely useful feature for a lab report, with sensible columns and precision.
- **The quiz per experiment** with explanation text is the right closing beat.
