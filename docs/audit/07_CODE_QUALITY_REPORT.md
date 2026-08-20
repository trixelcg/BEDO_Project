# 07 — Code Quality Report

Covers TypeScript rigour, React and R3F patterns, naming, duplication, dead code, styling approach and
maintainability. Architectural structure is in `02_ARCHITECTURE_AUDIT.md`; this document is about the code
itself.

**Baseline facts.** `tsc -b` exits **0**. `oxlint` reports **10 warnings, 0 errors**. There are **0 tests**.
Total: 5 253 lines in `src`, 804 in `api`, 182 in `server.ts`.

---

## Index

| ID | Title | Severity | Difficulty | Priority |
|---|---|---|---|---|
| CQ‑01 | `strict` is not enabled — the whole type system is opt‑out | High | Moderate | P0 |
| CQ‑02 | `as any` at every GLB boundary defeats typing where it matters most | High | Moderate | P1 |
| CQ‑03 | Zero tests, zero CI | High | Moderate | P1 |
| CQ‑04 | Dead code: unused types, constants, state fields and exports | Medium | Trivial | P1 |
| CQ‑05 | Vestigial naming from the forked project (`character*`) | Medium | Trivial | P1 |
| CQ‑06 | Duplicated logic in four places | Medium | Easy | P1 |
| CQ‑07 | 110 inline style objects; no styling system | Medium | Moderate | P1 |
| CQ‑08 | Magic numbers throughout the 3D layer | High | Moderate | P1 |
| CQ‑09 | A 272‑line `useFrame` doing eleven unrelated jobs | High | Hard | P0 |
| CQ‑10 | Variable‑length hook dependency arrays with suppressed lint | Medium | Easy | P1 |
| CQ‑11 | Derived state stored in state | Medium | Easy | P1 |
| CQ‑12 | Two lint warnings on missing `pick` dependency | Low | Trivial | P2 |
| CQ‑13 | `README.md` is the untouched Vite template | Medium | Trivial | P1 |
| CQ‑14 | 784 lines of `api/` from an unrelated product | Medium | Trivial | P1 |
| CQ‑15 | Empty `catch {}` blocks swallow errors | Medium | Trivial | P2 |
| CQ‑16 | `console.log` / `alert` as the error‑reporting strategy | Medium | Trivial | P2 |
| CQ‑17 | Two colour palettes coexist in one stylesheet | Medium | Easy | P1 |
| CQ‑18 | `.claude/settings.local.json` references a stale foreign path | Low | Trivial | P3 |
| CQ‑19 | `push.sh` blind‑commits everything with a canned message | Low | Trivial | P2 |
| CQ‑20 | `@types/three` declared as a runtime dependency | Low | Trivial | P2 |
| CQ‑21 | 110 MB `.git` from committed binary assets | Medium | Moderate | P2 |

---

### CQ‑01 — `strict` is not enabled

**Severity:** High **Difficulty:** Moderate **Priority:** P0

**Description.** `tsconfig.app.json` enables `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` and
`noFallthroughCasesInSwitch` — but **not** `strict`, and therefore not `strictNullChecks`,
`noImplicitAny`, `strictFunctionTypes` or `noUncheckedIndexedAccess`. `tsc` passing tells you very little.

Real consequences visible in the code:
- `ROW_VALVE_SETTINGS[1]` and `[2]` (`physics.ts:45‑46`) are typed `number`, not `number | undefined`.
- `prev.recordedRows[idx]?.loadedWeights ?? []` (`App.tsx:155`) needs the optional chain, but
  `recordedRows[balanceRow]` (`UIOverlay.tsx:99`) does not use one and is typed as a definite `RecordRow`.
- `experiment.quiz[0]` (`SoftwareMonitor.tsx:123`) is assumed non‑empty and dereferenced immediately.
- `err: any` in catch blocks throughout.

**Recommended solution.** Turn on `"strict": true` and `"noUncheckedIndexedAccess": true`. Expect a few dozen
errors; each one is a latent runtime failure. Do this **before** Phase 2 code is written, not after.

---

### CQ‑02 — `as any` at every GLB boundary

**Severity:** High **Difficulty:** Moderate **Priority:** P1

