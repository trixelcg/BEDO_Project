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

### 5.3 Defect 2 — the water jet was ~18× too wide (`BUG‑03`) — **RESOLVED**

Fixed. Full account, primary sources and measurements: **`docs/41`**.

**Root cause.** Three faults compounding. BEDO's storyboard (sl. 18) specifies **two** water
objects — "water shape before impact" and "water shape after impact" — and the code had
collapsed them into one; the survivor was sized at 95% of the **tank's** diameter; and its
width was additionally scaled by the valve opening, so the bore grew with the flow.

```ts
const scaleXZ = ((tankBounds.width * 0.95) / fit.width) * flowIntensity;
```

The tank is 181 mm across and the nozzle bore is 10 mm. Measured at HEAD: **139.7 mm at the
first reading's setpoint, 172.0 mm at full flow — 13.98× and 17.20×.**

**Authoritative source of truth.** `NOZZLE_AREA_M2`, via `d = 2√(A/π)` = **9.9975 mm**.
`src/lib/waterJet.ts` is the only place physical size becomes scene size; `jetScale` takes
no parameter that could carry a tank, a viewport or a flow rate. `tankBounds` no longer
exists in `DeviceModel`.

**Result.** Jet width **10.00 mm, error −0.00%**, identical at every flow state and for
every deflector family. The plume is sized from the deflector it forms on, never the tank.

**Regression tests.** `tests/unit/water-jet.spec.ts` — 16 tests, including one that asserts
`tankBounds` has not returned and one that identifies the jet asset by its aspect ratio
rather than its filename.

**Still open:** the shader samples its ripple texture by world position rather than the UVs
the assets carry (`docs/41 §9`), and `TRAVEL_HEIGHT_M` disagrees with the model geometry by
a factor of 5.3 (`docs/41 §13`).

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
