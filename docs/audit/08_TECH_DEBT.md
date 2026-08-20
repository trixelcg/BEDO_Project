# 08 — Technical Debt Register

This document is the **ledger**: what is owed, why it accrued, what interest it charges, and what it costs to
repay. Individual defects are catalogued in documents 03–07; this is the strategic view that feeds
`09_REBUILD_STRATEGY.md`.

---

## 1. How the debt accrued — the evidence

`git log` tells the story precisely. 48 commits over 12 days (2 Jul – 14 Jul 2026), and:

| File | Commits touching it | Share |
|---|---|---|
| `src/components/DeviceModel.tsx` | **42** | 88 % |
| `src/components/Scene3D.tsx` | 13 | 27 % |
| `src/App.tsx` | 11 | 23 % |
| `src/lib/physics.ts` | 2 | 4 % |

The commit subjects for the cover‑lift constant alone:

```
2026-07-08  Update Upper Plate offset to 5m (2.32 local units) and screws offset to 6.5m
2026-07-08  Update Upper Plate offset to 20m, screws to 25m, and spring/jet force objects to 15m
2026-07-09  Update Upper Plate/Tank_cover lift offset to 0.5m, Screws to 0.7m, and active deflector/spring/rods to 0.65m
2026-07-09  ... update cover lift displacement to 0.4m ...
(current value: COVER_LIFT = 0.286, SCREW_LIFT = 0.36 — and the screws still detach, BUG-20)
```

And for the weight stack:

```
2026-07-14  Separate inner rod/pointer assembly deflection from cover offset ... hide loaded table weights ...
2026-07-14  Reparent deflector rod, spring, active deflector, and weight stack to rise with cover plate offset
2026-07-14  Fix added weights alignment by restoring original clone transform mappings ...
2026-07-14  Fix added weights hole alignment by using proto translation coordinates ...
(current state: the weights render 2.18 m from the pan — BUG-02)
```

**This is the signature of debt, not of carelessness.** The team is competent — the physics is correct, the
comments are excellent, the GLB name‑sanitisation problem was diagnosed and fixed properly. What they lacked was
a structure that made a change *verifiable*. With no seams, no tests, and geometry facts scattered as magic
numbers, every fix was an empirical guess whose only validation was a screenshot, and each guess destabilised
the previous one.

**The debt is not the bugs. The debt is the absence of the structure that would have prevented them.**

---

## 2. The register

Interest = what this costs *per unit of future work*, not what it costs today.

| ID | Debt | Principal (to repay) | Interest (ongoing cost) | Severity | Prio |
|---|---|---|---|---|---|
| TD‑01 | **God component** — `DeviceModel.tsx`, 1 197 lines, 42/48 commits | 1–2 w | Every 3D change risks every other 3D behaviour; nothing testable | Critical | P0 |
| TD‑02 | **Unbudgeted assets** — 26 MB GLB, 764 MB VRAM, 39 MB dead files | 3–5 d | Every session pays 15–20 s; target hardware cannot run it | Critical | P0 |
| TD‑03 | **No tests, no CI** | 3–5 d | Every change is validated by eye; regressions ship | Critical | P0 |
| TD‑04 | **Forked-project residue** — `api/*`, `character*`, `SceneConfig` avatar fields | 1 d | Live security exposure (`ARCH‑09`); misleading names | Critical | P0 |
| TD‑05 | **No design system** — 110 inline styles, 2 palettes, undefined tokens | 3–5 d | Every UI change is a fresh guess; visual bugs recur | High | P1 |
| TD‑06 | **`strict` off + `as any` at the GLB boundary** | 2–3 d | The type system provides no safety exactly where it's needed | High | P0 |
| TD‑07 | **Magic numbers as the 3D contract** | 3–5 d | Every geometry fix is trial and error; see the commit log above | High | P1 |
| TD‑08 | **Rules duplicated in 8 places** | 2 d | Fixes applied to one copy; surfaces disagree (`CQ‑06`) | High | P1 |
| TD‑09 | **Prop-drilled monolithic state** | 3–5 d | Re-render cost; UI and 3D cannot evolve independently | High | P0 |
| TD‑10 | **No accessibility layer** | 1–2 w | Retrofit cost grows with every feature; likely procurement blocker | High | P1 |
| TD‑11 | **No i18n infrastructure** (strings inline, RTL a no-op) | 3–5 d | Every string is added twice by hand; RTL never improves | High | P1 |
| TD‑12 | **No loading/error/resilience layer** | 2–3 d | Any failure = black screen; no diagnostics from the field | High | P1 |
| TD‑13 | **Hand-rolled static server** (no Range, wrong cache headers, dynamic import) | 1–2 d | Video broken; model cache poisoned for a year | High | P1 |
| TD‑14 | **No audio system** | 3–5 d | A whole feedback channel absent; grows with each new step | Medium | P1 |
| TD‑15 | **Dev tooling shipped to production** (`MenuSettings` + `save-config`) | ½ d | Any student can alter the deployment for everyone | High | P1 |
| TD‑16 | **110 MB `.git`; binaries in history** | 1 d (LFS) | Slow clones and CI forever | Medium | P2 |
| TD‑17 | **No documentation** (README is the Vite template) | 2 d | Onboarding cost; GLB naming contract lives only in comments | Medium | P1 |
| TD‑18 | **Simulation fidelity gaps** (volumetric tank, sump, drag-install) | 1–2 w | Feature gap vs. the reference product; scope unknown until refs arrive | Medium | P2 |

