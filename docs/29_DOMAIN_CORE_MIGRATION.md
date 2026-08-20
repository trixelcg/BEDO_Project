# 29 — Domain Core Migration (BEDO‑005)

The verified engineering core now lives behind a boundary it cannot import its way out of.
Every equation is byte-for-byte the one BEDO's spreadsheet was checked against, and every
physical field states the unit it holds.

**Zero behaviour change.** Scene fingerprint identical, network identical, exported CSV
identical to the character, 340 tests green.

---

## 1. Before

```
src/
├── lib/
│   ├── physics.ts       jet physics, verified against the xlsx
│   ├── apparatus.ts     deflectors, weights, GLB node names, gltfName(),
│   │                    camera framing, animation travel distances   ← four concerns
│   ├── experiments.ts   the four sheets and the twelve steps
│   ├── readiness.ts     loading markers          (presentation)
│   └── sceneConfig.ts   frozen scene values      (presentation)
├── types/index.ts       RecordRow, SimulationState, ErrorCode, ExperimentId, …
└── components/          React + R3F + three.js
```

Two problems. `lib/` mixed verified engineering with presentation, so nothing stopped the
domain reaching for three.js or React. And the field names carried no units: `mass`,
`springhW`, `fth`, `actualWeightMass` — every one of them readable only by tracing back to
where it was assigned.

## 2. After

```
src/
├── domain/                      ← pure, no React, no three.js, no DOM, deterministic
│   ├── units.ts                 the unit vocabulary + conversions + Vec3
│   ├── physics.ts               constants, jetState, computeRow, JetState, RecordRow
│   ├── apparatus.ts             DEFLECTORS, WEIGHTS, WATER_SHAPES, MESH, AnchorKey
│   └── experiments.ts           EXPERIMENTS, buildSteps, ExperimentId, TOTAL_STEPS
├── lib/                         ← presentation-side support, may read the domain
│   ├── gltfNames.ts             gltfName() — how an authored name becomes a scene node
│   ├── apparatusView.ts         ANCHOR_VIEW, FRONT, COVER_LIFT, SCREW_LIFT
│   ├── exportSchema.ts          the published CSV schema (see §6)
│   ├── readiness.ts             loading markers
│   └── sceneConfig.ts           frozen scene values
├── types/index.ts               app state only: SimulationState, Mode, ErrorCode, …
└── components/                  React + R3F + three.js
```

Four domain files, not five folders holding one file each. The structure `docs/13 §2`
sketched (`domain/physics/jet.ts`, `domain/apparatus/deflectors.ts`, …) would have been
nine files averaging sixty lines; the boundary is what matters, and it is the same
boundary either way.

### Why `gltfName()` left the domain

`docs/13 §2` had it in `domain/apparatus/meshNames.ts`. It is not domain knowledge: it is a
reimplementation of `THREE.PropertyBinding.sanitizeNodeName`, which is a fact about how
GLTFLoader renames nodes on load. The domain says the nozzle is authored as
`JET Force 2_214`; the scene layer says three.js will answer to `JET_Force_2_214`. That is
exactly the split the task asked for — identity in the domain, lookup in the scene layer —
and it is why `gltfName` now sits in `src/lib/gltfNames.ts` beside the other
presentation-side helpers. The 51 GLB contract tests import it from there and are otherwise
unchanged.

`ANCHOR_VIEW` and the lift distances left for the same reason: where a camera stands and
how far a plate rises are rendering decisions. `AnchorKey` — *which part a step is about* —
stayed, because the lesson steps are domain data and they name it.

---

## 3. File mapping

| Before | After |
|---|---|
| `src/lib/physics.ts` | `src/domain/physics.ts` |
| `src/lib/experiments.ts` | `src/domain/experiments.ts` |
| `src/lib/apparatus.ts` → identity | `src/domain/apparatus.ts` |
| `src/lib/apparatus.ts` → `gltfName()` | `src/lib/gltfNames.ts` **(new)** |
| `src/lib/apparatus.ts` → framing, lifts, `FRONT` | `src/lib/apparatusView.ts` **(new)** |
| `src/types/index.ts` → `RecordRow` | `src/domain/physics.ts` |
| `src/types/index.ts` → `ExperimentId` | `src/domain/experiments.ts` (re-exported for callers) |
| — | `src/domain/units.ts` **(new)** |
| `SoftwareMonitor.tsx` → inline CSV | `src/lib/exportSchema.ts` **(new)** |

