# 05 — Rendering Report

Covers the scene graph, lighting, materials, shadows, camera, controls, the water shader, and visual fidelity
against the real apparatus. Performance consequences of these choices are quantified in
`04_PERFORMANCE_REPORT.md`; this document is about **what it looks like and why**.

---

## Index

| ID | Title | Severity | Difficulty | Priority |
|---|---|---|---|---|
| RND‑01 | Double lighting: real‑time lights on top of a baked lightmap | **Critical** | Easy | P0 |
| RND‑02 | The tank cover is force‑converted to 98 % transmissive glass | **Critical** | Trivial | P0 |
| RND‑03 | All 68 GLB materials are `doubleSided` | High | Easy | P1 |
| RND‑04 | 19 materials are `alphaMode: BLEND` without needing it | High | Easy | P1 |
| RND‑05 | The highlight glow repaints parts solid blue | High | Easy | P1 |
| RND‑06 | The glass tank is effectively invisible | High | Moderate | P1 |
| RND‑07 | Shadow camera frustum is ±2 for a room‑sized scene | High | Trivial | P1 |
| RND‑08 | `castShadow`/`receiveShadow` forced on all 157 meshes | High | Trivial | P1 |
| RND‑09 | Water shader: world‑space planar sampling, hidden ripple, frosted look | High | Moderate | P1 |
| RND‑10 | No tone‑mapping or colour‑space policy is stated | Medium | Easy | P1 |
| RND‑11 | Camera fly‑to framing is too close and loses spatial context | High | Moderate | P1 |
| RND‑12 | `OrbitControls` has no pan/zoom bounds for the lab interior | Medium | Easy | P2 |
| RND‑13 | Camera flights ping‑pong under the bench four times in five steps | High | Easy | P1 |
| RND‑14 | The camera ignores the 380 px sidebar occluding the viewport | Medium | Easy | P2 |
| RND‑15 | The guide arrow floats off‑target and overlaps geometry | Medium | Easy | P2 |
| RND‑16 | Two decorative orange fill lights fight the environment | Medium | Trivial | P2 |
| RND‑17 | No post‑processing, no AO, no anti‑banding — flat plastic look | Medium | Moderate | P2 |
| RND‑18 | `ContactShadows` blob under a baked floor | Medium | Trivial | P1 |

---

## Scene graph as built

```
scene
├── background / environment  = rosendal_plains_2_4k.webp (equirect)   [Scene3D:26-41]
├── ambientLight              intensity = selfIllumination*(2-contrast) = 0.15
├── directionalLight  [5, 8, 5]    0.8*contrast   castShadow, 1024², ortho ±2
├── directionalLight  [-5, 5,-5]   0.3*(2-contrast)  #f58220  (decorative)
├── directionalLight  [0, 6,-6]    0.4*contrast      #ff9100  (decorative)
├── ContactShadows    y=-1.81, scale 6, blur 2.4
└── group  pos [0,-1.8,0]  scale 1.8            ← "characterPosition/Scale" (misnamed)
    ├── <primitive object={Bedo_baked_v2.scene}>       159 nodes / 157 meshes / 68 materials
    │    ├── 26 baked room nodes  (walls, floor, desks, window, chart) — 5×4096² textures
    │    ├── ~100 bench / pipework / panel nodes
    │    ├── 7 tray deflectors + 7 installed deflectors
    │    ├── 5 weights, Pointer, deflector_rod, deflector_spring, Tank_cover, Screws,
    │    │   Valve, hydrolic bensh 1_087, Power_Switch, Diagram_Green_light_off
    │    └── ✚ runtime-injected pivot Groups: Valve__pivot, 1_087__pivot,
    │          Power_Switch__pivot, Pointer__pivot, deflector_spring__pivot
    ├── group weightStackRef        → cloned weight discs (currently ~2.2 m off, BUG-02)
    ├── group waterGroupRef         → 8 plume GLBs, one visible at a time
    ├── group arrowGroupRef         → cylinder + cone, emissive, toneMapped={false}
    └── 15 × invisible sphere hotspots (r 0.022 – 0.18)
```

