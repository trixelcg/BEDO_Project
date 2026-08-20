# 03 — Bug Report

**How these were found.** Every bug below was either (a) reproduced by driving the running application in
Chrome, (b) computed from the GLB binary and the source, or (c) read directly out of the code with the exact
line cited. Where a number is stated (offsets, widths, forces) it was calculated from the actual node
transforms and accessor bounds in `Bedo_baked_v2.glb`, not estimated.

**Legend.** Severity `Blocker` > `Critical` > `High` > `Medium` > `Low`.
Difficulty `Trivial` (<1 h) · `Easy` (½ d) · `Moderate` (1–3 d) · `Hard` (1–2 w).
Priority `P0`–`P3`.

---

## Index

| ID | Title | Class | Severity | Prio |
|---|---|---|---|---|
| BUG‑01 | ~15 s black screen on load with **zero** loading UI | Loading | **Blocker** | P0 |
| BUG‑02 | Loaded weights render **≈2.2 m away** from the weight pan | Simulation / 3D | **Blocker** | P0 |
| BUG‑03 | The water jet is drawn **≈18× too wide** — it fills the whole tank | Rendering / Sim | **Blocker** | P0 |
| BUG‑04 | Guided gating not applied to clicks → **two‑click dead end** | Interaction | Critical | P0 |
| BUG‑05 | Any deflector is selectable in 3D, breaking experiment↔physics consistency | Simulation | Critical | P0 |
| BUG‑06 | **Free mode records nothing** — no readings, no balance indicator | Simulation | Critical | P0 |
| BUG‑07 | `--glass-bg` is undefined → settings panel and toggle are transparent | UI/CSS | High | P1 |
| BUG‑08 | `.sidebar-header` has no CSS rule → the whole panel header is broken | UI/CSS | High | P1 |
| BUG‑09 | `.rtl` is a no‑op → Arabic renders as LTR with mis‑placed punctuation | i18n | High | P1 |
| BUG‑10 | Balance indicator is clipped out of the sidebar and unreadable | UI | High | P1 |
| BUG‑11 | `--accent-blue` is orange → F_th and F_ac curves are indistinguishable | UI/Chart | High | P1 |
| BUG‑12 | App is unusable below ~800 px — all step content disappears | Responsive | High | P1 |
| BUG‑13 | Step‑11 observation notice renders **under** the monitor overlay | UX | High | P1 |
| BUG‑14 | Results table shows a **fabricated row 4** the student never measured | Data | High | P1 |
| BUG‑15 | Chart plots a **phantom F_ac = 0 point**; line and dots use different datasets | Data | High | P1 |
| BUG‑16 | "Total Weight" sums two independent readings — physically meaningless | Data | Medium | P1 |
| BUG‑17 | Cover‑material leak: a new `MeshPhysicalMaterial` per settings‑slider tick | Memory | High | P1 |
| BUG‑18 | `document.body.style.cursor` can stick on `pointer` forever | Interaction | Medium | P2 |
| BUG‑19 | Hidden tray weights remain clickable (invisible click targets) | Interaction | Medium | P2 |
| BUG‑20 | Screws detach and float above the cover plate | Animation | Medium | P2 |
| BUG‑21 | Increasing flow (step 8) produces no visible change in the jet | Simulation | High | P1 |
| BUG‑22 | Step 2 says "Drag … onto the rod" but there is no drag‑and‑drop | UX/Copy | Medium | P1 |
| BUG‑23 | "Capture Camera" is a no‑op that claims success | UX | Medium | P2 |
| BUG‑24 | `/config.json` 404s on every load and logs a confusing message twice | Loading | Low | P3 |
| BUG‑25 | Video has no `Range` support → 28 MB, no seeking, autoplays with sound | Media | High | P1 |
| BUG‑26 | Informational notices carry a red "danger" glow | UI | Low | P3 |
| BUG‑27 | `MESH.nozzle` points at the tank base flange, not the nozzle | 3D data | Medium | P2 |
| BUG‑28 | `MESH.liquid` (`LIQUID001`) is a degenerate 0‑width sliver, unrelated to the tank | 3D data | Low | P3 |
| BUG‑29 | Volumetric tank / litre scale is decorative — no volumetric measurement | Simulation | Medium | P2 |
| BUG‑30 | No audio anywhere | Audio | High | P1 |
| BUG‑31 | Deep‑z artefacts inside the water column (sorting / `depthWrite:false`) | Rendering | Medium | P2 |
| BUG‑32 | Two competing "advance" affordances at step 10 | UX | Low | P3 |
| BUG‑33 | No WebGL context‑loss handling; no error boundary | Robustness | High | P1 |
| BUG‑34 | `Weight_Custom` mesh is reused for 10 g, 20 g **and** the custom weight | 3D data | Low | P3 |
| BUG‑35 | Custom weight button appended out of order in the grid | UI | Low | P3 |
| BUG‑36 | `THREE.Clock` deprecation warning on every load | Maintenance | Low | P3 |
| BUG‑37 | Step‑1 `advance` can be skipped, stranding guided progress | Interaction | Medium | P2 |

---

## BUG‑01 — ~15 second black screen on load, with zero loading feedback

**Severity:** Blocker **Class:** Loading **Difficulty:** Moderate **Priority:** P0

**Description.** From navigation to a visible 3D scene took **≈15–20 s** on a fast local dev server on an
Apple‑silicon Mac with the model served from `localhost`. During that window the viewport is **entirely black** —
no spinner, no progress bar, no percentage, no message. Measured resource timing shows
`Bedo_baked_v2.glb` (26 542 KB) fully downloaded in **386 ms**, starting at 471 ms. Everything after that is
main‑thread work.

Two screenshots, ten seconds apart, taken at the same page load:
- t ≈ 10 s — sidebar painted, canvas 100 % black.
- t ≈ 20 s — scene visible.

**Root cause.** Three compounding causes:
1. **42 embedded PNG/JPEG images are decoded on the main thread** by `GLTFLoader`, including five 4096×4096
   PNGs and one 4800×2950 PNG (`01_PROJECT_OVERVIEW.md §4`). No `KHR_texture_basisu`, no
   `createImageBitmap` worker path.
