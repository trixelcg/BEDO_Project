# 13 — Domain Core

**Classification: KEEP.** ~700 lines of verified engineering logic. Equations and constants must not be changed
without evidence of a defect, per the Phase 2 brief §4.

---

## 1. Verification against BEDO's own mathematical model

`Jet force_Mathematical model.xlsx` was extracted and compared cell-by-cell against `src/lib/physics.ts` and
`src/lib/apparatus.ts`. **The implementation reproduces BEDO's model.**

### 1.1 Flow rate — exact match on every tabulated row

`flowRateLMin(n, Q_T) = Q_T · (−4.9138n⁴ + 8.8783n³ − 3.7629n² + 0.7265n)`

| n | BEDO xlsx (L/min) | `physics.ts` | Δ |
|---|---|---|---|
| 0.0 | 0 | 0 | 0 |
| 0.2 | 6.953798400 | 6.953798400 | **0** |
| 0.4 | 15.714470400 | 15.714470400 | **0** |
| 0.6 | 43.456838400 | 43.456838400 | **0** |
| 0.8 | 84.712934400 | 84.712934400 | **0** |
| 1.0 | 111.372000000 | 111.372000000 | **0** |

The polynomial is confirmed independently by the storyboard (slide 6), which prints it verbatim:
`𝑄𝑖𝑛 = (−4.9138 nl⁴ + 8.8783 nl³ − 3.7629 nl² + 0.7265 nl) · Q_T`.

### 1.2 Velocities — exact match

| Quantity | BEDO (n = 0.4) | Ours | Note |
|---|---|---|---|
| `Q` (m³/s) | 2.6191308e-4 | 2.6190784e-4 | 0.002 % (sheet rounding) |
| `v₀ = Q/A` | 3.336472 m/s | 3.336406 m/s | 0.002 % |
| `v = √(v₀² − 2gs)` | 3.231926 m/s | 3.231857 m/s | 0.002 % |

**This settles the `2gs` question.** The audit noted a prior bug where `2·g·√s` was used instead of `2·g·s`.
BEDO's sheet confirms the linear form: `√(3.336472² − 2·9.81·0.035) = 3.231926` ✅.

### 1.3 Constants — all confirmed by two independent sources

| Constant | Value | Confirmed by |
|---|---|---|
| `NOZZLE_AREA_M2` | 0.0000785 m² | xlsx cell *"A = 0.0000785 m"*; storyboard sl. 6 *"A · 0.0000785 m · Constant"* |
| `TRAVEL_HEIGHT_M` | 0.035 m | storyboard sl. 6 *"s · 0.035 m · Constant"* |
| `GRAVITY` | 9.81 m/s² | storyboard sl. 6–7 |
| `WATER_DENSITY` | 1000 kg/m³ | storyboard sl. 7 *"ρ · 1000 kg/m³ · constant"* |
| `SPRING_RATE_N_PER_M` | 200 N/m | xlsx `hW` column: 0.4905 N → 2.4525 mm ⇒ k = 200 N/m; storyboard sl. 8 `h = F/(200×100)` |
| `TOTAL_FLOW_L_MIN` | 120 | xlsx `QT` column |

### 1.4 Momentum factors — all seven exact

Computed as `F_th(deflector) / F_th(flat)` from the spreadsheet at n = 0.4:

| Deflector | BEDO F_th (N) | Ratio to flat | `apparatus.ts` factor | ✅ |
|---|---|---|---|---|
| Oblique 30° | 0.204989947 | 0.25001 | `sin²30° = 0.25` | ✅ |
| Oblique 45° | 0.409979894 | 0.50002 | `sin²45° = 0.5` | ✅ |
| Oblique 60° | 0.614969842 | 0.75003 | `sin²60° = 0.75` | ✅ |
| Flat 90° | 0.819924835 | 1.00000 | `1.0` | ✅ |
| Semi 120° | 1.229939683 | 1.50006 | `1 − cos120° = 1.5` | ✅ |
| Conical 135° | 1.399611694 | 1.70700 | `1 − cos135° = 1.707` | ✅ |
| Semi 180° | 1.639849671 | 2.00000 | `1 − cos180° = 2.0` | ✅ |

