/**
 * The drag session — the input half of the interaction engine (`docs/16 §4`).
 *
 * ## Why this exists
 *
 * Every BEDO experiment sheet says the same thing at step 2: *"Drag the 90° flat
 * deflector to install it in the rod."* The evaluation the rebuild was commissioned from
 * says it again as a defect: *"The demo relies solely on basic clicks, lacking essential
 * features like drag-and-drop"* (§2b). Until now the only gesture the app had was a click,
 * so the instruction and the behaviour disagreed — `BUG-22`.
 *
 * ## What this is, and what it is deliberately not
 *
 * This module models a **gesture**, and nothing else. It knows a pointer went down on
 * something, how far it has travelled since, whether it is currently over a drop region,
 * and what that means when the pointer comes up. It maps the result to a *semantic
 * interaction* and hands it on.
 *
 * It does **not** know whether the interaction is allowed. That question has exactly one
 * answer in this codebase and it lives in `src/interaction/gate.ts`. A drag is an input
 * method; `BUG-04` and `BUG-05` are both what happened when a surface grew its own copy of
 * a rule, and adding a third surface is precisely the moment to not do that again.
 *
 * ```
 *   pointerdown / pointermove / pointerup      ← gesture, here
 *            ↓
 *   Interaction (SELECT_DEFLECTOR, REMOVE_WEIGHT)
 *            ↓
 *   evaluateInteraction()                      ← policy, gate.ts
 *            ↓
 *   SimulationRuntime.dispatch()               ← commitment
 *            ↓
 *   scene transfer animation                   ← presentation, transfer.ts
 * ```
 *
 * Pure, total, deterministic. No React, no three.js, no DOM, no globals.
 */

import type { Interaction } from './gate';

/** The two things on this rig a learner physically picks up. */
export type DragKind = 'deflector' | 'weight';

/**
 * What is being dragged, named the way the domain names it.
 *
 * A deflector is identified by its angle — the stable id `DEFLECTORS` uses — and a loaded
 * disc by its position in the stack, which is the identity `REMOVE_WEIGHT` takes and the
 * reason two 100 g discs stay distinguishable (`docs/37 §7`). No mesh, no uuid, no
 * three.js object crosses this boundary.
 */
export type DragSource =
  | { readonly kind: 'deflector'; readonly deflectorId: number }
  | { readonly kind: 'weight'; readonly index: number };

/** A pointer position in CSS pixels — the units `PointerEvent.clientX/Y` report. */
export interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * One gesture in flight.
 *
 * Transient presentation/input state, and only that: nothing here is authoritative about
 * the rig, and discarding a session at any moment leaves the simulation exactly as it was
 * (`BEDO-021 §3`, `§8`).
 */
export interface DragSession {
  readonly source: DragSource;
  /**
   * The pointer that owns this session.
   *
   * Sessions are keyed by `pointerId` rather than by "the mouse" so a second finger, a
   * second button or a stylus that arrives mid-drag can be ignored instead of hijacking
   * the object already being carried (`BEDO-021 §17`).
   */
  readonly pointerId: number;
  readonly startPoint: PointerPoint;
  readonly currentPoint: PointerPoint;
  /**
   * The pointer has travelled far enough for this to be a drag rather than a click.
   *
   * Latching: once true it stays true for the life of the session, so wandering back
   * towards the origin does not turn a drag half-way through into a click.
   */
  readonly isDragging: boolean;
  /** The pointer is currently over the source's drop region. Feedback only. */
  readonly overValidTarget: boolean;
}

/**
 * How far the pointer must move before a press becomes a drag.
 *
 * Expressed in **device** pixels and converted, rather than fixed in CSS pixels. Pointer
 * coordinates are reported in CSS pixels, so a hard-coded CSS threshold is a different
 * physical distance on every display: 6 CSS px is 6 device px on a 1× monitor and 12 on a
 * 2× one, which makes the same wrist movement read as a click on one machine and a drag on
 * the next. Pointing precision tracks device pixels, so that is what is held constant
 * (`BEDO-021 §15`).
 */
export const DRAG_THRESHOLD_DEVICE_PX = 8;

/**
 * A floor, so a very high pixel ratio cannot make the threshold so small that the tremor
 * in an ordinary click registers as a drag.
 */
export const MIN_DRAG_THRESHOLD_CSS_PX = 3;