2. **≈764 MB of texture is uploaded to the GPU** in one burst.
3. `<Suspense fallback={<ModelLoadingPlaceholder/>}>` (`Scene3D.tsx:224`) renders a wireframe cube — but the
   cube is *inside* the canvas and is never seen because the main thread is saturated before it can paint, and
   because there is no DOM‑level loading layer at all. `<LabEnvironment>` has `fallback={null}`.

**Affected files.** `public/Bedo_baked_v2.glb`, `src/components/Scene3D.tsx:54‑59, 195, 224‑249`,
`src/components/DeviceModel.tsx:90‑103, 1196‑1197`.

**Recommended solution.**
1. Compress the model: KTX2/Basis for every texture, Draco or meshopt for geometry, and **drop the five
   4096² room‑bake sheets to 1024²** (see `PERF‑01`). This alone should take the GLB from 26 MB to ~3–5 MB and
   VRAM from 764 MB to <150 MB.
2. Add a **DOM** loading screen driven by `useProgress()` from drei — branded, bilingual, with a real
   percentage and the asset name, sitting above the canvas until `active === false`.
3. Load the environment map and the water plumes *after* first interactive paint.
4. Consider a two‑stage load: a ~500 KB low‑poly apparatus for immediate interactivity, then hot‑swap the
   detailed model.

---

## BUG‑02 — Loaded weights render ≈2.2 m away from the weight pan

**Severity:** Blocker **Class:** Simulation / 3D **Difficulty:** Moderate **Priority:** P0

**Description.** Adding weights updates the sidebar total, hides the disc on the tray, and moves the physics —
but **no weight ever appears on the pan**. Confirmed visually from four camera angles (side, top‑down, zoomed,
overview) at 80 g and at 250 g.

**Root cause — computed exactly.** `DeviceModel.tsx:790‑794`:

```ts
offset: [ pan[0] - proto.position.x,
          pan[1] + cum + h / 2 - centre.y,
          pan[2] - proto.position.z ],
```

X and Z subtract the node's **translation** (`proto.position`); Y subtracts the clone's **measured bounding‑box
centre**. These are different spaces, and neither X nor Z accounts for the fact that this GLB is *baked* — the
node translation is `(0, 1.239, −1.232)` for every tray object while the geometry lives far away in vertex
coordinates.

For `Weight_50`, read from the binary:
- node translation `T = (0.000, 1.239, −1.232)`
- world bbox centre `= (0.139, 1.063, −0.021)` ⇒ vertex‑space centre `= (0.139, −0.176, 1.211)`
- pan anchor (rod crown) `= (0.010, 1.490, −0.229)`

Final rendered position `= offset + T + vertexCentre`:

| Axis | Computed | Should be | Error (model units) | Error (world, ×1.8) |
|---|---|---|---|---|
| X | `0.010 + 0.139 = 0.149` | `0.010` | **+0.139** | **+0.25 m** |
| Y | `0.431 + 1.063 = 1.494` | `1.490` | +0.004 ✅ | +0.007 m |
| Z | `1.003 − 0.021 = 0.982` | `−0.229` | **+1.211** | **+2.18 m** |

So every disc is placed **2.2 m behind the bench**, inside the lab wall. Y is correct, which is why the error
was never spotted from the default camera — the weights are simply off‑screen.

**Affected files.** `src/components/DeviceModel.tsx:756‑798, 1116‑1122`.

**Git context.** Three commits in a row attacked this: *"…fix added weights alignment by restoring original
clone transform mappings…"*, *"…hide loaded table weights…"*, *"Fix added weights hole alignment by using proto
translation coordinates…"*. The last one is what introduced the axis inconsistency.

**Recommended solution.** Stop compensating for baked transforms at runtime. Either
(a) re‑export the GLB with each weight's origin at its own centre (correct fix, done once in Blender), or
(b) compute the offset consistently in one space: measure the clone's world bbox centre `C`, then set
`offset = panWorld − C` for **all three axes**, and let the clone keep its own transform. Add a Playwright
assertion that the rendered stack's world position is within 5 mm of the pan anchor.

---

## BUG‑03 — The water jet is drawn ≈18× too wide

**Severity:** Blocker **Class:** Rendering / Simulation **Difficulty:** Easy **Priority:** P0

**Description.** When flow starts, the "jet" is a frosted white‑blue **cylinder filling essentially the entire
tank cross‑section**, from the tank floor to the deflector. It reads as a plastic water bottle. It completely
occludes the deflector, the rod and the impact point — which is the one thing steps 6–9 ask the student to
observe ("*Notice the shape of water impinging the deflector*").

**Root cause.** `DeviceModel.tsx:1055`:
```ts
const scaleXZ = ((tankBounds.width * 0.95) / fit.width) * flowIntensity;
```
`tankBounds.width` is the **tank's** width. From the GLB, `JET Force 2_205` measures `0.181 × 0.317 × 0.179`.
So the jet is authored to be 95 % of the tank's diameter — **0.172 model units ≈ 0.31 m in world space**.

The apparatus's real nozzle is a **10 mm bore** — the app's own physics constant says so:
`NOZZLE_AREA_M2 = 0.0000785` (`physics.ts:11`), i.e. Ø 10 mm. **0.181 m / 0.010 m ≈ 18×.**

**Affected files.** `src/components/DeviceModel.tsx:1042, 1055`, `src/lib/apparatus.ts:36‑41`.

**Recommended solution.** Scale the jet from the physical nozzle diameter, not the tank:
`jetDiameter = 2·√(NOZZLE_AREA_M2/π)` ≈ 10 mm at the nozzle, widening by a modest spread factor toward the
impact point. Re‑author the plume meshes so their base matches the bore. Drive *visible* variation from flow
rate — diameter, length, opacity, ripple speed and impact spray should all read differently between
`n = 0.4` and `n = 0.5` (see `BUG‑21`).

---

## BUG‑04 — Guided gating is not applied to clicks → two‑click dead end

**Severity:** Critical **Class:** Interaction **Difficulty:** Easy **Priority:** P0

**Description.** In Guided mode the app highlights only the part the current step asks for, and shows a pointer
cursor only over that part. But **clicking any other part still fires its action.**

**Reproduction (verified in browser).**
1. Step 1 → click the cover → it unscrews, step advances to 2.
2. Step 2 asks for a deflector. Click the (un‑highlighted, default‑cursor) **cover plate**.
3. The cover closes. `advance(prev, 3, 4)` does not fire because `currentStep === 2`.
4. The student is at step 2 with the tank shut. Selecting a deflector now raises **"Remove the tank cover
   first."** The tank cover is not a highlighted target at step 2, so nothing tells them to re‑open it.
