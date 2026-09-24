# 52 — Look development: five visual/mechanical fixes (BEDO-LOOK-01…05)

Branch `model/bedo-model-02`, on top of `395f7dd` (the commit production serves as
revision `bedo-project-r3f-app-00168-dod`, 100 % traffic — verified live at the start).
Not committed, not deployed: this is a working-tree change awaiting visual review.

Evidence: `measurements/look-dev-2026-09-24/` (gitignored) — `before/`, `after/`, the
`sheets/` side-by-sides, the two `*-report.json` traces and `baseline-timing.json`.
Every before/after pair is the same camera pose, viewport and simulation state, rendered
through the same scripted routine (`phase1`–`phase4` in the session's `helpers.js`).

| # | issue | proven cause | correction | evidence | remaining limitation |
|---|---|---|---|---|---|
| 1 | Flat, cut-out lighting; dull chrome; glass without edges | `RoomLighting` probed the model for `MergedBake_*` room materials to capture the room. The re-authored GLB has none and no bake at all, so the probe hid *every* mesh and prefiltered only `scene.background` — the 8-bit outdoor WebP — then wrote that as `envMap` on all 79 materials. Ambient was tinted cyan (`#d1f2f7`). The tank's blended glass scaled its whole reflection by alpha 0.10, so its rim vanished. | `studioEnvironment.ts`: three's `RoomEnvironment` prefiltered once into `scene.environment` at 0.8 (`StudioLighting` replaces `RoomLighting`; `roomEnvironment.ts` deleted). Ambient set white. Tank glass gets a Fresnel-driven alpha (0.10 face-on → 0.55 at grazing) in `modelAdapter.applyGlassRim`. Sun, exposure, tone mapping, every other material: unchanged. | `sheets/A-overview-*`, `B-chrome-glass-*`, `H-water-hose-*` | Frame mean rose 137→151 (no pixel above 250; p99 245). At low viewing angles the open cover's dark underside picks up the studio as a light sheen (`D-cover-open-*`); not visible from the learner's cameras. |
| 2 | Orange wall stripe stepped along the wall | Not geometry (normals render: one plane), not UVs (every island puts the band at world y 0.188–0.345, ±1 texel). The partition atlas maps the wall to a parallelogram rotated 0.77° against the texel grid; the bake rasterised the band with hard edges, so it is a staircase of one-texel (8.9 mm) steps every ~74 texels. Source-texture defect. | `wallStripe.ts`: the two wall paint materials evaluate the band from fragment height within ±2 cm of each edge (anti-aliased by `fwidth`), only where the texel is one of the three band colours; everywhere else the atlas is sampled unchanged. GLB, atlas and UVs untouched. | `sheets/C-stripe-front-*`, `C-stripe-oblique1-*`, `C-stripe-oblique2-*`; shimmer probe `after-C-shimmer-0/1/2` | Edge heights are constants measured off this atlas (`STRIPE_*_MODEL`); a re-baked wall would need them re-measured. |
| 3 | Pointer support rod rose with the cover | `DeviceModel` lifted `JET Force 2_212` (the pin) by `holderLift` next to the rod. Baseline trace: pin y 0.740 → 1.255 when open while the pointer arm stayed at 0.779 (arm detached from its pin). | The pin is never written; it keeps its authored transform. Rod, pan, spring, deflector and cover keep their lifts. | `sheets/D-cover-*`; traces in `before-report.json` / `after-report.json` (`trace.*.pin.pos` constant at 0.740 through closed→open→closed, 4 rapid cycles, +500 g) | none found |
| 4 | Hover/selection recoloured the whole part gold | `setGlow` cloned the material and wrote `emissive #ffc233`; a hovered weight rendered as a flat yellow disc. | `selectionOutline.ts`: inverted-hull outline (2 px line + 6.5 px glow at 0.32, CSS-pixel widths, depth-tested, per-mesh hulls in a separate layer; blended parts get a depth-only prepass). Original material untouched while hovered — verified (`emissive #000000`, metalness 0.85, roughness 0.38 during hover; zero materials carry the highlight colour). Guided pulse and drop-target feedback use the same path. | `sheets/E-weight-after-*` vs `E-weight-before-*`, `F-deflector-*`; 1366×768 and 2560×1440 checks | A small bore (the disc's centre hole) fills with the glow at close range — inherent to the hull technique. The reference video could not be played in the session's browser (YouTube stayed buffering), so the look follows the written edge-only requirement and Highlight Plus's documented outline+glow, not a frame-matched copy. |
| 5 | Pilot lamp turned green when powered | `emissive.set('#26ff7a')` at 1.6 on the red lens each frame. | `pilotLamp.ts`: `emissiveMap = map`, emissive `#ff2a18`, intensity damped 0 ↔ 1.4 from `isPowerOn` only. Material has one user (`red_light_off`), so nothing else changes. | `sheets/G-lamp-after-off-on-off.png` vs `G-lamp-before-*`; intensities 0 / 1.4 / 0 / 0 after reset in `after-report.json` | none found |

## Runtime comparison (same machine, same poses, dpr 1, 1920×1080)

| metric | before | after |
|---|---|---|
| draw calls, opening view, guided step 1 | 347 | 349 (+2: the cover's pulse outline) |
| draw calls, opening view, free mode | 343 | 343 |
| draw calls while a weight is hovered | 184 | 188 (depth prepass + 2 hulls, + label) |
| shader programs | 45–46 | 51–52 |
| textures | 42 | 41 (the probe's cube target is gone) |
| render passes | 1 + three's transmission pass* | same — no new pass, no post-processing |
| frame, opening view, `advance()`+`gl.finish()` p50/p90 | 4.1 / 4.6 ms | 3.4 / 3.7 ms |
| frame, tank close-up, same | 2.8 / 3.0 ms | 2.6 / 2.8 ms |
| rAF interval (vsync-limited, not a cost measure) | 16.7 ms | 16.7 ms |

*The GLB's deflector labels and room glass are `KHR_materials_transmission`, so three
already re-renders the opaque scene into its transmission buffer every frame. Pre-existing.

## Focused tests

* `tsc -b`: clean. `oxlint` on the changed files: clean (one pre-existing warning elsewhere).
* `vitest run tests/unit`: 1007 passed, 4 failed — all four in `assets.spec.ts` /
  `bundle.spec.ts`, which still expect `rosendal_plains_2_4k.webp`; that file was removed
  by `395f7dd` before this task. Not touched here.
* `npm run build`: clean; `vite preview` smoke of `dist/` loads and renders.

## Changed files

`src/lib/studioEnvironment.ts` (new), `src/lib/wallStripe.ts` (new),
`src/lib/selectionOutline.ts` (new), `src/lib/pilotLamp.ts` (new),
`src/lib/roomEnvironment.ts` (deleted), `src/components/Scene3D.tsx`,
`src/components/DeviceModel.tsx`, `src/lib/modelAdapter.ts`, `src/lib/sceneConfig.ts`,
`tests/unit/scene-config.spec.ts`.

## Round 2 (same day): lighting rejected as washed out; camera containment added

The 0.8 studio at exposure 1.3 was rejected on review as a white product studio. Changes:

* **Pipeline.** `src/lib/labPostProcessing.ts`: the frame now renders through an
  `EffectComposer` (half-float, 4× MSAA) → `GTAOPass` → `OutputPass`. Tone mapping (ACES,
  exposure) and the sRGB output conversion happen once, in the output pass; the render and
  AO stages work in linear light. Colour management checked: base-colour maps are sRGB,
  data maps linear (loader defaults), custom shaders only touch alpha/diffuse in linear.
* **Ambient occlusion.** GTAO at a 14 cm world radius with Poisson denoise, intensity 0.75.
  Glass, water, hose, transmissive labels and outline hulls are hidden for the AO pre-pass
  (`excludeSeeThroughFromAO`), so the tank never occludes its own interior. Cost: +189 draw
  calls (the normal/depth pre-pass) and 3.4 → 8.0 ms per frame at the opening view.
* **Values.** exposure 1.0 (was 1.3), studio environment 0.45 (was 0.8), sun 2.0 (2.4),
  ambient 0.05 white. Tank glass rim alpha 0.32 (was 0.55). Outline 1.5 px + 3.5 px so the
  weight's centre bore stays open. Camera near/far 0.05/60 for AO depth precision.
* **Containment.** `src/lib/cameraContainment.ts`: 11 half-space planes measured once from
  the wall and glass meshes (`Walls_1st_Level`, `WALLS_INTERNAL_PARTITIONING`, `Shape016`,
  `Object10433826/7`), floor −1.80, ceiling 4.55; camera margin 0.35 m, target 0.20 m.
  Applied every frame in `LabFrame` (priority 1, before the composer renders), so orbit,
  pan, dolly, damping, guided flights, reset and board view are all covered, and a single
  frame jump is projected back rather than tunnelling. Probes: wall −1.10 → +0.35, glass
  −1.89 → +0.35, 40 m jump → +2.21, floor/ceiling clamped, target +0.20, 400-frame slide
  stops at +0.35 with no jitter. Guided step-2 pose, Board view and the docked-monitor
  viewport all measured inside; no existing pose needed correcting.
* **Tests.** `assets.spec`/`bundle.spec` expectations moved from the removed
  `rosendal_plains_2_4k.webp` to `bedo_environment.webp`; the bundle ceiling raised
  1,380,000 → 1,440,000 B for the composer/AO/RoomEnvironment code (+42.6 KB, 11.2 KB gzip);
  the config marker literal changed from the retired cyan ambient to the sun colour.
  Relevant unit tests pass (scene-config, assets, bundle, glb-contract, api-surface,
  apparatus); `tsc -b` and `oxlint` clean on the changed files; production build clean.

Evidence: `measurements/look-dev-2026-09-24/` (`final-*` captures) and the published review
page.
