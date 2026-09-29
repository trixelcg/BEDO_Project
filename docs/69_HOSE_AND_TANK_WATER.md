# 69 — Water flowing through the hoses, and a real surface on the measuring tank

Working-tree change on top of docs/67. Not committed, not deployed.

**Request (user, 2026-09-30):** make the water material on the water meshes and in the pipes realistic, with waves and noise animation, so the water visibly flows through the pipes and through the rig in the right direction, with correct colour. The two circled pipes, the supply hose from the wall tap and the clear delivery tube over the bench, must show the water inside them, with no extra load on the scene.

## The circuit, measured (not assumed)

| mesh | from → to | wall |
|---|---|---|
| `Water supply hose - upper tap to tank` | wall tap `Cold_Tab_003` → bench fitting `Polyline004` | grey reinforced PVC, `CONDUIT_WALLS.smoked` |
| `Line010` | pump outlet `Polyline002` (low end) → tank-base fitting `Polyline001` | clear PVC, `CONDUIT_WALLS.clear` |

Both ends were found in the running scene by the double-sweep over each mesh's edge graph, and each fitting by proximity. In both hoses the water enters at the **lower** end, which `measureConduit` now uses as its rule.

## What changed

**`src/lib/waterMaterial.ts`, the conduit branch of the shared water shader.**

* Body of water seen from outside a tube: the chord the line of sight cuts through the bore decides the Beer–Lambert tint (clear at the bore's edge, blue-green down the middle, `CONDUIT_WATER`). The wall is drawn over it in its own tint and opacity, with the rim.
* Flow: the pattern is sampled at a **pipe-flow profile**: the core runs at 1.22× the mean and the wall at 0.72× (`CONDUIT_FLOW`), so the water shears instead of sliding as one piece. It swirls slowly round the axis and is domain-warped. Patchy caustic filaments ride on it, a focus line runs down the axis, and bubbles gather at the top of the bore and blur away at speed. A white front appears while a hose fills and a white tail while it drains.
* Reflection is three's own `totalSpecular` (Fresnel included). The outer wall is no longer bumped by the ripples: a hose's highlights run straight along its edges.
* Only the half of the tube facing the eye is drawn. The far half doubled the water and put a second wall inside it.
* New uniforms: `uFill` (the tube stands full with no flow) and `uSpeed`, plus a per-material `uConduitWall`.
* `CONDUIT_PATTERN_SPEED_MAX` (1.6 m/s, tanh-limited): at full valve the bore speed is well over 10 m/s, and a pattern carried that fast jumps more than its own length per frame and reads as flicker. The front still fills at the true Q / A.

**`measureConduit`.**

* Dijkstra on a binary heap. The O(n²) scan cost tens of ms per hose at load, and the supply hose has ~4100 welded vertices.
* Seeded on a cut square across the lower end, not at the lowest point. The supply hose sags just short of its inlet, and a lowest-point seed would have run its water both ways.
* The around-the-tube angle is parallel-transported slice to slice. A fixed "up" flipped it wherever the tube ran vertical.
* The along-the-tube coordinate is taken from the slice's centreline. Edge-graph distance zigzags by millimetres, which drew the filling front as a sawtooth.
* Smooth radial normals are written back to the hose geometry. Both hoses ship flat-shaded, and the water broke into facets.

**`src/components/DeviceModel.tsx`.** The supply hose gets its own conduit material (smoked wall, `uFill = 1`: a mains line stays full). Its pattern clock runs at Q / A through its own bore while the pump delivers. `Line010` keeps its fill-from-pump / drain-back behaviour and also sets `uSpeed`.

**`src/lib/measuringTank.ts`.** The measuring tank was a flat `#4f8fb3` box at 62 % opacity. It is now water:

* Room reflection (Fresnel).
* Depth-dependent Beer–Lambert colour.
* Two drifting ripple fields that always move, plus a finer chop while water pours in (`uStir`: the volumetric valve shut and the jet running).
* Moving caustics on the floor, from two unrelated scales so they never tile.

It is still one box and one draw call. Its absorption is a third of the jet's, because the jet's coefficients are scaled to tint millimetres and made a few centimetres of tank water an opaque slab.

The jet, its sheets and the pool are unchanged (docs/67 already carries their waves, ligaments and impact ring).

## Cost

No new meshes (the hoses' own geometry carries the water), no new render targets or passes. The two hoses share one program. Measured in the dev build with the pump running, 180 frames each way, twice: **25.1 ms/frame with the hoses and tank water drawn, 25.2 ms with them hidden**, which is no measurable difference.

## Verified

* Unit: `water-material`, `water-uv`, `hose-water` (+2 tests: the supply hose's wiring, and its water running from the tap towards the bench). `water-uv` now also accepts the conduit's profile coordinates `us` / `pc` / `pb`, and pins their definitions to the clock less the parcel's distance. `tsc -b` clean.
* The full suite has the same 13 failures with and without this change (integration UI, assets, bundle, domain-boundary). None of them touch the water.
* Live (dev, free mode):
  * `Line010` fills from the pump end and drains when the pump stops.
  * The supply hose stands full and runs while the pump does.
  * The measuring tank ripples and carries moving caustics as it fills.
  * No shader diagnostics.