5. Only `Reset simulator` escapes.

**Root cause.** `DeviceModel.tsx:1172‑1186` — `onPointerOver` checks `liveKeys.has(h.key)`; `onClick` does not.

**Affected files.** `src/components/DeviceModel.tsx:1167‑1191`, `src/App.tsx:195‑211`.

**Recommended solution.** Apply the same predicate in `onClick`. When a non‑live part is clicked in Guided
mode, raise a coaching notice ("That's not this step — finish *Install the deflector* first") rather than
ignoring silently. Also make step transitions idempotent so a cover toggle at any step reconciles rather than
strands.

---

## BUG‑05 — Any deflector is selectable in 3D, breaking experiment↔physics consistency

**Severity:** Critical **Class:** Simulation **Difficulty:** Easy **Priority:** P0

**Description.** During step 2 **all seven** tray deflectors glow and are clickable, regardless of which
experiment is loaded. Clicking one outside the current experiment silently changes `selectedDeflectorId` and
therefore the momentum factor `k`, while every label still claims the original experiment.

**Reproduction (verified in browser).** Load Exp. 1 (Flat, 90°, `k = 1.0`). At step 2 click the semi‑circular
tray item. The step text changes to *"Drag the Semi‑circular (180°) onto the rod"*, `k` silently becomes
**2.0**, and the sidebar's "Select deflector" list — which offers only *Flat surface (90°)* — now shows **nothing
selected**. The Software Data Monitor still prints "Exp. 1 — Flat surface deflector · F = ρAV²" over a table
computed with `k = 2.0`. **Every number in the results is wrong by a factor of two, with no indication.**

**Root cause.** `DeviceModel.tsx:683` — `if (s === 2) return new Set(trayDeflectors)` uses **all** of
`DEFLECTORS`, not `deflectorsFor(state.experimentId)`. `App.handleSelectDeflector` (`:214‑219`) applies no
membership check either. `UIOverlay` *does* filter correctly (`availableDeflectors`), so the two surfaces
disagree.

**Affected files.** `src/components/DeviceModel.tsx:664‑689`, `src/App.tsx:214‑219`,
`src/lib/experiments.ts:298`.

**Recommended solution.** Make `handleSelectDeflector` reject ids not in `deflectorsFor(experimentId)` (or
offer to switch experiment), and restrict `liveKeys` for step 2 to that same set. Non‑member tray items should
be visibly inert.

---

## BUG‑06 — Free mode records nothing

**Severity:** Critical **Class:** Simulation **Difficulty:** Moderate **Priority:** P0

**Description.** Free mode is advertised as *"interact with any part of the rig, in any order."* In practice a
student in Free mode can never take a reading: the results table stays at 0 g for every row, the balance
indicator never appears, and `F_ac` is never recorded.

**Root cause — two independent defects.**

1. **The row bookkeeping is keyed on the guided step number.** `App.tsx:73` defines
   `BALANCE_ROW = { 7: 1, 9: 2 }`, and `:148` reads `BALANCE_ROW[prev.currentStep]`. In Free mode `advance()`
   returns `{}` (`:189‑192`), so `currentStep` is **permanently 1** — `activeRow` is always `undefined` and the
   student's `loadedWeights` are never written into any row.
2. **The table ignores the valve the student actually set.** `:150` maps over `ROW_VALVE_SETTINGS`
   (`[0.0, 0.4, 0.5, 0.6]`) and passes those fixed values to `computeRow`. `state.valveOpening` is not even in
   the effect's dependency list (`:163‑169`). Whatever the student dials, the table reports the same four
   hard‑coded settings.

`UIOverlay` compounds it: `balanceRow = currentStep === 7 ? 1 : currentStep === 9 ? 2 : null` (`:98`) is
`null` in Free mode, so the "Pointer balanced!" card never renders.

**Affected files.** `src/App.tsx:73, 146‑169, 189‑192`, `src/components/UIOverlay.tsx:98‑100, 531‑548`.

**Recommended solution.** Decouple recording from step number. Give Free mode an explicit **"Record reading"**
action that appends `computeRow(currentValve, deflectorId, loadedWeights, qTotal)` to a growing array. Let the
table have as many rows as the student took, and derive `balanced` from live values in both modes.

---

## BUG‑07 — `--glass-bg` is never defined

**Severity:** High **Class:** UI/CSS **Difficulty:** Trivial **Priority:** P1

**Description.** The floating "Scene Settings" button and the settings sidebar have effectively **no
background** — 3D geometry shows through the panel and the text is hard to read (screenshotted).

**Root cause.** `index.css` defines `--glass-gradient`, `--glass-border`, `--glass-shadow` at `:root:32‑35`,
but `--glass-bg` is **never declared**, yet is used at `:557` and `:583`. An undefined custom property with no
fallback resolves to the unset initial value.

**Affected files.** `src/index.css:32‑36, 546‑591`.

**Recommended solution.** Declare it, or use `var(--panel-bg)`. More broadly, adopt a single token file and a
lint rule (`stylelint custom-property-no-missing-var-function` / a design‑token check) so this cannot recur.

---

## BUG‑08 — `.sidebar-header` has no CSS rule

**Severity:** High **Class:** UI/CSS **Difficulty:** Trivial **Priority:** P1

**Description.** The panel header is visually broken in every screenshot: the icon container stretches the full
380 px as an empty pill, the title and subtitle stack awkwardly beneath it, and the **"Video" and
"English/العربية" buttons float loose, overlapping the Free/Guided row**.

**Root cause.** `UIOverlay.tsx:142` renders `<div className="sidebar-header">`, but `index.css` contains no
`.sidebar-header` rule — only `.header-area` (`:118‑125`), which is never used by any component. The header
therefore has no `display:flex`, no `align-items`, no `gap`. `.logo-container` (`:127‑136`) is `display:flex`
with no width, so it fills the block. `.lang-btn` carries `margin-left: auto` (`:163`) which does nothing
outside a flex row.

**Affected files.** `src/components/UIOverlay.tsx:142‑174`, `src/index.css:117‑170`.

