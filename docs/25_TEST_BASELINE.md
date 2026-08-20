# 25 — Test Baseline (BEDO‑002)

**What this is.** The automated pin placed around the current implementation *before* any structural change.
It protects the parts of BEDO that are known-good — the verified physics, the momentum factors, the experiment
definitions, the safety guards, the GLB naming contract, the twelve-step lesson — so the rebuild in
`docs/23` cannot alter them silently.

- **Written against:** the code as it stands on `phase2/security-remediation`, unchanged.
- **Principle:** pin behaviour, do not correct it. Where today's behaviour disagrees with the reference
  material, that disagreement is **recorded here and left in place** (see §9).

---

## 1. Architecture

```
tests/
├── unit/                       Vitest, node environment — pure and fast
│   ├── physics.spec.ts         BEDO's mathematical model, pinned to the spreadsheet
│   ├── apparatus.spec.ts       deflectors, weights, plumes, anchors, gltfName
│   ├── experiments.spec.ts     the four sheets and the twelve-step procedure
│   ├── glb-contract.spec.ts    ★ every node name the runtime resolves, against the real asset
│   ├── assets.spec.ts          the files the app loads exist and are what they claim
│   ├── scene-config.spec.ts    the frozen scene values (added by BEDO-003)
│   ├── api-surface.spec.ts     the endpoints BEDO-001 removed stay removed
│   └── bundle.spec.ts          what production output must and must not contain
├── integration/                Vitest, jsdom — the real App, Scene3D doubled
│   ├── safety-guards.spec.tsx  the five guards from the state-machine document
│   └── lesson-flow.spec.tsx    all twelve steps, and the rules that hold each one
├── e2e/                        Playwright, chromium — a real page
│   ├── lesson.e2e.ts           ★ the twelve-step walkthrough, end to end
│   ├── language.e2e.ts         English / Arabic smoke
│   └── readiness.e2e.ts        loading milestones, against the real 26 MB model
├── fixtures/bedo-reference.ts  every expected physics number, with its provenance
└── helpers/                    GLB reader, jsdom harness, Scene3D double
```

Three layers, three jobs:

| Layer | Answers | Cost |
|---|---|---|
| unit | "is the domain still correct?" | 8 files, ~1 s |
| integration | "does the lesson engine still behave?" | 2 files, ~2.5 s |
| e2e | "does it still work in a browser?" | 3 files, ~1.4 min |

The integration layer exists because the lesson engine currently lives inside `App.tsx` as React handlers.
Testing it through a rendered `App` exercises the real code without refactoring it — which is the point:
BEDO‑002 must not move the thing it is measuring. After `BEDO‑006`/`BEDO‑008` extract a pure state machine,
most of `lesson-flow.spec.tsx` becomes a unit test and gets faster.

---

## 2. Commands

```bash
npm run test:unit         # Vitest: unit + integration
npm run test:e2e          # Playwright: browser suite
npm run test              # both
npm run typecheck         # tsc -b (app) + tsconfig.test.json (tests)
npm run lint              # oxlint
npm run test:ci           # typecheck → lint → build → unit → e2e   ← the full gate
npm run perf:baseline     # measurement harness (§7)
npm run glb:report        # asset budget, human-readable
npm run glb:nodes         # every node name, authored → as three.js exposes it
```

Notes.

- `npm run build` is **unchanged**. `tsconfig.test.json` is deliberately *not* in the root project references,
  so a broken spec can never break a production build.
- `bundle.spec.ts` needs a build; `test:ci` builds first. Without one it reports **skipped**, never green.
- Playwright starts its own dev server (`playwright.config.ts`), reusing one if it is already running.
  Only chromium is installed: `npx playwright install chromium`.
- Nothing in the suite reaches the public internet or a billable API. `api-surface.spec.ts` boots the project's
  own server on a reserved free port; the GCS client is never asked for credentials because no request reaches
  a handler that would use it.

---

## 3. What is protected