`SimulationState`, `Mode`, `ErrorCode`, `CustomParams` and `Language` stayed in
`src/types/index.ts`: they describe the running application, not the rig. `ErrorCode` will
move when `BEDO‑006` extracts the state machine that owns it.

---

## 4. Renamed fields, and the unit each one holds

The convention is in `src/domain/units.ts`: a suffix names the unit the number is **stored
in**, not the SI unit it would ideally be. Dimensionless quantities carry no suffix.

### `RecordRow` / `JetState`

| Before | After | Unit | Meaning |
|---|---|---|---|
| `flowRateQLMin` | `flowRateLMin` | L/min | Volumetric flow at this valve opening, Q |
| `flowRateQM3` | `flowRateM3S` | m³/s | The same flow, as the velocity maths needs it |
| `theoreticalVo` | `nozzleVelocityMS` | m/s | v₀, at the nozzle exit |
| `theoreticalV` | `impactVelocityMS` | m/s | v, at the deflector face, after climbing 35 mm |
| `fth` | `theoreticalForceN` | N | F_th, the momentum-derived jet force |
| `weightsN` | `measuredForceN` | N | F_ac, the weight of what is on the tray |
| `springhW` | `springDeflectionMm` | mm | Spring travel under that weight, F_ac / k |
| `mass` | `balancingMassG` | g | The exact mass that balances the jet, unrounded |
| `idealMass` | `targetMassG` | g | The same, rounded to the 10 g the tray can make |
| `actualWeightMass` | `loadedMassG` | g | What the student actually loaded |
| `totalFlowValue` | `pumpFlowLMin` | L/min | Q_total, the pump's delivery |
| `valveOpen` | `valveOpening` | — | n, 0..1. The old name read as a boolean |
| `balanced` | `isBalanced` | — | Boolean, now named like one |
| `loadedWeights` | `loadedWeightsG` | g[] | The individual discs on the tray |

### Elsewhere in the domain

| Before | After | Unit |
|---|---|---|
| `DeflectorDef.factor` | `DeflectorDef.momentumFactor` | — (k in F = k·ρ·A·v²) |
| `GRAVITY` | `GRAVITY_MS2` | m/s² |
| `WATER_DENSITY` | `WATER_DENSITY_KG_M3` | kg/m³ |

### App state

| Before | After | Unit |
|---|---|---|
| `SimulationState.loadedWeights` | `loadedWeightsG` | g[] |
| `CustomParams.qTotal` | `pumpFlowLMin` | L/min |
| `SimulationState.pointerOffset` | **removed** | was mm — initialised, never read or written |

Left alone deliberately (`§17` — this is not a naming sweep): `NOZZLE_AREA_M2`,
`TRAVEL_HEIGHT_M`, `SPRING_RATE_N_PER_M`, `BALANCE_TOLERANCE_G` and `TOTAL_FLOW_L_MIN`
already state their units; `computeRow`, `jetState` and `RecordRow` keep their names;
`characterPosition`/`characterRotation`/`characterScale` in `SceneConfig` keep their
avatar-template names, because they are presentation and renaming them buys nothing here.

### What the rename explicitly did **not** do

**No value was converted.** `mass` became `balancingMassG` and still holds grams — it did
not become kilograms. `tests/unit/units.spec.ts` asserts each renamed field against the
value the BEDO‑002 baseline pinned under its old name, and the physics spec's numeric
literals are byte-identical (checked by extracting every literal from both revisions and
comparing).

---

## 5. The dependency rule, enforced

`src/domain/` may import only from `src/domain/`. `tests/unit/domain-boundary.spec.ts`
(15 tests) checks every domain file for:

- imports of `react`, `react-dom`, `three`, `@react-three/*`, a state store, CSS,
  `../components/`, `../lib/`, `../types` — or any relative path that leaves the directory;
- browser and platform globals: `document.`, `window.`, `localStorage`, `fetch(`,
  `performance.`, `process.`, `require(`;
- non-determinism: `Math.random`, `Date.now`, `new Date`.

Plus the strongest form of the rule: it imports all four domain modules in a node
environment with no DOM present and computes a reading. If anything reached for a browser
API, that test throws.

A plain string check, not an architecture framework — the rule is simple enough to state in
one list, and `docs/22 §7`'s full boundary lint arrives with the layers it polices.

---

## 6. Export compatibility

The CSV is the only artefact of this app that leaves it, and someone downstream may have a
spreadsheet built on its columns. Renaming `fth` must not rename a column header.