**Recommended solution.** Rename one to match the other and reconcile the layout. Add a CI check for
`className`s with no matching rule (or move to CSS Modules, where the mismatch becomes a compile error).

---

## BUG‑09 — RTL is a no‑op; Arabic renders as LTR with mis‑placed punctuation

**Severity:** High **Class:** i18n **Difficulty:** Moderate **Priority:** P1

**Description.** Switching to Arabic translates the strings but **does not mirror the interface**. Verified in
browser:
- The sidebar stays on the **left**; the layout is unchanged.
- `"لقد انتهيت!"` renders with the exclamation mark on the **left** (`!لقد انتهيت`).
- `"غطاء الخزان:"` renders with the colon on the left.
- Mixed LTR technical strings — `"Save Screen"`, `"Export Data"` — sit inside RTL sentences with reversed quote
  placement.
- `"الخطوة 12 / 12"` reads incorrectly.
- The **entire Scene Settings panel stays in English** (`ARCH‑13`).

**Root cause.** Components add a `rtl` class (`UIOverlay.tsx:119`, `SoftwareMonitor.tsx:128`), but the only
`.rtl` rule in the entire stylesheet is `.warning-popup.rtl { direction: rtl }` (`index.css:327‑329`).
`.ui-container.rtl` and `.monitor-fullscreen.rtl` have **no declarations at all**. Additionally
`index.html:2` hard‑codes `<html lang="en">` and never sets `dir`, so the browser's bidi algorithm treats every
Arabic string as an isolated run inside an LTR paragraph — which is exactly why neutral characters (`!`, `:`,
`/`, quotes) land on the wrong side.

**Affected files.** `index.html:2`, `src/index.css:327‑343`, `src/components/UIOverlay.tsx:119`,
`src/components/SoftwareMonitor.tsx:128`, `src/components/MenuSettings.tsx` (untranslated).

**Recommended solution.** Set `document.documentElement.lang` and `dir` from the language state. Replace every
directional CSS property with logical properties (`margin-inline-start`, `padding-inline`, `inset-inline-end`,
`text-align: start`) so one stylesheet serves both directions. Wrap embedded LTR terms in
`<bdi>`/`<span dir="ltr">`. Translate `MenuSettings`, or remove it from production (`ARCH‑13`).

---

## BUG‑10 — The balance indicator is clipped out of the sidebar

**Severity:** High **Class:** UI **Difficulty:** Easy **Priority:** P1

**Description.** At steps 7 and 9 — the two steps whose *entire purpose* is balancing the pointer — the
"Unbalanced (target ≈ 80 g)" / "Pointer balanced!" card is **cut in half by the sidebar's footer** and, once
weights are added and the layout grows, disappears entirely. Screenshotted at 1440×757, a perfectly ordinary
desktop size.

**Root cause.** Nested scroll containers with a fixed footer competing for height:
`.sidebar-panel { max-height: calc(100vh - 48px); overflow-y: auto }` (`index.css:88‑101`) contains
`.menu-content-wrapper { flex: 1; overflow-y: auto }` (inline, `UIOverlay.tsx:232`) **and** a non‑shrinking
footer block (`:567‑615`). The inner scroller is never given a definite height, so the flex algorithm lets the
content overflow behind the footer instead of scrolling.

**Affected files.** `src/index.css:88‑101`, `src/components/UIOverlay.tsx:232, 531‑615`.

**Recommended solution.** One scroll container, `min-height: 0` on the flex child, footer outside it with
`flex-shrink: 0`. Independently: the balance feedback belongs **in the 3D scene next to the pointer**, not
buried in a scrolled panel.

---

## BUG‑11 — `--accent-blue` is orange, so the two chart curves are identical

**Severity:** High **Class:** UI / Data viz **Difficulty:** Trivial **Priority:** P1

**Description.** In the Software Data Monitor the theoretical curve (`stroke="var(--accent-blue)"`) and the
actual curve (`stroke="var(--accent-gold)"`) render in **the same orange**. The legend swatches are also
identical. It is impossible to tell F_th from F_ac — the central deliverable of the experiment.

**Root cause.** A rebrand redefined the token without renaming it: `index.css:25‑28`
```css
--accent-blue: #f58220;   /* orange   */
--accent-gold: #ff9100;   /* orange   */
```
Both are orange, 15° apart in hue. Meanwhile ~30 rules across the stylesheet still hard‑code the *old* cyan
(`rgba(0, 229, 255, …)`) for hovers, glows and borders, so the UI mixes two unrelated palettes.

**Affected files.** `src/index.css:21‑36` and ~30 `rgba(0,229,255,…)` occurrences;
`src/components/SoftwareMonitor.tsx:325‑375`.

**Recommended solution.** Rebuild the palette on semantic tokens (`--series-theoretical`,
`--series-measured`, `--state-ok`, `--state-warn`) validated for contrast **and** for colour‑blind
distinguishability. Never encode a series by colour alone — the theoretical series should also stay dashed and
both should carry direct labels. Purge every hard‑coded `rgba(0,229,255,…)`.

---

## BUG‑12 — Unusable below ~800 px; the 800 px breakpoint is itself broken

**Severity:** High **Class:** Responsive **Difficulty:** Moderate **Priority:** P1

**Description.** Tested at three widths:
- **1440 px** — usable, though the sidebar covers the apparatus and the camera never compensates.
- **820 px** — the fixed 380 px sidebar takes ~46 % of the viewport; the `@media (max-width: 800px)` rule does
  not fire; the notice popup overlaps the Scene Settings button.
- **500 px** — the sidebar becomes `max-height: 50vh` and **the entire scrollable middle section vanishes**.
  Header, tabs and footer remain; the step card, the OK button, the weight buttons, the valve slider and the
  Data Monitor button are all gone. The lesson is unreachable.

**Root cause.** `index.css:526‑543` — a single breakpoint that caps the panel's height without giving the inner
scroller a scrollable box (same defect as `BUG‑10`). There is no tablet layout, no portrait layout, no touch
affordance, no camera adaptation to aspect ratio, and `<Canvas camera={{ fov: 42 }}>` is fixed regardless of
viewport shape.

**Affected files.** `src/index.css:69‑101, 526‑543`, `src/components/Scene3D.tsx:190`.