| Area | Spec | The regression it prevents |
|---|---|---|
| Flow-rate polynomial | `physics.spec.ts` | Any edit to `Q(n)`; all six spreadsheet rows to 1e‑6 |
| `v = √(v₀² − 2gs)` | `physics.spec.ts` | The `2g√s` form, which drove `v²` negative and zeroed the jet force |
| Nozzle area, travel height, ρ, g, k, Q_T | `physics.spec.ts` | Silent constant drift; `k` is re-derived from the xlsx `hW` column |
| Seven momentum factors | `physics.spec.ts`, `apparatus.spec.ts` | Generalising `1 − cos θ` to the oblique family (0.134/0.293/0.5 instead of 0.25/0.5/0.75) |
| F_th per deflector | `physics.spec.ts` | Every BEDO `Fth` row at n = 0.4, plus exact ratio identities |
| F_o − F_th = ρA·2gs | `physics.spec.ts` | The identity that proves the linear `2gs` form |
| Balancing mass and the ±10 g window | `physics.spec.ts` | Judging balance against the rounded target, which "balanced" an empty tray |
| Four experiments, angles, quizzes | `experiments.spec.ts` | A sheet losing its Arabic half, an unanswerable quiz, an angle outside its family |
| The twelve steps | `experiments.spec.ts`, `lesson-flow.spec.tsx`, `lesson.e2e.ts` | Reordering, renumbering, or dropping a step |
| Five safety guards | `safety-guards.spec.tsx` | Any guard weakening — each is checked refused / state-unchanged / message / then allowed |
| **GLB node names** | `glb-contract.spec.ts` | ★ A Blender re-export renaming or deleting a node the runtime drives |
| Asset presence | `assets.spec.ts` | A media URL in `src/` with no file behind it |
| Removed API routes | `api-surface.spec.ts` | Reintroducing `/api/{chat,tts,upload,crawl,register,gcsStorage}` |
| Dev-only test adapter | `bundle.spec.ts` | Shipping the E2E seam to production |
| Loading milestones | `readiness.e2e.ts` | Losing the markers later performance work measures against |
| Scene configuration | `scene-config.spec.ts` | A scene value drifting after BEDO-003 froze it — every number is pinned against the live scene-graph observable it was read from (`docs/26 §2`) |
| No config fetch at startup | `readiness.e2e.ts` | The `/config.json` request, an `/api` call, or any 4xx or console error returning to startup |
| No developer settings UI | `bundle.spec.ts`, `readiness.e2e.ts` | The scene editor returning to a production build |
| The served asset set | `assets.spec.ts`, `bundle.spec.ts` | An unrequested file landing in `public/` or `dist/` again — checked from both directions, so neither a stale expected-list entry nor a new stray file can pass (`docs/28 §9`) |

---

## 4. Fixtures and numeric tolerances

Every expected physics value lives in `tests/fixtures/bedo-reference.ts` with its source recorded. **None of
them was produced by running the implementation** — they are transcribed from BEDO's material via `docs/13 §1`
and `docs/22 §4.1`. That is what makes the physics suite a check rather than a snapshot.

| Quantity | Tolerance | Why |
|---|---|---|
| `Q(n)` | 1e‑6 absolute | Exact arithmetic; a looser bound would hide a transcription error |
| `v₀`, `v` | 1e‑4 absolute | The precision the reference table is printed to |
| `F_th` vs BEDO's column | 1e‑4 **relative** | BEDO's own sheet carries rounding — its 120° row implies a factor of 1.50006, not 1.5 (`docs/13 §1.4`). An absolute bound would fail on *their* rounding |
| Factor ratios, `F_o − F_th` | 1e‑9 | Pure identities; these must be exact |
| Momentum factors | 1e‑3 | The factors are themselves defined to three decimals (1.707) |

Two documented rounding artefacts, asserted rather than hidden:

