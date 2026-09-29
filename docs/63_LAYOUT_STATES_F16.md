# 63 — Layout, responsive behaviour and control states (F16)

Working-tree change on top of F03–F15 (`docs/53`–`62`). Not committed, not deployed.

**Observed (QA, E29, IMG19, IMG21):**

* guided text wrapped word by word in a narrow panel;
* bottom controls overlapped content;
* enabled controls looked disabled (the QA screenshot circles a blank "Open Data Monitor");
* large overlays pushed the apparatus out of focus.

**Target resolutions.** DEC05 still leaves them undefined. The sizes used are the ones
`docs/23` and `docs/51` were measured at: 1366×768, 1440×900, 1920×1080 and 2560×1440.
1280×720 was added as a stress case.

## 1. What was wrong — measured at 1366×768 before the change

| # | Where | What it did |
|---|---|---|
| 1 | `.guided-controls > button` | Its `!important` near-black fill overrode the monitor button's green. The button's own dark label then sat on near-black: **1.00:1**, which is the blank button in the screenshot. |
| 2 | `.guided-dock` | Absolutely placed at `bottom: 116px` (124 on short screens) to clear a footer whose height it could only guess. At the weight steps it grew upward to **top −97 px**, clipping "Open volumetric valve". |
| 3 | Chip, Steps list, dock, footer | Each was hand-positioned, so they overlapped. The chip overlapped the dock, the Steps list overlapped the dock, and at step 10 the dock overlapped the footer. |
| 4 | Popups | Centred over the viewport, on top of the chip and the Steps list. |
| 5 | Filled buttons | Contrast was below 4.5:1. The monitor's Close measured 3.41, Calculate 2.59, "Open the answer sheet" 2.78 and "Yes, reset" 3.41. All used white text on orange, green or #ff3d71. |
| 6 | States | "Selected" was an inline orange border with a tint, so it was colour-only. There was no focus style of our own. Disabled buttons were only faded. Warnings and notes differed only by colour. |
| 7 | Docked monitor | Its one `1fr` column grew to the readings table's min-content width. The column was **407 px in a 268 px panel**, and the live cards ran out of the panel and were cut off. In Arabic they were cut on the left. |
| 8 | Sidebar header | Had no layout of its own. The logo, the title and the Video/language row stacked as blocks, the row sat flush on the mode toggle, and `margin-left: auto` misplaced it in RTL. |
| 9 | "Clear all weights", "−g" | #ff3d71 text on the glass sidebar measured **3.89:1**. The buttons that cannot be removed yet were an inline `opacity: 0.45`, so they looked like enabled buttons, only dimmer. |
| 10 | Monitor button | It toggles, but with the board already docked it still read "Open Data Monitor", in the green of a next step. |
| 11 | Chip | At 1280 with the monitor docked, "VL-FM009" broke at the hyphen. |

## 2. The correction

**A guided shell that reflows.** `.guided-shell` is a CSS grid:

```
[ start rail ] [ centre ] [ end rail ]
[ bottom: dock (centred layout) · footer ]
```

* Columns are `auto minmax(0, 1fr) auto` and rows are `minmax(0, 1fr) auto`.
* It is padded by `max(…, env(safe-area-inset-*))` on every edge.
* The rails are clamped widths:
  * start: `clamp(230px, 21vw, 310px)`, or `clamp(300px, 30vw, 500px)` when it holds the weights dock;
  * end: `clamp(220px, 19vw, 290px)`.
* Nothing in it has a coordinate. Anchoring:
  * The chip and the Steps view sit in the start rail.
  * At the weight steps (`is-aside`), the dock moves into the start rail and the Steps view to the end rail, so the weights sit beside the jet rather than over it.
  * Otherwise the dock and the footer share the bottom row, in order, so they cannot overlap.
  * The footer wraps onto more rows instead of running under anything.
* Popups render in the centre column (`.guided-centre`). They are static there, so they cannot cover a rail. Outside guided mode they keep their old place.

**Scrolling inside the panel:**

* The dock has `max-height: min(62vh, 100%)` and `overflow-y: auto`.
* The Steps list scrolls inside `.step-progress`.
* The rails have `min-height: 0`, so they shrink rather than push.
* The docked monitor scrolls inside itself, and its column is `minmax(0, 1fr)`, so the table scrolls in its own container rather than widening the panel. The expanded view is `minmax(0, 3fr) minmax(0, 2fr)`.
* The sidebar was already a scroll box. Its header is now one wrapping flex row, with its buttons at the inline end in either direction.

**No word-per-line.** The dock is a size container (`container-name: dock`). The step card lays out from the dock's width, not the window's:

* below 620 px it stacks as `'num actions' / 'body body'`, with the instruction full width;
* below 360 px it stacks as a single column.

**States: each has a cue that is not colour.**

| State | Cue |
|---|---|
| focus | A 3 px `#ffd166` ring, offset 2 px, on every focusable control (`:focus-visible`). No fill uses that colour. |
| selected | A 4 px inner bar on the leading edge (mirrored in RTL), bold text, an accent edge and `aria-pressed`. Applies to the deflector choice, the mode toggle, the panel tabs and the Steps toggle. Buttons only: the board's `.dfl-item.is-selected` keeps its own style. |
| disabled | Opacity 0.5, desaturated, a dashed edge (an inset dashed outline on borderless buttons) and the not-allowed cursor. The inline opacity on the "−g" buttons is gone. |
| hover / pressed | A lighter fill and a brighter edge; a 1 px press. |
| warning | "Not allowed" in words, a triangle icon and the red panel. |
| note | "Note" in words, an info icon, and a dark panel with an accent edge. |
| success | A tick beside the green: "Pointer balanced", and "Recorded readings" once complete. |