**Description.** The interface between the typed application and the untyped 3D scene is the highest‑risk seam
in the project, and it is entirely untyped:

```ts
const { scene } = useGLTF('/Bedo_baked_v2.glb') as any;                    // DeviceModel:90
low: useGLTF(WATER_SHAPES.low.url) as any, /* ×8 */                        // :94-101
const source = (water as any)[key]?.scene;                                 // :429, 1129
scene.traverse((child: any) => { … child.isMesh … child.material … })      // :181, 390, 523, 776, 810, 829
const lampMat = (pick(MESH.powerLight) as THREE.Mesh|undefined)?.material as any;  // :939
const controls = useThree((s) => s.controls) as any;                       // Scene3D:77
```

Every field access on a GLB node — `isMesh`, `material`, `morphTargetInfluences`, `emissive`, `visible` — is
unchecked. This is exactly the class of error the `apparatus.ts:11‑26` comment describes: *"getObjectByName on
the authored name therefore returns undefined and fails silently"*. The type system could have caught it and was
disabled at that boundary.

**Recommended solution.** Type the loader result (`GLTF` from `three-stdlib`, or generate types with
`gltfjsx`). Write narrow type guards — `isMesh(o): o is THREE.Mesh`, `hasStandardMaterial(m)`. Then build a
**validated refs layer** (`ARCH‑01`) that resolves every `MESH` name once and **throws loudly at load** if any
is missing, instead of failing silently at frame 3 000.

---

### CQ‑03 — Zero tests, zero CI

**Severity:** High **Difficulty:** Moderate **Priority:** P1

**Description.** No test runner, no spec files, no GitHub Actions workflow. The most testable code in the
project is completely untested:
- `physics.ts` — five pure functions with documented reference values sitting right there in the comments.
- `apparatus.ts` — `gltfName()` is a pure string transform; every `MESH` name and deflector name is checkable
  against the GLB.
- The state machine in `App.tsx` — 14 handlers, five guards, twelve steps, all pure decisions on a plain object.

The bugs this would have caught: `BUG‑14` (fabricated rows), `BUG‑15` (two filters for one series), `BUG‑06`
(Free mode records nothing), `BUG‑05` (cross‑experiment deflector), `BUG‑27` (nozzle name points at the wrong
mesh).

**Recommended solution.** Vitest + three spec files as the first Phase‑2 commit; a `apparatus.contract.test.ts`
that loads the real GLB's node‑name list from a checked‑in JSON fixture and asserts every constant resolves;
Playwright for one full twelve‑step walkthrough. A GitHub Action running `tsc --noEmit`, `oxlint`, `vitest`, and
an asset‑budget check.

---

### CQ‑04 — Dead code

**Severity:** Medium **Difficulty:** Trivial **Priority:** P1

Verified by exhaustive grep across `src/`:

| Symbol | Location | Status |
|---|---|---|
| `DeflectorOption` | `types/index.ts:3‑8` | never referenced — superseded by `DeflectorDef` |
| `StepDefinition` | `types/index.ts:10‑16` | never referenced — superseded by `ExperimentStep` |
| `pointerOffset` | `types/index.ts:66`, `App.tsx:60` | initialised to `0.0`, **never read or written again** |
| `targetMassG` | `physics.ts:94‑98` | exported, never imported |
| `FRONT` | `apparatus.ts:269` | exported, never imported (the comment above it is valuable — keep the comment) |
| `MESH.powerButtonBody` | `apparatus.ts:53` | never referenced |
| `MESH.liquid` | `apparatus.ts:55` | referenced only to hide a degenerate sliver (`BUG‑28`) |
| `DEFAULT_ARROW_OFFSET` | `apparatus.ts:255` | used, but only one anchor ever uses the default |
| `.header-area` | `index.css:118‑125` | no component uses this class (`BUG‑08`) |
| `.step-container` | `index.css:173‑178` | unused |
| `--glass-gradient` | `index.css:33` | declared, never used |
| `src/assets/hero.png`, `react.svg`, `vite.svg` | | never imported |
| `public/icons.svg` | | never referenced |
| `public/Bedo_M.glb` (17 MB) | | never referenced |
| `public/Bedo_model_optimized.glb` (1.7 MB) | | never referenced |
| `public/WaterShapes/*.abc` (20 MB) | | never referenced |
| `api/chat.ts`, `tts.ts`, `crawl.ts`, `register.ts`, `upload.ts`, `gcsStorage.ts` | | never called by `src/` |
| `framer-motion`, `@react-three/postprocessing` | `package.json` | never imported |