**Recommended solution.** Decide the supported device matrix explicitly (vocational labs are frequently
tablets). Then: fluid sidebar (`clamp()`), a bottom‑sheet layout in portrait, `min-height: 0` on the scroller,
a vertical‑FOV adjustment for portrait aspect, and larger touch targets (see `06_UX_REPORT.md`).

---

## BUG‑13 — The step‑11 observation notice renders under the monitor overlay

**Severity:** High **Class:** UX **Difficulty:** Easy **Priority:** P1

**Description.** Step 11's notice — *"Notice the table readings and the graph… you can use Save Screen and
Export Data"* — is the single most important instruction in the results phase. It is raised by
`handleCalculate`, which is **only reachable from inside the Software Data Monitor**. The monitor covers it.
Verified: the notice only became visible after closing the monitor, by which point it is useless.

**Root cause.** `.warning-popup { z-index: 100 }` (`index.css:310`) and
`.monitor-fullscreen { z-index: 100 }` (`:406`) tie; the monitor is later in DOM order and wins. Structurally,
`UIOverlay` and `SoftwareMonitor` are siblings under `App` with no shared layering system.

**Affected files.** `src/index.css:304‑325, 398‑411`, `src/App.tsx:417‑449`.

**Recommended solution.** A single z‑index scale in tokens (`--z-scene: 1, --z-hud: 10, --z-modal: 100,
--z-toast: 1000`). Notices should render into a portal at the top of the stack, and step‑11's guidance should
appear **inside** the monitor, anchored to the table it refers to.

---

## BUG‑14 — The results table shows a fabricated fourth row

**Severity:** High **Class:** Data integrity **Difficulty:** Easy **Priority:** P1

**Description.** The monitor's table has four rows. The student takes **two** readings. Rows 1 and 4 are
manufactured:

| Row | Q (L/min) | V₀ | V | Mass (g) | F_th (N) | Reality |
|---|---|---|---|---|---|---|
| 1 | 0.000 | 0.000 | 0.000 | 0 | 0.0000 | valve closed — never a reading |
| 2 | 15.714 | 3.336 | 3.232 | 80 | 0.8199 | ✅ the student's reading 1 |
| 3 | 27.024 | 5.738 | 5.677 | 250 | 2.5303 | ✅ the student's reading 2 |
| 4 | **43.457** | **9.227** | **9.189** | 0 | **6.6287** | ❌ **never measured** |

Row 4's F_th of 6.63 N is 2.6× the largest real reading, so it sets the chart's Y axis to 8 N and squeezes both
real readings into the bottom‑left corner (screenshotted). A student exporting this CSV would submit fabricated
data.

**Root cause.** `App.tsx:150‑159` unconditionally maps over `ROW_VALVE_SETTINGS = [0.0, 0.4, 0.5, 0.6]` and
calls `computeRow` for **all four**, so every row always carries fully computed hydraulics whether or not it was
measured. There is no "taken / not taken" flag on `RecordRow`.

**Affected files.** `src/App.tsx:146‑169`, `src/lib/physics.ts:44‑46, 100‑129`,
`src/components/SoftwareMonitor.tsx:199‑220`, `src/types/index.ts:18‑34`.

**Recommended solution.** Add `taken: boolean` (or make `recordedRows` an append‑only list of actual readings).
Render only taken rows. Keep `ROW_VALVE_SETTINGS` as *setpoints for the guided script*, not as table rows.

---

## BUG‑15 — Phantom F_ac point; line and dots are drawn from different datasets

**Severity:** High **Class:** Data integrity **Difficulty:** Easy **Priority:** P1

**Description.** After pressing Calculate, the chart shows a gold F_ac dot **on the x‑axis at Q ≈ 43.5 L/min
with F_ac = 0** (screenshotted). It is not on the F_ac line, and it corresponds to the fabricated row 4. The
table likewise prints `F_ac = 0.0000` for rows 1 and 4.

**Root cause.** Two different filters are used for the same series in the same SVG:
```ts
// SoftwareMonitor.tsx:30-33  — used for the DOTS
const rows = recordedRows.filter((r, i) => i > 0 && (r.actualWeightMass > 0 || r.valveOpen > 0));
// SoftwareMonitor.tsx:71     — used for the LINE
const measured = recordedRows.filter((r, i) => i === 0 || r.actualWeightMass > 0);
```
`rows` admits any row with `valveOpen > 0` — which includes the untouched row 4 — while `measured` requires
`actualWeightMass > 0`. Hence a dot with no line.

**Affected files.** `src/components/SoftwareMonitor.tsx:29‑33, 69‑71, 332‑359`.

**Recommended solution.** Derive both from one `takenRows` array (see `BUG‑14`). Never let a chart series have
two definitions.

---

## BUG‑16 — "Total Weight" sums two independent readings

**Severity:** Medium **Class:** Data integrity **Difficulty:** Trivial **Priority:** P1

**Description.** The monitor prints **`330 g × g = 3.237 N`** — the sum of reading 1 (80 g) and reading 2
(250 g). No physical quantity in this experiment equals 330 g. On BEDO's own board "Total Weight" is the mass on
the pan **for the current reading**.

**Root cause.** `SoftwareMonitor.tsx:35‑36` reduces over all rows.

**Affected files.** `src/components/SoftwareMonitor.tsx:35‑36, 173‑182`.

**Recommended solution.** Show it per row (it is already the `Mass (g)` column), or scope it to the reading
currently in focus.

---

## BUG‑17 — Cover‑material leak on every settings‑slider tick

**Severity:** High **Class:** Memory **Difficulty:** Easy **Priority:** P1

**Description.** Each drag increment of the Glass Roughness / Glass IOR / Glass Specular / Environment
Reflections slider constructs a **new `MeshPhysicalMaterial`** — and therefore a new compiled shader program —
and discards the previous one without disposing it.

**Root cause.** `DeviceModel.tsx:174‑207`. The effect's dependency array is
`[scene, reflection, glassSpecular, glassRoughness, glassIor]`, and its body does
`child.material = new THREE.MeshPhysicalMaterial({...})` with no cleanup. `MeshPhysicalMaterial` with
`transmission` is one of three.js's most expensive shader permutations.

A `step={0.01}` roughness slider dragged across its range produces **100 orphaned materials and up to 100
orphaned GPU programs** in a few seconds.