Note the group's props are named `characterPosition` / `characterRotation` / `characterScale` — vestigial
naming from the TTS‑avatar project this repo was forked from (`ARCH‑14`, `CQ‑05`).

---

### RND‑01 — Double lighting

**Severity:** Critical **Difficulty:** Easy **Priority:** P0

**Description.** Every screenshot shows the same problem: a flat, washed‑out, low‑contrast scene where white
surfaces blow out, dark cavities crush to black, and nothing reads as metal. The bench top, the sump and the
walls are all the same milky white.

**Root cause.** The lighting is applied **twice**. The GLB contains
`MergedBake_SM_D_Wood01_PBR_Lightmap` — a 4096² baked lightmap covering the entire room, meaning the model
already carries its final lighting. On top of that `Scene3D` adds:
- `ambientLight` at `selfIllumination * (2.0 - contrast)`
- three `directionalLight`s (0.8, 0.3, 0.4 × contrast)
- a full equirectangular environment at `environmentIntensity = 1.0` **and**
  `backgroundIntensity = 1.0`
- per‑material `envMapIntensity = reflection` (1.0) applied to **all** materials, including the baked room

Total added illumination on an already fully lit model. The `contrast` slider then couples two lights in
opposite directions (`0.8 * contrast` up, `0.3 * (2 - contrast)` down), which is not a contrast control — it is
a colour‑temperature crossfade with a misleading name.

**Affected files.** `src/components/Scene3D.tsx:22‑44, 199‑222`, `src/components/DeviceModel.tsx:185`,
`public/Bedo_baked_v2.glb`.

**Recommended solution.** Commit to one model. Given the bake exists and is good:
1. Keep the lightmap as the diffuse ground truth. Assign it to `material.lightMap` if the exporter did not
   (currently it is baked into base colour, which also means it cannot be tuned).
2. Environment map for **specular/reflection only** — `scene.environment` with a low
   `envMapIntensity` (~0.3) on metals, ~0 on the baked room.
3. **One** key light, tightly framed on the apparatus, for the moving parts that the bake cannot cover.
4. Delete `ambientLight` and both decorative fills.
5. Replace `contrast` with a real tone‑mapping/exposure control (`RND‑10`).

The alternative — go fully dynamic and drop the bake — is more expensive and would waste 426 MB of baked
texture. Do not do that.

---

### RND‑02 — The tank cover is force‑converted to 98 % transmissive glass

**Severity:** Critical **Difficulty:** Trivial **Priority:** P0

**Description.** On the real VL‑FM009 the "upper plate" is an **opaque metal plate** bolted down with three
screws. In this build it renders as a floating blue‑tinted glass disc, visually detached from the tank
(clearly wrong in the step‑3 screenshot, where the plate, spring, rod and screws hang against the sky with
nothing connecting them).

**Root cause.** `DeviceModel.tsx:187‑203` unconditionally replaces `Tank_cover`'s authored material:
```ts
new THREE.MeshPhysicalMaterial({
  color: '#ffffff', transparent: true, opacity: 1.0,
  transmission: 0.98, ior: glassIor /*1.52*/, thickness: 1.5,
  clearcoat: 1.0, specularIntensity: glassSpecular, depthWrite: false,
})
```
This is a **glass** material applied to a metal part. `depthWrite: false` compounds it — the plate no longer
occludes anything behind it, which is why the assembly reads as disconnected. And the GLB already ships a
`plate_uv` 2048² texture for this part, which is discarded.

**Affected files.** `src/components/DeviceModel.tsx:174‑207`, `src/lib/apparatus.ts:29`.

**Recommended solution.** Delete the override; use the authored material. If the intent was for the student to
see inside the tank, apply the glass treatment to `JET Force 2_205` (the actual tank) instead — see `RND‑06`.
This one change removes a full transmission pass (`PERF‑03`) **and** fixes the fidelity problem.

