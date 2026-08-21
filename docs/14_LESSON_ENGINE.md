# 14 — Lesson Engine

> **Implemented in BEDO‑018 — see `docs/34`.** `src/lesson/{schema,currentLesson,runner}.ts`.
>
> Differences from the design below, all deliberate: **two** completion notions rather than
> one (`isSatisfied` for the arrow, `advance.when` for the OK button) because the shipped
> app genuinely needed both and collapsing them would have changed behaviour; conditions
> are predicates rather than a serialisable `Condition` algebra, since nothing yet needs to
> lint or explain them; and the runner **returns** the commands a finished step asks for
> instead of dispatching them, so the simulation keeps a single mutator.
>
> The content is still the shipped twelve steps. `BEDO‑019` migrates it to the canonical
> eleven of `docs/32` by editing data.


**Principle:** a lesson step describes **intent**. UI components contain **no** rules for advancing lessons.

---

## 1. What is wrong today

Rules for one step are spread across three files:

| Concern | Lives in |
|---|---|
| Step text and target | `lib/experiments.ts` `buildSteps()` |
| Which parts are clickable | `DeviceModel.tsx:664‑689` `liveKeys` |
| Whether the step is done (arrow) | `DeviceModel.tsx:696‑705` |
| Whether the step is done (OK button) | `UIOverlay.tsx:106‑112` — **a different formulation** |
| What advancing does | `App.tsx:285‑331` — a `switch` with side effects |
| Which table row it fills | `App.tsx:73` `BALANCE_ROW = {7:1, 9:2}` |
| Camera target | `lib/apparatus.ts` `ANCHOR_VIEW` |

The two "done" predicates can disagree — the arrow disappears while OK is still hidden, or vice versa
(`CQ‑06 #5`). Keying the table row on `currentStep` is what makes Free mode record nothing (`BUG‑06`), because
in Free mode `currentStep` never leaves 1.

---

## 2. Step schema

```ts
export interface LessonStep {
  id: StepId;
  title:       LocalisedText;
  instruction: LocalisedText;
  hint?:       LocalisedText;

  /** Intents permitted while this step is active. Drives affordances AND gating. */
  allowedActions: ActionMatcher[];

  /** Pure predicate over simulation state + the intent stream. */
  completion: Condition;

  /** Optional: what makes an otherwise-legal action wrong *here*. */
  validation?: { when: Condition; feedback: LocalisedText }[];

  /** Raised once completion becomes true. The storyboard's "(Popup)" observations. */
  observation?: LocalisedText;

  /** Semantic, not a camera position. The director resolves it. */
  view?: NamedView;
  highlight?: EquipmentRef[];
  narration?: AudioCue;

  /** Explicit — never inferred from array order. */
  next: StepId | 'complete';

  /** Requires an explicit confirmation before advancing (the "OK" button). */
  requiresAcknowledgement?: boolean;
}
```

`Condition` is a small declarative algebra, not a callback, so it can be serialised, linted and explained to
the student:

```ts
type Condition =
  | { is: 'coverOpen' | 'coverClosed' | 'powerOn' | 'volumetricValveOpen' }
  | { is: 'deflectorInstalled'; oneOf?: number[] }
  | { is: 'valveAtLeast'; opening: number; tolerance?: number }
  | { is: 'pointerBalanced'; tolerance?: Grams }
  | { is: 'readingRecorded'; atLeast: number }
  | { is: 'monitorOpen' } | { is: 'forceCalculated' } | { is: 'quizAnswered' }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition };
```

**One evaluator** serves the arrow, the OK button, the highlight and the tests — implemented as
`isSatisfied`/`canConfirm` on `LessonRunner`. They cannot disagree, and a source audit in
`domain-boundary.spec.ts` fails the build if a component reconstructs either from a step number.

---

## 3. Runner

```ts
class LessonRunner {
  constructor(lesson: Lesson, sim: SimulationRuntime, bus: IntentBus);
  get current(): LessonStep;
  get progress(): { index: number; total: number; completed: StepId[] };
  isAllowed(intent: Intent): boolean;      // gating — consulted by the interaction layer
  acknowledge(): void;                      // the "OK" affordance
  goTo(id: StepId): void;                   // review only; never rewinds the apparatus
}
```

Behaviour:
- Subscribes to simulation state; re-evaluates `completion` on change.
- On completion → raises `observation`, sets `view`/`highlight`, and either auto-advances or waits for
  `acknowledge()` when `requiresAcknowledgement` is set.