- At n = 0.5 the reference simulator prints `v₀ = 5.74` and `v = 5.679`. Squaring the *displayed* `v₀` gives
  5.6799; carrying full precision, as this implementation does, gives 5.6774. Both are asserted, each against
  the chain it belongs to, and agreement with the printed row is claimed only to two decimals.
- BEDO's `Fth` column at n = 0.4 differs from ours by ≤ 4.3e‑5 relative — sheet rounding, not arithmetic.

**If a physics assertion fails, the equation is not the thing to change.** The evidence rule in the Phase 2
brief applies: produce the reference value that justifies the change first.

---

## 5. The GLB naming contract

The single highest-value test here, and the reason is in `src/lib/apparatus.ts:11‑26`: every mesh is resolved
with `getObjectByName(gltfName(authored))`, `getObjectByName` returns `undefined` for a name that is not there,
and every call site treats `undefined` as "nothing to animate". A renamed node therefore produces a **green
build, a silent app, and a part that never moves** — the failure mode that produced "the cover never moved" and
"seven deflectors visible inside the tank at once".

Strategy:

1. **Read the shipped asset, not a checked-in list.** `public/Bedo_baked_v2.glb` is parsed on every run, so a
   re-export is caught immediately. A frozen fixture would only ever catch code drift.
2. **Parse with the production analyser.** `tests/helpers/glb.ts` shells out to `scripts/analyze-glb.mjs` — the
   same tool that produced `docs/11 §3`. Re-implementing a GLB parser in the test would give it its own opinion
   of what a node name is, which is the exact class of divergence being tested for. One further test asserts
   the analyser's sanitiser and `gltfName()` agree across all 159 real node names.
3. **Use `gltfName()` as the contract.** The test never re-implements sanitisation; it applies the production
   helper to the authored names and looks the result up.
4. **Pin only real contracts** — the 33 names the runtime resolves (14 `MESH` entries, 7 shelf meshes,
   7 installed meshes, 5 weight discs). The other ~110 nodes are scenery and are deliberately not asserted.
5. **Check uniqueness both ways**: no two nodes in the export collapse onto one exposed name, and no two
   contract names collide after sanitising.
6. **Check the patterns the code assumes**: mounted deflectors keep their `.001` suffix, tray copies keep
   `_base`, and the nozzle/pin/tank keep the authored `JET Force 2_n` form that whitespace sanitising rewrites.

Failure output names the node. For a missing entry the message prints the label (`MESH.tankCover`), the
authored name, the name that was looked up, and the closest nodes that *do* exist in the export — and two tests
assert that message, so the diagnostics cannot rot.

Regenerate the human-readable node dump with `npm run glb:nodes`.

---

## 6. E2E strategy

**Goal:** prove the lesson is completable, not that pixels are identical. No screenshots, no coordinates.

- **Selectors** are roles and text (`Turn On Pump`, `+50g`, `Calculate`) plus a few stable structural classes
  the app already had (`.step-badge`, `.ok-confirm-btn`, `.data-table`, `.warning-popup`).
- **No sleeps.** Every wait is an assertion on application state. `openApp` waits for the readiness markers;
  each step asserts the step badge before acting.
- **Real progression.** The OK button is only visible when the lesson engine says the step is satisfied, so
  clicking through is itself the proof. A second test drives the negative cases: the valve below the setpoint
  and the tray under-loaded produce no confirm button at all.
- **CSS animations are frozen** with an injected stylesheet. The popups slide in over 300 ms and Playwright
  will not act on a moving element; with the render loop competing for the main thread that wait is unbounded.
  This changes appearance timing only, never behaviour.

### 6.1 The one production seam — the tank cover

Steps 1 and 3 press the tank cover, which exists **only** as a mesh inside the WebGL canvas, and the camera
reframes between steps. Clicking screen coordinates would be guessing at a moving target.

`src/App.tsx` therefore exposes exactly one handler on `window.__bedoTest.coverClick`, inside
`if (!import.meta.env.DEV) return;`. It is the same function the mesh calls, so the guards and the guided
transition both run — the lesson engine is not bypassed. `vite build` compiles `import.meta.env.DEV` to `false`
and drops the block, and `bundle.spec.ts` asserts the string `__bedoTest` is absent from `dist/`.