**Contrast.**

* Primary actions keep their own fill (`.guided-controls > button:not(.btn-primary)`).
* Dark `#141517` text on orange (OK, Calculate) and on green ("Open the answer sheet").
* White is used only on the new `--danger-fill: #c81e4a`: the monitor's Close, "Yes, reset", the answer sheet's danger action, and the refusal popup at 0.97 alpha.
* Destructive outline buttons (`.is-danger`) get a solid dark backing and `#ff6b8e` text.

| Pair | Ratio |
|---|---|
| `#141517` on `#f58220` | 7.0 |
| `#141517` on `#4caf50` | 6.6 |
| white on `#c81e4a` | 5.6 |
| `#ff6b8e` on `#141517` | 6.7 |

**The monitor button names its action.** It reads "Close Data Monitor", in the secondary style, while the board is docked. The chip's "VL-FM009" no longer breaks.

**The apparatus stays the centre.** At every size and state the audit probed, the canvas centre was clear, with no UI over it.

## 3. Evidence — dev build, Chrome, rendered at exact sizes

**How it was measured.**

* The app ran in a same-origin iframe at each exact viewport, in a background tab.
* The animation clock was driven by the harness, so the lesson played out the same way at every size.
* An in-page audit ran at 15 states:
  * guided steps 1, 5, 6 (with the note), 6 (weights), 9, 10 (monitor docked) and 11 (with the note);
  * the answer sheet;
  * complete;
  * the video;
  * the reset dialog;
  * free mode with the sidebar;
  * free mode with the sidebar and the monitor;
  * the same in Arabic;
  * guided in Arabic.
* At each state it checked:
  * enabled buttons clipped by the viewport, unless they sit in an on-screen scroll box;
  * controls obscured, probed at three points each;
  * enabled-label contrast below 4.5:1, composited over a white scene as the worst case;
  * overlaps between the chip, Steps list, dock, footer, docked monitor, sidebar and popup;
  * panels off the viewport;
  * horizontal overflow, and vertically clipped content, in every panel;
  * word-per-line wraps;
  * canvas coverage and whether the canvas centre was clear.

**Results.**

| Size | Clipped | Obscured | Low contrast | Overlaps | Off-viewport | Overflow | Word-wrap | Canvas centre |
|---|---|---|---|---|---|---|---|---|
| 1280×720 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | clear at every state |
| 1366×768 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | clear |
| 1440×900 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | clear |
| 1920×1080 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | clear |
| 2560×1440 | 0 | 0 | 0 (after `.is-danger`) | 0 | 0 | 0 | 0 | clear |

Canvas covered by UI:

| Situation | Covered |
|---|---|
| Guided, dock at the bottom | 10–34 % (2560 → 1280) |
| Weights aside | 9–48 % |
| Monitor docked | 38–64 %, most of it the dock itself, which leaves the apparatus its own column |

Before the change, at 1366, the audit found:

* the 1.00 monitor button;
* the dock at top −97 px;
* four overlaps;
* four sub-4.5 buttons;
* the popup over the chip and the Steps list.

After the change, the docked monitor measured `scrollWidth` 268 in a 268 px panel, where it had been 407. The first 2560 pass found "Clear all weights" at 3.89; `.is-danger` fixed it.

**Screenshots** (1280×720 and 1366×768), checked by eye:

* the step-6 note in the centre column, clear of both rails;
* the Steps rail with the current step highlighted;
* the weights dock scrolling inside the start rail at 1366×768;
* the yellow focus ring on "+20g";
* "−50g" and "Clear all weights" disabled (dashed and faded) while a weight is still settling;
* step 10 with the monitor docked:
  * Close is at the top of the monitor;
  * the Steps list scrolls to the current step;
  * the footer wraps to two rows;
* the free sidebar, where the deflector list scrolls in its box and the selected Free Mode, Steps tab and Flat surface each show the leading bar.

**Harness artefact, not a defect.** In a background tab `ResizeObserver` does not fire, so the WebGL canvas kept its first size after the monitor closed, and screenshots of that state show it black. The same states in a foreground tab resize normally. That path is unchanged since F05.

## 4. Tests

* **New:** `tests/unit/f16-layout-states.spec.ts` (17). The source and CSS guarantees:
  * the grid shell and its safe-area padding;
  * no absolute bottom offsets left on the dock, footer or chip;
  * in-panel scrolling;
  * popups in the centre column;
  * the container query;
  * the monitor's `minmax(0, …)` tracks;
  * the sidebar header row;
  * the focus, disabled and selected rules, the RTL mirror, and `aria-pressed` with the class on all three selection groups;
  * the popup words and icons;
  * the success tick;
  * the monitor button's label;
  * the contrast pairs, computed to WCAG, and the danger-fill uses.
* **Updated:** `f14-guided-progress.spec.ts`. AC7 now matches the named `inGuidedShell` condition, which replaced the inline one.
* **Whole unit suite:** unchanged apart from these. `tsc`: only the existing TS2345 in `DeviceModel.tsx`.

## 5. Not verified here — run before merging

* **CI:** `npm run test:ci` and the Playwright e2e. The jsdom and e2e specs were reviewed by reading, not run; there is no vitest/jsdom/Playwright here.
  * They find the popup by `.warning-popup`, the footer by `.guided-footer` and the Steps toggle by `aria-pressed`, and all three are unchanged.
  * "Open Data Monitor" is clicked only while the monitor is closed, and it keeps that name then. Closing is done with "Close".
* **Touch devices and real notches:** the `env(safe-area-inset-*)` padding is in place, but no device with a notch was available.
* **DEC05:** the target sizes above are an assumption until DEC05 is decided.