---

### RND‑03 — All 68 materials are `doubleSided`

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** Parsed from the binary: **68 of 68 materials** have `doubleSided: true`. Backface culling is
therefore disabled for the entire scene.

**Consequences.** (a) Roughly double the fragment work on every one of the ~4.5 scene passes per frame
(`PERF‑02`); (b) interior faces of pipes, the tank and the sump are shaded with flipped normals, producing the
odd dark bands visible inside the tank and around the bench cabinet; (c) transparent double‑sided surfaces make
the sorting problem in `RND‑04`/`BUG‑31` unsolvable.

**Root cause.** A Blender export default — "Backface Culling" left unchecked on every material.

**Recommended solution.** Audit in `gltf-transform`; set `doubleSided: false` on everything except genuinely
single‑surface geometry (thin sheet metal, the water plumes). Fix any inverted normals this exposes rather than
papering over them.

---

### RND‑04 — 19 materials use `alphaMode: BLEND` unnecessarily

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** 19 of 68 materials are `BLEND` (the other 49 are `OPAQUE`), including `MergedBake_Baked.002` (the room background),
`base.001`, `Pitot1`, `09 - Default`, `Material #27565`, `10 - Default.001`, `14 - Default.002` and the seven
deflector‑label materials (`30.001`, `45.001`, `60.001`, `120.001`, `135.001`, `180.001`, `0.001`).

Blended materials are excluded from the opaque pass, sorted per‑object by centroid, do not write depth by
default in many pipelines, and cannot be batched. Combined with `doubleSided` (`RND‑03`) this produces the
sorting artefacts documented in `BUG‑31`.

**Root cause.** Blender assigns `BLEND` whenever a base‑colour texture has an alpha channel, even a fully
opaque one. `MergedBake_SM_D_Wood01_PBR_Diffuse-..._A` is exactly that — an alpha companion sheet.

**Recommended solution.** For each `BLEND` material, check whether the alpha channel actually varies. If not,
switch to `OPAQUE` and drop the alpha texture. Use `MASK` with `alphaCutoff` for the label decals. Reserve
`BLEND` for the tank glass and the water.

---

### RND‑05 — The highlight glow repaints parts solid blue

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** In every step, the interactive part turns into a **flat blue slab**. Verified: the volumetric
valve handle renders as a purple‑blue wedge (it is a red lever on the real rig); the flow valve as a cyan‑blue
gradient blade; the power switch as a plain blue disc; and at step 2 **all seven** deflectors glow blue at
once. The parts' actual materials, textures and shapes become unreadable — which matters, because step 2 asks
the student to *identify* a deflector by its shape and label.

**Root cause.** `DeviceModel.tsx:807‑824` sets `mat.emissive = '#1e7fd6'` with
`emissiveIntensity` pulsing 0.14→0.38 (0.7 on hover) on a cloned material. Emissive is **added on top of**
shaded colour, so on a small, mid‑grey part it dominates completely. It is applied to the whole subtree, every
frame, with no rim/outline restraint. The blue is also off‑brand (the palette is orange, `BUG‑11`).

**Affected files.** `src/components/DeviceModel.tsx:800‑837, 856‑877`.

**Recommended solution.** Replace with a **silhouette outline** — the standard technique the reference simulator
uses (HighlightPlus in Unity). Either an inverted‑hull outline pass, a stencil‑based outline, or `drei`'s
`<Outlines>`. It reads as "click me" without destroying the part's appearance. Pulse the outline width/opacity,
not the surface colour, and use the brand orange. Highlight **one** part at a time (`BUG‑05`).

---

### RND‑06 — The glass tank is effectively invisible

**Severity:** High **Difficulty:** Moderate **Priority:** P1

**Description.** In the default framing the tank cannot be seen at all — the cover plate, spring, rod and
pointer appear to float in mid‑air above the bench with nothing containing them. Only at close range and a
particular angle does a faint cylinder outline become visible.

