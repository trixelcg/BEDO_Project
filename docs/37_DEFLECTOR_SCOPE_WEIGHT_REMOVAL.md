# 37 — Deflector Scope & Individual Weight Removal (BEDO-022)

**Status:** implemented.
**Closes:** `BUG-05`. Implements the storyboard's *weight-on-holder* transition.
**Scope:** which deflector an experiment may run on, and taking one disc back off the pan.
The eleven canonical steps, their ids, numbering and copy are untouched, and no physics
equation was changed.

---

## 1. BUG-05, and its root cause

> Exp. 1 silently runs with `k = 2.0` while every label says `F = ρAV²`.

The panel scoped the deflector list to the loaded experiment — by rendering a shorter list:

```tsx
{availableDeflectors.map((d) => <button onClick={() => onSelectDeflector(d.id)} …>)}
// availableDeflectors = deflectorsFor(state.experimentId)
```

The 3D tray carries **all seven** discs whatever sheet is open, because a bench does not
rearrange itself, and its hotspots called the same handler with any id. The apparatus state
machine had no opinion and said so:

```ts
// No check that the deflector belongs to the loaded experiment: the app has never
// had one, and adding it here would be `BUG-05` fixed by accident. BEDO-022.
```

So this is **`BUG-04` one layer down.** `BEDO-020` made both surfaces ask one gate whether
they may touch the deflectors; nothing asked *which one*. The gate reasons in affordance
groups, which was right for every other control — `power` is one switch — and is exactly
the granularity a tray of seven discs falls through.

What the student saw: the header still read *"Exp. 1 — Flat surface deflector"*, the
objective still printed `F = ρAV²`, the worksheet still asked them to compute it — and the
table read a force twice as large, balanced at 170 g instead of 80 g, and plotted a line
with the wrong slope. Numerically plausible, instructionally wrong, and silent.

---

## 2. The experiment → deflector table, from the sheets

Transcribed from `/Measurement of Jet Forces/Phase 2/`. Step 2 of each sheet names the
disc; the objectives give the factor.

| Experiment | Sheet, step 2 | Angles | Momentum factor | Formula, as printed |
|---|---|---|---:|---|
| **Exp. 1** `flat` | *"Drag the **90°** flat deflector to install it in the rod."* | 90 | 1.0 | `F = ρAV²` |
| **Exp. 2** `semi` | *"Drag the **120° or 180°** semi-circular deflector…"* | 120, 180 | 1.5, 2.0 | `F = ρAV²(1 − cos β)` |
| **Exp. 3** `conical` | *"Drag the **135°** conical surface deflector…"* | 135 | 1.707 | `F = 1.707 ρAV²` |
| **Exp. 4** `oblique` | *"Drag the **45°** oblique surface deflector…"*, objectives *"(ɵ = 30°, 45° or 60°)"* | 30, 45, 60 | 0.25, 0.5, 0.75 | `Fx = ρAV² (sin ɵ)²` |

**Two of the four give the learner a choice and two do not.** That asymmetry is BEDO's, and
it is why the scope is a *set* per experiment and not a single required id — a
`requiredDeflectorId` would have been simpler and would have contradicted Exp. 2's own
sheet. The Phase 2 answer sheets repeat the same ranges, so the two Phase 2 documents agree.

`1.707` is BEDO's printed value for `1 − cos 135° = 1.70710678…`; the apparatus rounds
factors to three decimals (`src/domain/apparatus.ts:109-110`), which is what makes the two
match. Pre-existing, and not touched here.

### 2.1 One authority

`EXPERIMENTS[].angles` already held this, so nothing new was created:

```ts
export const isDeflectorInScope = (id: DeflectorFamily, deflectorId: number): boolean =>
  getExperiment(id).angles.includes(deflectorId);
```

The repo also encodes the same fact a second way — `DeflectorDef.family`, which drives the
water shapes and the names. Rather than delete one, a test asserts the two agree for every
experiment, so a future divergence fails loudly instead of one of them quietly winning.

---

## 3. Guided policy

The check is a **value-level** rule in the interaction gate — the one place `BEDO-020`
anticipated needing to look past the affordance group:

```ts
if (interaction.action.type === 'SELECT_DEFLECTOR') {
  if (!isDeflectorInScope(experimentId, interaction.action.deflectorId)) {
    return { allowed: false, blockedBy: 'lesson',
             reason: 'DEFLECTOR_NOT_IN_EXPERIMENT', affordance: 'deflectors' };
  }
}
```

`experimentId` joins the gate's input. It is deliberately **not** part of `ApparatusState`:
a rod holds whatever you put on it, and the experiment is the lesson's context, not the
rig's.

**A second lesson reason, not a second use of the first.** The learner *is* on the deflector
step and *is* touching the tray — "follow the highlighted step first" would be untrue.
`DEFLECTOR_NOT_IN_EXPERIMENT` presents as *"This experiment uses a different deflector."* /
*"هذه التجربة تستخدم عاكساً مختلفاً."*, a blue notice like every lesson refusal, never the
red safety banner.