**Total estimated principal: ≈ 10–14 developer-weeks** if repaid as a structured rebuild of the presentation
layers, preserving the domain layer. Repairing in place, defect by defect, would cost more and leave the
generative causes intact.

---

## 3. Debt by generative cause

Grouping by *why* rather than *what*, because Phase 2 must fix the causes, not the symptoms.

### Cause A — No verification loop (TD‑03, TD‑06, TD‑07, TD‑08)

Nothing in the project can be checked except by looking at it. There is no test, no type guarantee at the 3D
boundary, no assertion that a mesh name resolves, no budget check, no CI. Every geometry constant was arrived at
by iteration against a screenshot.

**Highest-leverage repayment:** a `apparatus.contract.test.ts` that loads the GLB node list and asserts every
`MESH` constant, every `shelf`, every `installed` name and the nozzle diameter. It is perhaps 60 lines and would
have prevented `BUG‑27`, the entire class of silent‑lookup failures described in `apparatus.ts:11‑26`, and every
"the model was re‑exported and things broke" incident in the log.

### Cause B — No seams (TD‑01, TD‑09)

One 1 197-line component and one 18-field state object mean there is no unit smaller than "the whole 3D scene"
to change, test or reason about. This is why 88 % of commits land in one file.

### Cause C — No budgets or contracts (TD‑02, TD‑05, TD‑07)

Nothing declares the target device, the VRAM ceiling, the draw-call ceiling, the colour palette, the spacing
scale, or the units of a geometry constant. Without a declared limit, every addition is individually defensible
and the aggregate is 764 MB of texture and 769 draw calls.

### Cause D — Inherited scope (TD‑04, TD‑15)

The repository was forked from a TTS-avatar product. 784 lines of `api/`, the `character*` naming, the
`visemeMap`/`ttsConfig`/`aiConfig` config payload, and the runtime scene-tuning panel all came along for the
ride. This is the only debt category that is **actively dangerous today** — see `ARCH‑09`.

### Cause E — Deferred cross-cutting concerns (TD‑10, TD‑11, TD‑12, TD‑14, TD‑17)

Accessibility, i18n direction, loading, error handling, audio and documentation were each deferred. All five are
cross-cutting: retrofitting them touches every component, so the cost grows super-linearly with the size of the
codebase. They should be established as *infrastructure* at the start of Phase 2, not added at the end.

---

## 4. Immediate liabilities — repay before anything else

These are not "debt" in the amortised sense; they are live exposures.

