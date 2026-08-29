# 48 — Water response (Stage D)

Water rendering only. **No physics value changed**: the diff touches
`src/components/DeviceModel.tsx` and the capture harness and nothing else, so `src/lib/`
— where the bore, the flow curve, the fill and drain rates and the tank calibration live —
is byte-identical to the Stage C release. `public/Bedo_baked_v2.glb` stays frozen at
`f1836e3b0af22f9090df2136899b69e77e455b7dd19d9b3aa3ccf2f6cf24d6f4` (11,948,588 bytes).

Stage A.1 lighting, Stage B.1 materials and Stage C-safe glass are untouched, and that is
checked rather than asserted: of the 14 review views, the **9 with no water in frame are
bit-identical** to the Stage C release, and of the 5 glass views, **both empty-glass views
are bit-identical**. Only water-bearing views moved.

## 1. What the recording actually shows, and what we were shipping

Measured relatively inside each image, because the framing and the background behind the
tank differ between the recording and this scene.

### Tank volume — the depth cues ran backwards

| | reference | shipped |
|---|---|---|
| luminance, shallow → deep | 109.7 → 76.0 (**−33.7**) | 117.9 → 105.7 (−12.2) |
| saturation, shallow → deep | 0.204 → 0.331 (**rises**) | 0.202 → 0.176 (**falls**) |
| blue bias, shallow → deep | +21.9% → +41.1% | +17.5% → +15.0% |
| contact darkening at the floor | **−40.7** | +6.9 (it *brightened*) |

Beer-Lambert says a longer path is both darker and more saturated. The reference obeys that
in both channels; the shipped water was flat in luminance and **inverted in saturation**,
which is the opposite of a liquid.

### Free surface — no specular return at all

Row-averaged luminance walking down through the waterline:

* **Reference** — falls 153.8 → 118.6, rebounds to 141.8, climbs to 164.6. A trough, then a
  **+46 luminance band**, textured ±4 row to row.
* **Shipped** — falls 163.9 → 134.0 over 8 rows, then **dead flat for 55 rows**. Rebound
  **+0**.

The surface existed as a tonal step and nothing else.

### Jet and splash — rendered as white plastic

| | reference jet | shipped splash |
|---|---|---|
| saturation | **0.335** | **0.006** |
| blue bias | +42.1% | +0.4% |
| against its surround | **14.8 darker** | **12.4 brighter** |

Saturation 0.006 is achromatic. The body colour was `#6d84a6`, so the blue was buried
rather than missing.

## 2. Four mechanisms, each measured before it was changed

### 2.1 Transmission was producing a visible artifact and paying for it

Both water materials used transmission (tank 0.45, jet 0.12), so both routed through
three's transmission resolve — **the same subsystem that forced Stage C-safe on the
glass**. Inside that now-approved safe glass it drew the geometry behind the water as
hard-edged, axis-aligned rectangular blocks, worst across the tank floor and around the
nozzle.

Confirmed by rendering the identical frame with it on and off:

| | on | off |
|---|---|---|
| block artifact | present, objectionable | **entirely absent** |
| the rod read through the water | broken by blocks | **clean** |
| draw calls, water views | 198 | **119** |
| triangles, water views | 73,848 | **42,420** |

Removing it fixes the artifact, *improves* readability, and returns **79 draw calls and
31,428 triangles per frame**. Nothing in the recording asks for refraction either — its
water displaces nothing behind it.

### 2.2 Linear values had been authored as though they were display values

Both shaders modify `gl_FragColor` at `<opaque_fragment>`, which is **before**
`<tonemapping_fragment>`. ACES at exposure 1.3 lifts mid-darks hard, so a colour authored
at the value the reference measures renders far brighter than it.

The jet's "depth" colour was `vec3(0.247, 0.345, 0.467)`, which arrives near luminance
**205** — so the term meant to deepen the column was *lightening* it. Inverting the tone
curve for the reference's core, rgb(60, 68, 92), gives `vec3(0.039, 0.046, 0.069)` — about
six times lower. The tank's `deep` had the same fault.

### 2.3 The body colour is transmitted light, not a shaded surface

With the water's alpha forced to 1.0 the tank body still rendered at luminance **135** near
the surface — about 2.5× its own albedo — because a smooth dielectric under a 2.4-intensity
sun and a room probe is mostly specular. Tinting toward a darker colour barely moved it.

So absorption now *replaces* the shaded body rather than tinting it, keeping a fifth of the
shaded result so the wall highlights and grazing rim still live. Per channel, over the real
optical path:

```glsl
float depthWorld = max(uTankHeight - vLocal.y, 0.0) * uTankLevel;
vec2  travel = normalize(-V.xz + vec2(1e-6, 0.0));
float chord  = clamp(-2.0 * dot(vLocal.xz, travel), 0.0, 2.0 * uTankRadius);
vec3  absorb = exp(-(depthWorld + chord) * vec3(5.5, 3.4, 2.0));
gl_FragColor.rgb = mix(vec3(0.070, 0.092, 0.130) * absorb, gl_FragColor.rgb, 0.18);
```

The **chord** term matters as much as the depth. A fragment on the near wall has the whole
width of the column behind it, and light reaching the eye crosses that too — up to the full
0.169-unit diameter at the axis, nothing at the silhouette. It is why the reference's water
is already blue just under the surface, and darker through the middle than near the glass.
Omitting it left the shallow water reading as almost clear.

