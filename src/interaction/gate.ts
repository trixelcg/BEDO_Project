/**
 * The interaction gate: one policy for every learner interaction, whatever surface it
 * arrives from.
 *
 * ## What BUG-04 was
 *
 * The guided panel showed only the current step's controls, so the 2D path respected the
 * lesson by *not rendering* the wrong buttons. The 3D path had no such filter: every
 * hotspot in the scene called straight through to the simulation at every step. Clicking
 * the power switch during step 1 turned the pump on; clicking it again during step 5
 * turned it off in the middle of a reading. Two surfaces, two different sets of rules,
 * and only one of them written down.
 *
 * Hiding a control is a presentation choice. It is not a rule, and `docs/16` had already
 * observed that treating it as one is how the two paths came apart. This module is the
 * rule, and both surfaces ask it.
 *
 * ## Two questions, still separate
 *
 * *Is this the step's action?* is the lesson's question, answered from the step's own
 * metadata. *Is this mechanically safe?* is the apparatus's question, answered by
 * `attempt()`. `BEDO-006` and `BEDO-018` were careful to keep those apart and this module
 * does not merge them: it asks each in turn and reports which one refused, in that one's
 * own vocabulary.
 *
 * ## Semantic, never numeric
 *
 * Nothing here compares a step number, a button id or a mesh name. An interaction maps to
 * an *affordance* — the group of apparatus parts or panel sections it belongs to — and a
 * step already declares which affordances it invites (`highlight`) and which it shows
 * (`panelControls`). The gate is the intersection of those declarations with the incoming
 * interaction. Renumbering, merging or dropping a step changes the policy for free, which
 * is the property `BEDO-018` bought and this module spends.
 *
 * Pure, total, deterministic. No React, no three.js, no DOM, no strings a student sees.
 */

import { attempt, type ApparatusAction, type ApparatusState, type RejectionReason } from '../domain/stateMachine';
import { DEFLECTORS } from '../domain/apparatus';
import { getExperiment, isDeflectorInScope, type ExperimentId } from '../domain/experiments';
import type { HighlightKey, Lesson, LessonStepDefinition, PanelControl } from '../lesson/schema';
import type { LessonMode } from '../lesson/runner';

/**
 * The unit the gate reasons in: a group of controls that belong to one part of the rig or
 * one panel section.
 *
 * Deliberately the union of the two vocabularies a step already speaks. `cover` exists
 * only as a highlight (the plate has no panel button); `monitor` and `answerSheet` only as
 * panel controls (a screen is not part of the apparatus). Every other key is in both, and
 * in `src/lesson/currentLesson.ts` every step's two lists agree on them — which is what
 * makes one gate able to serve both surfaces.
 */
export type InteractionAffordance = HighlightKey | PanelControl;

/**
 * Interactions the lesson governs but the apparatus has no opinion about.
 *
 * A screen is not a machine part. `RECORD_ACTUAL_FORCE` does change simulation state, but
 * no safety guard reads it and inventing an apparatus action to carry it would put a
 * button press into the rig's state machine, so it stays here.
 */
export type PresentationAction = 'OPEN_MONITOR' | 'RECORD_ACTUAL_FORCE' | 'OPEN_ANSWER_SHEET';

/**
 * What the learner is trying to do.
 *
 * Intent, not event: a click, a drag and a keyboard activation of the same control are one
 * interaction here. That is what lets the future interaction engine (`docs/16`) add input
 * kinds without touching the policy.
 */
export type Interaction =
  | { readonly kind: 'apparatus'; readonly action: ApparatusAction }
  | { readonly kind: 'presentation'; readonly action: PresentationAction };

/**
 * Why the lesson refused.
 *
 * Kept apart from `RejectionReason` on purpose: a safety refusal is a fact about the rig
 * and a lesson refusal is a fact about where the learner is in the procedure. Sharing a
 * code between them would make the two indistinguishable at exactly the point where the
 * app has to choose what to say.
 */
