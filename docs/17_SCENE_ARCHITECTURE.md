# 17 — Scene Architecture

**Responsibility:** present simulation state in 3D. Nothing else. No lesson orchestration, no business rules,
no React state writes from the frame loop.

---

## 1. Composition

```
<Stage>                              Canvas · frameloop · dpr · colour · error boundary
 ├─ <Environment/>                   room, lighting rig, environment map
 ├─ <Apparatus>                      one <primitive> + measured refs
 │   ├─ <CoverAssembly/>             cover + screws, unscrew sequence
 │   ├─ <DeflectorMount/>            installed deflector, rides the rod
 │   ├─ <SpringPointer/>             spring compression + pointer swing/height
 │   ├─ <WeightStack/>               loaded discs on the pan
 │   ├─ <ValveGroup/>                flow + volumetric levers
 │   ├─ <PowerPanel/>                switch + indicator lamp
 │   └─ <Rotameter/>                 litre scales (currently decorative)
 ├─ <WaterJet/>                      plume + <ImpactSpray/>
 ├─ <Annotations/>                   screen-space callouts (NOT giant 3D cards)
 ├─ <Affordances/>                   hit proxies from the interaction registry
 ├─ <Highlight/>                     outline pass
 └─ <CameraDirector/>                one controller — see docs/18
```

**One `useFrame` per component**, each animating only what it owns. The current single 272-line frame callback
doing eleven jobs (`CQ‑09`) disappears.

Each component follows the same shape:

```tsx
function CoverAssembly() {
  const refs = useApparatusRefs();                  // resolved ONCE at load
  const runtime = useSimulationRuntime();
  useFrame((_, dt) => {
    const k = runtime.getKinetics();                // volatile values, not props
    refs.cover.position.y = refs.cover.userData.restY + k.coverLift;
    refs.screws.position.y = refs.screws.userData.restY + k.coverLift + k.screwBackOut;
  });
  return null;
}
```

No `getObjectByName` in a frame (`PERF‑06`), no `setState` from a frame (`ARCH‑08`), no accumulated imperative
offsets whose baseline can drift (`ARCH‑04`).

---

## 2. Asset lifecycle

```ts
// assets/loadApparatus.ts
export async function loadApparatus(url: string): Promise<ApparatusRefs>;
```

- Loads the GLB **once**, then `clone()`s into component-owned scene data so the drei cache is never mutated
  (`ARCH‑04`).
- Resolves every `MESH` name through `gltfName()` into a **typed** record and **throws at load** on a miss.
  Today a missing name fails silently at frame 3 000; this makes it a startup error with the exact name.
- No runtime pivot surgery. Pivots and origins are fixed **offline** in the `.blend` — see
  `docs/19 § DCC_ASSET_ACTIONS_REQUIRED`. Until then, a documented runtime shim performs the same job in one
  place with an explicit teardown.
- Every material, texture and geometry the app creates is registered with `assets/disposal.ts` and released on
  unmount (`BUG‑17`, `PERF‑15`).

```ts
// assets/measureApparatus.ts — PURE, unit-testable against a fixture
export function measureApparatus(scene: Object3D): ApparatusMeasurements {
  // → { anchors, bounds, tank: {centre,size}, nozzle: {lip,diameter}, pan, restY }
}
```

---

## 3. Frameloop policy

`frameloop="demand"`. A frame is requested only when something changes.

| Source | Requests frames while |
|---|---|
| Camera transition | flight in progress (`docs/18`) |
| `OrbitControls` damping | velocity above epsilon |
| Unscrew / reseat sequence | sequence active |
| 2 s transfers | any transfer in flight |
| Water | `flowing === true` |
| Tank drain | level > 0 after power-off |
| Spring / pointer | `|target − current| > epsilon` |
| Highlight pulse | an affordance is highlighted **and** the pointer moved in the last 2 s |
| Hover | pointer over the canvas |

Everything registers through one `useInvalidateWhile(active)` helper so the policy is auditable in one place.
Expected: a student reading a step description renders **0 frames/s** instead of 60 (`PERF‑05`).

---

## 4. Lighting and materials

