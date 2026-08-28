# 46 — Material response (Stage B, Stage B.1)

Making the geometry answer the approved Stage A.1 lighting. The lighting architecture is
unchanged: sun azimuth 40°, elevation 32°, intensity 2.4, `BAKED_ROOM_ENV` 0.45, the 4096²
shadow map, the frustum, bias, normalBias and the selective caster/receiver logic are all
exactly as approved.

`APPARATUS_ENV` also stays at 2.0 for every family except one. Stage B.1 gives the
`paintedMetal` family — three materials, the powder coat — the environment at unity instead,
for a reason set out in §4a: the 2.0 is a diffuse-fill compensation, and a 2%-albedo coating
has no diffuse to compensate, so on that family alone the factor lands entirely on the
specular. The control panel is not in that family and is unaffected.

`public/Bedo_baked_v2.glb` stays frozen at
`f1836e3b0af22f9090df2136899b69e77e455b7dd19d9b3aa3ccf2f6cf24d6f4`. Every correction is
applied at runtime to the loaded material instances.

## 0. The frozen approved state

Stage A.1 + Stage B.1, approved for production. Every value below was read back from source at
release time, not from notes.

### Lighting — unchanged from Stage A.1

| value | setting | where |
|---|---|---|
| `sunAzimuth` | 40 | `sceneConfig.ts` |
| `sunElevation` | 32 | `sceneConfig.ts` |
| `sunIntensity` | 2.4 | `sceneConfig.ts` |
| `sunColor` | `#fff4e6` | `sceneConfig.ts` |
| shadow map | 4096 x 4096 | `Scene3D.tsx` `WindowSun` |
| shadow bias / normalBias | −0.0004 / 0.035 | `Scene3D.tsx` `WindowSun` |
| shadow frustum | left/right/top/bottom ±14, near 1, far 60 | `Scene3D.tsx` `WindowSun` |
| `BAKED_ROOM_ENV` | 0.45 | `materialFamilies.ts` |
| selective room casters | `Walls_1st_Level`, `WALLS_INTERNAL_PARTITIONING`, `window_frame_`, `ALuminum_Frame`, `Floor_1st_Floor`, `Skirting_1st_Floor`, `White_Board_`, `Desks` | `DeviceModel.tsx` |
| floor receives, never casts | `Plane001_Baked` | `DeviceModel.tsx` |

### Materials — Stage B plus the Stage B.1 corrections

| value | setting | what it holds |
|---|---|---|
| `DIELECTRIC_SPECULAR` | 1.0 | the restored specular; lifted only, never lowered |
| `MAX_SPECULAR_COLOUR` | 1.0 | clamped **down only** — an authored factor below 1 is a finish and is never raised |
| `APPARATUS_ENV` | 2.0 | every family except `paintedMetal` |
| `COATING_ENV` | 1.0 | `paintedMetal` only — the black powder coat |
| `CONDUCTOR_TINT_LIMIT` | 0.25 | checker-plate and conductor chroma neutralisation |
| `CONDUCTOR_MIN_REFLECTANCE` | 0.55 | exposed-metal reflectance floor |
| `MIN_CONDUCTOR_LUMINANCE` | 0.35 | demotes a too-dark "metal" to a coating |
| `MAX_INSULATOR_ALBEDO` | 0.55 | white-paint response |

Invariants that must survive any later change:

* `Material #35` keeps its **authored** `specularColorFactor` of 0.173. Raising it is what blew
  the tank-base grazing highlight; it is the only material in the GLB authored meaningfully
  below 1.
* The black coating keeps its **authored** base colour `#262626` and `metalness: 0`. It is a
  dielectric, and its darkness is pigment, not a missing specular.
* The control panel classifies as `unknown`, not `paintedMetal`, so it keeps `APPARATUS_ENV`.

The legs sit at a median of 29 against the reference's 13. That gap is left **deliberately
unresolved**: closing it means the room's ambient balance rather than the coating, and
overfitting a material to one number is how the Stage B error happened in the first place.

### Reference provenance

`docs/reference/reference-render.png` is the approved photorealistic reference used for every
A/B comparison in this document. Byte-identical to the image as supplied, never recompressed.

```
sha256  e0b343c7ca4b38e2db3251092ffa3b59c58d8cc904e8b83a7a63ca7860fdc7b5
bytes   1,782,147
size    1501 x 1048
```