Note `noUnusedLocals` is on, which catches unused *locals* but not unused *exports* — hence the accumulation.

---

### CQ‑05 — Vestigial naming from the forked project

**Severity:** Medium **Difficulty:** Trivial **Priority:** P1

**Description.** `SceneConfig` — the type that positions the **hydraulics apparatus** — declares:

```ts
characterPosition: [number, number, number];
characterRotation: [number, number, number];
characterScale:    [number, number, number];
```

There is no character. These are the apparatus's transform, carried over from the TTS‑avatar product this repo
was forked from. The same fork left `handleSaveConfig` posting `characterUrl`, `locationUrl`, `visemeMap` and
two `apiKey` fields (`App.tsx:110‑119`), and `MenuSettings` labels its own section "Apparatus Transformations"
while binding to `character*` fields.

Other naming problems:
- `SimulationState.mode` vs `ExperimentDef.id` vs `ExperimentId` vs `DeflectorFamily` — `ExperimentId` is an
  alias of `DeflectorFamily`, so an *experiment* is typed as a *deflector family*.
- `RecordRow.springhW` — unreadable; it means "spring deflection h_W in mm".
- `RecordRow.totalFlowValue` holds `qTotal`; `RecordRow.mass` is the *unrounded* target while `idealMass` is
  rounded and `actualWeightMass` is what is loaded — three masses with no unit suffixes.
- `MESH.volumetricValve = 'hydrolic bensh 1_087'` — carries an authoring typo into the code (unavoidable, but
  the constant name is doing the right job).
- `LabEnvironment`, `RendererController`, `ModelLoadingPlaceholder` are all declared inside `Scene3D.tsx`.

**Recommended solution.** Rename `character*` → `apparatus*`; add unit suffixes (`massG`, `deflectionMm`,
`forceN`, `flowLMin`); separate `ExperimentId` from `DeflectorFamily` even if they currently coincide; strip the
avatar fields from the config payload.

---

### CQ‑06 — Duplicated logic

**Severity:** Medium **Difficulty:** Easy **Priority:** P1

| # | Duplication | Locations |
|---|---|---|
| 1 | The cover safety guard (power on / weights loaded) | `App.tsx:198‑201` **and** `DeviceModel.tsx:724‑727` |
| 2 | Valve‑ready predicate `valveOpening >= SETPOINT - MARGIN` | `App.tsx:260‑263`, `UIOverlay.tsx:94‑96`, `DeviceModel.tsx:701‑702` — three copies |
| 3 | Balance‑row mapping (step → row index) | `App.tsx:73` (`BALANCE_ROW`) and `UIOverlay.tsx:98` (a ternary) |
| 4 | Tray deflector / tray weight name lists | `DeviceModel.tsx:578‑579` and `:667‑668` — rebuilt twice |
| 5 | Step‑done predicate | `DeviceModel.tsx:696‑705` (arrow) and `UIOverlay.tsx:106‑112` (OK button) — two different formulations of the same thing |
| 6 | `mimeTypes` map | `server.ts:123‑126`, `server.ts:146‑159`, `api/save-config.ts:23‑32` — three copies |
| 7 | GCS `Storage` init + try/catch warning | `server.ts:13‑18`, `api/save-config.ts:12‑18`, `api/gcsStorage.ts:11‑17`, `api/register.ts:4‑9` |
| 8 | Metadata‑token fetch + cache | `api/chat.ts:10‑32` and `api/tts.ts:6‑33` |

Duplication #5 is the dangerous one: the guide arrow disappears when *its* definition of "done" is met, and the
OK button appears when *another* definition is met. They can and do disagree.

`physics.ts:1‑5` opens with a comment noting this exact problem was already fixed once for the physics
("*This lived twice — once in App.tsx and once in DeviceModel.tsx — and both copies carried the same typo*").
The same medicine should be applied to the predicates.