**Affected files.** `src/components/DeviceModel.tsx:174‑207`; also `waterMaterial` (`:285‑386`) and `waterTex`
(`:228‑283`) are never disposed on unmount.

**Recommended solution.** Create the material **once** and mutate its properties in a separate effect
(`mat.roughness = …; mat.ior = …`) — no `needsUpdate` required for these. Dispose everything the component
created in the effect cleanup. Add a dev‑only `renderer.info` HUD so leaks are visible during development.

---

## BUG‑18 — `document.body.style.cursor` can stick on `pointer`

**Severity:** Medium **Class:** Interaction **Difficulty:** Trivial **Priority:** P2

**Description.** Hover handlers write the cursor onto `document.body` globally
(`DeviceModel.tsx:1175, 1180`). If a `pointerout` is missed — the mesh is hidden, the component re‑renders and
swaps the element, the Software Monitor opens over the canvas, or the pointer leaves the window — the cursor
stays `pointer` over the entire document, including over the sidebar and the results table.

**Root cause.** Global mutation with no cleanup effect; `showMonitor` empties `liveKeys` but never resets the
cursor.

**Affected files.** `src/components/DeviceModel.tsx:1172‑1182`.

**Recommended solution.** Derive the cursor from `hoveredKey` in a `useEffect` with a cleanup that restores it,
and scope it to the canvas element rather than `document.body`.

---

## BUG‑19 — Hidden tray weights remain clickable

**Severity:** Medium **Class:** Interaction **Difficulty:** Easy **Priority:** P2

**Description.** When a weight is loaded, its tray mesh is hidden
(`DeviceModel.tsx:1083‑1090`: `meshObj.visible = !state.loadedWeights.includes(w.grams)`). Its **hotspot sphere
is unaffected** and keeps firing, so the student can keep clicking an empty spot on the tray and keep adding
50 g discs that visibly do not exist. Conversely, once two 50 g weights are loaded, removing one would not
restore the mesh, because `.includes` is a presence test, not a count.

**Root cause.** Two parallel representations (mesh visibility vs. hotspot list) with no shared source of truth.

**Affected files.** `src/components/DeviceModel.tsx:633‑655, 1083‑1090`.

**Recommended solution.** Model the tray as inventory: each denomination has a count; the mesh and its hotspot
are both derived from `count > 0`. Rebuild the hotspot list from the same derived state.

---

## BUG‑20 — Screws detach and float above the cover plate

**Severity:** Medium **Class:** Animation **Difficulty:** Trivial **Priority:** P2

**Description.** During the unscrew sequence the screws rise **further than the plate** and hang in mid‑air,
visibly disconnected (screenshotted at step 3).

**Root cause.** `apparatus.ts:222‑223` — `COVER_LIFT = 0.286`, `SCREW_LIFT = 0.36`. From the GLB,
`Tank_cover` occupies y `1.356…1.385` and `Screws` occupies y `1.337…1.386` — they interpenetrate at rest, so
lifting them by different amounts separates them by `0.074` model units ≈ **13 cm in world space**.

**Affected files.** `src/lib/apparatus.ts:219‑223`, `src/components/DeviceModel.tsx:883‑911, 976‑981`.

**Recommended solution.** Model the sequence properly: the screws back out of their threads (a short rise plus
rotation), then the plate lifts **carrying the screws with it** — parent the screws to the cover for the lift
phase. Two independent magic constants cannot express that.

---

## BUG‑21 — Increasing the flow produces no visible change

**Severity:** High **Class:** Simulation **Difficulty:** Easy **Priority:** P1

**Description.** Step 8's entire pedagogical content is *"Increase the opening of the flow control valve"* and
*"Notice that the water jet pushes the deflector upward"*. Going from `n = 0.4` (Q = 15.7 L/min) to `n = 0.5`
(Q = 27.0 L/min) — a **72 % increase in flow, a 3× increase in force** — produced a jet that is visually
indistinguishable in side‑by‑side screenshots.

**Root cause.** `DeviceModel.tsx:1053‑1055`. The only flow‑dependent term is
```ts
const flowIntensity = 0.7 + 0.3 * Math.min(1, (state.valveOpening - 0.22) / 0.48);
```
which yields **0.81 at n = 0.4 and 0.87 at n = 0.5** — a 7 % width change on an already tank‑filling
cylinder (`BUG‑03`). The jet's **length is fixed** (nozzle→deflector, `scaleY = gap / fit.height`), and the
deflector's own rise is driven by spring deflection which is nearly cancelled by the added weights. Ripple
speed varies (`:1063`) but is invisible under the frosted shader.

**Affected files.** `src/components/DeviceModel.tsx:1018‑1075`, `src/lib/physics.ts:32‑33`.

**Recommended solution.** Map flow to a *bundle* of visible cues: jet diameter (from bore + spread), particle
density / spray at the impact point, opacity and turbulence, audible pitch, pointer deflection magnitude,
and a visible flow indicator on the rotameter. The student must be able to *see* that more water = more force.

---

## BUG‑22 — Step 2 instructs a drag‑and‑drop that does not exist

**Severity:** Medium **Class:** UX / Copy **Difficulty:** Easy **Priority:** P1

**Description.** Step 2 reads *"Drag the Flat surface (90°) onto the rod to install it"* / Arabic
*"اسحب … لتركيبه في العمود من الأسفل"*. There is **no drag interaction anywhere in the codebase** — the only
handler is `onClick`. A student following the instruction literally will conclude the app is broken.

**Root cause.** Copy transcribed from the reference simulator; the interaction was implemented as a click.

**Affected files.** `src/lib/experiments.ts:80‑86`, `src/components/DeviceModel.tsx:1183‑1186`.

**Recommended solution.** Either implement pointer‑drag installation (which is the more tactile and more
faithful option, and is worth doing) or change the copy in both languages to "Select … to install it". Do not
ship the mismatch.

---

## BUG‑23 — "Capture Camera" is a no‑op that claims success

**Severity:** Medium **Class:** UX **Difficulty:** Trivial **Priority:** P2

**Description.** `src/App.tsx:409‑411`:
```tsx
onSaveCurrentCamera={() => { alert('Camera angles captured. Save config to write permanently.'); }}
```
Nothing is captured. `SceneConfig` has no camera fields. The user is told an action succeeded when it did not.

**Affected files.** `src/App.tsx:409‑411`, `src/components/MenuSettings.tsx:104‑124`.