**Root cause.** `JET Force 2_205` (measured: 0.181 × 0.317 × 0.179, y 1.058→1.375) uses `Galss_Material` —
`alphaMode: BLEND`, `roughness 0.3`, **no** base texture, no transmission, no thickness, no clearcoat. A plain
blended surface with almost no Fresnel produces almost no visible edge. Meanwhile the *cover* got the full
glass treatment it should have had (`RND‑02`), and the oversized water column (`BUG‑03`) hides what little
tank profile remains.

**Affected files.** `public/Bedo_baked_v2.glb` (`Galss_Material`, material 22),
`src/components/DeviceModel.tsx:187‑203`, `src/lib/apparatus.ts:41`.

**Recommended solution.** Move the glass material to the tank: moderate `transmission` (0.9), `ior 1.52`,
`thickness` matched to the wall, `roughness 0.02`, strong `clearcoat`, and — critically — **visible edges**
(rim lighting or a subtle edge darkening) so the cylinder reads as a physical object. Cap it at **one**
transmissive material in the scene (`PERF‑03`).

---

### RND‑07 — Shadow frustum is ±2 for a room‑sized scene

**Severity:** High **Difficulty:** Trivial **Priority:** P1

**Description.** `Scene3D.tsx:210‑213` sets the shadow camera to `left/right/top/bottom = ∓2/±2`, on a group
scaled 1.8 containing an entire lab room. Anything outside a 4×4 world‑unit box neither casts nor receives
correctly, and within it a 1024² map spread over 4 units gives ~256 texel/unit — coarse for the 3 cm screws and
6 mm weight discs the student is meant to see.

**Recommended solution.** Restrict shadow casting to the apparatus (`RND‑08`), then tighten the frustum to a
~1 unit box around the bench. 1024² then gives ~1000 texel/unit, which is ample. `shadow-bias -0.0001` should
be re‑tuned after, and `shadow-normalBias` added.

---

### RND‑08 — `castShadow`/`receiveShadow` forced on all 157 meshes

**Severity:** High **Difficulty:** Trivial **Priority:** P1

**Description.** `DeviceModel.tsx:183‑184` sets both flags on every mesh in the traversal, including the walls,
floor, ceiling, desks, window frame and wall chart — all of which are baked. This is the single largest
contributor to the shadow pass's ~181 draws (`PERF‑02`) and it double‑darkens surfaces that already have baked
shadows.

**Recommended solution.** Drive both flags from a small explicit list of dynamic parts (cover, screws, rod,
spring, pointer, installed deflector, tray deflectors, weights). Everything else: `castShadow = false`.

---

### RND‑09 — Water shader: hidden ripple, frosted look, world‑space sampling

**Severity:** High **Difficulty:** Moderate **Priority:** P1

**Description.** The jet renders as an opaque frosted white‑blue cylinder with visible horizontal banding. It
does not read as water, does not respond visibly to flow rate (`BUG‑21`), and hides the deflector (`BUG‑03`).

The shader itself (`DeviceModel.tsx:228‑386`) is genuinely well‑crafted — a runtime‑generated tileable
fractal normal/height map, dual‑scroll UV animation, Fresnel rim, glint and foam terms. Several specific
choices defeat it:

1. **Non‑uniform scale destroys the effect.** The plume group is scaled
   `(scaleXZ, scaleY, scaleXZ)` with wildly different values — measured, roughly `0.9 × 0.05 × 0.9` for a
   `0.181 × 0.18` jet against a mesh authored ~20 units tall. The vertex ripple
   `transformed.x += sin(position.y * 0.9 + uTime*5.0) * 0.16 * rise` is applied in **object space before**
   that scale, so a 0.16‑unit displacement becomes ~0.14 in X and ~0.008 in Y — the ripple is squashed into
   invisibility. `vWNorm = normalize(mat3(modelMatrix) * objectNormal)` is also wrong under non‑uniform scale
   (it needs the inverse‑transpose), so the Fresnel rim is skewed.
