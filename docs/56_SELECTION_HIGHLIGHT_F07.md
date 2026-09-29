# 56 — Selection highlight that keeps the material (F07)

Working-tree change on top of F03–F05 (`docs/53`–`55`); not committed, not deployed.

**Observed (QA, F07):** the selection treatment can cover the whole object in a strong gold,
flattening it and hiding its material, texture and perceived mass.

**Acceptance criteria:** AC1 original metal/texture remains visible while highlighted; AC2 the
highlight is readable against dark and light materials; AC3 it does not change the apparent
geometry or material class.

## 1. What was wrong — measured

Two builds, two different faults.

* **Deployed build** (the one QA reviewed): the hovered part's material is cloned and given a
  gold `emissive`. That is the full-surface gold in the report.
* **Working tree before F07** (BEDO-LOOK-04, `docs/52` #4, never deployed): an inverted-hull
  outline instead. It left most parts alone but still failed the criteria:
  * **Open and concave parts** (the cupped and conical deflectors, a weight's bore) showed the
    hull on their own inner faces.
  * **See-through parts** were given a depth-only pre-pass, so that the hull behind them was
    hidden. That pre-pass made them opaque to everything. The tank is highlighted as the drop
    target while a deflector is dragged, and it turned solid: the rod and water inside
    disappeared behind the environment.
  * **Gold on light surfaces** has no contrast: 1.35 : 1 on a mid grey, 1.6 : 1 on white.

Measured in the running app (local dev build, Chrome, 1920 × 889, the lesson's own camera).
The rendered frame was compared with and without the highlight. The "interior" figure
excludes a 1-pixel anti-aliased rim. Frame-to-frame noise with no highlight at all was
0–1.5 %.

| part | deployed | before F07 | **F07** |
|---|---|---|---|
| 50 g weight | 48.5 % of its pixels changed | 3.2 % | **0.2 %** |
| 180° deflector | 95.5 % | 6.3 % | **0 %** |
| 30° deflector | 93.2 % | 9.2 % | **0 %** |
| custom weight | — | 1.6 % | **0 %** |
| tank (drop target) | 69.2 % | **97.4 %** (turned opaque) | **0.1 %** (noise 0.2 %) |

## 2. The correction (`src/lib/selectionOutline.ts`)

* **Masked by the part itself.** Each highlighted mesh first draws a *mark*: its own
  geometry, both sides, with colour and depth writes off. It writes a stencil value where the
  part is visible and nothing else. The two outline hulls are stencil-tested `≠`, so they can
  never draw on a pixel of the part, whatever its shape. They are still depth-tested, so
  anything standing in front of the part still hides its outline. The depth pre-pass is gone:
  nothing the highlight adds writes depth, so glass stays glass.
* **Two tones.** A 2.5 px pale-amber line (`#ffe2a0`) with a thin dark keyline (`#140e04` at
  0.9, 2 px outside it). The light line carries dark surroundings and the keyline carries
  light ones. For every background luminance from black to white, one of them contrasts by
  at least **3 : 1** (WCAG's non-text threshold; `outlineContrast`). The old line was
  #ffc233 alone.
* **Pale amber, not gold:** less saturated and lighter than the old colour.
* **The frame has a stencil buffer:** the composer's render target (`labPostProcessing.ts`,
  `stencilBuffer: true`) and the canvas (`Scene3D.tsx`, `stencil: true`). Nothing else in the
  pipeline uses the stencil.
* **Unchanged:**
  * Hover only (BEDO-UX-ENV).
  * The part's own material, geometry and transform are never touched.
  * The hulls live outside the asset hierarchy.
* **Cost:** one extra draw call per highlighted mesh, for the mark; the depth pre-pass that
  blended parts used to get is gone.

## 2a. The wash over the part (product-owner direction, 2026-09-28)

Asked for after F07 was first delivered: the highlight should also be a colour over the item,
translucent so its texture shows through (QA IMG11: "elegant, light, doesn't destroy the
object's materials, textures and weight").

* The part's own geometry is drawn once more over itself (depth-equal, a hair towards the
  eye), blended in warm `#ffd27a`: **28 % face-on, rising to 45 % at the silhouette**, where a
  lit edge reads as a highlight rather than as paint.
* It is laid over the material, never in place of it. Face-on, 72 % of the surface's own
  texture contrast survives (`overlayTextureRetention`), so the steel, the engraved mass and
  the shading all still read. The deployed build's emissive replaced the surface outright.
* The outline (§2) is unchanged around it, and the wash fades with it when the intensity
  fades.
* Cost: one more draw call per highlighted mesh (four in all).
* Tested: `f07-acceptance.spec.ts`. The wash is the only highlight mesh drawn on the part; it
  is blended, never replaces; and at least 70 % of the texture contrast survives face-on
  (more than 50 % at the rim).

## 3. AC2 — contrast

Synthetic check: a steel weight and a black handle, each against three backdrops, at the
90th percentile of per-pixel contrast along the outline.

| backdrop | before F07 (gold) | **F07** |
|---|---|---|
| white | 1.61 : 1 | **5.2 : 1** |
| mid grey | 1.35 : 1 | **4.1 : 1** |
| black | 6.7 : 1 | **8.6 : 1** |

In the running app, the 90th percentile along the outlines of the parts in §1 was 10–15 : 1
on the black tray and 11 : 1 for the tank against the white wall and bench.

## 4. Tests

`tests/unit/f07-acceptance.spec.ts` (new, 12). It attaches the outline exactly as
`DeviceModel.setGlow` does, to every hoverable part and both drop targets of the shipped model:

* **AC1**
  * No material, map, colour, child or transform of the part changes, during the highlight or
    after it.
  * Every colour-writing mesh is stencil-masked `≠`, and every mark writes the stencil
    (`Replace`) on both sides before any hull draws.
  * Nothing the highlight adds writes depth.
  * The render targets have a stencil buffer.
  * `setGlow` never clones or recolours a material.
* **AC2**
  * One of the two tones reaches ≥ 3 : 1 against any background luminance.
  * The light tone covers dark backgrounds and the dark tone covers light ones.
  * The old gold failed on grey and white.
  * The new colour is paler than the old one.
* **AC3**
  * The outline uses the part's own geometry, shared and unmodified.
  * It lives outside the part's hierarchy.
  * Widths are in screen pixels: line ≤ 3 px, keyline ≤ 5 px.
  * It cannot be picked, and it casts and receives no shadow.

Against the pre-F07 outline, this spec fails 6 of its 12 tests. The whole unit suite is
otherwise unchanged.

## 5. Not verified here — run before merging

`npm run test:ci`, in particular `weight-hotspots.e2e.ts` (which checks the hover outline set).
Also check once on a device without MSAA support: the stencil is requested on the MSAA target
and on the canvas, but it has only been exercised on desktop Chrome.

Aside, not part of F07: the node `Tank_cover` that the cover's hover outlines is only a
small part of the visible cover (about 400 px in the step-6 view), so the cover's outline is
short. Whether the plate should be part of that node is a model question (F02).