### Frozen asset

```
public/Bedo_baked_v2.glb
sha256  f1836e3b0af22f9090df2136899b69e77e455b7dd19d9b3aa3ccf2f6cf24d6f4
bytes   11,948,588
```

No asset regeneration, no `gltfpack`, no `recompress.mjs`, no `repair-contract.mjs` in this
release.

## 1. The mechanism

Half this model has its dielectric specular reflection switched off.

**31 of the 68 authored materials carry `KHR_materials_specular` with `specularFactor: 0`**,
which three's loader faithfully applies as `specularIntensity = 0`. A dielectric at zero
specular is a pure Lambertian surface — no sheen, no Fresnel, no view dependence — which is
physically impossible in exactly the way `metalness: 0.5` is. It sits on the white bench, the
powder-coated frame, the control panel and most of the apparatus.

A further **28 materials carry the opposite error**, `specularColorFactor` of 1.8 or 2.0,
doubling F0 to around 8% — brighter than any common dielectric.

The measurement that makes it unambiguous: across the whole white bench panel, a large surface
spanning several orientations, the Stage A.1 render's luminance ran from 221 to 222 — a
standard deviation of **0.31 in 255**. No lighting change could fix that, because nothing about
the lighting was wrong. The surface had no term that could respond to it.

Both errors are corrected to the physical value in `applyFamily`, with F0 left to come from
each material's own index of refraction.

## 2. What each surface needed

### Floor — nothing, and that is the result

Sampled over its own triangles in the running scene, area-weighted:

| channel | what is actually there |
|---|---|
| albedo | exactly 102, 102, 102 at every sample — uniform, neutral |
| normal map | exactly (128, 128, 255) at every sample — **the flat normal** |
| roughness map | **a constant 0.502** — p05, p50 and p95 identical |

There is no authored surface detail to preserve, and the floor is not too rough. What flattens
it is that both sources reaching a floor in shade — the ambient light and the captured room
environment — are close to isotropic.

Four changes were built, rendered and measured against the shaded floor's baseline of mean
83.1, sd 2.59:

| change | mean | sd | sun-shadow floor (p05) |
|---|---|---|---|
| as authored | 83.1 | **2.59** | 32 |
| `emissiveIntensity` 1.0 → 0.6 | 78.4 | 1.86 | 30 |
| + `envMapIntensity` → 1.0, albedo ×0.72 | 72.5 | 2.17 | 52 |
| `envMapIntensity` 0.45 → 1.0 alone | 86.0 | 1.22 | **63** |
| roughness 0.502 → 0.35 alone | 79.0 | 1.23 | 39 |

Every one makes the floor flatter, and the two that raise the environment fill the sun's own
shadow — p05 climbing from 32 to 63 is the mullion bars washing out. The authored values win.

A floor reflecting the apparatus is not reachable by material tuning at all:
`captureRoomEnvironment` deliberately excludes the apparatus, so there is nothing of it to
reflect. That needs a second probe and is an architecture decision.

### Checker plate — the cast is in the texture

