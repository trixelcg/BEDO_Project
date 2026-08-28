# 47 — Glass optical response (Stage C-safe)

A **renderer-limited safe glass checkpoint, not fully physically transmissive glass.** The
tank reads better than it did and no longer reads blue, but it does not refract, it has no
visible wall thickness, and its front and rear walls are still not properly distinct. Those
need transmission, and transmission is not usable in this renderer — §3 says why.

`public/Bedo_baked_v2.glb` stays frozen at
`f1836e3b0af22f9090df2136899b69e77e455b7dd19d9b3aa3ccf2f6cf24d6f4` (11,948,588 bytes). No
vertices moved, no re-export, no asset regeneration. Stage A.1 lighting, Stage B.1 materials
and the water are untouched.

## 1. The original mechanism, and why it failed visually

`Galss_Material` — the cylinder `JET_Force_2_205` and the base ring `Line010` — is the only
glass in the model authored with **no material extensions at all**. No
`KHR_materials_transmission`, no `KHR_materials_ior`, and no `KHR_materials_specular` either,
so unlike most of Stage B it inherits no bad specular value to correct.

What it inherits is a *type*. With no transmission extension the loader builds a
`MeshStandardMaterial`, whose only route to transparency is `opacity` — and the GLB sets
base-colour alpha to **0.10** with a base colour of **[0.499, 0.652, 0.801]**, a blue filter.

That single fact explains every missing cue. **Alpha blending multiplies the whole shaded
result — the environment reflection included — by the opacity.** A glass whose Fresnel term
arrives at a tenth of its strength cannot have a rim highlight, cannot brighten at grazing
incidence and cannot read as curved. All it can do is tint what is behind it.

Measured by rendering the same frame twice, once with the tank and once with it hidden, so
the glass's own contribution is isolated from the background:

| | shipped glass |
|---|---|
| rim gain | **−14.9** luminance |
| face-on | **−15.2** luminance |
| rim minus face | **0.2** — no curvature cue at all |
| rim band | 0 px |

It subtracts about 15 luminance uniformly across the vessel and adds nothing anywhere. The
reference, profiled across its own tank, shows a narrow rim spike to **188** against a local
surround near 109.

### The geometry is not the problem

Rays cast horizontally through the tank cross **four** surfaces — front-outer, front-inner,
rear-inner, rear-outer — at every height and off-axis. A genuine walled tube:

| | |
|---|---|
| wall thickness | 0.00815 world units, both walls |
| outer diameter | 0.32588 |
| interior span | 0.30958 |
| height | 0.5703 |
| wall / diameter | 2.50% |

Thickness, front/rear distinction and a visible glass edge are all physically available. The
limitation is the material path, not the mesh.

## 2. Native transmission — what it fixes, and the artifact

Rebuilding the tank as the `MeshPhysicalMaterial` it would have been with the transmission
extension written works, and works well: rim gain **−14.9 → +12.7**, face-on veil
**−15.2 → +4.0**, rim band **0 → 11 px**, readability improved, water still visible through
the vessel.

It also produces a **black stippled ring where the tank's bottom rim meets the collar**,
visible at working distance, and raises black clipping across every glass-bearing review view
— worst case 0.539% → 1.837% on `4-water-active`, ×5.7 on `6-weights`. Views with no glass in
frame are unchanged, which is what confirms the cause.

### Diagnosis

Six reversible diagnostics, each changing one thing:

| test | result | rules in / out |
|---|---|---|
| hide neighbouring opaque geometry | **clean** | needs something opaque behind the glass |
| clone the same tank into empty space | **clean** | not the tank's geometry, and **not its rim** |
| `transmissionResolutionScale` 0.5 | much worse, blockier | **scales with the transmission buffer** |
| device pixel ratio 2 | finer, still present | same — a resolution-dependent resolve |
| shadows off for the tank only | unchanged | not shadow-related |
| camera near / far | present at both | not a single-distance coincidence |
| polygonOffset −1/−4, FrontSide, renderOrder, thickness 0–0.05, depthWrite | reduced at best | **not z-fighting, not sorting, not depth** |
| transmission = 0 | **the only clean setting** | the artifact requires transmission |

**Classification: renderer / transmission implementation, triggered by adjacent opaque
geometry.** The fragment samples the transmission render target at a UV displaced by
refraction; near the tank's base that displacement crosses a high-contrast silhouette in a
limited-resolution, MSAA-resolved buffer, and the quantisation of that boundary is the
stipple. The geometry supplies the edge; the resolve turns it into black dashes.

