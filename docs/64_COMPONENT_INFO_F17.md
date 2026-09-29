# 64 — Hover identification and anchored component information (F17)

Working-tree change on top of F03–F16 (`docs/53`–`63`). Not committed, not deployed.

**Observed (QA, E30, IMG22):**

* Hovering over parts of the apparatus did not consistently identify the part or explain its function.
* There were no popups anchored to parts.

**Required:**

* Hover and focus show a compact tooltip with the part's name and a short function.
* A deliberate click opens a richer card.
* Cards anchor to the part by a stable anchor id.
* Hover never acts.
* Everything comes from one component-information definition.

## 1. What was there — found in the code, then driven in the browser

| # | Where | What it did |
|---|---|---|
| 1 | `DeviceModel.labelFor` | Composed hover labels inline for six kinds of part: weights, nozzle, tray deflectors, power switch, flow valve and volumetric valve. Each label was a **name only**, with no function. |
| 2 | Tank cover | Had a hit proxy (it is clicked at steps 1 and 3), but `labelFor` returned **null** for it, so hovering the cover showed nothing. |
| 3 | Pointer, spring, weight carrier | **No hit proxy at all**, so hovering them found nothing. |
| 4 | Flowmeter | There is no flowmeter model (ledger F17-AC01, F18). The part the QA's "flowmeter view" (IMG23) shows is the bench's measuring-tank scale, which had no proxy either. |
| 5 | Deflector on the rod | No proxy. Only the tray deflectors were named. |
| 6 | Richer surface | None. The only surface was a one-line cursor label. |
| 7 | Anchors | `apparatusView` anchors covered only the parts a lesson step frames. Nothing tied a popup to a part. |

## 2. The correction

**One definition: `src/domain/componentInfo.ts`.** It is pure data and string functions, and the domain-boundary rules apply to it.

* **Parts.** It covers 11 parts: tank cover, nozzle, deflector (on the tray or installed), weight carrier, pointer, spring, weight (on the tray or on the carrier), flow control valve, volumetric valve, power switch, and flowmeter (the volumetric scale).
* **Text.** Each part has, in English and Arabic:
  * a **name**;
  * a one-line **function**;
  * **details** for the card;
  * a **use** line (what to do with it, or what to watch it for).
* **Derived numbers.** No figure is restated; each comes from its source:

  | Figure | Source |
  |---|---|
  | Nozzle bore and area | `NOZZLE_AREA_M2` |
  | Spring stiffness | `SPRING_RATE_N_PER_M` |
  | Deflector name and momentum factor | `DEFLECTORS` |
  | Weight name | `WEIGHTS` (the custom weight names itself, as in F04) |

* **Wording.** It follows the lesson's own terms: "weight base", "pointer tip", «قاعدة الأوزان».
* **Facts checked against the state machine.** For example, the cover "will not open while the pump runs or weights are on the carrier" matches `COVER_BLOCKED_BY_POWER` and `COVER_BLOCKED_BY_WEIGHTS`.
* **Arabic formulas.** Formulas inside Arabic text are isolated left-to-right (U+2066…U+2069) and use non-breaking spaces. Without the isolate, the browser rendered "Q = ΔV / Δt" out of order.
* **The flowmeter card says what the simulator does.** Q follows the valve opening, and the timed volume reading is not simulated. It invents no volumes or durations (DEC02, BLK-04). *(Since F18 the card adds that the column shows the water collecting while the volumetric valve is shut, as a picture only — `docs/65`.)*
* **Stable anchor ids.** Each part has an id of the form `vlfm009.<part>[.<where>][.<variant>]`. Examples:
  * `vlfm009.tank-cover`
  * `vlfm009.deflector.installed.90`
  * `vlfm009.weight.carrier.50`

  The id names the part, not a mesh, so it does not change across reloads, languages or re-exports of the model.

**Surfaces that read it.**

