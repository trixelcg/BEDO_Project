# 44 — Water: authored motion, and parity with the reference recording

BEDO-044. The water was reported as not looking like the intended simulation. It did not,
and the reasons were measurable rather than matters of taste.

The authority for **what the water is** is `assets-source/WaterShapes/*.abc`. The authority
for **how it should look and how fast it should move** is `docs/reference/Bedo_Mesu_J.mp4`.
Neither is sufficient alone: the caches carry the geometry, and the recording carries the
timing, the scale and the material.

---

## 1. The reference recording

| | |
|---|---|
| Path | `docs/reference/Bedo_Mesu_J.mp4` (identical copies in `public/`, `dist/`, and next to the repo) |
| Format | 1920×1080, H.264, **exactly 30.000 fps**, 2672 frames, 89.07 s |
| Content | A screen recording of the original BEDO simulator walking Experiment 01 |

There is no `ffmpeg` on the development machine; frames were decoded through Chrome and the
container metadata read straight out of the MP4 `mvhd` / `stsz` boxes.

Water is on screen in two windows:

| Window | State |
|---|---|
| 55.5 – 65.5 s | Low flow. Tank **empty**, jet column only |
| 72.0 – 78.4 s | Tank **filled** almost to the cover |

Pump-off and drain are never shown, so nothing here reverses the cache.

---

## 2. The caches

Measured in Blender, not inferred from filenames:

* Eight archives, **81 samples at 24 fps** (3.3333 s), corroborated independently by the
  Unity importer settings left in each `.abc.meta` (`abcEndTime: 3.3333333`).
* **Constant topology** throughout — which is what makes morph targets legal.
* One mesh each, always visible. No visibility animation, no topology change.
* Every frame distinct.

What had shipped was **frame 80 of each, frozen**, matched to within 3e-5 units by searching
all 81 frames. Frame 0 is a 0.1–2 unit nub; frame 80 is the full 17–28 unit shape.

There is no Unity implementation to be faithful to: that project contains two C# files, both
the stock tutorial sample, no prefabs, no Timeline, and a scene holding only lights and a
camera. `Bedo_MJblend.blend` holds the apparatus and no water. The caches are the only
authored truth, and they came from 3ds Max / Maya (`Max_MaterialID_*`, `polySurface1`).

---

## 3. Timing — 3.333 s was the authoring rate, not the playback rate

The archive rate is not evidence of playback speed. Counting water pixels per frame in the
tank region of the recording, against a stable pre-water baseline of ~8,200:

| Share of steady | Timestamp |
|---|---|
| 0 % | 55.55 s |
| 50 % | 56.02 s |
| 90 % | 56.40 s |
| 95 % | **56.70 s** |
| asymptotic | ~57.0 s |

**Startup is ≈ 1.15 s**, not 3.333 s — `WATER_STARTUP_SECONDS`. Frames 0→80 still play in
order and still hold at 80; only the pace changed.

Playback remains one-shot. Returning frame 80 to frame 0 moves every vertex by 18–29 % of
the shape's own diagonal, and the quietest 12-frame window in any cache still has a seam
error at least as large as the motion inside it — there is no authored cycle to loop.

---

## 4. Two different things called "the jet"

BEDO-017 scaled the *rendered* water to `NOZZLE_AREA_M2`. That fixed a real defect — the
water had been 95 % of the tank's diameter, 17× too wide — but it overshot, because it
applied a **physical bore** to what is actually an **authored silhouette**. At 10 mm the
water was invisible.

The recording settles it. The water body is broad, envelops the nozzle tube, and spans tank
floor to deflector. Measured per row at t = 60.63 s: 27 px at the deflector, 48–54 px through
the body, 74 px at the flared foot — about **one deflector diameter** across, using the
deflector cone as an in-frame ruler (the one object visible in both flow states).

So the two are separated, and both are now asserted:

| Concept | Value | Owner |
|---|---|---|
| Physical bore | **10.00 mm**, from `NOZZLE_AREA_M2` | `domain/physics` — force, velocity, momentum. Unchanged. |
| Visible body | ≈ 1.0 × deflector diameter | `lib/waterJet.ts` `bodyScale` — presentation only |

`Water_low`'s own silhouette confirms which the asset represents: rendered at its settled
frame it is a tapered column, narrow at the top, widening to a flared foot — exactly the
shape in the video.

Rendered result: **32.4 mm wide × 252.4 mm tall**, against 10 mm × 184 mm before.

---

## 5. Material and ripple