Apparatus legality still comes first (`docs/36 §5`): with the tank shut, any deflector — in
scope or not — is refused with guard 2, *"Remove the tank cover first"*.

---

## 4. Free-mode policy

Free mode is unrestricted apparatus exploration, so any disc may go on the rod and the
physics follows the disc that is actually installed. `BEDO-022 §5` requires that this never
be *silent*, and it is not:

- The monitor header reads `experiment.name — deflectorName`, always the installed disc.
- The exported CSV's title row carries the same pair.
- **The panel now lists all seven deflectors in free mode**, so the installed one is always
  on screen and highlighted.

That last point is the change. Previously the panel showed the experiment's discs and the
tray showed seven, so a free-mode learner could install a disc that *did not appear in the
list at all* — the list simply showed nothing selected. Both surfaces now offer the same
set in both modes, which is the same defect BUG-04 and BUG-05 both were: one surface
enforcing a rule by rendering less than the other.

```ts
export const deflectorsSelectableIn = (experimentId, mode) =>
  mode === 'guided' ? getExperiment(experimentId).angles : DEFLECTORS.map((d) => d.id);
```

**One source for the policy and for the controls that present it.** The panel's list, the
tray's actionable hotspots and the gate's decision all read this function.

---

## 5. Experiment switching

Already deterministic and already correct: `SELECT_EXPERIMENT` rebuilds the rig with
`createInitialSimulationState`, which loads that experiment's `defaultAngle`. No deflector
state survives a switch, so the corrupting path — install the 180° disc under Exp. 2, switch
to Exp. 1, run it at `k = 2.0` — cannot happen. Now covered for every ordered pair of
experiments, and by an invariant that each experiment's default is inside its own set.

---

## 6. The lesson step

`install-deflector` gained the other half of its own completion rule:

```ts
advance: { kind: 'confirm', when: (c) =>
  c.simulation.apparatus.isCoverOpen &&
  isDeflectorInScope(c.simulation.experimentId, c.simulation.apparatus.selectedDeflectorId) }
```

Belt and braces against the gate — and it catches the one route the gate cannot, because in
free mode there is nothing to refuse: explore, leave the hemisphere on the rod, switch back
to guided. The step then holds its OK button until a valid disc is installed, and the panel
shows exactly the valid ones. No step number is involved and no numbering changed.

---

## 7. Weight removal — the source

`Jetforce_Storyboard.pptx`, slide 32, state **D "The weights on the tank holder"**:

| Clickable Item | Next State | Transition | Event |
|---|---|---|---|
| **5. Weights on holder** | **B** | Click on the weight on holder | **The weight removed from the tank holder in 2 sec.** |

and slide 19, on the spring:

> *"…moves downward when the weights are placed on the holder and **moves upward when the
> weights are removed from it**."*

**A discrepancy worth recording.** BEDO's separate state table
(`Jet force_State machine.docx`) lists clickable items 1–7 only, and its state-D row for
"5. Weights" goes to D with no note — it has **no row for this eighth clickable at all**.
The storyboard's per-state slides are the fuller specification, and they are what `docs/30`
was reading when it recorded that individual removal *"is specified but has never been
implemented"*. The two BEDO documents disagree about whether the interaction exists; the
storyboard is the more detailed and the more recent, and it is the one followed here.

The storyboard's next state is `B` ("the trainer is operated", i.e. nothing on the holder),
which is simply the one-disc case — BEDO's state model does not count discs. Removing one of
several leaves the rig in D, which is what the implementation does.

---

## 8. The transition, and identity

```ts
| { readonly type: 'REMOVE_WEIGHT'; readonly index: number }
```

**By stack position, not by mass.** The pan can hold two 50 g discs, and
`loadedWeightsG.filter(g => g !== 50)` would take both off — the trap `BEDO-022 §16` names,
and a test loads two identical discs and removes exactly one. The index is the smallest
identifier that is actually correct: it is the order the discs were added, therefore the
order they are stacked, and it is what the scene already keyed each rendered disc by
(`` `${idx}-${grams}` ``). A three.js UUID would be a rendering detail leaking into the
domain.

| Case | Behaviour |
|---|---|
| Valid position | that disc comes off; the others keep their order |
| Two identical discs | exactly the clicked one comes off |
| Last disc | the pan empties |
| Position out of range, or empty pan | **no-op** — `unchanged(state)`, returned by identity, no message, no subscriber notified |
| Tank open | **allowed** |

**Unguarded, deliberately.** Guard 5 is *"remove all weights first before opening the tank"*,
so removal is the direction that *resolves* a guard; refusing it with the tank open would be
a deadlock. This is the same reasoning that has always left `REMOVE_ALL_WEIGHTS` unguarded.

An out-of-range index is a programming error, not a student action — no disc is rendered
there — so it is a no-op rather than a refusal, and raises nothing the learner would see.

`REMOVE_ALL_WEIGHTS` is unchanged and remains the panel's one-press escape.

---

## 9. Runtime, gate and recovery