Per `RND‑01`: the GLB already carries a 4096² baked lightmap. The scene currently adds an ambient light, three
directional lights, a full environment at intensity 1.0, and `ContactShadows` on top of it.

**Target rig:**

| Element | Setting |
|---|---|
| Baked lightmap | The diffuse ground truth. Assigned to `material.lightMap` where the exporter allows. |
| Environment map | **Specular only.** `envMapIntensity` ~0.3 on metals, ~0 on the baked room. |
| Key light | **One** directional, `castShadow`, ortho frustum tightened to the bench (~1 unit), 1024². |
| Ambient / fills | **Removed.** The two decorative orange fills go (`RND‑16`). |
| `ContactShadows` | **Removed** — the floor is baked (`RND‑18`). |
| `castShadow` | An explicit list of dynamic parts only, not all 157 meshes (`RND‑08`). |
| Tone mapping | ACES + a fixed exposure chosen once. Output `SRGBColorSpace`. Dithering to kill banding. |
| `contrast` slider | Deleted. It currently cross-fades two lights in opposite directions under a misleading name. |

**Material corrections** (source-side where possible — see `docs/19`):

| Part | Now | Target |
|---|---|---|
| `Tank_cover` | Force-replaced with 98 %-transmissive glass, `depthWrite:false` | **Opaque metal**, using the shipped `plate_uv` texture (`RND‑02`) |
| `JET Force 2_205` (tank) | `Galss_Material`, plain BLEND, invisible | The glass treatment: `transmission` 0.9, `ior` 1.52, thickness, clearcoat, visible rim (`RND‑06`) |
| All 68 materials | `doubleSided: true` | Culling on except genuine single-surface geometry (`RND‑03`) |
| 19 materials | `alphaMode: BLEND` | `OPAQUE` / `MASK` unless alpha actually varies (`RND‑04`) |

**Transmission budget: ≤ 1 material.** Each transmissive material costs a full extra scene render per frame,
and there are currently three (`PERF‑03`).

---

## 5. ★ Coordinate spaces and physical-to-visual mapping

This section exists because both P0 visual defects are coordinate/mapping failures. Per the brief §22:
*never use arbitrary world-space offsets when a coordinate transform can derive the correct value*, and
*never make visual geometry define the simulation truth*.

### 5.1 The four named spaces

| Space | Definition | Used for |
|---|---|---|
| **Mesh-local** | Vertex coordinates inside a `BufferGeometry`, before any node transform. | Reading authored geometry. |
| **Node-local** | A node's TRS *relative to its glTF parent*. This model is *baked*: *every* top-level node — the rod, all five weights, everything — shares the translation `(0, 1.238958, −1.231891)`, the exporter's Z-up → Y-up conversion, while the real geometry lives in vertex coordinates. | Almost nothing. **A node's `position` in this model is not where the object is.** |
| **Apparatus-local** | Inside `<group position={[0,−1.8,0]} scale={1.8}>`. The GLB is a `<primitive>` child of this group with no transform of its own, so apparatus-local and the GLB's own scene space coincide. | All anchors, hotspots, drop regions, measurements. |
| **World** | After the group transform. One model unit is one metre of real apparatus; the 1.8 scale is presentation. | Camera, lights, raycasting. |

**Rules.**

1. A value crossing a boundary is converted, never assumed.
2. **No vector may take one axis from one space and another axis from another.** This is not a style
   preference — it is the exact shape of `BUG‑02` (§5.2), and it is the thing to check first when geometry
   lands somewhere impossible.
3. **Never read `object.position` as "where this is"** in this model. Measure geometry — a `Box3`, or the
   vertices themselves. `position` is the shared export constant above.
4. Prefer keeping placement in apparatus-local for as long as possible and letting the group transform do the
   rest, rather than converting individual objects to world space repeatedly.
5. Presentation code may consume measured geometry; it may never feed measured geometry back into the domain.
   `src/domain` cannot import three.js at all — `tests/unit/domain-boundary.spec.ts` enforces it.

### 5.2 Defect 1 — loaded weights rendered 2.18 m from the pan (`BUG‑02`) — **RESOLVED, BEDO‑016**

Fixed. Full account, measurements and source-asset findings: **`docs/39`**. Kept here because the *shape* of
the mistake is the reason §5.1 rule 2 exists.