**Recommended solution.** Remove the button (with the rest of the panel — `ARCH‑13`), or implement it.
Separately: three `alert()` calls remain in the codebase (`App.tsx:129, 131, 134, 410`) — blocking, unstyled,
and untranslated.

---

## BUG‑24 — `/config.json` 404s on every load, logged twice

**Severity:** Low **Class:** Loading **Difficulty:** Trivial **Priority:** P3

**Description.** Every page load fires `GET /config.json`, gets a 404, and logs
`"Using default client-side scene configuration."` — **twice**, because `StrictMode` double‑invokes the effect
in development. Confirmed in the console.

**Root cause.** `src/App.tsx:96‑108`. The file only exists if someone has pressed "Save Config", and on Cloud
Run the container filesystem is ephemeral, so it typically does not exist there either.

**Affected files.** `src/App.tsx:96‑108`, `api/save-config.ts:180‑191`.

**Recommended solution.** Bake the config into the bundle (`ARCH‑13`); delete the fetch. If a remote override
is genuinely wanted, ship a default `config.json` so the 404 path never runs.

---

## BUG‑25 — The 28 MB video cannot seek and autoplays

**Severity:** High **Class:** Media **Difficulty:** Easy **Priority:** P1

**Description.** `UIOverlay.tsx:647‑652` renders `<video src="/Bedo_Mesu_J.mp4" controls autoPlay>`.
`Bedo_Mesu_J.mp4` is **28 MB**. `server.ts` never handles `Range` requests (`ARCH‑11`), so:
- the player cannot seek — dragging the scrubber restarts the download;
- the full 28 MB is fetched every time the modal opens;
- on a metered or school connection this is a significant, unannounced cost;
- `autoPlay` with audio will be blocked by Chrome's autoplay policy in most contexts, producing a silent,
  seemingly frozen player.

There is also no `preload="none"`, no poster, no captions/subtitles track, no focus trap and no Esc handler on
the modal.

**Affected files.** `src/components/UIOverlay.tsx:618‑655`, `server.ts:106‑178`, `public/Bedo_Mesu_J.mp4`.

**Recommended solution.** Transcode to ~6 MB 720p H.264 (or HLS), serve from a CDN/GCS with `Range`, add
`preload="none"` + `poster`, drop `autoPlay`, add bilingual captions, and make the modal a proper accessible
dialog.

---

## BUG‑26 — Informational notices carry a red danger glow

**Severity:** Low **Class:** UI **Difficulty:** Trivial **Priority:** P3

**Description.** The blue "observation" popups render with a **red halo** (clearly visible in screenshots) —
the notice reuses `.warning-popup` and overrides `background` and `borderColor` inline, but not
`box-shadow: 0 10px 30px rgba(255, 61, 113, 0.3)`.

**Root cause.** `src/components/UIOverlay.tsx:130‑139` styling by inline override of a danger class.
`src/index.css:321`.

**Recommended solution.** Two variant classes (`.toast--info`, `.toast--error`) rather than inline overrides.

---

## BUG‑27 — `MESH.nozzle` points at the tank base flange

**Severity:** Medium **Class:** 3D data **Difficulty:** Easy **Priority:** P2

**Description.** `apparatus.ts:36` maps `nozzle: 'JET Force 2_214'`. Measured from the GLB, that node's bounding
box is **0.227 × 0.048 × 0.227** — it is *wider than the tank itself* (0.181). It is the tank's base plate, not a
Ø 10 mm nozzle. The jet's origin (`nozzleLip`) is taken as this box's `max.y = 1.109`, which happens to be
roughly the right height, so the error is currently masked — but the jet's *diameter* has no correct reference
to scale from, which is part of why `BUG‑03` was possible.

**Affected files.** `src/lib/apparatus.ts:36`, `src/components/DeviceModel.tsx:610‑615`.

**Recommended solution.** Identify (or author) a real nozzle node in the GLB and add an assertion test that its
diameter matches `2·√(NOZZLE_AREA_M2/π)` within tolerance.

---

## BUG‑28 — `MESH.liquid` is a degenerate sliver

**Severity:** Low **Class:** 3D data **Difficulty:** Trivial **Priority:** P3

**Description.** `apparatus.ts:55` maps `liquid: 'LIQUID001'`, and the only use is to force it hidden
(`DeviceModel.tsx:205`). Measured: its bounding box is **0.000 × 0.017 × 0.007** at world `(−0.283, 0.570,
0.148)` — a zero‑width sliver next to the bench, nowhere near the tank. It is not the tank liquid.

**Recommended solution.** Delete the constant and the special case, or find the real sump‑water mesh. The sump
level not changing when the pump runs is a separate fidelity gap (`BUG‑29`).

---

## BUG‑29 — The volumetric tank and litre scale are decorative

**Severity:** Medium **Class:** Simulation fidelity **Difficulty:** Moderate **Priority:** P2

**Description.** Step 5 opens the "volumetric control valve", and the rig's twin litre scales are prominently
visible in the scene — but **nothing is measured volumetrically**. `isVolumetricValveOpen` is a boolean that
rotates a lever and gates nothing; the scales never move; the sump level never changes; no timing is involved.
On the real VL‑FM009 the volumetric tank is how flow rate is *measured*.

**Affected files.** `src/App.tsx:238‑241`, `src/lib/experiments.ts:103‑110`, `src/lib/physics.ts` (no volume
model).

**Recommended solution.** Decide with the client whether volumetric measurement is in scope. If yes, model tank
level vs. time with a stopwatch; if no, remove the litre scales from the framing so students are not asked to
read an instrument that does nothing.

---

## BUG‑30 — There is no audio at all

**Severity:** High **Class:** Audio **Difficulty:** Moderate **Priority:** P1

**Description.** The application produces **no sound of any kind**: no pump start/run/stop, no water jet, no
valve click, no weight clink, no UI confirmation, no error tone, no narration. Verified by inspection —
`grep` finds no `Audio`, `AudioContext`, `PositionalAudio`, `useAudio` or any audio asset in the repo. The only
sound the product can make is the walkthrough MP4 (`BUG‑25`).

**Impact.** Audio is a primary feedback channel in a procedural training simulator. Without it: the student
gets no confirmation the pump started (the only cue is a small green lamp usually outside the camera frame), no
sense of flow rate changing, and no reinforcement of the safety warnings.