---

### CQ‑07 — 110 inline style objects; no styling system

**Severity:** Medium **Difficulty:** Moderate **Priority:** P1

**Description.** `style={{…}}` count: `UIOverlay` **49**, `MenuSettings` **38**, `SoftwareMonitor` **23**.
Layout, colour, spacing and state styling are all expressed as JS object literals recreated on every render
(`PERF‑14`). Some are large — `UIOverlay.tsx:154‑161` sets six properties inline on a button that already has a
`.lang-btn` class with conflicting values.

Consequences: styles are unsearchable, untestable, unthemable, cannot express `:hover`/`:focus`, cannot respond
to media queries, and drift from the stylesheet — which is precisely how `BUG‑08` (a class with no rule) and
`BUG‑26` (a shadow that survives an inline override) happened.

**Recommended solution.** CSS Modules (or Tailwind, or vanilla‑extract — any of them, consistently). Variants
via `data-*` attributes. Reserve inline styles for genuinely dynamic values (a computed transform).

---

### CQ‑08 — Magic numbers throughout the 3D layer

**Severity:** High **Difficulty:** Moderate **Priority:** P1

**Description.** Unlike `physics.ts` — where every constant is named, unit‑annotated and justified — the 3D
layer is dense with unexplained literals:

```ts
COVER_LIFT = 0.286;  SCREW_LIFT = 0.36;                      // apparatus.ts:222-223  (BUG-20)
cover: { offset: [-0.52, 0.22, 0.34] }, /* ×9 anchors */      // apparatus.ts:275-287  (RND-11)
if (a > 0.05) {…} if (a > 0.8) {…} if (a > 2.2) {…}           // DeviceModel.tsx:888-898
damp(x, y, 6) / damp(x, y, 4) / damp(x, y, 10) / damp(x, y, 12)
minDeflection = -0.45 * restH; maxDeflection = 0.45 * restH;  // :956-957
restH fallback 0.065                                          // :955
shape = valveOpening > 0.22 ? … : 'low'                       // :1023
startup = min(1, valveOpening * 4.5)                          // :1040
scaleXZ = tankBounds.width * 0.10 / fit.width                 // :1042
scaleXZ = tankBounds.width * 0.95 / fit.width                 // :1055  (BUG-03)
flowIntensity = 0.7 + 0.3 * min(1, (n - 0.22)/0.48)           // :1054  (BUG-21)
pulse = sin(t*5.0)*0.12 + 0.26;  glow 0.7                     // :873-876
radius = clamp(worldRadius/modelScale, minRadius, 0.18)       // :639
upright = asIs.size.z > asIs.size.y * 1.15                    // :437
0.16 * rise, 0.9, 5.0, 0.7, 3.9, 6.0, 1.2, 4.5, 7.5, 1.8, 2.2, 1.5 …  // the water shader
```

Each was tuned by eye, and `git log` is the record: *"Update Upper Plate offset to 5m"* → *"to 20m"* →
*"to 0.5m"* → *"lift displacement to 0.4m"* → the current 0.286. Nothing records what the number means, so every
adjustment is a fresh guess.

**Recommended solution.** Derive from measured geometry wherever possible (the codebase already does this well
for anchors and hotspots — extend it). Where a value is genuinely artistic, name it, give it a unit, and put it
in one `tuning.ts` with a comment stating what it controls and what it was tuned against.

---

### CQ‑09 — A 272‑line `useFrame`

**Severity:** High **Difficulty:** Hard **Priority:** P0

**Description.** `DeviceModel.tsx:839‑1110` is one callback performing eleven unrelated jobs: highlight
management, the unscrew/reseat sequence, flow valve, volumetric valve, power switch, lamp, jet force + spring
deflection, pointer kinematics, cover‑assembly lift, water jet placement/scale/shader time, weight stack, tray
weight visibility, cover hotspot tracking, and the guide‑arrow bob.

It contains a nested helper (`damp`), a second nested helper (`lift`), calls `pick()` 15+ times per frame
(`PERF‑06`), reads eight pieces of React state from its closure, mutates six refs, and **calls a React setter
(`onCoverClick()`) from inside the frame loop** (`:897`).