| # | Liability | Why now |
|---|---|---|
| 1 | **`/api/chat` + `/api/tts`** grant anonymous callers Vertex AI and Google TTS **billed to the project** | Ongoing, unbounded financial exposure on a public URL |
| 2 | **`/api/upload`** writes arbitrary public objects into the GCS bucket | Anyone can host arbitrary files on a Google-owned domain via your project |
| 3 | **`/api/save-config`** downloads attacker-supplied URLs, publishes them, and rewrites the global scene config | Abuse vector **and** a student can break the app for their whole class |
| 4 | **`/api/crawl`** is an open SSRF proxy | Reaches internal endpoints from inside your VPC |
| 5 | **`/api/register`** unauthenticated, unrate-limited bucket writes | Storage abuse |

**Action:** delete `api/chat.ts`, `api/tts.ts`, `api/crawl.ts`, `api/upload.ts`, `api/register.ts`,
`api/gcsStorage.ts` and redeploy — this is a deletion, not a refactor, and can be done in under an hour. Then
audit the bucket for objects an anonymous caller may already have written, and decide whether `save-config`
survives at all.

I have **not** made these changes, per the brief. They are the one item I would recommend acting on ahead of
the full Phase 2 plan.

---

## 5. What is *not* debt — protect it

Carrying this forward unchanged is a requirement of the rebuild, not an option.

| Asset | Why it is valuable |
|---|---|
| `src/lib/physics.ts` (129 ln) | Correct, validated against reference figures, documents its own history. **Verified correct during this audit.** |
| `src/lib/experiments.ts` (300 ln) | All four experiment sheets, twelve steps, quizzes, bilingual, with derivations. Pure data. |
| `src/lib/apparatus.ts` (287 ln) | The GLB name map, the `gltfName()` sanitiser, the momentum-factor table and the reasoning behind each. Weeks of hard-won knowledge. |
| The five safety guards | Pedagogically correct interlocks with explanatory bilingual messages. |
| Bounding-box-derived anchors/hotspots | The right technique; survives model re-exports. |
| `THREE.MathUtils.damp` usage | Correctly diagnosed frame-rate independence. |
| The comment culture | Comments explain *why* and record past failures. Unusual and genuinely useful. |
| The Arabic content | Complete and good quality across every surface. |

**Roughly 700 lines of the 5 253 are assets. The remaining ~4 500 are the liability.** That ratio is what makes
a rebuild-around-the-core strategy viable rather than a rewrite from zero.

---

## 6. Repayment sequencing

Ordered by *unblocking value*, not by size. Detail in `09_REBUILD_STRATEGY.md`.

| Order | Item | Debt repaid | Effort |
|---|---|---|---|
| 0 | Delete the foreign `api/` handlers; redeploy | TD‑04 (liability) | 1 h |
| 1 | Enable `strict`; add Vitest + the GLB contract test; add CI | TD‑03, TD‑06 | 3–4 d |
| 2 | Write the budget doc; optimise the GLB (KTX2, merge, re-resolution); delete dead assets | TD‑02 | 4–5 d |
| 3 | Extract `stateMachine.ts` + store; split `DeviceModel` into subsystem components | TD‑01, TD‑08, TD‑09 | 2 w |
| 4 | Loading/error/resilience layer; design tokens + CSS Modules; i18n with `dir` | TD‑05, TD‑11, TD‑12 | 1.5 w |
| 5 | Accessibility layer (DOM control for every action, dialogs, live regions, focus) | TD‑10 | 1–1.5 w |
| 6 | Rendering pass: lighting, materials, jet, highlight, camera | (visual quality) | 1.5 w |
| 7 | Audio system | TD‑14 | 3–5 d |
| 8 | Server hardening; CDN; documentation; LFS | TD‑13, TD‑16, TD‑17 | 3–4 d |
| 9 | Fidelity gaps, pending the storyboard/video | TD‑18 | TBD |

**Do not** attempt items 3–7 before items 1–2. Without tests and a budget, the rebuild will regenerate exactly
the same debt — that is the lesson the commit log is already teaching.
