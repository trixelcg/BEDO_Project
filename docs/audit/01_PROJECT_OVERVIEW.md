# 01 — Project Overview

**Project:** BEDO Hydraulic Machines Vocational Training — *VL‑FM009 Measurement of Jet Forces*
**Repository:** `/Users/ramial-fuqahaa/Desktop/BEDO_Project/BEDO_Project_R3F`
**Branch / HEAD:** `main` @ `2471bc9`
**Deployment:** https://bedo-project-r3f-app-yfb7zd26za-uc.a.run.app/ (Google Cloud Run, `us-central1`)
**Audit date:** 2026‑08‑20
**Audit scope:** read‑only. No source file was modified. Only this `docs/audit/` folder was created.

> **Note on the supplied references.** The storyboard, evaluation document and demo video were mentioned in the
> brief but are not present in the repository and were not attached to this session. Everything below is derived
> from (a) reading 100 % of the source, (b) parsing the GLB binaries directly, and (c) driving the running
> application in a real browser. Where I refer to "the reference simulator" I am quoting the intent recorded in
> the code's own comments, not the documents. **Please attach the three references before Phase 2** — several
> open questions in `09_REBUILD_STRATEGY.md` can only be closed against them.

---

## 1. What the product is

A single‑page, browser‑based 3D replica of BEDO's **VL‑FM009** jet‑force test rig. A student stands at a virtual
hydraulics bench, unscrews a tank cover, mounts a deflector on a spring‑loaded rod, starts a pump, opens two
valves, and adds calibrated weights until a pointer re‑centres. The balancing mass gives the *actual* jet force
`F_ac`; the app computes the *theoretical* force `F_th` from momentum theory. A "Software Data Monitor" screen
tabulates both, plots them against flow rate, and closes with an assessment question.

Four experiment sheets share one twelve‑step procedure and differ only in the deflector fitted and the momentum
factor that follows from its geometry:

| Exp. | Family | Angles | Force law | Momentum factor `k` |
|---|---|---|---|---|
| 1 | Flat | 90° | `F = ρAV²` | 1.0 |
| 2 | Semi‑circular | 120°, 180° | `F = ρAV²(1 − cos β)` | 1.5, 2.0 |
| 3 | Conical | 135° | `F = 1.707 ρAV²` | 1.707 |
| 4 | Oblique | 30°, 45°, 60° | `Fx = ρAV² sin²θ` | 0.25, 0.5, 0.75 |

Bilingual (English / Arabic), with a Guided mode (step‑gated) and a Free mode (everything unlocked).

## 2. Technology inventory

### Runtime dependencies (declared)

| Package | Version | Used? | Notes |
|---|---|---|---|
| `react`, `react-dom` | ^19.2.7 | ✅ | Single root, `StrictMode` on |
| `three` | ^0.184.0 | ✅ | 38 MB installed |
| `@react-three/fiber` | ^9.6.1 | ✅ | |
| `@react-three/drei` | ^10.7.7 | ✅ | `useGLTF`, `useTexture`, `OrbitControls`, `ContactShadows` only |
| `lucide-react` | ^1.21.0 | ✅ | 39 MB installed; 18 icons actually imported |
| `@google-cloud/storage` | ^7.21.0 | ✅ (server only) | Pulled into the client dep tree unnecessarily |
| `@react-three/postprocessing` | ^3.0.4 | ❌ **unused** | |
| `framer-motion` | ^12.41.0 | ❌ **unused** | 5.6 MB installed |
| `@types/three` | ^0.184.1 | ⚠️ | Types listed as a *runtime* dependency |

### Dev / build

`vite` 8.1.1 · `@vitejs/plugin-react` 6 · `typescript` ~6.0.2 · `oxlint` 1.71 · `tsx` 4.22
Build: `tsc -b && vite build`. Dev: `tsx server.ts & vite` (Vite on 5179 proxying `/api` → 8080).
Deploy: multi‑stage `Dockerfile` → Cloud Build → Cloud Run, `--allow-unauthenticated`.

### There is no

test runner, CI, error boundary, analytics, logging, i18n library, router, state library, storybook,
`.env.example`, formatter config, pre‑commit hook, or `CLAUDE.md`/contributor doc. `README.md` is the
**unmodified Vite starter template**.

