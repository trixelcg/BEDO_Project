# 14 — Lesson Engine

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

**One evaluator** (`lesson/engine/conditions.ts`) serves the arrow, the OK button, the highlight, the progress
rail and the tests. They cannot disagree.

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

## 5. Reconciling the step list ⚠️ decision required

The four experiment sheets define **11 steps**, and none is a volumetric-valve step. The current build has 12.

| BEDO Exp. sheet | Current build | Note |
|---|---|---|
| 1. Press the upper plate to unscrew it | 1 ✅ | |
| 2. **Drag** the 90° flat deflector to install it in the rod | 2 ✅ (copy says drag; implementation is click) | `BUG‑22` |
| 3. Press the plate again to mount it | 3 ✅ | |
| 4. Turn on the power switch | 4 ✅ | |
| — | **5. Slightly open the volumetric control valve** | ⚠️ **not in any experiment sheet** |
| 5. Slightly open the flow control valve → *Popup: jet pushes deflector upward* | 6 ✅ | |
| 6. Add weights to balance → *Popup: shape of water impinging* | 7 ✅ | |
| 7. Increase the flow valve opening → *Popup: jet pushes deflector upward* | 8 ✅ | |
| 8. Add weights to balance | 9 ✅ | |
| 9. Switch to the software monitor | 10 ✅ | |
| 10. Click "Calculated" to record F_ac → *Popup: table/graph; Popup: Save Screen & Export Data* | 11 ✅ | |
| 11. You finished! Click the **"Document" tab** to view the answer sheet | 12 — shows an inline quiz instead | Answer-sheet PDFs exist: `Phase 2/Exp.{1..4} (Answer sheet).pdf` |

**Recommendation (D‑2):** follow the sheets — 11 steps. The volumetric valve remains clickable and
state-neutral, exactly as the state machine document specifies. This also removes two of the four disorienting
camera trips under the bench (`RND‑13`).

**Also to reconcile:** step 11 should surface the real answer sheet (four PDFs exist) in addition to, or
instead of, the inline quiz. Needs your decision — see `docs/12 §7 D‑6`.

---

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