export const dragThresholdPx = (devicePixelRatio = 1): number =>
  Math.max(MIN_DRAG_THRESHOLD_CSS_PX, DRAG_THRESHOLD_DEVICE_PX / Math.max(devicePixelRatio, 1));

/**
 * Whether releasing this kind of object anywhere but its target is a miss.
 *
 * A deflector has one destination the sheets name — *"install it in the rod"* — so
 * dropping it elsewhere is a miss and it goes back. A disc on the holder has no
 * destination in any BEDO document: the storyboard's transition is *"click on the weight
 * on holder — the weight removed from the tank holder in 2 sec"* (sl. 32, state D), which
 * is a removal, not a placement. Dragging one off is therefore the same act wherever the
 * hand lets go, and is accepted anywhere.
 */
const REQUIRES_DROP_TARGET: Readonly<Record<DragKind, boolean>> = {
  deflector: true,
  weight: false,
};

export const requiresDropTarget = (kind: DragKind): boolean => REQUIRES_DROP_TARGET[kind];

export const beginDrag = (
  source: DragSource,
  pointerId: number,
  at: PointerPoint
): DragSession => ({
  source,
  pointerId,
  startPoint: at,
  currentPoint: at,
  isDragging: false,
  overValidTarget: false,
});

export const ownsPointer = (session: DragSession | null, pointerId: number): boolean =>
  session !== null && session.pointerId === pointerId;

export const dragDistance = (session: DragSession): number =>
  Math.hypot(
    session.currentPoint.x - session.startPoint.x,
    session.currentPoint.y - session.startPoint.y
  );

/**
 * Advances a session with a pointer move.
 *
 * Returns the session **unchanged** — the same object, so a caller can skip work by
 * identity — when the move belongs to a different pointer or changes nothing.
 */
export const trackPointer = (
  session: DragSession,
  pointerId: number,
  at: PointerPoint,
  options: { readonly overValidTarget?: boolean; readonly thresholdPx?: number } = {}
): DragSession => {
  if (session.pointerId !== pointerId) return session;

  const thresholdPx = options.thresholdPx ?? dragThresholdPx();
  const next: DragSession = {
    ...session,
    currentPoint: at,
    overValidTarget: options.overValidTarget ?? session.overValidTarget,
  };
  const isDragging = session.isDragging || dragDistance(next) >= thresholdPx;

  if (
    next.currentPoint.x === session.currentPoint.x &&
    next.currentPoint.y === session.currentPoint.y &&
    next.overValidTarget === session.overValidTarget &&
    isDragging === session.isDragging
  ) {
    return session;
  }
  return { ...next, isDragging };
};

/**
 * What releasing the pointer means.
 *
 * `activate` is the click — the gesture BEDO's own storyboard specifies (*"When the user
 * clicks on the deflector…"*, sl. 14) — and `commit` is the drag the experiment sheets
 * specify. **Both produce the same semantic interaction**, which is the whole point:
 * `interactionFor` is not given the outcome, only the source. `tests/unit/drag.spec.ts`
 * pins that, and `docs/16 §4.1` records why the two documents do not actually conflict.
 */
export type DropOutcome =
  /** Released over the valid target after a real drag. */
  | 'commit'
  /** Released without passing the threshold — a press, i.e. a click. */
  | 'activate'
  /** Dragged, then released away from any valid target. Nothing happens; it goes back. */
  | 'return'
  /** Not this session's pointer. */
  | 'ignored';

export const resolveDrop = (session: DragSession, pointerId: number): DropOutcome => {
  if (session.pointerId !== pointerId) return 'ignored';
  if (!session.isDragging) return 'activate';
  if (!requiresDropTarget(session.source.kind)) return 'commit';
  return session.overValidTarget ? 'commit' : 'return';
};

/** Whether an outcome should be put to the interaction gate at all. */
export const commits = (outcome: DropOutcome): boolean =>
  outcome === 'commit' || outcome === 'activate';

/**
 * The semantic interaction a source stands for.
 *
 * The one place gesture becomes intent. Note what is *not* a parameter: how far the
 * pointer moved, which button was held, what it was released over, whether it was a click
 * or a drag. A source means one thing, and the gate decides about that thing.
 */
export const interactionFor = (source: DragSource): Interaction =>
  source.kind === 'deflector'
    ? { kind: 'apparatus', action: { type: 'SELECT_DEFLECTOR', deflectorId: source.deflectorId } }
    : { kind: 'apparatus', action: { type: 'REMOVE_WEIGHT', index: source.index } };