So the schema was **pinned first, before a single field was touched**:
`tests/integration/export-contract.spec.tsx` (15 tests) drives the whole lesson, exports
the file, and asserts the filename, MIME type, comment line, all eleven headers in order,
the unit on every column that carries one, the row count, two complete data rows character
for character, the numeric precision of each column, the empty-until-Calculate behaviour,
and the experiment mapping. It also pins the on-screen table's eight columns, including its
Arabic headers.

Then the inline CSV construction moved out of `SoftwareMonitor` into
`src/lib/exportSchema.ts`, which maps `RecordRow` → published columns:

```
domain RecordRow  →  EXPORT_COLUMNS (headers + formatting)  →  stable CSV
```

Every domain field was renamed underneath it, and **not one character of the output
changed**. That is what the adapter is for.

Two mismatches are preserved, not corrected:

- **`Balanced mass (g)` carries `loadedMassG`**, the mass the student loaded — not
  `balancingMassG`, the mass that balances the jet exactly. When a reading is balanced the
  two agree within 10 g, which is presumably why it went unnoticed.
- **The reference simulator's own table orders `V_th` before `V_o`** and has no mass
  column, so this schema is not a copy of BEDO's layout.

Both are schema decisions with an audience. Changing either belongs in a task that has the
reference sheets in hand, not in a refactor.

---

## 7. Physics preservation evidence

| Check | Result |
|---|---|
| `physics.spec.ts` (57 tests) | green, **no expected value edited** |
| Numeric literals in `physics.spec.ts`, before vs after | **identical** (extracted and compared as multisets) |
| Same, `apparatus.spec.ts`, `experiments.spec.ts`, `glb-contract.spec.ts` | **identical** |
| Same, `lesson-flow.spec.tsx` + `app-harness.tsx` combined | **identical** — the walk helper moved between the two files, so they are compared together |
| Exported CSV | character-identical, pinned before the rename |
| Scene fingerprint | identical: 290 objects, 4 lights, 33 mesh transforms, 16 hotspots, camera |
| GLB contract | 51 tests, unchanged |

---

## 8. The lever arm — answered

`BEDO‑002` recorded that no lever-arm constant exists: `F_ac = m·g`, with no moment ratio.
The available reference material was searched again, and it settles the question.

**BEDO's own reference simulator computes the actual force as mass × g, with no lever
term.** Its monitor prints:

> `Total Weight  [ 0.45 gm ]  × g  =  [ 4.414 N ]`

and 0.45 × 9.81 = 4.4145. Evidence: `docs/reference/reference-simulator-force.jpg`,
decoded from `Bedo_Mesu_J.mp4` at 83–88 s.

**Conclusion: the rig is treated as 1:1 by BEDO's own model, and the implementation already
matches it.** Nothing changes. `docs/13 §1.3` lists the constants confirmed by two
independent sources and contains no lever arm; the spreadsheet's `Fth` column, which the
implementation reproduces exactly, needs none.

Two caveats worth recording rather than burying:

1. The evidence is BEDO's *simulator*, not a mechanical drawing of the physical rig. If the
   real VL‑FM009 has a lever ratio, BEDO's own model does not model it — that would be a
   defect in the reference, not in this implementation, and it is theirs to answer.
2. That readout is also a unit-labelling bug in the reference: `0.45` is plainly kilograms
   and the label says `gm`. It is the exact failure mode this task's naming convention
   exists to prevent, which is why it opens `src/domain/units.ts`.

**No speculative change made.** If a ratio is ever confirmed, it is a physics change under
the brief's evidence rule: reference in hand, `physics.spec.ts` updated deliberately with
the new expected values, and the CSV/monitor reviewed for the change in F_ac.

---

## 9. Residual domain debt

| | Owner |
|---|---|
| `ErrorCode` and the five guards still live in `App.tsx` as React handlers, not as a pure state machine | `BEDO‑006` |
| The spring model clamps symmetrically and permits negative deflection, against storyboard sl. 8 | `BEDO‑007` |
| `recordedRows` is four fixed rows, one of them fabricated (`BUG‑14`) — it should be an append-only `Reading[]` with provenance | `BEDO‑009` |
| Branded scalar types (`Newtons`, `Grams`, …) from `docs/13 §3` — the names now carry units, the *types* still do not, so grams and newtons remain interchangeable to the compiler | a later task, once the domain settles |
| `src/lib/` still mixes scene-layer helpers (`gltfNames`, `apparatusView`) with app helpers (`readiness`, `sceneConfig`, `exportSchema`) | `BEDO‑013`/`014`, when a real scene layer exists |
| `computeRow` still returns all four rows' worth of shape even for untaken rows | `BEDO‑009` |