export type LessonBlockReason =
  | 'NOT_EXPECTED_IN_CURRENT_STEP'
  /**
   * The deflector is real, installable and belongs to a different experiment.
   *
   * A second reason rather than a second use of the first: the learner *is* on the step
   * that asks for a deflector and *is* touching the right affordance. What is wrong is the
   * value, and "you are not at this step yet" would be untrue and unhelpful. `BUG-05`.
   */
  | 'DEFLECTOR_NOT_IN_EXPERIMENT';

export type InteractionDecision =
  | { readonly allowed: true; readonly why: 'EXPECTED' | 'ALWAYS_AVAILABLE' | 'FREE_MODE' }
  | { readonly allowed: false; readonly blockedBy: 'apparatus'; readonly reason: RejectionReason }
  | {
      readonly allowed: false;
      readonly blockedBy: 'lesson';
      readonly reason: LessonBlockReason;
      /** The affordance the interaction belongs to, for feedback that wants to name it. */
      readonly affordance: InteractionAffordance;
    };

export interface InteractionRequest {
  readonly interaction: Interaction;
  /**
   * Which experiment sheet is loaded.
   *
   * The apparatus does not know or care — a rod holds whatever you put on it — so this is
   * not part of `ApparatusState`. It is the lesson's context, and only the deflector rule
   * reads it.
   */
  readonly experimentId: ExperimentId;
  /** Read by the apparatus check. Ignored for presentation interactions. */
  readonly apparatus: ApparatusState;
  readonly step: LessonStepDefinition;
  readonly lesson: Lesson;
  readonly mode: LessonMode;
}

/** Which group of controls an interaction belongs to. Total over both unions. */
export const affordanceOf = (interaction: Interaction): InteractionAffordance => {
  if (interaction.kind === 'presentation') {
    return interaction.action === 'OPEN_ANSWER_SHEET' ? 'answerSheet' : 'monitor';
  }
  switch (interaction.action.type) {
    case 'OPEN_COVER':
    case 'CLOSE_COVER':
      return 'cover';
    case 'SELECT_DEFLECTOR':
      return 'deflectors';
    case 'POWER_ON':
    case 'POWER_OFF':
      return 'power';
    case 'OPEN_VOLUMETRIC_VALVE':
    case 'CLOSE_VOLUMETRIC_VALVE':
      return 'volumetricValve';
    case 'SET_VALVE':
      return 'flowValve';
    case 'ADD_WEIGHT':
    case 'REMOVE_WEIGHT':
    case 'REMOVE_ALL_WEIGHTS':
      return 'weights';
  }
};

/**
 * Everything the learner may touch while this step is current.
 *
 * The step's own two declarations, plus whatever the lesson makes available at every step.
 * `alwaysAvailable` is why the volumetric valve survives `BEDO-019`'s loss of its step
 * number — the gate reads the lesson's metadata rather than naming the valve, so the next
 * always-available affordance needs no code change here.
 */
export const affordancesAvailableAt = (
  lesson: Lesson,
  step: LessonStepDefinition
): ReadonlySet<InteractionAffordance> =>
  new Set<InteractionAffordance>([
    ...step.highlight,
    ...step.panelControls,
    ...(lesson.alwaysAvailable ?? []),
  ]);

/**
 * The single decision.
 *
 * ## Order, and why it is this one
 *
 * Apparatus legality is evaluated **first**, and `docs/36 §5` records the reasoning.
 * Briefly: `attempt()` is pure, so asking it costs nothing and mutates nothing — the
 * ordering has no bearing on `BEDO-020 §12`. What it does change is which sentence the
 * learner reads when an action is both unsafe *and* premature, and there the safety guard
 * wins on merit. "You can't add weights while the tank is open" is one of BEDO's five
 * documented rules, written by them, translated, and about the real rig; "that is not this
 * step" is a fact about the software. The former also happens to be the message the app
 * has always shown in those situations, so preferring it keeps every safety-guard
 * expectation in `tests/integration/safety-guards.spec.tsx` true at whatever step the test
 * happens to be standing on.
 *
 * Free mode skips the lesson question entirely and keeps the apparatus one.
 */