The storyboard (sl. 7–8) prints the three distinct laws, matching `apparatus.ts:105‑117` exactly:
`F_th = ρAv²sinθ` (flat), `ρAv²sin²θ` (oblique), `ρAv²(1−cosθ)` (conical / hemispherical).

**The comment in `apparatus.ts` warning that `1 − cosθ` must NOT be generalised to the oblique family is
correct and is now independently confirmed.**

### 1.5 One discrepancy found — and it is BEDO's, not ours

The spreadsheet carries two force columns, `Fo` and `Fth`, differing by a **constant 0.05390595 N** at every
flow rate. That constant is exactly `ρ · A · 2gs = 1000 × 0.0000785 × 2 × 9.81 × 0.035`.

So `Fo = ρAv₀²` (nozzle velocity) and `Fth = ρAv²` (impact velocity). **Our implementation computes `Fth`,
which is the correct one** and the one BEDO's own graphs plot. No change required.

---

## 2. Structure

```
domain/
├── physics/
│   ├── jet.ts        flowRateLMin · jetState · computeReading   ← from lib/physics.ts
│   ├── spring.ts     deflection(F_th, F_ac)  ← NEW, see §4
│   └── units.ts      branded scalar types    ← NEW, see §3
├── apparatus/
│   ├── deflectors.ts DEFLECTORS[] + getDeflector + deflectorsFor
│   ├── weights.ts    WEIGHTS[]
│   ├── meshNames.ts  MESH + gltfName()       ← the GLB naming contract
│   └── waterShapes.ts WATER_SHAPES
├── experiments/
│   ├── definitions.ts EXPERIMENTS[]
│   └── quiz.ts
└── stateMachine.ts   ← NEW, see §5
```

**Constraints, enforced by lint (`docs/22 §7`):**
- No import of `react`, `react-dom`, `three`, `@react-three/*`.
- No `Math.random()`, no `Date.now()`, no `new Date()`, no I/O.
- Every exported function is pure and total.

---

## 3. Units (new)

The audit found three different masses on `RecordRow` with no unit suffixes (`mass`, `idealMass`,
`actualWeightMass`) and a field named `springhW`. Branded types make the boundary explicit without runtime cost:

```ts
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type Newtons          = Brand<number, 'N'>;
export type Grams            = Brand<number, 'g'>;
export type Kilograms        = Brand<number, 'kg'>;
export type Metres           = Brand<number, 'm'>;
export type Millimetres      = Brand<number, 'mm'>;
export type MetresPerSecond  = Brand<number, 'm/s'>;
export type LitresPerMinute  = Brand<number, 'L/min'>;
export type CubicMetresPerSecond = Brand<number, 'm³/s'>;
export type Degrees          = Brand<number, '°'>;
export type ValveOpening     = Brand<number, 'n'>;   // 0..1
```

Renames at the boundary: `springhW → springDeflectionMm`, `mass → balancingMassG`,
`idealMass → targetMassG`, `actualWeightMass → loadedMassG`, `weightsN → measuredForceN`,
`fth → theoreticalForceN`, `totalFlowValue → pumpFlowLMin`.

---

## 4. Spring model (correction required)

The storyboard (sl. 8, 19) specifies:

```
h_w = F_ac / k          deflection due to the loaded weights
h_F = F_th / k          deflection due to the jet
X   = h_F − h_w         net pointer displacement
if h_F ≤ h_w  →  X = 0  and the spring does not move
"The spring will not exceed the cover or holder surface"
```

Current code (`DeviceModel.tsx:952‑958`) computes `X = h_F − h_w` correctly but clamps it symmetrically to
`±0.45 × restHeight`, permitting **negative** displacement. Per spec it should clamp at **zero** below and at
the physical travel limit above.

```ts
// domain/physics/spring.ts
export const springDeflection = (
  jetForce: Newtons, weightForce: Newtons,
  rate: number = SPRING_RATE_N_PER_M, maxTravel: Metres,
): Metres => clamp((jetForce - weightForce) / rate, 0, maxTravel) as Metres;
```