2. **World‑space planar sampling on a scaled object — and it is unnecessary.** `vWPos.xz * 6.0` and
   `vWPos.y * 2.0` sample in world space. The code comment justifies this with *"these baked simulation meshes
   carry no usable UVs"* — but **that is not true**. Verified against the binaries: every one of the eight plume
   GLBs carries `TEXCOORD_0`, and three (`Water90_Flat`, `Water180_HemiSphere`, `Water45_Oblique`) carry
   `TEXCOORD_1` as well. The UVs sit roughly in 0..1 with V progressing **along the flow** — `Water_low`'s three
   primitives occupy `v[-0.02..0.20]`, `v[0.20..0.24]`, `v[0.24..0.74]`, a continuous run down the stream, which
   is exactly the layout a flow‑aligned scroll wants. Meanwhile the world‑space fallback, on a 0.18 m tall
   object, spans only ~1.6 UV units over the whole jet — one and a bit repeats stretched over the entire
   column, which is precisely the horizontal banding seen in the screenshots.
3. **`transmission: 0.3` + `emissive #0d4a86` + `opacity 0.8` + `clearcoat 1.0`** with `depthWrite: false` and
   `DoubleSide` — the code's own comment explains it was tuned "so the water reads as a luminous blue column"
   against a dark tank. It reads as frosted plastic.
4. **`shader.uniforms.uTime = waterTime.current`** shares one uniform object across all plume materials — fine
   here, but it means the uniform is mutated outside React and never reset.

**Affected files.** `src/components/DeviceModel.tsx:219‑399, 409‑450, 1018‑1075`.

**Recommended solution.** Author the plumes at the correct physical size in Blender with **real UVs** (flow‑
aligned V), so no runtime scaling or world‑space fallback is needed. Then:
- Sample by UV, with V scrolling along the flow direction.
- Displace in world space, or pre‑compensate for the object scale.
- Use `inverse-transpose(modelMatrix)` for the normal.
- Reduce opacity to ~0.35–0.5, drop `transmission` to 0, keep the clearcoat/Fresnel rim, and add a **separate
  additive spray/mist mesh** at the impact point whose density tracks flow rate.
- Keep `depthWrite: true` on the jet body (`BUG‑31`).

---

### RND‑10 — No stated tone‑mapping or colour policy

**Severity:** Medium **Difficulty:** Easy **Priority:** P1

**Description.** `toneMapping` is never set, so R3F's default (`ACESFilmicToneMapping`) applies —
but only `toneMappingExposure` is exposed, via a slider labelled "Exposure (Tone Mapping)". The guide arrow
opts out entirely with `toneMapped={false}` (`DeviceModel.tsx:1152, 1161`), which is why it is the only
saturated object on screen. The environment texture is explicitly set to `SRGBColorSpace`
(`Scene3D.tsx:29`) — correct for a WebP LDR image, but it means the "HDR" environment has no dynamic range
above 1.0, so `environmentIntensity` and `backgroundIntensity` at 1.0 flatten the specular response. There is
no `outputColorSpace` statement and no dithering, so the large flat gradients (the sky, the white bench) band
visibly.

**Recommended solution.** State the policy explicitly: ACES + a fixed exposure chosen once, `SRGBColorSpace`
output, and a real HDR (`.hdr`/`.exr` → `RGBE`) environment if specular range matters — or accept LDR and drop
`environmentIntensity` to ~0.3. Add dithering/noise to kill the banding.

---

### RND‑11 — Camera fly‑to framing is too close and loses context

**Severity:** High **Difficulty:** Moderate **Priority:** P1

**Description.** Every step transition throws the camera to a tight close‑up of one part, with the rest of the
apparatus out of frame. Verified across all twelve steps:

