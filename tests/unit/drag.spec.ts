import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_DEVICE_PX,
  MIN_DRAG_THRESHOLD_CSS_PX,
  beginDrag,
  commits,
  dragDistance,
  dragThresholdPx,
  interactionFor,
  ownsPointer,
  requiresDropTarget,
  resolveDrop,
  trackPointer,
  type DragSession,
  type DragSource,
} from '../../src/interaction/drag';

/**
 * The drag session (BEDO-021 §29).
 *
 * Every assertion here is about a *gesture*. Not one of them mentions a lesson step, an
 * experiment or a safety rule, because the module does not know about any of those — that
 * separation is the thing being pinned as much as the behaviour is.
 */

const DEFLECTOR: DragSource = { kind: 'deflector', deflectorId: 90 };
const WEIGHT: DragSource = { kind: 'weight', index: 1 };

const move = (session: DragSession, dx: number, dy = 0, overValidTarget = false) =>
  trackPointer(
    session,
    session.pointerId,
    { x: session.startPoint.x + dx, y: session.startPoint.y + dy },
    { overValidTarget, thresholdPx: 8 }
  );

describe('starting a gesture', () => {
  it('commits nothing — a press is not a selection', () => {
    const session = beginDrag(DEFLECTOR, 1, { x: 100, y: 100 });
    expect(session.isDragging).toBe(false);
    expect(session.overValidTarget).toBe(false);
    expect(dragDistance(session)).toBe(0);
  });

  it('records the pointer that owns it', () => {
    const session = beginDrag(DEFLECTOR, 7, { x: 0, y: 0 });
    expect(ownsPointer(session, 7)).toBe(true);
    expect(ownsPointer(session, 8)).toBe(false);
    expect(ownsPointer(null, 7)).toBe(false);
  });
});

describe('the click / drag threshold', () => {
  it('holds a constant distance in device pixels, not in CSS pixels', () => {
    // The same physical wrist movement has to mean the same thing on a 1x monitor and a
    // 2x one; a hard-coded CSS threshold is twice as far in device terms on the latter.
    expect(dragThresholdPx(1)).toBe(DRAG_THRESHOLD_DEVICE_PX);
    expect(dragThresholdPx(2)).toBe(DRAG_THRESHOLD_DEVICE_PX / 2);
  });

  it('never falls below the floor, however dense the display', () => {
    expect(dragThresholdPx(8)).toBe(MIN_DRAG_THRESHOLD_CSS_PX);
    expect(dragThresholdPx(0)).toBe(DRAG_THRESHOLD_DEVICE_PX);
  });

  it('stays a press below it and becomes a drag above it', () => {
    const session = beginDrag(DEFLECTOR, 1, { x: 100, y: 100 });
    expect(move(session, 3).isDragging).toBe(false);
    expect(move(session, 7.9).isDragging).toBe(false);
    expect(move(session, 8).isDragging).toBe(true);
    expect(move(session, 40).isDragging).toBe(true);
  });

  it('measures the diagonal, not one axis', () => {
    const session = beginDrag(DEFLECTOR, 1, { x: 0, y: 0 });
    // 6 and 6 are each under the threshold; together they are 8.49 px of travel.
    expect(move(session, 6, 6).isDragging).toBe(true);
  });

  it('latches, so drifting back towards the start does not undo a drag', () => {
    let session = beginDrag(DEFLECTOR, 1, { x: 0, y: 0 });
    session = move(session, 40);
    expect(session.isDragging).toBe(true);
    session = trackPointer(session, 1, { x: 0, y: 0 }, { thresholdPx: 8 });
    expect(session.isDragging).toBe(true);
  });
});

describe('pointer ownership', () => {
  it('ignores a move from a pointer that does not own the gesture', () => {
    const session = beginDrag(DEFLECTOR, 1, { x: 0, y: 0 });
    const other = trackPointer(session, 2, { x: 500, y: 500 }, { thresholdPx: 8 });
    // Same object back: a second finger cannot move the object the first is carrying.
    expect(other).toBe(session);
  });

  it('ignores a release from a pointer that does not own the gesture', () => {
    const session = move(beginDrag(DEFLECTOR, 1, { x: 0, y: 0 }), 40, 0, true);
    expect(resolveDrop(session, 2)).toBe('ignored');
    expect(commits('ignored')).toBe(false);
  });

  it('returns the identical session when nothing about it changed', () => {
    const session = beginDrag(DEFLECTOR, 1, { x: 10, y: 10 });
    expect(trackPointer(session, 1, { x: 10, y: 10 }, { thresholdPx: 8 })).toBe(session);
  });
});

describe('resolving a release', () => {
  it('a press with no travel is a click, wherever it is released', () => {
    const session = move(beginDrag(DEFLECTOR, 1, { x: 0, y: 0 }), 2);
    expect(resolveDrop(session, 1)).toBe('activate');
    expect(commits('activate')).toBe(true);
  });

  it('a drag released on the rod commits', () => {
    const session = move(beginDrag(DEFLECTOR, 1, { x: 0, y: 0 }), 60, 0, true);
    expect(resolveDrop(session, 1)).toBe('commit');
    expect(commits('commit')).toBe(true);
  });

  it('a drag released away from the rod goes back, and asks the gate nothing', () => {
    const session = move(beginDrag(DEFLECTOR, 1, { x: 0, y: 0 }), 60, 0, false);
    expect(resolveDrop(session, 1)).toBe('return');
    expect(commits('return')).toBe(false);
  });

  it('a disc pulled off the holder commits wherever it is let go', () => {
    // The storyboard's transition is a removal, not a placement: "click on the weight on
    // holder — the weight removed from the tank holder in 2 sec" (sl. 32, state D). There
    // is no destination to miss.
    expect(requiresDropTarget('weight')).toBe(false);
    expect(requiresDropTarget('deflector')).toBe(true);
    const session = move(beginDrag(WEIGHT, 1, { x: 0, y: 0 }), 90, 40, false);
    expect(resolveDrop(session, 1)).toBe('commit');
  });
});

describe('gesture to intent', () => {
  it('a deflector source means SELECT_DEFLECTOR, by angle', () => {
    expect(interactionFor(DEFLECTOR)).toEqual({
      kind: 'apparatus',
      action: { type: 'SELECT_DEFLECTOR', deflectorId: 90 },
    });
  });

  it('a weight source means REMOVE_WEIGHT, by stack position', () => {
    // Position, not mass — which is what keeps two 100 g discs distinguishable.
    expect(interactionFor({ kind: 'weight', index: 1 })).toEqual({
      kind: 'apparatus',
      action: { type: 'REMOVE_WEIGHT', index: 1 },
    });
  });

  it('produces the same intent for a click and for a drag', () => {
    // BEDO-021 §30, at the level this module can prove it: the mapping is a function of
    // the source alone. How far the pointer travelled, which button was down and what it
    // was released over are not parameters, so they cannot change the meaning.
    const clicked = move(beginDrag(DEFLECTOR, 1, { x: 0, y: 0 }), 1);
    const dragged = move(beginDrag(DEFLECTOR, 2, { x: 0, y: 0 }), 200, 120, true);
    expect(resolveDrop(clicked, 1)).toBe('activate');
    expect(resolveDrop(dragged, 2)).toBe('commit');
    expect(interactionFor(clicked.source)).toEqual(interactionFor(dragged.source));
  });
});