## 3. Codebase shape

```
src/                              5 253 lines of TS/TSX/CSS
├── main.tsx                 10   React root
├── App.tsx                 452   ALL simulation state + all business rules
├── index.css               682   Global stylesheet (only stylesheet)
├── types/index.ts           96   SimulationState, SceneConfig, RecordRow…
├── lib/
│   ├── apparatus.ts        287   GLB mesh-name map, deflector table, camera anchors
│   ├── experiments.ts      300   4 experiment definitions + 12 step definitions + quizzes
│   └── physics.ts          129   Flow / velocity / force / balance maths
└── components/
    ├── Scene3D.tsx         272   <Canvas>, lights, env, CameraRig, OrbitControls
    ├── DeviceModel.tsx   1 197   ⚠️ god component — model, materials, water shader,
    │                             pivots, hotspots, anchors, animation, per-frame sim
    ├── UIOverlay.tsx       661   Sidebar: steps, controls, experiments, params, video
    ├── SoftwareMonitor.tsx 438   Results table, SVG chart, CSV export, quiz
    └── MenuSettings.tsx    350   Developer scene-tuning panel (shipped to students)

api/                        804   6 serverless-style handlers — 5 of them belong to a
                                  different product (TTS avatar) and are never called
server.ts                   182   Static file server + dynamic API router
```

**23 % of the front-end code lives in one file** (`DeviceModel.tsx`), and that file absorbed **42 of the
project's 48 commits**.

## 4. Asset inventory

### Shipped in `public/` (all copied verbatim into `dist/` and into the container image)

| File | Size | Referenced by code? |
|---|---|---|
| `Bedo_baked_v2.glb` | **26 MB** | ✅ the apparatus |
| `Bedo_Mesu_J.mp4` | **28 MB** | ✅ the "Video" walkthrough modal |
| `Bedo_M.glb` | 17 MB | ❌ **dead** |
| `Bedo_model_optimized.glb` | 1.7 MB | ❌ **dead** |
| `WaterShapes/*.glb` × 8 | 364 KB | ✅ one jet plume per deflector |
| `WaterShapes/*.abc` × 8 | **20 MB** | ❌ **dead** (Alembic authoring sources) |
| `rosendal_plains_2_4k.webp` | 440 KB | ✅ environment map |
| `icons.svg`, `favicon.svg` | 20 KB | favicon only; `icons.svg` **dead** |
| `src/assets/{hero.png, react.svg, vite.svg}` | 36 KB | ❌ **dead** |

**`dist/` is 95 MB, of which ≈39 MB is never requested by any client.**

### Inside `Bedo_baked_v2.glb` (parsed directly from the binary)

* glTF 2.0, Blender I/O 4.5.48 · **159 nodes, 157 meshes, 181 primitives**
* **48 487 triangles / 78 063 vertices** — geometrically trivial
* **68 materials, 57 textures, 42 embedded images** — 23 MB of the 26 MB file is texture data
* Extensions: `KHR_materials_clearcoat`, `_transmission`, `_specular`, `_anisotropy`, `_ior`
* **No** Draco, no meshopt, no KTX2/Basis, no animations, no skins, no cameras
* **All 68 materials are `doubleSided: true`**; 14 are `alphaMode: BLEND`
* Texture budget: **≈764 MB of VRAM** after RGBA8 expansion + mipmaps (see `04_PERFORMANCE_REPORT.md`)
  * five 4096×4096 lightmap/normal/diffuse/metalness sheets for the baked *room* alone = 426 MB
  * one 4800×2950 wall chart = 72 MB
  * eight 2048×2048 sheets for weights / pointer / plate = 170 MB

## 5. Runtime architecture