`maxTravel` is supplied by the presentation layer from the measured spring geometry — the domain does not know
about meshes. **This is a genuine defect corrected against the spec, and is the one physics-adjacent change
authorised by the evidence rule.** Tracked as **BEDO‑009**.

---

## 5. `stateMachine.ts` (new)

The state machine document defines a machine that is **independent of the lesson script**. Transcribed exactly:

**States:** `A` initial · `B` trainer operated · `C` tank cover opened · `D` weights on holder ·
`E`–`I` errors 1–5 · `J` software monitor view.

**Clickables:** power switch · valve · volumetric tank valve · deflectors · weights · weights-on-holder ·
cover · software monitor · ok · save screen · export data.

| From \ Click | Power | Valve | Vol. valve | Deflector | Weight | Weight-on-holder | Cover | Monitor |
|---|---|---|---|---|---|---|---|---|
| **A** initial | B | A *(rotates, no value change — pump off)* | A | **F** err2 | D | — | C | J |
| **B** operated | A *(water drains)* | B *(value changes)* | B | **F** err2 | D | — | **G** err3 | J |
| **C** cover open | **H** err4 | C | C | C *(deflector installs)* | **E** err1 | — | A | J |
| **D** weights on | A / B | D | D | **F** err2 | D | **B** *(weight removed, 2 s)* | **I** err5 | J |
| **E–I** errors | — | — | — | — | — | — | — | Ok → previous view |
| **J** monitor | — | — | — | — | — | — | — | Monitor → previous · Save Screen → J · Export → J |

The current five guards in `App.tsx` match this exactly. Two behaviours are missing and become tasks:
- **weight-on-holder → removal** (`R‑3`) → **BEDO‑023**
- **water drains on power-off** (`R‑13`) → **BEDO‑010**

```ts
// domain/stateMachine.ts
export type Action =
  | { kind: 'togglePower' } | { kind: 'setValve'; opening: ValveOpening }
  | { kind: 'toggleVolumetricValve' } | { kind: 'selectDeflector'; id: number }
  | { kind: 'addWeight'; grams: Grams } | { kind: 'removeWeight'; index: number }
  | { kind: 'toggleCover' } | { kind: 'openMonitor' } | { kind: 'closeMonitor' };

export type Outcome =
  | { ok: true;  next: ApparatusState; events: DomainEvent[] }
  | { ok: false; error: ErrorCode; state: ApparatusState };

export function attempt(state: ApparatusState, action: Action): Outcome;
```

Pure, synchronous, exhaustively testable. **Both** the UI and the 3D layer route through it, which is what
removes the `BUG‑04` gap (3D clicks bypassing the gate) and the `CQ‑06` duplication.

---

## 6. Tests (BEDO‑002, before any refactor)

| Suite | Asserts |
|---|---|
| `physics.spec.ts` | All six `Q(n)` rows to 1e-9; `v₀`, `v` at n = 0.4 and 0.5; `F_th` for all seven deflectors; the `Fo − F_th = ρA·2gs` identity; `flowRateLMin` monotonic and ≥ 0 on [0,1]; `qTotal` scaling linear |
| `apparatus.spec.ts` | All seven factors exact; `gltfName()` against the 159 real node names; **every `MESH` constant, every `shelf`, every `installed` name resolves** against a checked-in node-name fixture |
| `experiments.spec.ts` | Four experiments; angles ⊆ deflector ids; `quiz.answer` in range; every step has en+ar text; `deflectorsFor()` partitions `DEFLECTORS` |
| `stateMachine.spec.ts` | Every cell of the §5 table; errors are non-mutating; unreachable-state check |
| `spring.spec.ts` | `X = h_F − h_w`; clamps at 0; never exceeds `maxTravel` |

The `apparatus.spec.ts` contract test is the highest-value test in the project: a model re-export that renames
nodes currently fails **silently at runtime**; this turns it into a red build. It would have caught `BUG‑27`
(`MESH.nozzle` pointing at the tank base flange, 0.227 m wide against a 0.010 m bore) and the entire class of
lookup failures described in `apparatus.ts:11‑26`.