export const evaluateInteraction = (request: InteractionRequest): InteractionDecision => {
  const { interaction, apparatus, experimentId, step, lesson, mode } = request;

  // 1. Apparatus legality — pure, and nothing is committed by asking.
  if (interaction.kind === 'apparatus') {
    const outcome = attempt(apparatus, interaction.action);
    if (!outcome.ok) return { allowed: false, blockedBy: 'apparatus', reason: outcome.reason };
  }

  // 2. Lesson legality — guided only.
  if (mode !== 'guided') return { allowed: true, why: 'FREE_MODE' };

  // 2a. Value legality, for the one action whose *value* the lesson constrains.
  //
  // BEDO-020 gates on affordance groups, which answers "may I touch the deflectors" and
  // not "which one". That granularity was right for every other control and is exactly
  // the gap `BUG-05` lives in, so this is the one place the gate looks past the group.
  if (interaction.kind === 'apparatus' && interaction.action.type === 'SELECT_DEFLECTOR') {
    if (!isDeflectorInScope(experimentId, interaction.action.deflectorId)) {
      return {
        allowed: false,
        blockedBy: 'lesson',
        reason: 'DEFLECTOR_NOT_IN_EXPERIMENT',
        affordance: 'deflectors',
      };
    }
  }

  const affordance = affordanceOf(interaction);
  if (step.highlight.includes(affordance as HighlightKey) ||
      step.panelControls.includes(affordance as PanelControl)) {
    return { allowed: true, why: 'EXPECTED' };
  }
  if (lesson.alwaysAvailable?.includes(affordance as PanelControl)) {
    return { allowed: true, why: 'ALWAYS_AVAILABLE' };
  }
  return {
    allowed: false,
    blockedBy: 'lesson',
    reason: 'NOT_EXPECTED_IN_CURRENT_STEP',
    affordance,
  };
};

/** Every affordance there is. Free mode's answer, and the exhaustiveness check's. */
export const ALL_AFFORDANCES: readonly InteractionAffordance[] = [
  'cover',
  'deflectors',
  'power',
  'volumetricValve',
  'flowValve',
  'weights',
  'monitor',
  'answerSheet',
];

/**
 * What the presentation layer needs to know: which affordances the gate will accept.
 *
 * Exported so the scene can tell an actionable hotspot from a blocked one *without*
 * re-deriving the rule — `BEDO-020 §24`. Note this is **not** the same question as "what
 * is the step asking for": the volumetric valve is actionable at every step and asked for
 * at none, so the pulsing highlight and the guide arrow keep reading `step.highlight`
 * while the pointer cursor reads this. Conflating them would make the valve pulse for
 * attention on all eleven steps, which is a redesign and not this task's business.
 */
export const availableAffordances = (
  lesson: Lesson,
  step: LessonStepDefinition,
  mode: LessonMode
): ReadonlySet<InteractionAffordance> =>
  mode === 'guided'
    ? affordancesAvailableAt(lesson, step)
    : new Set<InteractionAffordance>(ALL_AFFORDANCES);

/**
 * Which deflectors may go on the rod right now.
 *
 * **The one source** for both the policy and the controls that present it — the panel's
 * list and the scene's tray both read this, so neither can offer something the gate would
 * refuse, and neither can hide something it would accept. Enforcing a rule by rendering a
 * shorter list is what `BUG-05` was, exactly as `BUG-04` was enforcing one by hiding a
 * button.
 *
 * Guided runs the loaded experiment's own angles; free mode is unrestricted apparatus
 * exploration and offers all seven. See `docs/37 §4` for why free mode is not a hole:
 * every surface that names the experiment also names the installed deflector.
 */
export const deflectorsSelectableIn = (
  experimentId: ExperimentId,
  mode: LessonMode
): readonly number[] =>
  mode === 'guided' ? getExperiment(experimentId).angles : DEFLECTORS.map((d) => d.id);