| Step | Target | What the student actually sees |
|---|---|---|
| 2 | `tray` | The deflector tray at a steep tilt, filling the screen; no tank, no bench, no reference |
| 3 | `cover` | Plate + spring + rod against the **sky**, apparently floating; no tank |
| 4 | `power` | The control panel filling the frame; the tank is gone |
| 5 | `volumetricValve` | Camera **inside the bench cabinet**, near plane clipping the cabinet panel |
| 6, 8 | `flowValve` | Same — inside the cabinet, looking at the sump floor |
| 7, 9 | `weights` | Tank + tray, but the pointer (the thing being balanced) is behind the sidebar |

**Root cause.** `ANCHOR_VIEW` (`apparatus.ts:275‑287`) stores a single position offset per anchor with no
framing intent — no target field of view, no "keep the tank in shot" constraint, no collision avoidance against
the bench geometry, and no consideration of the occluding sidebar (`RND‑14`). Computed: the `cover` view sits
1.19 m from a 0.27 m‑wide plate, so the subject fills ~30 % of frame height with nothing else identifiable
around it.

**Affected files.** `src/lib/apparatus.ts:244‑287`, `src/components/Scene3D.tsx:61‑155`.

**Recommended solution.** Frame by **bounding sphere plus context**: compute a distance that fits
`union(targetBounds, contextBounds)` in the *unoccluded* portion of the viewport. Always keep at least one
landmark (the tank, or the bench edge) in shot. Push valve views **outside** the cabinet looking in, not inside
it. Add a near‑plane/collision check so the camera never enters solid geometry.

---

### RND‑12 — `OrbitControls` bounds are wrong for an interior

**Severity:** Medium **Difficulty:** Easy **Priority:** P2

**Description.** `Scene3D.tsx:260‑268`: `minDistance 0.6`, `maxDistance 8`, `maxPolarAngle π/2 + 0.25`,
`target [0, -0.1, -0.2]`, panning unrestricted. At `maxDistance 8` in a room the student orbits **outside the
walls** and looks at the back faces of the lab (visible because everything is `doubleSided`, `RND‑03`). At
`minDistance 0.6` they can push the camera through the bench. There is no `minPolarAngle`, no
`enablePan={false}` or pan bounds, and no damping‑aware return to a home view.

**Recommended solution.** Constrain to the operator's working volume: `minDistance ~0.8`, `maxDistance ~3`,
polar `[0.15π, 0.55π]`, azimuth limited to the front 180° (the rig faces −X per `apparatus.ts:269`), pan
disabled or clamped to a small box. Add a "reset view" control.

---

### RND‑13 — Camera flights ping‑pong under the bench

**Severity:** High **Difficulty:** Easy **Priority:** P1

**Description.** The guided sequence orders targets: `overview → tray → cover → power → volumetricValve →
flowValve → weights → flowValve → weights → overview`. Steps 5–9 therefore fly **down under the bench, up to
the tank, back under the bench, back up to the tank** — four 1.25 s traversals of the full rig in five steps.
It is disorienting and, for some users, nauseating.

**Recommended solution.** Reorder or group: one "under‑bench controls" view that covers both valves, one
"tank and balance" view that covers the pointer and weights. Prefer a gentle dolly within a shared view over a
full re‑framing between adjacent steps. Add a user preference to disable camera automation entirely (also an
accessibility requirement — `UX‑12`).

---

### RND‑14 — The camera ignores the sidebar occlusion

**Severity:** Medium **Difficulty:** Easy **Priority:** P2

**Description.** A 380 px opaque sidebar (plus 24 px margin) covers the left ~28 % of a 1440 px viewport, and
~46 % at 820 px. The camera centres its subject in the **full** viewport, so at step 7/9 the pointer being
balanced sits behind the panel.

**Recommended solution.** Offset the projection (or the look‑at target) by half the occluded width, or use an
off‑centre `camera.setViewOffset`. Alternatively let the sidebar collapse during 3D‑focused steps.

---

### RND‑15 — The guide arrow floats off‑target

**Severity:** Medium **Difficulty:** Easy **Priority:** P2