```
main.tsx → <StrictMode><App/></StrictMode>

App.tsx
 ├── useState<SimulationState>      ← the entire simulation (18 fields)
 ├── useState<SceneConfig>          ← rendering knobs, hydrated from GET /config.json
 ├── useEffect                      ← recompute all 4 result rows on every state change
 ├── 14 handler functions           ← the state machine + 5 safety guards
 │
 ├── <Scene3D  state steps sceneConfig … 6 callbacks />
 │      └── <Canvas shadows="percentage" preserveDrawingBuffer>
 │            ├── <RendererController>   toneMappingExposure
 │            ├── <LabEnvironment>       equirect webp → scene.background/environment
 │            ├── ambientLight + 3 × directionalLight (1 casting) + <ContactShadows>
 │            ├── <Suspense><DeviceModel …/></Suspense>
 │            ├── <CameraRig>            eased fly-to per step
 │            └── <OrbitControls makeDefault>
 │
 ├── <UIOverlay  state steps experiment … 14 callbacks />   ← sidebar + popups + video modal
 ├── <MenuSettings>                                          ← dev panel (conditional)
 └── <SoftwareMonitor>                                       ← full-screen results (conditional)
```

**State management:** one `useState` object in `App`, threaded down as ~20 individual props. No context, no
reducer, no store, no memoisation of children. Every state change — including a warning popup opening —
re‑renders `DeviceModel` and therefore re‑evaluates its 1 197 lines.

**Simulation loop:** a single `useFrame` in `DeviceModel` (lines 839–1110, ~270 lines) drives highlights,
the unscrew sequence, both valves, the switch, the lamp, spring deflection, pointer swing, the water jet's
position/scale/shader time, the weight stack, the cover hotspot and the guide‑arrow bob. It reads React state
directly from the closure and mutates `THREE.Object3D` transforms imperatively.

**Interaction:** 15 invisible `<sphereGeometry>` hotspots, positioned and sized at load time from real mesh
bounding boxes, sit in front of the model. `onClick` dispatches a tagged `Action` union back to `App`.

**Camera:** `CameraRig` lerps `camera.position` and `controls.target` over 1.25 s toward a per‑step anchor
offset defined in `ANCHOR_VIEW`, aborting if the student grabs `OrbitControls`.

**Physics:** a quartic fit maps valve opening `n` → `Q`; `v₀ = Q/A`; `v = √(v₀² − 2gs)`; `F_th = k·ρ·A·v²`.
Verified against the reference figures quoted in `physics.ts` (`n = 0.5 → Q = 27.024 L/min, v₀ = 5.74,
v = 5.679`) — **the maths is correct** and is the healthiest part of the codebase.

**Backend:** `server.ts` serves `public/` then `dist/`, falls back to `dist/index.html` for extension‑less
paths, proxies missing assets from a GCS bucket in production, and routes `/api/<name>` by
`await import('./api/<name>.ts')`.

## 6. Health summary

| Area | Verdict |
|---|---|
| Domain modelling (`physics.ts`, `experiments.ts`, `apparatus.ts`) | 🟢 **Good.** Correct, well documented, honest about its assumptions. |
| Application architecture | 🔴 One god component, prop‑drilled state, no boundaries |
| Rendering pipeline | 🔴 769 draw calls/frame, 764 MB of texture, double lighting, no LOD or budget |
| Loading | 🔴 26 MB blocking download then ~15 s of blocking main‑thread work, **no loading UI at all** |
| Interaction | 🟠 Works, but guided‑mode gating is cosmetic; several dead ends reachable |
| Simulation fidelity | 🟠 Correct numbers, wrong visuals — the jet is ~18× too wide, weights are invisible |
| UI / UX | 🔴 Broken header, clipped panels, unusable below 800 px, RTL is a no‑op |
| Accessibility | 🔴 Two of twelve steps are mouse‑only; no labels, no focus rings, `lang="en"` in Arabic |
| Audio | ⚫ **Does not exist** — no pump, no water, no click, no narration |
| TypeScript rigour | 🟠 Compiles clean, but `strict` is off and `as any` is used at every GLB boundary |
| Security (backend) | 🔴 Five unauthenticated write/proxy endpoints on a public URL |
| Tests | ⚫ **Zero** |

**Bottom line.** The *knowledge* in this project — the physics, the experiment definitions, the mesh map, the
hard‑won notes about how the GLB is authored — is genuinely valuable and should be preserved verbatim. The
*machinery* around it (one 1 200‑line component, an unbudgeted render pipeline, a 26 MB blocking asset, and a
UI shell with no layout system) is what is failing, and is what Phase 2 should replace.

Detailed findings follow in documents 02–08; the recommended plan is in `09_REBUILD_STRATEGY.md`.