Moving the tank rim would **not** have fixed it — the clone test disproves that hypothesis
directly. The trigger is any opaque silhouette close behind the glass, and the collar would
still be there. The same black edge also appears on the translucent hose, which was already
transmissive in production and merely too faint to show it.

## 3. Feasibility — every native route, and why each is closed

### Native controls

three r184 exposes exactly **one** public control over the transmission pass,
`renderer.transmissionResolutionScale`. Everything else is fixed where the target is
constructed — MSAA at `max(4, capabilities.samples)`, `resolveDepthBuffer: false`,
half-float, mipmapped, working colour space — and tone mapping is forced off for its
duration, so none of the interactions worth suspecting are configurable.

**There is no per-object exclusion hook.** The pass calls
`renderObjects(opaqueObjects, scene, camera)` with no filter, so the collar cannot be kept
out of the buffer the glass samples without hiding it per frame around the render call —
a custom rendering architecture, out of scope.

### Device pixel ratio

The app renders at `window.devicePixelRatio`, which on an ordinary external desktop monitor
is **1.0** — the worst case, not the best.

| DPR | near-black, rim crop | above the scene floor | visible? |
|---|---|---|---|
| 1.0 (production default) | 8.94% | +8.39 pp | yes, heavy |
| 1.25 | 6.71% | +6.16 pp | yes |
| 1.5 | 5.31% | +4.76 pp | yes |
| 2.0 (Retina) | 3.91% | +3.36 pp | yes, thinner |
| **C-safe, any ratio** | **0.55%** | **0.00 pp** | **no artifact** |

Not "measurable but invisible". At every supported ratio the tank base still carries a broken
black outline.

Raising the transmission buffer instead of the display buffer behaves the same way — near-black
pixels fall 4.27% → 3.06% → 2.48% → 1.99% at scales 1.0, 1.5, 2.0 and 3.0, approaching a floor
rather than zero, at a cost rising with the square of the scale.

### drei `MeshTransmissionMaterial`

Inspected before testing. It is **not** a wrapper: it allocates its own FBO and runs a full
`gl.render(scene, camera)` every frame, then samples that instead of three's target. So the
acquisition path is genuinely different — but two things decide it.

* **Its buffer still contains the trigger.** drei renders the whole scene minus the parent
  mesh, a *superset* of three's opaque-only buffer. The collar silhouette is in both, and its
  shader performs the same refracted-UV screen-space lookup.
* **The extra pass was measured, not assumed:** an additional full scene render in this scene
  costs **+3.60 ms p50, +43%** — 8.4 ms to 12.0 ms — with p95 +6.8 ms. A walled tube would
  also want its `backside` buffer, making that two.

It fails both halves of the rejection rule, so it was not adopted.

## 4. Stage C-safe — the shipped values

Two values change on one material. Alpha is left **exactly as authored**.

| property | production | **C-safe** |
|---|---|---|
| type | MeshStandardMaterial | **MeshStandardMaterial** |
| color | `#bbd3e7` (blue) | **`#ffffff`** |
| envMapIntensity | 1.0 | **2.0** (`GLASS_ENV`) |
| opacity | 0.10 | **0.10** — as authored |
| metalness | 0 | **0** |
| roughness | 0.02 | **0.02** |
| side | DoubleSide | **DoubleSide** |
| depthWrite | false | **false** |
| transmission | none | **none** |

`GLASS_ENV` is `APPARATUS_ENV`: the probe photographs the room flat-lit at unity, so it holds
the room's albedo rather than its radiance, and every unbaked surface already receives 2.0 to
compensate. The shortfall is largest exactly where reflection matters most, so glass had the
weakest case for the exception it was given.

### What improves

| cue | production | C-safe |
|---|---|---|
| rim gain | −3.1 | **+0.8** |
| rim band | 0 px | **12 px** |
| readability through the vessel | 74% | **82%** |
| face-on | −15.2 dark veil | +8.8 light lift |
| colour | blue filter | **neutral** |

## 5. Remaining realism limitations

Stated plainly, because this checkpoint is not the reference's glass:

* **No true refraction.** Nothing behind the vessel is displaced by it.
* **No visible wall thickness**, despite the geometry having 2.5% walls.
* **Front and rear walls are still not properly distinct.**
* **The rim is roughly a fifteenth of the strength transmission reaches** — the reflection is
  still multiplied by the authored 0.10 opacity.
* **Face-on it still behaves like a tinted sheet**, now a neutral one that lifts slightly
  rather than a blue one that darkened.

These are blocked by the renderer, not by the asset or by this material. Revisiting them means
either a future three.js whose transmission resolve handles adjacent silhouettes, or an
explicitly approved custom rendering task.