**Root cause.** One vector mixed two coordinate spaces:

```ts
offset: [ pan[0] - proto.position.x,                    // node-local translation
          pan[1] + cum + h/2 - centre.y,                // measured bbox centre
          pan[2] - proto.position.z ],                  // node-local translation
```

Because the export is baked, `proto.position` is the *same constant* for every object, so subtracting it did
not move a disc towards the pan — it displaced every disc by `−(0, 1.239, −1.232)` wherever it was. Measured at
HEAD before the fix: **2.196500 world units**, 1.2203 model units, ≈1.22 m of apparatus.

**A second error compounded it.** The pan anchor took `deflector_rod`'s bounding-box **crown** — which is the
tip of the thin retaining post the annular discs slide down, not the plate they rest on. The earlier audit
recorded Y as correct because it compared against that same crown; against the real plate the Y error is a
constant **+0.104421** world units (58 mm of apparatus).

**Authoritative source of truth.** The **pan plate's top face**, found as the widest lamina on `deflector_rod`
and returned in apparatus-local space by `measureHolderAnchor` (`src/lib/holderAnchor.ts`). *Not* the rod's
crown, not the tray, not a node translation, and never inferred from where a weight currently is.

```
deflector_rod geometry → HolderAnchor → Seat[] → slot group → disc, click proxy, removal flight
```

The slot group's origin **is** the seat, the disc is recentred into it and the click proxy sits at the origin,
so the visible disc and its interaction target cannot drift apart.

**Fix location.** Runtime, not DCC. The GLB's pivots are not mis-placed in a way Blender could repair — they
are all identical because the transform was baked, which is valid glTF. A re-export would risk the 33-name
contract in `tests/unit/glb-contract.spec.ts` for no mathematical gain. `docs/39 §6` records the trade-off.

**Result.** Horizontal error **0.000000**; residual vertical error is the deliberate 1 mm seating clearance
per disc. **2.1965 → 0.0018 world units.**

**Regression tests.** `tests/unit/holder-anchor.spec.ts`, 27 tests against the shipped GLB. The load-bearing
one moves a node's translation without moving a vertex and asserts the anchor does not budge — rule 2, as an
executable statement.

### 5.3 Defect 2 — the water jet is ~18× too wide (`BUG‑03`)

**Current root cause.** `DeviceModel.tsx:1055`:

```ts
const scaleXZ = ((tankBounds.width * 0.95) / fit.width) * flowIntensity;
```

The jet's diameter is derived from the **tank's** width. This is the brief's *"visual geometry defining
simulation truth"* anti-pattern in its purest form.

**Coordinate spaces involved.** Plume object space (authored ~20 units tall, arbitrary origin, some lying
down), apparatus-local (tank measurement), and the physical domain (metres).

**The numbers.** Tank `JET Force 2_205` measures `0.181 × 0.317 × 0.179`, so the jet renders **0.181 m** wide.
The physical nozzle is a **10 mm bore** — the app's own `NOZZLE_AREA_M2 = 0.0000785 m²` says so, and both the
spreadsheet (*"A = 0.0000785 m"*) and the storyboard (sl. 6) confirm it. **0.181 / 0.010 ≈ 18×.**

Compounding: `MESH.nozzle` points at `JET Force 2_214`, whose bbox is `0.227 × 0.048 × 0.227` — *wider than
the tank*. It is the tank's base flange, not a nozzle (`BUG‑27`), so there was no correct reference to scale
from.

**Authoritative source of truth.** **`NOZZLE_AREA_M2` in the domain.**
`d = 2√(A/π) = 2√(0.0000785/π) = 0.00999 m`.

**Intended fix.**

```ts
// scene/water/jetGeometry.ts — presentation reads the domain, never the reverse
const nozzleDiameter = 2 * Math.sqrt(NOZZLE_AREA_M2 / Math.PI);   // 0.010 m, exact
const spread        = 1 + SPREAD_RATE * (travel / nozzleDiameter); // slight widening to impact
const scaleXZ       = (nozzleDiameter * spread) / plumeFit.width;
const scaleY        = travel / plumeFit.height;                    // nozzle lip → deflector underside
```

