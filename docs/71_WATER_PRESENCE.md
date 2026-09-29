# 71 — Water you can feel: a lit, coloured body instead of a wash

Working-tree change on top of docs/70. Not committed, not deployed.

**Request (user, 2026-09-30):** after docs/70 the water is too transparent and hard to see. Give it some water colour, or better foam and simulation, so its presence is felt.

## Why raising the opacity alone was not the answer

The jet's body was a flat aqua constant (`WATER_TINT`) mixed in at `WATER_VISIBILITY.body`:
* It was **not lit.** It glowed the same in shade and in light.
* It had **no depth.** The edge and the axis were the same colour.
* It had **no motion** of its own.

At 50 % that read as a frosted plastic rod; at 28 % (docs/70) it vanished. Making it more opaque would only bring the plastic back. The body itself had to become water.

## What changed

**`src/lib/waterMaterial.ts`**

* **`WATER_BODY`**: the colour water scatters back. Aqua where the eye crosses little of it (0.50, 0.76, 0.84), blue-green where it crosses the most (0.12, 0.40, 0.54). The hoses share it (`CONDUIT_WATER = WATER_BODY`), so the circuit is one substance.
* **`waterLight`**: the body is lit by the room, meaning the irradiance a white matte surface would receive at that point. It is darker in shade and brighter in light.
* **`waterTurb`**: turbulence carried with the parcels, long along the flow. Denser and clearer water passes by, which is what makes a stream read as moving.
* **The jet:**
  * the body deepens from edge to axis (`chordB = cosView`) at `WATER_VISIBILITY.body` 0.45 × (0.7 … 1.2);
  * it is laid over the unchanged refraction and reflection;
  * foam is now lit white (`vec3(0.9, 0.94, 0.97) * waterLight`), not self-lit.
* **Sheets and films:** the same lit, turbulent body; the same lit foam.
* **The film on the tank wall:** floor 0.08 → 0.12 and rivulet weight 0.16 → 0.28. The wall carries visible streams of water; between them it stays clear.

**`src/lib/jetFlowMesh.ts`, the pool on the tank floor**

* It was at 6 % alpha and read as nothing.
* It is now premultiplied, like the rest of the water:
  * the room's reflection;
  * a lit blue-green body at 38 %, shaded by a slow swell;
  * foam where the water lands, plus a wider skirt of broken bubbles drifting out from it.

## Verified

* Live (dev, free mode, flat 90° deflector, Q = 27 L/min):
  * the jet reads as a blue column with turbulence moving up it;
  * the hose water reads as blue water;
  * the pool reads as water with foam at the landing;
  * the wall shows streams running down;
  * no shader diagnostics.
* Tests:
  * `water-surfaces.spec` updated where it pinned the old foam formula and rivulet weight. It still asserts that air whitens the body, that the reflection is never scaled away, and that the film is clear between its rivulets.
  * All 76 water and glass tests pass. The full suite has the same 13 pre-existing failures as docs/69 and docs/70.
* Cost: shader arithmetic only, plus two texture reads in the jet. No new meshes, passes or textures.

## Tuning

| to change | constant |
|---|---|
| how much of the jet's body shows | `WATER_VISIBILITY.body` |
| the water's colour | `WATER_BODY` |
| the wall film | `WATER_VISIBILITY.runoff` and the rivulet weight in the run-off alpha |
| the pool | `0.58` base alpha in `createPoolMesh` |

## Follow-up (same day): less transparent

**Request (user):** the water is still too transparent; it should not be fully clear.

* `WATER_VISIBILITY`: body 0.45 → **0.70**, hose 0.50 → **0.72**, sheet 0.50 → **0.68**, runoff 0.12 → **0.20**. The jet's body share is 0.70 × (0.75 … 1.10), capped at 0.92.
* **Entrained air in the jet** (`airStreak`): milky streaks of fine air, long along the flow and moving with it, up to 35 %. A fast real jet is not glass-clear.
* **Pool on the tank floor:** base alpha 0.38 → 0.58, foam 0.9.
* **Measuring tank: a Beer–Lambert multiply pass** (`createBasinAbsorption`).
  * The problem: a single alpha has no colour, so however opaque the water was made, the white basin floor came through grey.
  * A second draw of the same 12-triangle box, just before the water's own layer, multiplies what is already drawn by the per-channel transmittance `exp(-k · 2d / cosθ)` (`MultiplyBlending`, premultiplied, alpha 1). The floor now reads aqua under a few centimetres and blue-green deeper.
  * The water's own layer only adds its reflection, its scattered light (alpha 0.1 … 0.6) and caustics (eased to 0.18).
  * It is a child of the water mesh, so it rides the level and hides with it. It is disposed with it, left out of the AO pre-pass (`seeThrough`) and out of the probe capture.

Verified live: at a pinned 4.5 cm level the tank reads as blue water with moving caustics. The jet, hoses, sheets and pool read as water that is present but not opaque. A new test pins the absorption pass. 77 water and glass tests pass, and the full suite has the same 13 pre-existing failures.