**Recommended solution.** See `ARCH‑01`. One `useFrame` per animated subsystem, each in its own component with
its own refs, tested in isolation where possible.

---

### CQ‑10 — Variable‑length dependency arrays with suppressed lint

**Severity:** Medium **Difficulty:** Easy **Priority:** P1

```ts
}, [...waterGltfs, waterMaterial]);   // DeviceModel.tsx:398-399, eslint-disable
}, [...waterGltfs]);                  // :449-450,               eslint-disable
```

React requires dependency arrays of **constant size between renders**. These are constant only because
`WATER_SHAPES` has exactly eight entries — a fact enforced nowhere. Adding or removing a plume silently breaks
the hooks contract, and React will warn or misbehave. The `eslint-disable` hides it.

**Recommended solution.** Depend on a single stable value (e.g. a `useMemo`'d key string derived from the
loaded URLs), or restructure so the plumes are children that each own their own effect.

---

### CQ‑11 — Derived state stored in state

**Severity:** Medium **Difficulty:** Easy **Priority:** P1

`recordedRows` is a pure function of `(selectedDeflectorId, loadedWeights, currentStep, currentRecordIndex,
qTotal)` and is nonetheless stored inside the same `SimulationState` and written by a `useEffect`
(`App.tsx:146‑169`). Every interaction therefore costs an extra render pass, and the effect's dependency list is
a manual restatement of the derivation that has already drifted — `state.valveOpening` is missing, which is one
half of `BUG‑06`.

**Recommended solution.** `useMemo` or a store selector. Never `useEffect` + `setState` for derived data.

---

### CQ‑12 — Outstanding lint warnings

`oxlint` reports 10 warnings, all real:

```
src/components/DeviceModel.tsx:537  react-hooks(exhaustive-deps): missing dependency 'pick'
src/components/DeviceModel.tsx:563  react-hooks(exhaustive-deps): missing dependency 'pick'
server.ts:36 / api/*                no-unused-vars ×8 (unused imports, unused catch params,
                                    `getDestName` declared but never used in save-config.ts:37)
```

The `pick` omissions are currently harmless (`pick` is stable via `useCallback([scene])`) but the warning is
correct and should not be standing.

---

### CQ‑13 — `README.md` is the Vite template

**Severity:** Medium **Difficulty:** Trivial **Priority:** P1

The repository's README is verbatim *"React + TypeScript + Vite — This template provides a minimal setup…"*.
Nothing documents what the project is, how to run it, the GLB naming contract, the physics assumptions, the
deployment procedure, or the environment variables. For a project whose central difficulty is
*"which mesh name corresponds to which physical part"*, this is a significant onboarding cost — and that
knowledge currently survives only as comments inside `apparatus.ts`.

---

### CQ‑14 — 784 lines of foreign `api/` code

See `ARCH‑14` and `ARCH‑09`. Beyond being dead weight, `chat.ts` contains a hard‑coded Arabic assistant persona
prompt and `save-config.ts` contains a helper (`getDestName`) that is declared and never used. All of it should
be deleted.

---

### CQ‑15 — Empty catch blocks

```ts
} catch (e) { body = bodyData; }                    // server.ts:36
} catch (err) { /* metadata server not available */ } // api/chat.ts:28
} catch (e) {}                                       // api/save-config.ts:46
.catch(() => { console.log('Using default…'); });    // App.tsx:105-107
```

Four silent failure paths. `App.tsx`'s is the one that matters — a genuinely failed config fetch is
indistinguishable from the normal 404 (`BUG‑24`).

---

### CQ‑16 — `console.log` and `alert` as the error strategy

There is no logging abstraction, no error reporting, no telemetry. User‑facing failures use `alert()`
(`App.tsx:129, 131, 134, 410`), developer‑facing ones use `console.log`. In production nobody will ever learn
that a student's model failed to load.

**Recommended solution.** A tiny `logger` module, an error boundary (`ARCH‑15`), and — if the client permits —
an error‑reporting endpoint. At minimum, surface load failures to the student with a retry.

---

### CQ‑17 — Two colour palettes in one stylesheet

**Severity:** Medium **Difficulty:** Easy **Priority:** P1