### 6.2 Why the lesson run stubs the model

With the real 26 MB model loaded under a software renderer, a single lesson step took **up to 44 seconds**
(measured) — every state change re-renders the scene, which is the known `PERF‑13`/`PERF‑16` defect that
BEDO‑002 does not fix. Left alone it would make the suite slow and flaky, and a suite nobody runs protects
nothing.

So the lesson and language tests serve a valid, empty GLB in place of the apparatus model
(`tests/e2e/stub-model.ts`). The app, the canvas, the DOM and the lesson engine are all real; only the 3D
content is empty. The real asset is still covered three ways: `readiness.e2e.ts` loads it in a browser,
`glb-contract.spec.ts` checks every name in it, and `assets.spec.ts` checks the file itself.

Run the whole browser suite against the real asset with:

```bash
BEDO_E2E_FULL_MODEL=1 npm run test:e2e
```

That path is verified, not aspirational: the twelve-step walkthrough passes against the real asset in
**6.7 minutes** (versus 17.5 s with the stub). The per-test timeout widens automatically when the flag is set.

---

## 7. Performance measurement (§10 of the task — infrastructure only)

`scripts/perf-baseline.mjs` reproduces the methodology frozen in `docs/11 §1`: the same WebGL prototype
counters injected into the page's **main world**, the same reset-then-settle sampling, the same VRAM
computation via `analyze-glb.mjs`, plus the new readiness marks for timing.

```bash
npm run build && npm run perf:baseline            # serves dist/ and measures it
node scripts/perf-baseline.mjs --url http://localhost:5179
node scripts/perf-baseline.mjs --headed --channel chrome --seconds 8   # closest to docs/11
```

It captures draw calls/frame, triangles/frame, framebuffer binds/frame, shader programs, frame-time
percentiles, texture VRAM, transferred bytes, `dist/` size, time to training-ready and time to scene-ready.
It writes JSON to `test-results/` and prints a ready-made `docs/11 §5` row. It asserts nothing and changes
nothing.

It refuses to run against a hidden tab — the `docs/11 §1.5` pitfall that invalidated the first Phase 1 attempt.

**Comparability.** The frozen baseline was taken in real Chrome on a GPU. Headless Playwright falls back to
SwiftShader: draw counts match exactly, every *timing* is far slower. The output records browser, channel,
renderer and headless flag so a row can never be misread later.

Run on 2026‑08‑20 against the production build, headless/SwiftShader:

| Metric | This run | `docs/11` baseline |
|---|---|---|
| Draw calls / frame | **769.0** | 769.0 ✅ |
| Triangles / frame | **217 055** | 217 055 ✅ |
| Framebuffer binds / frame | **22** | 22 ✅ |
| Shader programs | 42 | 35 *(different browser build)* |
| Texture VRAM | **764.45 MB** | 764 MB ✅ |
| Apparatus GLB | 25.92 MB | 26 MB ✅ |
| `dist/` | 95.28 MB | 95 MB ✅ |
| Initial transfer | 27.02 MB (14 resources) | ≈ 27 MB ✅ |
| App shell ready | 452 ms | — *(new marker)* |
| Training ready | 451 ms | — *(new marker)* |
| Scene ready | 22 180 ms | 15–20 s observed by eye |
| fps (idle) | 1.3 (p50 808 ms) | 60 fps *(GPU host — not comparable)* |

The GPU counters reproduce the frozen baseline exactly, which is the evidence that the methodology is
genuinely reproducible.

---

## 8. Loading instrumentation

Three markers, added by `src/lib/readiness.ts` (~30 lines, no state, no rendering):