The old material was glass: `transmission: 0.3`, `clearcoat: 1.0`, `envMapIntensity: 1.6`.
Worse, the BEDO-043 fragment stage summed `glint + rim + foam` to as much as 1.8 before
clamping at 0.95 and mixing toward near-white — so most of the surface was painted white.
A 10 mm thread of mirror against a dark tank is nothing at all.

Sampled across the reference column at t = 60.63 s the core is **rgb(83, 90, 111)**: a dark,
desaturated blue-grey through which the nozzle and deflector stay visible. Retuned to match,
the rendered body now measures **rgb(78, 89, 100)** over 4,710 sampled pixels.

BEDO-043's architecture is **kept** — the derived object-space surface coordinate is the
right mechanism and its banding fix still holds. Only the amplitudes changed. Between 60 s
and 64 s the reference's water region changes **0.65/255 per frame** against **0.05** for a
static background: real, continuous motion, but a fraction of what was implemented. Vertex
displacement went 0.16 → 0.022 and the highlight ceiling 0.95 → 0.40.

---

## 6. The tank water

The high-flow state is **not** a wider jet. The two reading setpoints are n = 0.4 and n = 0.5,
which `flowRateLMin` separates by a factor of 1.72 — nowhere near enough to fill a tank. It
is the volumetric measurement: shut the drain and the tank fills, which is what the
experiment exists to do.

No shipped asset can draw it. `LIQUID001` — the one liquid-sounding mesh — is a **four-vertex
flat quad**, 0.3125 × 0.7874 × 0 in its own space (≈ 6.7 × 16.9 mm), sitting about 480 mm
below the tank floor and 300 mm to one side. It is identical in `Bedo_baked_v2.glb`,
`assets-source/models/Bedo_M.glb` and `Bedo_model_optimized.glb`, so it is what was authored,
not something a bake broke. It stays hidden.

So `lib/tankWater.ts` generates one, from the tank's own measured interior: the glass's
vertices fall into two radial bands, an inner wall at **85.6 mm** and an outer at 90.5 mm,
with the interior spanning y 1.058 → 1.375 (**298 mm**). The body fills to `FULL_LEVEL = 0.90`
of that, where the reference's free surface sits.

> **`DRAIN_CAPACITY_FRACTION = 0.178` is a reference-calibrated presentation threshold, not
> a verified BEDO physical constant.** No BEDO document describes the drain or any flow at
> which the tank starts to fill. It exists only to reproduce the recording, it lives outside
> `src/domain` so no equation can read it, and a test enforces that. It must never be quoted
> as an engineering parameter unless BEDO source documentation later confirms a real value.

`FILL_SECONDS` is **bounded, not measured**: the tank is empty when the camera leaves at
65.5 s and nearly full when it returns at 71.5 s, so filling takes *at most* six seconds —
but the recording never shows when the valve was shut. Six seconds is the slowest value
consistent with the evidence, chosen over a faster invented one.

It is presentation only. Nothing in `src/domain` references it, and it takes no part in any
equation — asserted in `tests/unit/tank-water.spec.ts`.

---

## 7. Reproducing the assets

```
npm run water:build
```

which runs, for each of the eight caches:

```
assets-source/WaterShapes/*.abc
  → Blender  scripts/water/abc_to_morph_glb.py    bake 81 samples to morph targets
  → gltfpack -cc -kn -km                          EXT_meshopt_compression
  → public/WaterShapes/*.glb
```

`gltfpack` is a declared devDependency. Blender is not (it is a desktop application); the
script fails fast with instructions if it is missing, and `BLENDER=` overrides the path.

**The base mesh is frame 80, deliberately.** `waterFit` measures each shape's extents and
`buildWaterUv` bakes its surface coordinate from the same vertices; exporting frame 0 as the
base would hand both a nub. With frame 80 as the base, all influences at zero *is* the
geometry that shipped before, and the animation is purely additive.

Packaging was measured, not assumed:

| Option | All eight, brotli |
|---|---|
| Blender float32 morph export | 5.65 MB |
| **gltfpack `-cc`** | **1.25 MB** |
| Custom q16 + delta (positions only, no container) | 0.47 MB |

`gltfpack` wins on the rule "prefer the most standard thing that meets the budget": it is
`KHR_mesh_quantization` + `EXT_meshopt_compression`, decoded by three's own `GLTFLoader`,
which drei's `useGLTF` wires up by default. Bundle cost is zero — `three-stdlib` imports
`MeshoptDecoder` at module scope regardless.

`Box3.setFromObject` must never be used to measure these assets: it expands over every morph
target, and for *relative* targets by adding the most negative delta found anywhere to the
overall minimum. Use `basePoseBox` (`lib/waterCache.ts`).