**Recommended solution.** Add a small audio layer: a looping pump bed whose gain/pitch tracks `valveOpening`, a
water‑impact loop tied to jet force, mechanical one‑shots for valve/switch/weight/cover, distinct
success/error tones, and a mute control. Gate everything behind a user gesture to satisfy autoplay policy. If
narration is in the storyboard, budget for bilingual VO.

---

## BUG‑31 — Depth/sorting artefacts inside the water column

**Severity:** Medium **Class:** Rendering **Difficulty:** Moderate **Priority:** P2

**Description.** Black dashed streaks and hard bands appear **inside** the water column in every flow
screenshot — parts of the rod, pointer pin and deflector punching through the transparent jet in the wrong
order.

**Root cause.** The water material is `transparent: true`, `side: THREE.DoubleSide`, `depthWrite: false`
(`DeviceModel.tsx:308‑309`), and the plume meshes have 2–3 primitives each, so back and front faces of a
double‑sided, non‑depth‑writing surface are sorted per‑object by centroid distance — a classic ordering
failure. The tank cover material is likewise `transparent` + `transmission: 0.98` + `depthWrite: false`
(`:188‑201`), and the GLB ships **19 `alphaMode: BLEND` materials**, several of which do not need blending at
all.

**Recommended solution.** Make the jet a single closed, front‑facing, convex mesh; keep `depthWrite: true` with
`alphaTest` for the hard body and use a separate additive pass for the froth. Audit the GLB and switch every
material that does not need it back to `OPAQUE` (see `05_RENDERING_REPORT.md`).

---

## BUG‑32 — Two competing "advance" affordances at step 10

**Severity:** Low **Class:** UX **Difficulty:** Trivial **Priority:** P3

**Description.** Step 10 shows both an orange **OK** button and a green **Open Data Monitor** button. Both open
the monitor and advance to step 11 (`App.tsx:319‑322` vs `:347‑356`), by two different code paths.

**Recommended solution.** One primary action per step.

---

## BUG‑33 — No WebGL context‑loss handling and no error boundary

**Severity:** High **Class:** Robustness **Difficulty:** Easy **Priority:** P1

**Description.** With ~764 MB of texture resident (`04_PERFORMANCE_REPORT.md`), context loss on laptops with
switchable graphics and on tablets is a **likely** event, not a theoretical one. There is no
`webglcontextlost` listener, no `onError` on either `<Suspense>`, and no error boundary anywhere. Any of these
produces a permanently black screen with no message and no recovery path. See `ARCH‑15`.

---

## BUG‑34 — `Weight_Custom` is reused for three different denominations

**Severity:** Low **Class:** 3D data **Difficulty:** Trivial **Priority:** P3

**Description.** `apparatus.ts:210‑217` maps `10 g → 'Weight_Custom'` and gives `20 g` no mesh; the clone code
falls back to `'Weight_Custom'` for anything unmapped (`DeviceModel.tsx:772`). The default custom weight is
25 g. So 10 g, 20 g and 25 g all render as the same disc — measured at 0.057 × 0.017 × 0.058, the **same
thickness as the 500 g weight**. Physically nonsensical if the stack ever becomes visible (`BUG‑02`).

**Recommended solution.** Author distinct meshes, or scale thickness from mass.

---

## BUG‑35 — Custom weight button appended out of order

**Severity:** Low **Class:** UI **Difficulty:** Trivial **Priority:** P3

**Description.** The weight grid renders `+10 +20 +50 +100 / +200 +500 +25` — the custom denomination is
appended last regardless of value, breaking the ascending order and the 4‑column grid rhythm.

**Root cause.** `UIOverlay.tsx:114‑116` concatenates `params.customWeightG` after the fixed list without
sorting.

---

## BUG‑36 — `THREE.Clock` deprecation warning

**Severity:** Low **Class:** Maintenance **Difficulty:** — **Priority:** P3

**Description.** Every load logs `THREE.Clock: This module has been deprecated. Please use THREE.Timer
instead.` It originates inside R3F's own loop on three r184, not in project code, but it signals that the
three/R3F version pair will need attention. Track it; do not patch around it.

---

## BUG‑37 — Step‑1 progress can be stranded

**Severity:** Medium **Class:** Interaction **Difficulty:** Easy **Priority:** P2

**Description.** `handleHotspot`'s cover branch (`DeviceModel.tsx:716‑733`) starts a 2.2 s animation, then calls
`onCoverClick()` from inside `useFrame`. If the student clicks the cover twice quickly, or clicks it while the
animation is running, `animActiveRef` guards re‑entry but the *state* only flips once — while the visual offsets
were already driven to their open positions. Combined with `BUG‑04`, the visual state and `isCoverOpen` can
disagree.

**Recommended solution.** Drive the animation from state (`isCoverOpen` → target offsets) rather than driving
state from the animation. The visual should always be a pure function of the simulation state plus elapsed
time.

---

## Not bugs — verified correct

Recorded so Phase 2 does not "fix" working code:

- **The physics is right.** `flowRateLMin(0.5) = 27.024 L/min`, `v₀ = 5.738`, `v = 5.677`, and
  `F_th = 2.5303 N` for the flat plate — all reproduced and consistent with the reference values documented in
  `physics.ts`. The quartic flow fit, the linear `2gs` head loss and all seven momentum factors check out.
- **The `gltfName()` sanitiser is correct** and necessary — `PropertyBinding.sanitizeNodeName` really does turn
  `"JET Force 2_214"` into `"JET_Force_2_214"` and `"Flat_surface_deflector_90.001"` into
  `"Flat_surface_deflector_90001"`. Verified against all 159 node names in the binary.
- **All 7 shelf names, all 7 installed names and every `MESH` constant resolve** to real nodes in
  `Bedo_baked_v2.glb` (except the two semantic mismatches in `BUG‑27` / `BUG‑28`).
- **`THREE.MathUtils.damp` is used correctly** and the comment explaining the runaway‑lerp bug it replaced is
  accurate.
- **Balance tolerance is sound.** `BALANCE_TOLERANCE_G = 10` against the *exact* mass (not the rounded target)
  makes both readings reachable with the available denominations: 80 g vs 83.7 g exact, 250 g vs 258.0 g exact.