| Milestone | Attribute on `<html>` | `performance.mark` | Set by |
|---|---|---|---|
| App shell mounted | `data-bedo-app-ready` | `bedo:app-ready` | `App` |
| Training panel usable | `data-bedo-training-ready` | `bedo:training-ready` | `UIOverlay` |
| Apparatus model in the scene graph | `data-bedo-scene-ready` | `bedo:scene-ready` | `DeviceModel` |

The attribute value is `performance.now()` at the moment it happened, and the first write wins so a re-render
cannot move a milestone. Nothing in the application reads them.

---

## 9. Known gaps and defects found

Found while writing this suite. **None is fixed here** — BEDO‑002 is additive and behaviour-neutral.

1. **Popups are unreachable once the software monitor is open.** `.warning-popup` and `.monitor-fullscreen`
   both use `z-index: 100`, and the monitor renders later in the DOM, so it paints on top. From step 10 onward
   every guard message and every observation popup — including step 11's, which the experiment sheet
   specifies — is hidden behind the monitor and its OK button cannot be clicked at all. The E2E dispatches the
   click instead of performing it, and says so at the call site. **New finding; needs a task.**
2. **RTL is a class with no rules.** `lang`/`dir` on `<html>` never change, and `.rtl` only matches
   `.warning-popup` in `index.css`. The language smoke test asserts what genuinely happens and no more. This is
   the audit's `BUG‑09` → `BEDO‑037`.
3. **No lever-arm constant exists.** The task's "lever/geometry constant" is not in the code: `F_ac` is
   `m·g` with no moment ratio, and the geometry constants that do exist (nozzle area, 35 mm travel height,
   200 N/m spring rate) are pinned instead. If the rig's lever ratio is not 1:1, the domain is missing it —
   worth confirming against BEDO before `BEDO‑005`.
4. **Deflector selection is not scoped to the loaded experiment.** Clicking a 180° deflector during Exp. 1 is
   accepted. Current behaviour is pinned as-is; the audit tracks it as `BUG‑05` → `BEDO‑022`.
5. **3D clicks are not step-gated.** Hotspots dispatch at any step; only the five safety guards refuse. Pinned
   as-is; `BUG‑04` → `BEDO‑020`.
6. **Row 4 of the results table is fabricated** (`n = 0.6`, never measured) and row 1 is a zero row. Pinned as
   today's behaviour; `BUG‑14`/`BUG‑15` → `BEDO‑009`.
7. **Twelve steps vs eleven.** Preserved and tested at twelve, deliberately. The evidence is now gathered in
   `docs/27`: BEDO's own shipped simulator has ten numbered steps *including* the volumetric valve, so the
   build is the union of two differing BEDO sources rather than an invention. The decision itself
   (`BEDO‑041` / `D‑2`) still belongs to BEDO, and these tests stay pinned to twelve until it is made.

### Not covered yet (deliberately)

Visual regression, accessibility (axe), cross-browser (webkit/firefox), memory-leak soak, coverage
thresholds, the 3D transform assertions in `docs/22 §5` (weight stacking, plume geometry, spring travel), and
the free-mode and multi-experiment matrices. `docs/22 §3` remains the target pyramid; BEDO‑002 builds its
foundation, not its roof.

---

## 10. Future test work

| Next | Why | After |
|---|---|---|
| Move `lesson-flow.spec.tsx` assertions onto the extracted state machine | Faster, and tests the rules directly | `BEDO‑006` |
| Full transition-table spec (`docs/13 §5`) | Every cell, including the two missing behaviours | `BEDO‑006` |
| 3D transform specs — weight stacking, plume extent, spring travel | The `BUG‑02`/`BUG‑03` class needs geometry assertions | `BEDO‑013` |
| Experiment × language E2E matrix | Currently Exp. 1 only | `BEDO‑018` |
| Visual regression + a11y | `docs/22 §2` | `BEDO‑025`, `BEDO‑036` |
| Coverage thresholds on `domain/` | Cheap once the domain is isolated | `BEDO‑005` |
| Boundary lint (`docs/22 §7`) | Layering is only real if checked | `BEDO‑005` |
