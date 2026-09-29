// Where the inspected part is on screen, and where its card goes (F17).
//
// The scene knows where a part is in 3D; the card is DOM. The scene projects the part's
// anchor once per frame and publishes the screen point here; the card subscribes and
// places itself beside it. A tiny external store rather than React state, so the scene
// does not re-render the tree every frame the camera moves — only the card re-renders,
// and only when the point has actually moved.

import type { ComponentRef } from '../domain/componentInfo';

/** The part a card or focus tooltip is about, and why it opened. */
export interface Inspection {
  ref: ComponentRef;
  /** Stable anchor id (`anchorIdOf`), which the scene resolves to the part's position. */
  anchorId: string;
  /**
   * `click`: a deliberate click opened the full card, which stays until closed.
   * `focus`: a panel control for this part has keyboard focus; a compact card shows while
   * it does, and goes when focus leaves.
   */
  via: 'click' | 'focus';
  /** The scene's own key for the exact proxy clicked (a disc's seat), when it has one. */
  sceneKey?: string;
}

export interface AnchorPoint {
  x: number;
  y: number;
  /** False when the part is behind the camera or off the canvas. */
  onScreen: boolean;
}

let point: AnchorPoint | null = null;
const listeners = new Set<() => void>();

/** Called by the scene each frame for the inspected anchor (null: nothing to anchor to). */
export function publishAnchorPoint(next: AnchorPoint | null): void {
  const same =
    (next === null && point === null) ||
    (next !== null &&
      point !== null &&
      next.onScreen === point.onScreen &&
      Math.abs(next.x - point.x) < 0.5 &&
      Math.abs(next.y - point.y) < 0.5);
  if (same) return;
  point = next;
  listeners.forEach((l) => l());
}

export function subscribeAnchorPoint(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getAnchorPoint = (): AnchorPoint | null => point;

/** Gap between the part's anchor dot and the card's nearest edge, CSS px. */
export const CARD_GAP = 18;
/** Keep this far from every viewport edge, CSS px. */
export const CARD_MARGIN = 12;

export type CardSide = 'right' | 'left' | 'above' | 'below';

/**
 * Where a card of `size` goes for an anchor at `at`: beside the part, never on it.
 *
 * Tries the inline-end side first (right in LTR, left in RTL), then the other side, then
 * above and below — the first where the card fits whole inside `bounds` without covering
 * the anchor. If none fits, the side with the most room, clamped inside the bounds. The
 * part itself stays visible in every placement that fits, which is what keeps the card
 * "near its component" without hiding it.
 */
export function placeCard(
  at: { x: number; y: number },
  size: { width: number; height: number },
  bounds: { left: number; top: number; right: number; bottom: number },
  dir: 'ltr' | 'rtl' = 'ltr'
): { left: number; top: number; side: CardSide } {
  const { width: w, height: h } = size;
  const clampX = (x: number) => Math.max(bounds.left + CARD_MARGIN, Math.min(x, bounds.right - w - CARD_MARGIN));
  const clampY = (y: number) => Math.max(bounds.top + CARD_MARGIN, Math.min(y, bounds.bottom - h - CARD_MARGIN));
  const candidates: Record<CardSide, { left: number; top: number }> = {
    right: { left: at.x + CARD_GAP, top: clampY(at.y - h / 2) },
    left: { left: at.x - CARD_GAP - w, top: clampY(at.y - h / 2) },
    above: { left: clampX(at.x - w / 2), top: at.y - CARD_GAP - h },
    below: { left: clampX(at.x - w / 2), top: at.y + CARD_GAP },
  };
  const fits = (c: { left: number; top: number }) =>
    c.left >= bounds.left + CARD_MARGIN - 0.5 &&
    c.top >= bounds.top + CARD_MARGIN - 0.5 &&
    c.left + w <= bounds.right - CARD_MARGIN + 0.5 &&
    c.top + h <= bounds.bottom - CARD_MARGIN + 0.5;
  const order: CardSide[] = dir === 'rtl' ? ['left', 'right', 'above', 'below'] : ['right', 'left', 'above', 'below'];
  for (const side of order) if (fits(candidates[side])) return { ...candidates[side], side };
  // Nowhere fits whole: take the side with the most room and keep the card on screen.
  const room: Record<CardSide, number> = {
    right: bounds.right - at.x,
    left: at.x - bounds.left,
    above: at.y - bounds.top,
    below: bounds.bottom - at.y,
  };
  const side = order.reduce((best, s) => (room[s] > room[best] ? s : best), order[0]);
  const c = candidates[side];
  return { left: clampX(c.left), top: clampY(c.top), side };
}
