# 09 — Rebuild Strategy

**Status: proposal awaiting your approval. No source file has been modified.**

---

## 1. The recommendation

**Rebuild the presentation layers around the existing domain layer. Do not rewrite from zero, and do not patch
in place.**

The reasoning is in `08_TECH_DEBT.md §5`: roughly **700 of the 5 253 lines are genuine assets** — the physics,
the experiment definitions, the GLB mesh map and the momentum-factor table. They are correct (I verified the
physics numerically against the reference values in the code's own comments) and they encode weeks of knowledge
that would be expensive and risky to re-derive.

The other ~4 500 lines are the liability, and they are a liability *structurally*, not defect-by-defect. Of the
37 bugs in `03_BUG_REPORT.md`, at least 20 trace back to four causes: no seams, no tests, no budgets, no
contracts. Fixing them individually leaves those causes intact — and the commit log already shows what that
looks like (42 of 48 commits in one file, the same constant re-tuned five times, the weight-stack transform
"fixed" three times and still 2.18 m off target).

**Three options considered:**

| Option | Cost | Outcome |
|---|---|---|
| Patch in place | ~4–6 w | 37 bugs closed; the four generative causes remain; regression risk on every fix; the next feature reopens them |
| **Rebuild around the domain core** | **~10–14 w** | Structure that makes changes verifiable; domain knowledge preserved; every finding in this audit addressed |
| Rewrite from zero | ~16–20 w | Discards correct physics, the GLB map and the bilingual content; re-derives known-hard problems |

I recommend the middle option.

---

## 2. Phase 0 — before any rebuild work (do these first)

### 2.1 Immediate: close the live exposures (~1 hour)

Delete `api/chat.ts`, `api/tts.ts`, `api/crawl.ts`, `api/upload.ts`, `api/register.ts`, `api/gcsStorage.ts` and
redeploy. These grant anonymous internet callers Vertex AI inference and Google TTS **billed to your project**,
arbitrary public writes to your GCS bucket, and an open SSRF proxy (`ARCH‑09`, `08_TECH_DEBT.md §4`). They are
leftovers from the TTS-avatar project this repo was forked from and nothing in the simulator calls them. This is
a deletion, not a refactor.

Then audit the bucket for objects an anonymous caller may already have written.

### 2.2 Attach the reference materials

The storyboard, evaluation document and demo video were named in your brief but are not in the repository and
were not attached to this session. Several decisions below are blocked on them — listed in §8. Please attach
them before Phase 2 starts.

### 2.3 Write the budget (½ day, with you)

Nothing in the project currently declares what hardware it must run on. That single omission produced 764 MB of
texture, 769 draw calls per frame and a 26 MB blocking download. Proposed starting point — **please confirm or
correct the target device**, because everything else follows from it:

```
Target device      2019 mid-range laptop, integrated GPU
                   8"–12" school tablet (please confirm — this drives everything)
Browsers           Chrome / Edge / Safari, last 2 versions
Frame rate         60 fps desktop · 30 fps sustained tablet, no throttle in 15 min
Draw calls         ≤ 150 / frame
Triangles          ≤ 60 000 submitted / frame
Framebuffer binds  ≤ 4 / frame  (≤ 1 transmissive material)
Texture VRAM       ≤ 150 MB
Initial transfer   ≤ 8 MB
JS initial chunk   ≤ 150 KB gzip
Time to interactive ≤ 4 s on 20 Mbit
Accessibility      WCAG 2.1 AA
Languages          en / ar with full RTL
```

Enforce the asset and bundle lines **in CI** so they cannot silently regress.

### 2.4 Establish the verification loop (3–4 days)

This is the highest-leverage work in the entire plan and must come before any refactor.

1. `"strict": true` and `"noUncheckedIndexedAccess": true` in `tsconfig.app.json`; fix the fallout.
2. Vitest, with three specs written **against the current code** so they pin known-good behaviour:
   - `physics.test.ts` — the reference table (`n = 0.5 → Q = 27.024, v₀ = 5.738, v = 5.677, F_th = 2.5303 N`
     for the flat plate), all seven momentum factors, the balance tolerance at both readings.
   - `apparatus.contract.test.ts` — load the GLB's node-name list from a checked-in fixture; assert every
     `MESH` constant, every deflector `shelf` and `installed` name resolves through `gltfName()`. **This ~60-line
     test would have prevented the entire class of silent-lookup failures documented at `apparatus.ts:11‑26`.**
   - `stateMachine.test.ts` — once extracted (§4.1): all twelve steps, all five guards, both modes.
3. Playwright: one smoke test that walks the full twelve-step procedure and asserts the final table.
4. GitHub Action: `tsc --noEmit`, `oxlint`, `vitest`, `playwright`, asset-budget check.

**Do not skip this.** Without it the rebuild will regenerate the same debt — that is precisely what the commit
history demonstrates.

---

## 3. Phase 1 — assets (4–5 days, can run in parallel with Phase 2)

This is the single biggest win available and it requires no application code changes.

| # | Action | Effect |
|---|---|---|
| 1 | KTX2 / Basis for all 42 textures (`gltf-transform`) | VRAM ↓ ~6–8×, no CPU decode |
| 2 | Re-budget resolutions: room bake 4096²→1024²; wall chart 4800×2950→2048×1280; weights 2048²→512² **atlased onto one sheet**; LED 2048²→64² | **764 MB → ~120 MB** |
| 3 | Drop uniform-value channels (flat metalness maps → scalar factors) | file ↓ |
| 4 | `doubleSided: false` except where genuinely needed; audit the 14 `BLEND` materials back to `OPAQUE`/`MASK` | fragment cost ↓, sorting artefacts fixed (`RND‑03`, `RND‑04`, `BUG‑31`) |
| 5 | Merge the 26 static room nodes into one mesh; merge static bench/pipework | **769 → ~200 draw calls** |
| 6 | meshopt/Draco geometry compression | file ↓ |
| 7 | Split into `apparatus.glb` (loads first) + `room.glb` (streams second) | perceived load ↓ |
| 8 | **Author the water plumes at correct physical size with real UVs** | fixes `BUG‑03` and `RND‑09` at the source |
| 9 | Add a real nozzle node sized to the 10 mm bore | fixes `BUG‑27`, gives the jet a correct reference |
| 10 | Fix the tank/cover materials in the source: cover = opaque metal, tank = glass | fixes `RND‑02`, `RND‑06`, removes a transmission pass |
| 11 | Delete `Bedo_M.glb`, `Bedo_model_optimized.glb`, `WaterShapes/*.abc`, `icons.svg`, `src/assets/*` | **dist 95 MB → ~56 MB** |
| 12 | Transcode `Bedo_Mesu_J.mp4` 28 MB → ~6 MB 720p (or HLS) | `BUG‑25` |
| 13 | Move binaries to Git LFS or an asset bucket + manifest | `.git` 110 MB stops growing |

**Expected: GLB 26 MB → ~3–5 MB; VRAM 764 MB → ~120 MB; load 15–20 s → ~2–4 s.**

Note items 8–10 are **Blender/DCC work, not code**. Please confirm who owns the source `.blend` — several
findings (jet scale, cover material, tank material, nozzle geometry, weight-disc origins for `BUG‑02`) are best
fixed there, once, rather than compensated for at runtime forever.

---

## 4. Phase 2 — application rebuild (~8–10 weeks)

Target structure:

```
src/
├─ domain/                 ← CARRIED OVER ESSENTIALLY UNCHANGED
│   ├─ physics.ts              (from lib/physics.ts — verified correct)
│   ├─ experiments.ts          (from lib/experiments.ts)
│   ├─ apparatus.ts            (from lib/apparatus.ts — mesh map, factors, anchors)
│   └─ stateMachine.ts         ← NEW: attempt(state, action) → next | ErrorCode
├─ store/
│   ├─ apparatusStore.ts       cover, power, valves, weights, deflector
│   ├─ lessonStore.ts          mode, step, experiment, readings, quiz
│   └─ selectors.ts            derived: recordedRows, balance, liveParts
├─ three/
│   ├─ loadApparatus.ts        load once → typed ApparatusRefs; THROWS on missing name
│   ├─ measureApparatus.ts     pure: scene → anchors, hotspots, tankBounds, nozzle
│   ├─ materials/              waterMaterial.ts, glassMaterial.ts, outline.ts (+dispose)
│   └─ tuning.ts               every geometry constant, named, with units and provenance
├─ scene/
│   ├─ Stage.tsx               Canvas, lighting, env, frameloop, dpr
│   ├─ CameraDirector.tsx      framing by bounding sphere + context + occlusion
│   └─ parts/                  CoverAssembly · DeflectorMount · SpringPointer ·
│                              WaterJet · ValveGroup · PowerPanel · WeightStack ·
│                              Hotspots · GuideCallout        (one useFrame each)
├─ ui/
│   ├─ tokens.css              ONE palette, semantic names, contrast-validated
│   ├─ Shell.tsx               responsive layout: desktop rail / tablet sheet
│   ├─ StepRail.tsx            progress, review, back
│   ├─ ControlPanel.tsx        a DOM control for EVERY apparatus action
│   ├─ Monitor/                table · chart · export · quiz · completion
│   └─ a11y/                   Dialog, LiveRegion, FocusTrap, SkipLink
├─ i18n/  en.ts · ar.ts · useI18n.ts (binds document.lang + dir)
├─ audio/ AudioEngine.ts + sources
└─ app/   App.tsx · ErrorBoundary · LoadingScreen · ContextLossRecovery
```

### 4.1 Workstream A — Domain & state (1.5 w)

Move `lib/*` to `domain/*` unchanged. Extract `stateMachine.ts` as a pure
`attempt(state, action): {next} | {error: ErrorCode}` — this deduplicates the guard logic currently living in
both `App.tsx` and `DeviceModel.tsx` (`CQ‑06 #1`) and is the most testable unit in the project. Replace the
single `useState` with two stores plus selectors; derive `recordedRows` instead of storing it (`CQ‑11`).

**Fixes:** `ARCH‑03`, `ARCH‑06`, `ARCH‑08`, `CQ‑06`, `CQ‑11`, `BUG‑04`, `BUG‑05`, `BUG‑06`, `BUG‑14`, `BUG‑15`,
`BUG‑16`, `BUG‑37`.

Two design decisions to make here:
- **Readings become an append-only list** with a `taken` flag, not four fixed rows. This fixes the fabricated
  row 4, the phantom chart point, and unlocks Free mode.
- **Free mode gets an explicit "Record reading" action**, decoupled from step number.

### 4.2 Workstream B — 3D layer (3 w)

`loadApparatus.ts` resolves every name once into typed refs and **throws at load** if any is missing — never
`getObjectByName` in a frame again (`PERF‑06`). `measureApparatus.ts` becomes a pure, testable function. Split
`DeviceModel` into the nine `scene/parts/*` components, each owning one `useFrame`. Every geometry constant moves
to `tuning.ts` with a unit and a note on how it was derived.

`Stage.tsx`: `dpr={[1, 1.5]}`, `frameloop="demand"` with explicit invalidation, no `preserveDrawingBuffer`, one
key light on a tight shadow frustum, no `ContactShadows`, no decorative fills, environment for specular only.

Replace the emissive-repaint highlight with a **silhouette outline** (`RND‑05`). Rebuild `CameraDirector` to
frame by bounding sphere plus context, avoid entering geometry, respect the sidebar occlusion, honour
`prefers-reduced-motion`, and stop ping-ponging under the bench (`RND‑11`, `RND‑13`, `RND‑14`).

**Fixes:** `ARCH‑01`, `ARCH‑04`, `ARCH‑05`, `PERF‑02/03/05/06/07/08/09/10/15`, `RND‑01/05/07/08/09/11/12/13/14/15/16/18`,
`BUG‑02`, `BUG‑17`, `BUG‑18`, `BUG‑19`, `BUG‑20`, `BUG‑21`, `BUG‑31`, `CQ‑02`, `CQ‑08`, `CQ‑09`, `CQ‑10`.

### 4.3 Workstream C — UI, i18n, accessibility (2.5 w)

One token file, CSS Modules, no inline styles. A real responsive shell: desktop rail, tablet bottom-sheet,
portrait support — with a decision on the minimum supported width (currently the app silently loses all its
content below ~800 px). `useI18n` binds `document.documentElement.lang` and `dir`; every directional CSS property
becomes a logical property so one stylesheet serves both directions.

Accessibility is built in, not retrofitted: **a DOM control for every apparatus action** (this also fixes the
mouse-only steps 1 and 3), `role="dialog"` + focus trap + Esc on all three modals, `aria-live` on the safety
warnings, real `:focus-visible` styles, labelled inputs, and no colour-only encoding in the chart.

**Fixes:** `BUG‑07/08/09/10/11/12/13/22/23/24/25/26/32/35`, `UX‑01/03/04/07/08/09/11/12/13/14/15/16/17/18/19/20/21/22/23/24/25`,
`ARCH‑13`, `ARCH‑15`, `CQ‑07`, `CQ‑17`, `TD‑05`, `TD‑10`, `TD‑11`.

Also here: the loading screen (`useProgress`, branded, bilingual, real percentage), the error boundary, WebGL
context-loss recovery, and `localStorage` persistence so a refresh does not cost the session.

### 4.4 Workstream D — Audio (3–5 d)

There is currently no audio at all (`BUG‑30`). Minimum viable: a looping pump bed whose gain and pitch track
`valveOpening`; a water-impact loop tied to jet force; one-shots for valve, switch, weight and cover; distinct
success and error tones; a mute control; everything gated behind a user gesture. Whether bilingual narration is
in scope depends on the storyboard (§8).

### 4.5 Workstream E — Backend & infrastructure (3–4 d)

Replace the hand-rolled static server with a maintained one, or move static assets to a CDN with `Range` support
and correct cache headers (hashed → `immutable`; unhashed → `must-revalidate` + ETag — currently a 26 MB model is
cached `immutable` for a year under a stable filename, `ARCH‑12`). Replace the path-driven dynamic `import()`
with an explicit route map. Bake `SceneConfig` into the bundle and gate `MenuSettings` behind
`import.meta.env.DEV`. Write a real README documenting the GLB naming contract, the physics assumptions, the
budget and the deploy procedure.

**Fixes:** `ARCH‑09/10/11/12/13/16/17`, `BUG‑24`, `BUG‑25`, `PERF‑11/12`, `CQ‑13/14/18/19/20/21`.

---

## 5. Sequencing

```
Week   1  ██ Phase 0: delete api/*, strict, Vitest, GLB contract test, CI, budget doc
Week   2  ██ Phase 1 assets (art) ─────────┐   Workstream A: domain + state machine + stores
Week   3  ██ Phase 1 assets ───────────────┘   Workstream A ──┐
Week 4-6  ██ Workstream B: 3D layer split, materials, camera, jet
Week 5-7  ██ Workstream C: UI shell, tokens, i18n, a11y, loading/error  (overlaps B)
Week   8  ██ Workstream D: audio          ██ Workstream E: backend + docs
Week 9-10 ██ Integration, Playwright coverage, performance verification against the budget
Week  11+ ██ Fidelity gaps (§8), pending the reference materials
```

Phase 1 (asset/DCC work) is independent of Phase 2 and should start immediately in parallel — it is the largest
single performance win and it unblocks the rendering work in Workstream B.

---

## 6. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The source `.blend` is unavailable, so the GLB can only be fixed post-hoc | Medium | Confirm ownership now (§8). `gltf-transform` can do textures, materials and merging without the source; geometry origins (`BUG‑02`) and the nozzle (`BUG‑27`) are much harder without it |
| Re-exporting the GLB renames nodes and breaks the mesh map | **High** | This has already happened twice in the log. The `apparatus.contract.test.ts` from Phase 0 turns it from a silent runtime failure into a red CI build |
| The reference materials reveal scope not in the current build | Medium | §8. Budget contingency in week 11+ |
| Target device is weaker than assumed (older tablets) | Medium | Confirm in §2.3 before Phase 1 sets texture budgets |
| Physics is changed during the rebuild | Low | Pinned by `physics.test.ts` in Phase 0 |
| Rebuild regenerates the same debt | Medium | This is why Phase 0 is non-negotiable: budgets in CI, tests before refactor, contracts at the GLB boundary |

---

## 7. Definition of done

Phase 2 is complete when all of the following hold in CI:

- [ ] All 37 bugs in `03_BUG_REPORT.md` closed, each with a test
- [ ] Every budget line in §2.3 met and enforced in CI
- [ ] A student can complete all four experiments in both languages and both modes
- [ ] Every apparatus action reachable by keyboard and announced to a screen reader
- [ ] WCAG 2.1 AA verified (axe + manual keyboard/screen-reader pass)
- [ ] Usable at 360 px, 768 px, 1024 px, 1440 px, portrait and landscape
- [ ] Time to interactive ≤ 4 s on a throttled 20 Mbit connection
- [ ] 30 fps sustained for 15 minutes on the confirmed target tablet, no thermal throttle
- [ ] No unauthenticated write endpoints in production
- [ ] `renderer.info` stable over a 10-minute session (no leaks)
- [ ] Playwright walks all twelve steps for all four experiments
- [ ] README documents the GLB naming contract, physics assumptions, budget and deploy

---

## 8. Open questions — I need your input before Phase 2

**Blocking:**

1. **The storyboard, evaluation document and demo video.** Named in your brief, not present in the repo, not
   attached to this session. I have audited against the code's own recorded intent; several fidelity questions
   below can only be settled against the references.
2. **Target device.** Everything in the budget follows from this. Are these desktop lab PCs, laptops, tablets,
   or all three? What is the oldest machine that must run it?
3. **Who owns the source `.blend`?** Items 8–10 in Phase 1 are best fixed at the source rather than compensated
   for at runtime forever.

**Scope decisions:**

4. **Volumetric measurement.** The rig's litre scales and volumetric valve are modelled but measure nothing
   (`BUG‑29`). On the real VL-FM009 this is *how flow rate is determined*. In scope?
5. **Drag-to-install.** Step 2's copy says "drag"; the implementation is a click (`BUG‑22`). Implement the drag,
   or reword in both languages?
6. **How much should the app tell the student?** It currently prints the exact balancing target
   (`UX‑03`), which removes the measurement from the exercise. Keep as a hint mode, remove, or gate behind an
   instructor setting?
7. **Free mode's purpose.** Instructor demonstration, or student exploration? It currently records nothing
   (`BUG‑06`); the answer shapes what "Record reading" should do.
8. **Assessment.** One question per experiment today, with no score, no retry, no reporting. Is there an LMS,
   SCORM/xAPI, or grade-export requirement?
9. **Narration.** Is bilingual voice-over in the storyboard? It changes the audio budget substantially.
10. **Accessibility conformance level.** I have assumed WCAG 2.1 AA. If this is publicly funded vocational
    training, please confirm the contractual requirement.

**Lower priority:**

11. Should the 28 MB walkthrough video ship with the app, or link out?
12. Is `MenuSettings` needed by anyone (an instructor? an integrator?), or can it be dev-only?
13. Are the other three BEDO experiment sheets (Phase 3+) coming? If so, the `experiments.ts` data model should
    be validated against them now, while it is cheap.

---

## 9. What I have not done

Per your instructions, I have **not** modified, refactored, optimised, renamed, deleted or created any source
file. The only files created are the nine reports in `docs/audit/`.

Two things I would flag as worth acting on ahead of full approval:
- **§2.1** — deleting the five foreign `api/` handlers. This is a live financial and abuse exposure, and it is a
  deletion of code nothing calls.
- **§2.2** — attaching the reference materials, so Phase 2 can start without the open questions in §8.

Awaiting your review.