Depth is **real depth, not fractional depth**. `vLocal.y` spans the full interior and the
mesh is scaled by the level, so the previous form made a tank a tenth full exactly as dark
at its floor as a full one.

### 2.4 The white was a doubled, untinted specular

At opacity 0.86 the jet body is nearly opaque, and `DoubleSide` with `depthWrite: false`
lets the front and back face of the same shape each lay down a broad `clearcoat` lobe plus
a `specularIntensity` one, neither tinted by the body colour. Two stacked achromatic sheets
over a nearly opaque base is white, whatever is underneath. Cut to `clearcoat 0.08` and
`specularIntensity 0.18`, with `envMapIntensity` returned to the 0.45 it was originally
authored at — the argument for holding 1.0 was that the appearance at 1.0 had been
validated, and Stage D's measurements retire that: it is the appearance that renders the
splash at saturation 0.006.

## 3. The free surface

The cylinder's **top cap is the free surface**, and its object normal is the only one
pointing up, which separates it from wall and floor without knowing the geometry's group
order. The band is a reflection of the room, so it is built as one: ripple the surface
normal, then take Fresnel against the rippled normal. A flat sheet at these angles returns
about 5%; a rippled one swings roughly 2.4% to 12%, and that *variation* is what reads as
water rather than as a painted line.

Ripple speed follows the valve (it runs on the jet's own clock, `t * (0.6 + valveOpening *
1.6)`) and amplitude follows inflow. Both are existing simulation state, read never written.

**The ripple uses the jet's ripple map, not a sum of sines.** Three sine trains at fixed
frequencies beat against each other into a regular dot lattice, plainly visible once the
tank drained far enough to be seen from above — a tiled normal map in all but name. The
texture is tileable and aperiodic at these scales, and reusing it keeps the standing water
and the falling water made of the same material.

The reflection is bright but must not also make the water opaque. Seen along the surface —
the drained tank is viewed from about 14° above it — Fresnel alone reaches 0.27, so the mix
saturates its ceiling across the whole cap and the alpha it used to add turned that into a
white lid you could not see into. The colour still saturates there, which is correct (water
at grazing incidence is a bright sheet), but a deeper ripple keeps variation inside it and
the opacity gain is now small enough that the body stays visible through the surface.

## 4. Result

| cue | shipped | Stage D | reference |
|---|---|---|---|
| free-surface rebound | +0 | **+35.5**, 22-row band, ±6.6 texture | +46.0, ±4 |
| depth: saturation shallow → deep | 0.202 → 0.176 (**falls**) | **0.060 → 0.364 (rises)** | 0.204 → 0.331 |
| deep water | 105.7 lum / 0.176 sat | **77.3 / 0.364** | 76.0 / 0.331 |
| splash vs its surround | +12.4 brighter, sat 0.042 | **−21.0 darker, sat 0.207** | −14.8 darker, sat 0.335 |
| block artifact | present | **absent** | n/a |

## 5. Cost

| | Stage C release | Stage D |
|---|---|---|
| draw calls, idle | 417 | **417** |
| triangles, idle | 120,602 | **120,602** |
| shader programs | 42 | **40** |
| frame time p50 | ~8.30 ms | **8 ms** (p95 10, 120 fps) |
| draw calls, water views | 198 | **119** |
| triangles, water views | 73,848 | **42,420** |

Nothing was added. Removing transmission removed a whole scene re-render from every frame
with water on screen, and two shader programs with it.

## 6. Behaviour, read from the live scene

The capture harness now records the tank mesh's y scale per view, which *is* the fill level
— a capture that looks right because the tank happens to be full is not the same as one
where the tank filled when it was supposed to.

| view | level | expected |
|---|---|---|
| W1 low flow | 0.0001, hidden | empty — the recording's tank is empty through ten seconds at the lower setpoint |
| W2 impact | 0.0001, hidden | empty |
| W3 high flow | 0.4167 | filling |
| W4 partial | 0.6250 | part filled |
| W5 / W6 / W7 | 0.9000 | `FULL_LEVEL` |
| W8 draining | 0.2333 | falling, volumetric valve open |

1002 unit tests pass, including all 58 water-physics tests; 17 E2E pass, 16 skipped
(FULL_MODEL-gated, none water-related); typecheck clean.

## 7. Remaining limitations

* **The scene behind the tank is brighter than the recording's** (151/187/122 against the
  recording's darker wall), so absolute composite luminance is not comparable between them
  and was not tuned to. The depth *trend*, the surface *contrast* and the water-versus-
  surround *relationship* are what were matched.
* **The surface rebound is +35.5 against the reference's +46.** The stronger setting turned
  the drained tank's surface into a white lid at grazing incidence; this is the value that
  holds at every fill level in the set.
* **Shallow water is paler than the reference's** — saturation 0.060 against 0.204 just
  under the surface, largely the background difference above.
* **Still no true refraction**, by choice as much as by constraint: the renderer limitation
  from Stage C is unchanged, and the reference's water does not refract either.
* The jet and the impact/splash **share one material**, so they cannot be tuned apart
  through material parameters. Every change above therefore applies to both.