- `isAllowed()` is the **single** gate. `BUG‑04` (3D clicks bypassing `liveKeys`) becomes structurally
  impossible because both the DOM control and the 3D affordance ask the same question.
- A disallowed intent produces a coaching feedback event, never silence.

---

## 4. Modes

| Mode | Runner | Recording |
|---|---|---|
| **Guided** | Active. Gates intents, advances steps, directs views. | Automatic at the balance steps. |
| **Free** | Inert (no gating, no step). | **Explicit "Record reading" action.** |

Free mode is not "guided minus the guide" — it needs its own affordance, which is exactly what is missing
today (`BUG‑06`). The simulation and the readings list are shared; only the runner differs.

---

## 5. The step list — settled (`docs/32`)

**Eleven numbered steps**, as all four experiment sheets specify. Re-opened and resolved in
BEDO‑041 against the primary sources; the earlier table in this section inferred the same
count and was correct.

| # | Stable id | Sheet step |
|---|---|---|
| 1 | `unscrew-cover` | Press the upper plate to unscrew it |
| 2 | `install-deflector` | Drag the deflector to install it in the rod |
| 3 | `mount-cover` | Press the plate again to mount it to the tank |
| 4 | `power-on` | Turn on the power switch of the unit |
| 5 | `set-flow-reading-1` | Slightly open the **flow control** valve |
| 6 | `balance-reading-1` | Add weights to balance |
| 7 | `increase-flow-reading-2` | Increase the opening of the flow control valve |
| 8 | `balance-reading-2` | Add weights to balance |
| 9 | `open-monitor` | Switch to the software monitor |
| 10 | `record-actual-force` | Click "Calculated" to record F_ac |
| 11 | `open-answer-sheet` | You finished! Click the "Document" tab |

**Not steps:**

- **The volumetric valve.** Absent from all four sheets and from the storyboard's state
  tables. The state-machine document lists it only as a clickable whose transitions are
  A→A, B→B, C→C, D→D — it turns and changes nothing. BEDO removed it from their own Unity
  `StepsText` on 19 Oct 2025. It stays as an affordance, without a number.
- **The assessment question.** Real BEDO content, present in every sheet, but as an
  unnumbered block between step 10 and step 11. BEDO's Bernoulli trainer keeps its MCQ in a
  separate `Questions` asset, outside `StepsText` — the same shape is right here.

**Still open:** the sheets say *drag* the deflector and every implementation clicks
(`BUG‑22`), and step 11's answer-sheet document — a blank fill-in worksheet, four PDFs —
is not wired up at all (`D‑6`).

**`step id ≠ display number`.** No rule may key on an index; `BALANCE_ROW = {7: 1, 9: 2}`
in `App.tsx` is the current instance of exactly that problem.

## 6. Example — step 6 as data

```ts
{
  id: 'balance-1',
  title:       { en: 'Balance the pointer (reading 1)', ar: 'موازنة المؤشر (القراءة 1)' },
  instruction: { en: 'Add weights to balance the weight base with the pointer tip.',
                 ar: 'قم بإضافة الأوزان حتى تتوازن قاعدة الأوزان مع طرف المؤشر.' },
  hint:        { en: 'Watch the pointer, not the numbers.', ar: '…' },
  allowedActions: [{ kind: 'addWeight' }, { kind: 'removeWeight' }],
  completion: { is: 'pointerBalanced', tolerance: 10 },
  observation: { en: 'Notice the shape of water impinging the deflector.',
                 ar: 'لاحظ شكل الماء بعد الاصطدام بالعاكس.' },
  view: 'pointer',
  highlight: ['weights.tray', 'pointer'],
  requiresAcknowledgement: true,
  next: 'increase-flow',
}
```

Everything the step needs is here. No component needs to know the step number.

---

## 7. Validation (dev-only linter)

Runs in `import.meta.env.DEV` and in CI:

- every `next` resolves; no unreachable steps; no cycles without an exit
- every `view` and `highlight` resolves against the apparatus registry
- every `Condition` leaf is satisfiable given `allowedActions`
- every text has both `en` and `ar`
- **every step is completable** — a headless simulation drives each step's `allowedActions` and asserts
  `completion` becomes reachable. This is what would have caught the low-flow balance step being unreachable
  with the available weight denominations (the bug `physics.ts:18‑26` records).