| Surface | Trigger | Shows |
|---|---|---|
| Cursor tooltip (`lib/cursorTooltip.ts`) | Hover over any part | Three lines: the name, what it does, and how to open its card. |
| Component card (`components/ComponentCard.tsx`) | A deliberate click | Name, function, details and use, with a close button and Escape. It is a `role="dialog"` and stays until it is closed. |
| Compact card | Keyboard focus (`:focus-visible`) on a panel control for a part: the cover buttons, power, volumetric valve, flow slider, deflector choices, weight buttons | Name and function only, as a `role="tooltip"`. It goes when focus leaves. A mouse click on those controls does not open it. |

**New hit proxies in `DeviceModel`.**

* All are fitted boxes, like the nozzle's, so they stand in front of nothing:
  * pointer;
  * spring;
  * weight carrier (the pan mesh);
  * flowmeter (the two scale plates, `Rectangle002` and `Rectangle003`, beside the sight tube next to the volumetric valve);
  * the deflector on the rod.
* Moving parts are followed every frame. The spring rides the cover lift, and the carrier and the fitted deflector ride the rod's lift, using the same numbers the parts use.
* The pointer's proxy is withdrawn while the cover is up, because the pointer arm swings clear then.
* The installed deflector's proxy exists only while a deflector is fitted.

**Hover is informational only.**

* `hoverProxy` sets the outline, the cursor and the label, and nothing else. The unit test asserts that it calls no handler, whether a callback or a dispatch.
* Operational parts keep their click for the action, unchanged.
* The card opens on:
  * a **right-click** on any part (a long press on touch). A right-drag still pans the camera; a press that moved more than 6 px is not a request.
  * a plain **click** on an informational part (nozzle, pointer, spring, carrier, flowmeter, installed deflector), but only when no control is behind it.
* The spring, carrier, pointer and installed deflector sit inside the tank cover's click sphere. Clicking them still acts on the cover, exactly as before, and their hint therefore says "Right-click for details". The hint is worked out on each hover.
* **Which part is "the" part.** The cover's sphere encloses the parts above and inside the tank, so the rule is:
  1. A disc on the carrier, whenever one is under the pointer.
  2. Otherwise the nearest proxy.
  3. If the nearest is the cover and a fitted part is also under the pointer, that fitted part.

  This is the existing disc rule, extended to the new fitted parts. It applies to hover and the card only; the cover's click is untouched.

**Anchored placement.**

* Each frame, the scene projects the inspected part's anchor to the screen (`lib/componentAnchor.ts`, a small external store, so the scene does not re-render the tree).
* The card is placed beside the anchor, never on it, by `placeCard`:
  * it tries the inline-end side first (right in English, left in Arabic), then the other side, then above, then below;
  * it stays inside the viewport with a 12 px margin, and 18 px from the part;
  * a ring marks the part, and a dashed line joins the marker to the card.
* It has a solid backing, so it reads over any part of the scene.
* The hover tooltip is not shown over a part whose card is already open.

## 3. Evidence — dev build, Chrome, 1366×768, English and Arabic

The app ran in the same exact-size harness as `docs/63`, with the scene clock driven.

**Every part names itself.** Hovering each part's projected centre gave:

| Part | Tooltip name | Tooltip function | Hint |
|---|---|---|---|
| Tank cover | Tank cover (upper plate) | Closes the top of the jet tank… | Right-click |
| Nozzle | Nozzle — 10 mm bore | Forms the vertical water jet… | Click or right-click |
| Pointer | Pointer | A fixed mark at the weight carrier's rest height. | Right-click (inside the cover's sphere) |
| Spring | Deflector spring | Supports the rod and carrier… | Right-click |
| Weight carrier | Weight carrier (weight base) | Holds the balancing weights… | Right-click |
| Flowmeter | Flowmeter (volumetric scale) | The scale on the bench's measuring tank… | Click or right-click |
| Volumetric valve | Volumetric valve | The drain valve of the tank… | Right-click |
| Power switch | Power switch | Turns the pump on and off. | Right-click |
| Installed deflector (after fitting 90°) | Flat surface (90°) | — | Right-click |
| A 50 g disc on the carrier | 50 g | A balancing mass… | — |
| Custom weight | Custom weight | — | — |