**Description.** Verified in screenshots: at step 4 the arrow hovers over the bench edge, well left of the power
switch; at steps 5/6 it floats above the pipe rather than at the valve handle; at step 2 it overlaps a
deflector; at step 7 it points into the tank wall.

**Root cause.** A single `DEFAULT_ARROW_OFFSET = [0, 0.09, 0]` (`apparatus.ts:255`) with two hand‑tuned
exceptions (`:281‑282`). The offset is applied to the **anchor** — which for multi‑mesh anchors like `weights`
is the centroid of a group spanning 0.29 × 0.38 × 0.18 — not to the specific part being pointed at. The arrow is
also drawn with `toneMapped={false}` and emissive 1.4, so it is the brightest object in every frame.

**Recommended solution.** Anchor the arrow to the *clickable part's* bounding box top, in view space, with an
occlusion check so it never sits behind geometry. Better still: replace the world‑space arrow with a screen‑space
callout (a `<Html>` badge with a leader line) that is always legible and never intersects the model.

---

### RND‑16 — Two decorative orange fill lights

**Severity:** Medium **Difficulty:** Trivial **Priority:** P2

**Description.** `Scene3D.tsx:215‑220` adds a `#f58220` light from `[-5, 5, -5]` and a `#ff9100` light from
`[0, 6, -6]`. They tint the white bench and the walls warm orange for brand reasons, on a model that is already
lit by a neutral bake. They contribute nothing physically and add per‑fragment cost on every material.

**Recommended solution.** Remove. Express brand through UI chrome, not by mis‑lighting the apparatus.

---

### RND‑17 — No post‑processing, no AO, visible banding

**Severity:** Medium **Difficulty:** Moderate **Priority:** P2

**Description.** `@react-three/postprocessing` is installed but never imported (`TD‑02`). There is no SSAO/GTAO,
no bloom on the power lamp, no colour grading, and no dithering. Combined with `RND‑01`, contact areas (the
weights on the tray, the bench legs on the floor) have no grounding, and the sky/bench gradients band.

**Recommended solution.** After fixing the lighting (`RND‑01`), evaluate a **minimal** effect stack: subtle
GTAO + dithering + a light vignette, at reduced resolution, and only on capable devices detected at runtime.
Do not add post‑processing before the draw‑call budget is met (`PERF‑02`).

---

### RND‑18 — `ContactShadows` under a baked floor

See `PERF‑10`. A blob shadow rendered every frame beneath a floor that already has baked contact shadows.
Remove.

---

## Visual fidelity gaps vs. the real apparatus

Independent of bugs, these are places where the render does not match what the equipment looks like. They
should be checked against the storyboard and demo video once those are available.

| # | Observed | Expected |
|---|---|---|
| 1 | Cover plate renders as blue glass | Opaque metal plate (`RND‑02`) |
| 2 | Tank invisible | Clear acrylic cylinder with visible walls and rim (`RND‑06`) |
| 3 | Jet fills the tank | Ø 10 mm column with visible spread and impact spray (`BUG‑03`) |
| 4 | Screws float above the plate | Screws back out then rise with the plate (`BUG‑20`) |
| 5 | Weights never appear on the pan | Discs stack visibly on the pan (`BUG‑02`) |
| 6 | Pointer motion imperceptible | Clear, readable deflection against a scale |
| 7 | Litre scales static | Volumetric tank fills while the valve is open (`BUG‑29`) |
| 8 | No sump water; `LIQUID001` is a sliver | Visible water in the sump (`BUG‑28`) |
| 9 | Interactive parts painted blue | Their real colours with an outline highlight (`RND‑05`) |
| 10 | Whole scene washed out | Contrasty, readable, metal reading as metal (`RND‑01`) |
| 11 | Wall chart clipped by the viewport at the default framing | Legible or deliberately out of frame |
| 12 | Flow rate has no visible signature | Jet, sound and pointer all change with `n` (`BUG‑21`) |