```
click (panel button or disc on the holder)
   → App.interact  → evaluateInteraction   (BEDO-020's gate, unchanged path)
                   → runtime.dispatch(REMOVE_WEIGHT)
                   → attempt(state, action)          (the only place the rule lives)
```

The runtime needed one line — `REMOVE_WEIGHT` added to the set of commands routed to
`attempt()` — and no removal logic of its own.

**Recovery.** Removal inherits the `weights` affordance, so it is permitted at exactly the
steps that invite the pan and nowhere else. That is not a special case and not an
"always allowed" exemption: `BEDO-020` already keys the gate on the affordance a step
invites rather than on its expectation, precisely so that `REMOVE_ALL_WEIGHTS` — which is no
step's expectation — stays reachable at a balance step. Individual removal lands in the same
place for the same reason, and a test walks the overload-and-correct path end to end.

---

## 10. The two surfaces

| | Panel | Scene |
|---|---|---|
| **Deflectors** | lists the selectable set (experiment's in guided, all seven in free) | all seven meshes as before; out-of-scope shelves are no longer *actionable* — no pointer cursor — and a click still forwards so the learner gets the notice |
| **Weights** | a `−50g` button per loaded disc, beside the existing add grid and clear-all | an invisible proxy over each disc in the stack, sized to the disc |

The scene's tray scoping reads `lesson.selectableDeflectorIds`, handed down from the gate —
`DeviceModel` decides nothing, exactly as `BEDO-020 §4` requires.

Every disc proxy is a hotspot of the same kind as the sixteen that already exist. **Nothing
is added to the scene while the pan is empty**, so the baseline fingerprint is untouched;
the discs' transforms, geometry, scale and materials are not read or written.

---

## 11. What was deliberately left alone

- **The rendered weights sit off the pan.** A known visual defect, and `BEDO-022 §20` is
  explicit that it is not this task's. Untouched: the removal path changes which discs are
  in the stack, never where a disc is drawn.
- **`BUG-19`, invisible-but-clickable tray weights.** A tray disc's mesh is hidden once its
  denomination is loaded while its hotspot remains live. Input-layer work, `BEDO-021`.
- **The custom deflector angle** (storyboard sl. 10: *"enter the deflector angle with input
  range (1–180)°"*) is not implemented in R3F, which ships seven fixed discs. Out of scope;
  the scope rule is a set of ids and would extend to a range without restructuring.
- **The pan's total is hidden at guided steps that are not about the pan**, because the whole
  weights card is. Pre-existing panel behaviour; noted because it surprised a test.

---

## 12. Tests

| Suite | Tests | Covers |
|---|---:|---|
| `tests/unit/deflector-scope.spec.ts` | 55 | the sheets vs the domain, scope, gate, physics, switching, step completion |
| `tests/unit/weight-removal.spec.ts` | 22 | the transition, duplicates, no-ops, runtime, subscriptions, committed rows, gate |
| `tests/integration/deflector-scope.spec.tsx` | 17 | BUG-05 from both surfaces, free mode, removal, recovery |
| `tests/unit/domain-boundary.spec.ts` | +1 | no component writes `selectedDeflectorId` or `loadedWeightsG` |
| `tests/e2e/lesson.e2e.ts` | +2 | BUG-05 refused then the right force computed; single-disc removal |
| `tests/e2e/language.e2e.ts` | +1 | both new strings in Arabic, RTL |

The deflector fixture is **transcribed from the sheets and computes its own factors**, so it
would fail if the domain's numbers were wrong rather than agreeing with them by
construction.

### 12.1 Two existing tests changed on purpose

Both pinned `BUG-05` as expected behaviour:

| Test | Was | Now |
|---|---|---|
| `lesson-runner.spec.ts` — *advances a confirm step only when the learner confirms* | installed the **135° conical** disc while Exp. 1 was loaded and confirmed the step | installs Exp. 1's own 90° plate |
| `safety-guards.spec.tsx` — *accepts the selection once the tank is open* | installed the **180° hemisphere** under Exp. 1 and asserted the app took it | runs Exp. 2, where BEDO's sheet genuinely offers 120° **or** 180°, and selects the 120° |

Neither assertion was weakened; both now assert the same thing about guard 2 in a
configuration the sheets allow.

---

## 13. Verification

| | Before | After |
|---|---|---|
| Vitest | 637 | **731** (+94) |
| Playwright | 13 | **16** (+3) |
| Pre-existing tests changed | — | **2**, both listed above |
| Scene fingerprint | — | **identical in all 10 sections** |
| Draw calls / triangles / FB binds | 769 / 217 055 / 22 | unchanged |
| Boot requests / transfer | 15 / 25.92 MB | unchanged |
| JS raw | 1 239 070 B | 1 240 890 B (+1 820) |
| JS gzip | 344.39 kB | 344.86 kB (+470 B) |
| CSS | 7 170 B | 7 170 B |
| TypeScript / oxlint / build | clean | clean (2 pre-existing warnings) |

No new render loop, no `useFrame` work, no new asset request, and the disc proxies exist
only while discs are on the pan — which is why the baseline fingerprint reports the same
290 objects and the same 16 hotspots as before.