with, per storyboard sl. 6, the plume choice driven by `theoreticalV > 0` rather than a valve threshold
(`docs/15 §4.1`), and flow rate expressed through cues the student can actually see — impact spray density,
turbulence, opacity, pointer deflection and pump pitch — rather than a 7 % width change that is invisible
(`BUG‑21`).

Also required: sample the plumes **by UV** instead of world‑space planar projection, and author them at
**physical size**.

> **Correction to the Phase 1 audit.** The shader comment claims the plumes *"carry no usable UVs"*. Verified
> against the binaries: **all eight carry `TEXCOORD_0`**, and `Water90_Flat`, `Water180_HemiSphere` and
> `Water45_Oblique` carry `TEXCOORD_1` too. V runs **along the flow** — `Water_low`'s three primitives occupy
> `v[-0.02..0.20]`, `v[0.20..0.24]`, `v[0.24..0.74]` consecutively down the stream. The flow‑aligned scroll the
> shader wants is therefore already authored, and the world‑space fallback — the source of the banding — can
> simply be deleted. **This makes the shader fix a code change, not a DCC change.**

Physical size remains a DCC concern: the current non‑uniform scale (`~0.9 × 0.05 × 0.9`) squashes the shader's
own vertex ripple to ~8 mm in Y and invalidates `mat3(modelMatrix) * objectNormal`, which needs the
inverse‑transpose (`RND‑09`).

**Regression test.** `waterJet.spec.ts` — assert the rendered plume's world XZ extent at the nozzle is within
**±15 %** of `2√(A/π) × groupScale`, for all seven deflectors and at n ∈ {0.2, 0.4, 0.6, 0.8, 1.0}. A test
that fails loudly if anyone reintroduces a tank-derived scale.

**Visual acceptance.** At the `tank` view, 1920×1080: a slender column leaves the nozzle, the deflector face
and the impact point are **unobstructed**, the plume's after-impact shape is identifiable per deflector, and
the difference between n = 0.4 and n = 0.5 is obvious in a side-by-side screenshot.

### 5.4 Related mapping corrections

| Item | Now | Target |
|---|---|---|
| `COVER_LIFT` / `SCREW_LIFT` | Two independent magic constants (0.286 / 0.36); screws detach by ~13 cm | Screws back out of their threads, then **parent to the cover** for the lift (`BUG‑20`) |
| Pointer deflection | Physically tiny and imperceptible | A declared, documented **visual exaggeration factor** applied in presentation only — the domain value is never scaled |
| Anchors | Derived per part, good | Keep, but move to the pure `measureApparatus` |

---

## 6. Highlight

Replace emissive repaint (`RND‑05`) with a **silhouette outline** — the technique the Unity reference used
(HighlightPlus is in `Project_VL-FM009/Assets/`). Inverted-hull or stencil, brand orange, pulsing width/opacity
rather than surface colour, and **one part at a time**. The storyboard's phrase is *"The color area is the
allowed range for clicking"* — it marks the region, it does not repaint the object.

---

## 7. Staged loading (`UX‑01`, `BUG‑01`)

```
BOOT           index.html paints BEDO branding immediately (inline critical CSS)
   ↓
APP SHELL      React mounts; chrome, language, lesson header visible      < 500 ms
   ↓
CRITICAL UI    step 1 instruction readable; "Preparing the laboratory…"
   ↓
CORE SCENE     apparatus.glb + environment            progress % per asset
   ↓
TRAINING READY interaction enabled; lesson starts                        target ≤ 4 s
   ↓
OPTIONAL       room detail, remaining plumes, walkthrough video (on demand)
```

Driven by drei's `useProgress()`, rendered in the **DOM** above the canvas. The current in-canvas wireframe-cube
fallback is never seen because the main thread is saturated before it can paint. **A black screen must never
occur at any point.**

---

## 8. Annotations

Per the evaluation PDF §3e (*"3D info cards are excessively large yet contain minimal content"*) and the brief
§14: instructional content lives in the **2D UI**. In-scene annotations are limited to short screen-space
callouts with leader lines — a measurement label, a part name, the balance indicator beside the pointer
(`UX‑15`) — and are never used for step instructions.