`:root` defines `--accent-blue: #f58220` (orange) and `--accent-gold: #ff9100` (orange). Meanwhile ~30 rules
still hard‑code the pre‑rebrand cyan `rgba(0, 229, 255, …)` for hovers, glows, badges and borders — for example
`.glass-card:hover`, `.logo-container`, `.step-badge`, `.btn-primary:hover`, `.data-table th`,
`input[type=range]::-webkit-slider-thumb`. `--glass-bg` is used but never declared (`BUG‑07`);
`--glass-gradient` is declared but never used. The result is a UI that is orange in some states and cyan in
others, and a chart whose two series are the same colour (`BUG‑11`).

**Recommended solution.** One token file with **semantic** names, a contrast‑ and colour‑blindness‑validated
palette, and a lint rule banning raw colour literals in component styles.

---

### CQ‑18 — Stale local settings

`.claude/settings.local.json` allows a `swift` command against a scratch path from a **different project
directory** (`.../BEDO-Project-R3F/572a5a07-.../crop.swift`). Harmless, but it is checked in and stale.

---

### CQ‑19 — `push.sh`

```bash
MSG=${1:-"style: update layout and configuration settings"}
git add .   # everything, including build output and stray binaries
git commit -m "$MSG"
git push
```

`git add .` with a default message of *"style: update layout and configuration settings"* is how a 110 MB `.git`
happens (`CQ‑21`) and how commits end up mislabelled. Several commits in the log carry generic subjects.

---

### CQ‑20 — `@types/three` as a runtime dependency

`package.json:14` lists `@types/three` under `dependencies`. It belongs in `devDependencies`. (Note also that
three ≥ r150 ships its own types, so this package may be redundant entirely.)

---

### CQ‑21 — 110 MB `.git`

**Severity:** Medium **Difficulty:** Moderate **Priority:** P2

Multiple 17–27 MB GLBs plus a 28 MB MP4 have been committed, replaced and renamed over 48 commits — including
`Bedo_baked_integration.glb`, `Bedo_baked.glb`, `Bedo_baked_v2.glb`, `Bedo_M.glb` and
`Bedo_model_optimized.glb`, and the eight `.glb` plume files were each committed twice. Every clone pays for
all of it forever.

**Recommended solution.** Move binary assets to Git LFS or an asset bucket with a manifest. If history size
becomes a real problem, a filtered rewrite is possible but should be a deliberate, coordinated decision.

---

## What the code does well

These are genuinely good and should be preserved:

1. **`src/lib/physics.ts`** — the best file in the repository. Named constants with units, functions that are
   pure and total, and comments that record *what was wrong before, why, and what reference value proved the
   fix* (`physics.ts:18‑26, 35‑46, 61‑69`). This is exemplary domain code.
2. **`src/lib/apparatus.ts:11‑26`** — the `gltfName()` explanation is the single most valuable comment in the
   project. It documents a silent‑failure mode that cost the team weeks. Keep it verbatim.
3. **`src/lib/experiments.ts`** — clean, declarative, bilingual, with the derivations transcribed and the
   non‑obvious factor choice defended (`apparatus.ts:105‑117`, explaining why `1 − cos θ` is *wrong* for the
   oblique family). Data, not code.
4. **Deriving anchors and hotspots from real bounding boxes** (`DeviceModel.tsx:545‑655`) instead of hard‑coding
   coordinates — the right instinct, and it survives model re‑exports.
5. **`THREE.MathUtils.damp`** replacing frame‑rate‑dependent lerp (`:843‑854`), with a comment explaining the
   exact runaway‑extrapolation failure it fixes. Correct and well reasoned.
6. **`clearGlow` disposes its cloned materials** (`:826‑837`) — the one place resource lifetime is handled
   properly.
7. **Tagged‑union actions** for hotspots (`:29‑35`) with an exhaustive `switch` — idiomatic TypeScript.
8. **The comments explain *why*, not *what*.** Throughout, the codebase documents reasoning and prior failures
   rather than restating the code. That is unusual and valuable; whoever wrote them made this audit far faster.

**The pattern across all eight:** the *domain* code is disciplined; the *3D and UI* code is not. Phase 2 should
carry the domain layer across untouched and rebuild the rest around it.