`ground_uv_3` has a mean of 119.5, 119.3, **129.5** — blue 8.4% over red — and the Stage A.1
render came out at 61.5, 61.4, **66.5**, which is 8.1%. The map's cast arrives essentially
unchanged, which rules out the environment (a contribution would push the rendered ratio
*above* the map's), the base colour factor (white), emissive (none) and colour-space handling
(a neutral map would have been tinted too).

It matters here because a conductor has no diffuse term: its base colour *is* the colour of its
specular reflection, so the cast multiplies every highlight the plate makes.

`neutraliseConductorTint` measures a conductor map's mean chroma once at load and divides it out
through `material.color`, preserving luminance and pattern. A strongly coloured map is left
alone — `dirty copper` measures 0.62 chroma against the checker plate's 0.08, so the 0.25
threshold is not a fine judgement.

### Exposed metals

The same neutralisation reaches `steel1` (deflectors, +4.6% blue) and `iron basic` (+7.4%).
Separately, `CONDUCTOR_MIN_REFLECTANCE` lifts an untextured conductor too dark to be one:
`steels crews` is authored at 0.157 linear where iron and titanium sit near 0.55. Mapped metals
are never lifted, and nothing dark and painted is promoted to metal — classification is
unchanged.

### Black powder coat

Base colour untouched at `#262626`, metalness still 0. The coating gains a specular lobe, and
its roughness comes down from 0.9 — closer to unfinished plaster than to a coating — into the
0.45–0.68 band a powder coat occupies. The leg's p05–p95 range goes from 17–23 to 30–51.

The rendered core doubles, 20 → 40 of 255. That is the correct consequence of a 4% F0 with
Fresnel on a near-edge-on surface and no base colour was touched to get it, but it is the
judgement call in this stage most worth a second opinion.

### White paint

Two faults. The specular was off, and an albedo of 0.847 linear put the surface on the shoulder
of the ACES curve, where a 20% change in incident light moves the displayed value by about 7 of
255. `MAX_INSULATOR_ALBEDO` caps untextured insulator albedo at 0.55 — measured, not guessed:
the panel gradient goes 0.46 at a cap of 0.68 and 0.58 at 0.55 while the panel stays plainly
white at 209.

The remaining flatness is not a material property. The bench stands in the room's shade, lit by
a probe captured *flat-lit at unity*, so its panels receive very nearly equal irradiance
whatever their orientation and the only gradient physically available is Fresnel.

## 3. Measurements

Both columns captured back to back from `scripts/render/capture.mjs`, each verified reproducible
across two runs (14/14 identical signatures). Raw data in `measurements/stageB/`.

| view | mean | contrast (sd) | p05 | p95 | black clip % | white clip % | saturation |
|---|---|---|---|---|---|---|---|
| 1-laboratory | 105.37 → 105.02 | 68.06 → 65.71 | 22 → 23 | 216 → 207 | 0.207 → 0.199 | 0.002 → 0.006 | 0.0744 → 0.0715 |
| 2-apparatus | 103.19 → 104.41 | 72.17 → 66.93 | 15 → 29 | 221 → 204 | 0.482 → 0.481 | 0.025 → 0.061 | 0.0907 → 0.0712 |
| 3-glass-tank | 99.26 → 107.01 | 61.18 → 62.02 | 16 → 27 | 197 → 208 | 0.583 → 0.568 | 0.097 → 0.257 | 0.0827 → 0.0694 |
| 4-water-active | 104.60 → 109.28 | 56.32 → 56.82 | 19 → 29 | 197 → 197 | 0.546 → 0.539 | 0.094 → 0.240 | 0.1067 → 0.0945 |
| 5-control-panel | 121.65 → 119.52 | 83.33 → 78.91 | 19 → 21 | 223 → 218 | 0.342 → 0.342 | 0 → 0 | 0.0948 → 0.0885 |
| 6-weights | 58.50 → 72.48 | 69.11 → 64.21 | 7 → 21 | 221 → 204 | 0.148 → 0.102 | 0.145 → 0.589 | 0.2143 → 0.1146 |
| 7-deflector | 77.26 → 83.94 | 68.30 → 63.39 | 11 → 19 | 198 → 198 | 0.032 → 0.032 | 0 → 0 | 0.0794 → 0.0804 |
| 8-environment | 117.08 → 116.53 | 68.76 → 66.56 | 17 → 18 | 209 → 208 | 0.292 → 0.135 | 0 → 0 | 0.0595 → 0.0567 |
| 9-reference-match | 101.68 → 101.38 | 63.80 → 61.29 | 23 → 25 | 214 → 206 | 0.178 → 0.170 | 0.001 → 0.013 | 0.0802 → 0.0776 |
| 10-window-beam | 90.54 → 89.18 | 67.54 → 63.74 | 16 → 19 | 208 → 205 | **2.239 → 0.133** | 0 → 0.003 | 0.0824 → 0.0767 |
| 11-floor | 88.73 → 88.55 | 53.64 → 52.00 | 20 → 20 | 205 → 205 | **1.038 → 0** | 0 → 0 | 0.0951 → 0.0925 |
| 12-checker-plate | 96.89 → 94.69 | 83.15 → 72.11 | 16 → 18 | 221 → 204 | 0 → 0 | 0 → 0 | 0.0856 → 0.0633 |
| 13-black-frame | 118.92 → 112.84 | 93.44 → 81.77 | 17 → 18 | 222 → 204 | 0.028 → 0.028 | 0 → 0 | 0.0606 → 0.0542 |
| 14-white-bench | 198.88 → 185.20 | 61.16 → 53.47 | 24 → 40 | 225 → 210 | 0.010 → 0.010 | 0 → 0 | 0.0339 → 0.0414 |

Two patterns run through it. **p05 rises almost everywhere** and black clipping falls or holds
on every view — the restored Fresnel reaching surfaces that had nothing but diffuse.
**Contrast falls on most views**, which is the same effect from the other end: a standard
deviation drops when the bottom of the range stops being crushed. **Saturation falls on eleven
of fourteen** as the conductor cast comes out.

Per the brief, no attempt was made to push the global histogram toward the reference at the cost
of local realism.

### Per-surface crops

| crop | mean | sd | saturation | p05 → p95 |
|---|---|---|---|---|
| floor — shaded | 83.10 → 83.10 | 2.59 → 2.59 | 0.1154 → 0.1154 | 79→79 / 88→88 |
| floor — sunlit band | 183.07 → 183.07 | 51.79 → 51.79 | 0.0525 → 0.0525 | 32→32 / 206→206 |
| checker plate | 61.78 → 61.21 | 25.71 → 25.20 | **0.0935 → 0.0450** | 23→23 / 102→101 |
| black powder-coated leg | 23.04 → 42.83 | 24.41 → 20.47 | 0.1328 → 0.1015 | **17→30 / 23→51** |
| white bench panel | 225.00 → 209.47 | **0.32 → 0.58** | 0.0200 → 0.0293 | 224→208 / 225→210 |
| weights — steel discs | 50.58 → 61.76 | 43.52 → 37.37 | **0.2038 → 0.1380** | 9→26 / 142→142 |
| deflector cones | 47.22 → 52.99 | 53.89 → 48.42 | **0.2257 → 0.1233** | 5→16 / 156→156 |
| black instrument tray | 41.20 → 52.52 | 63.77 → 51.20 | **0.2821 → 0.1121** | 6→24 / 209→187 |
| tank collar (white) | 119.50 → 176.64 | 62.51 → 61.53 | 0.0716 → 0.0363 | 28→62 / 208→244 |
| control panel | 148.04 → 144.70 | 81.32 → 81.15 | 0.1327 → 0.1368 | 36→41 / 223→218 |

## 4. Performance

Headed Chrome on an M1 Max via Metal, 1440×900, eight-second sample, ~960 frames per run.

| metric | Stage A.1 | Stage B |
|---|---|---|
| frame time p50 | 8.30 ms | 8.30 ms |
| frame time p95 | 10.30 ms | 8.50 ms (vsync noise; B measured 10.30 / 10.00 / 8.50 across three runs) |
| frame time max | 10.40 ms | 10.40 ms |
| fps | 120.1 | 119.9 |
| draw calls / frame | 417 | 417 |
| triangles / frame | 120,602 | 120,602 |
| framebuffer binds / frame | 22 | 22 |
| shader programs | 42 | 42 |
| capture-harness draw calls | 159 | 159 |
| textures / geometries | 54 / 156 | 54 / 156 |

Stage B is scalar parameter changes on existing materials plus one 32×32 canvas read per
textured conductor at load. No render passes, no SSR, SSAO or bloom, no new lights, no extra
materials, no extra geometry.

One early reading of 64 shader programs was a transient caught mid-recompile; two further runs
both report 42. Similarly, the first capture of the Stage A.1 baseline reported 171 geometries
and 65 programs against a cold preview server — the condition `capture.mjs` already warns about.
Both columns above were re-captured warm and back to back.

## 4a. Stage B.1 — the reference correction

`docs/reference/reference-render.png` arrived after Stage B was measured and answered both open
questions, one of them against Stage B. Two rules changed, each one-sided, each traced to a
specific material.

### The black powder coat read as dark grey

Measured in the matched `9-reference-match` framing, the legs' median luminance:

| | reference | Stage A.1 | Stage B | **Stage B.1** |
|---|---|---|---|---|
| leg, front | 13 | 21 | 40 | **29** |
| leg, second | 14 | 20 | 42 | **32** |
| leg, grazing crop | — | 20 | 40 | **29** |

`APPARATUS_ENV = 2.0` is a **diffuse-fill** compensation — its own note argues the case in the
language of diffuse. three applies it to both lobes. On a coating with an albedo of 0.02 there
is almost no diffuse to restore, so the 2× lands almost entirely on the specular, where it makes
the coat reflect a room twice as bright as the room is; at grazing angles, where Fresnel is
effectively a mirror, that doubling is the whole of what you see.

`COATING_ENV = 1.0` scopes the environment to unity for `paintedMetal` — three materials. The
specular is not switched back off, the base colour stays `#262626`, metalness stays 0. The
**control panel classifies as `unknown`** and keeps `APPARATUS_ENV`; its black clipping is
0.342% in all four columns.

### The tank-collar clipping was never the white ring

Scanning for luminance ≥ 253 puts the clipped pixels at `x 613–674` and `x 1254–1305` — the
ring's left and right flanks. Rays cast through those exact pixels hit `JET_Force_2_214` first,
at `N·V` of 0.153–0.329 (71°–81° off normal), material `Material #35`, base colour `#161616`.
No glass appears in the hit list at those pixels, so Stage C will not change it.

Stage B set every dielectric's `specularColor` to exactly 1 in *both* directions. Of the 64
materials carrying `KHR_materials_specular`, 32 sit above 1 and 32 at or below, and exactly
**one** is meaningfully below: `Material #35` at 0.173. Raising it to 1.0 multiplied its F0 by
5.8. `MAX_SPECULAR_COLOUR` now clamps **down only**; a suppressed specular is a real finish.

| | reference | Stage A.1 | Stage B | **Stage B.1** |
|---|---|---|---|---|
| collar mean | 143.0 | 119.5 | 176.6 | **119.4** |
| collar white clip | 0.116% | 0.89% | 2.535% | **0.89%** |

Every white-clipping regression Stage B introduced returns to its A.1 value frame-wide.
Beam black clipping goes 2.239% (A.1) → 0.133% (B) → **0.694%** (B.1), still 3.2× better than
the approved baseline. Checker plate, white paint, exposed metals and floor are unchanged by B.1.

## 4b. FULL_MODEL suite

The gated run reported 13 passed, 4 failed; the shell's exit 0 was the pipeline's, not
Playwright's. Each failure was rerun individually with the machine held awake:

| test | first run | rerun | class |
|---|---|---|---|
| `camera-follow.e2e.ts:253` | idle-state timeout after a page navigation | **passed** (3.8 m) | D — machine sleep |
| `drag.e2e.ts:81` | same timeout, 11.6 m against a 900 s budget | **passed** (3.8 m) | D — machine sleep |
| `weight-transfer.e2e.ts:247` | `Execution context was destroyed…by a navigation` | **passed** (1.5 m) | D — machine sleep |
| `camera-follow.e2e.ts:82` | `transferFollow` 0.741 vs > 0.8 | **reproduced** 0.750 | B — pre-existing |

The reproducing failure was then run against a clean pre-rendering baseline (`ede1791`, in a
throwaway `git worktree`, working tree untouched): **0.744, and a byte-identical disc
trajectory**. The assertion reads only projected screen positions and UI panel rects; nothing in
that chain touches a material, light or the environment probe, and frame time is identical at
8.30 ms p50. True status for this branch: **16 passed, 1 pre-existing failure**, documented and
left outside this task.

## 5. Known regression

White clipping on the tank collar (`12 - Default`) rises from **0.89% to 2.54%** of a tight
crop. It is the sun's specular highlight on a curved gloss ring — a term the surface previously
could not have at all. It was swept and is insensitive to `MAX_INSULATOR_ALBEDO` (0.68 vs 0.55),
to `APPARATUS_ENV` (2.0 / 1.6 / 1.4) and to the roughness band max (0.68 / 0.82 / 0.90), because
it is a direct-light highlight on a mapped material whose authored roughness of 0.5 already sits
inside the band. Suppressing it means raising the `unknown` family's minimum roughness above
0.5, which dulls every other coated part to fix one ring.

## 6. Open

* **The reference render is not in this repository.** `docs/reference/` holds the two UI
  screenshots and `Bedo_Mesu_J.mp4` only. The comparison above is therefore two-way, and the
  floor was calibrated from what the GLB contains plus the four experiments in §2 rather than
  from the reference as the brief asks.
* **A floor that reflects the apparatus** needs a second environment probe including the
  apparatus, used by the floor alone: one cube render and one PMREM at load, nothing per frame.
  It changes how the scene is lit, so it is not taken here.
* **`tests/unit/scene-config.spec.ts` was red on arrival.** Stage A.1 added the four `sun*`
  fields without updating the field-count pin. Repaired, and the sun values are now pinned.

Glass and water are untouched. Stage C is not started.