**Hover and the card never act.**

* In free mode, with 50 g on the carrier, the right-clicks below left the cover "Closed" and the load at "50" in both languages. One right-click was made on **every** mounted part: 22 in each language (the 50 g tray disc is off the tray while it is on the carrier).
* A left click on the nozzle opened its card and changed nothing on the rig.
* A left click on the cover still unscrewed it, as before.

**Placement.** For each of those right-clicks:

* the card's anchor id matched the part the ray hit;
* the card sat entirely inside the viewport;
* it did not cover the anchor;
* it sat 14–22 px from the part.

Cards measured 340 px wide by 141–259 px high.

**Mismatched tray parts.** On the receding tray rows, a ray aimed at one disc's or deflector's projected centre is 5 px from its neighbour's and hits that nearer neighbour. The card then correctly names the part that was hit. This is the tray's existing hit geometry at that distance; F17 did not change it.

**Focus.**

* Tabbing onto "Open tank cover" (a real key press) showed the compact card at the cover: `role="tooltip"`, name and function.
* Tabbing on to "Reset simulator" removed it.
* Escape closed a clicked card.

**Arabic.** The flowmeter card read «مقياس التدفق (المقياس الحجمي)», with the formula shown intact as `Q = ΔV / Δt`.

**Carrier disc versus carrier.** A right-click on the 50 g disc on the carrier opened the disc's card ("On the weight carrier. Drag the top one off…"). An earlier build opened the carrier's, because the carrier's box was nearer; the disc-first rule fixed it.

## 4. Tests

* **New:** `tests/unit/f17-component-info.spec.ts` (16):
  * **AC1:** every reviewed part exists, with a name, function, use and hint in both languages for every deflector and weight; the new proxies; the cover now labelled.
  * **AC2:**
    * derived figures (bore, spring rate, deflector factors, weight names);
    * the scene, card and tooltip all import `describeComponent`, and the inline labels are gone;
    * anchor ids are unique and of the stated form;
    * Arabic formulas are isolated.
  * **AC3:** the hover path calls no handler; operational clicks are unchanged; the card opens on right-click; an informational part never takes a click meant for a control behind it; opening a card is not a runtime command (App still has exactly 5 `runtime.dispatch`).
  * **AC4:** `placeCard` keeps the card beside the anchor and inside the viewport, prefers the inline-end side and flips when there is no room; the frame loop publishes the anchor; the card is a dialog with close and Escape; focus is gated on `:focus-visible`; the panel controls carry `data-component`.
* **Updated:**
  * `domain-boundary.spec.ts`: `componentInfo.ts` added to the domain module list.
  * `tests/e2e/weight-hotspots.e2e.ts`:
    * the tooltip's name is read from `.cursor-tooltip-title`, because the tooltip now has three lines;
    * a nozzle click must still leave the rig unchanged, and now also opens the nozzle's card.
* **Whole unit suite:** unchanged apart from these. `tsc`: only the existing TS2345 in `DeviceModel.tsx`.

## 5. Not verified here — run before merging

* **CI:** `npm run test:ci`, including the updated Playwright hover test. There is no Playwright here.
* **Touch:** a long press fires `contextmenu` in Chrome on Android. iOS Safari does not fire it, so on iOS the card opens only for informational parts, via a tap.
* **Keyboard reach:** the compact card appears only for parts that have a panel control. The spring, pointer, carrier and flowmeter have none, so they are reachable by pointer only.
* **Flowmeter:** this is identification only. The measurement itself is F18, which is blocked by DEC02 and BLK-04.
* **Existing, unchanged:** moving the pointer from a part straight onto a DOM panel can leave the cursor label up until the pointer returns to the canvas, because the overlay sits above the canvas's event source. Moving within the canvas clears it.
