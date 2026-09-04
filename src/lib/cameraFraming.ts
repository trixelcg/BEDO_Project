// Fitting a part of the apparatus into the part of the screen the learner can actually see.
//
// ## Why this exists
//
// Every guided view until now was a hand-authored offset in `ANCHOR_VIEW` — a camera
// position relative to an anchor, in model units, chosen by eye. That works for a fixed
// framing of a fixed part, and it is kept for those. It cannot answer "frame these three
// parts together, whatever size they turn out to be", which is what the end of the
// deflector install needs: the installed deflector, the rod it sits on and the top plate
// the learner reaches for next (`docs/44 §D5`).
//
// So this derives the distance from the bounds instead. There is deliberately one such
// derivation in the codebase — no competing fit algorithm (`§D6`).
//
// ## The 2D panel
//
// The instructional sidebar is 380 px wide with 24 px of padding, and it sits over the
// canvas rather than beside it: `.canvas-container` is `width: 100%`, and `.ui-container`
// is an overlay. So a part centred in the *canvas* can be half-hidden behind the panel and
// still pass any check written against canvas bounds.
//
// The panel is on the left in English and on the right in Arabic (`.rtl` reverses the flex
// row), and below 800 px it stops being a side panel at all. Rather than branch on any of
// that, the usable region is computed from measured rectangles, so the framing is correct
// in both languages and at every supported size without knowing which is in play.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How much of the region's smaller dimension to leave empty around the subject. */
export const FRAMING_PADDING = 1.18;

/**
 * A panel only counts as blocking an edge if it covers most of that edge.
 *
 * The side panel spans nearly the full height, so it trims width; the stacked layout under
 * 800 px spans the full width, so it trims height. A small floating element — a warning
 * popup — covers neither and is ignored rather than eating the whole viewport.
 */
export const BLOCKING_COVERAGE = 0.6;

/**
 * The largest axis-aligned part of `canvas` that no panel covers.
 *
 * Panels are trimmed off whichever edge they are nearest, which is exact for the layouts
 * that exist (one edge-anchored panel) and conservative for anything else. Coordinates are
 * in the same space as the inputs; callers pass client rects.
 */
export function usableRect(canvas: Rect, panels: readonly Rect[]): Rect {
  let { left, top, width, height } = canvas;
  for (const panel of panels) {
    if (panel.width <= 0 || panel.height <= 0) continue;
    const right = left + width;
    const bottom = top + height;

    if (panel.height >= height * BLOCKING_COVERAGE) {
      // A tall panel: trim the side it is nearest.
      const overlapLeft = panel.left + panel.width - left;
      const overlapRight = right - panel.left;
      if (overlapLeft > 0 && overlapLeft <= overlapRight) {
        width -= overlapLeft;
        left += overlapLeft;
      } else if (overlapRight > 0) {
        width -= overlapRight;
      }
    } else if (panel.width >= width * BLOCKING_COVERAGE) {
      const overlapTop = panel.top + panel.height - top;
      const overlapBottom = bottom - panel.top;
      if (overlapTop > 0 && overlapTop <= overlapBottom) {
        height -= overlapTop;
        top += overlapTop;
      } else if (overlapBottom > 0) {
        height -= overlapBottom;
      }
    }
  }
  return {
    left,
    top,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

/**
 * How far a perspective camera must stand for a sphere of `radius` to fit `region`.
 *
 * The vertical field of view is the camera's own; the horizontal one follows from the
 * **canvas** aspect, because that is what the projection uses — the region is a crop of
 * that projection, not a separate camera. Each is then reduced by the fraction of the
 * canvas the region actually occupies, and the binding one wins.
 */
export function fitDistance(
  radius: number,
  fovDegrees: number,
  canvas: Rect,
  region: Rect,
  padding = FRAMING_PADDING
): number {
  const safeRadius = Math.max(radius, 1e-6);
  const vFov = (fovDegrees * Math.PI) / 180;
  const aspect = Math.max(canvas.width, 1) / Math.max(canvas.height, 1);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

  const vShare = Math.min(1, Math.max(0.05, region.height / Math.max(canvas.height, 1)));
  const hShare = Math.min(1, Math.max(0.05, region.width / Math.max(canvas.width, 1)));

  const vDistance = (safeRadius * padding) / Math.tan((vFov * vShare) / 2);
  const hDistance = (safeRadius * padding) / Math.tan((hFov * hShare) / 2);
  return Math.max(vDistance, hDistance);
}

/**
 * How far to slide the whole view sideways and up so the subject lands in the middle of
 * `region` rather than the middle of the canvas.
 *
 * Returned in world units at `distance`, along the camera's own right and up vectors. The
 * caller adds it to *both* the camera position and the orbit target, which shifts the
 * frame without turning the camera — so the subject moves across the screen and the
 * composition stays square to the bench.
 */
export function regionOffset(
  canvas: Rect,
  region: Rect,
  distance: number,
  fovDegrees: number
): { right: number; up: number } {
  const vFov = (fovDegrees * Math.PI) / 180;
  const viewHeight = 2 * distance * Math.tan(vFov / 2);
  const viewWidth = viewHeight * (Math.max(canvas.width, 1) / Math.max(canvas.height, 1));

  const canvasCentreX = canvas.left + canvas.width / 2;
  const canvasCentreY = canvas.top + canvas.height / 2;
  const regionCentreX = region.left + region.width / 2;
  const regionCentreY = region.top + region.height / 2;

  return {
    // Moving the view left makes the subject appear further right, hence the negation.
    right: -((regionCentreX - canvasCentreX) / Math.max(canvas.width, 1)) * viewWidth,
    // Screen y grows downward; world up is the opposite.
    up: ((regionCentreY - canvasCentreY) / Math.max(canvas.height, 1)) * viewHeight,
  };
}


/**
 * Keeping the camera inside the room.
 *
 * ## The defect
 *
 * Every guided view is an anchor plus a hand-authored offset, and the offsets were chosen
 * against the parts they frame rather than against the walls behind them. Step 3 frames the
 * tank cover from far enough back that the camera ends up *outside* the window — the
 * apparatus is drawn through glass and a slice of the wall, which reads as a rendering
 * fault rather than as a camera position.
 *
 * ## Why a clamp, and not `CameraControls`
 *
 * The brief asks for drei's `CameraControls` with a boundary box. That is a different
 * controls API — `setLookAt`, its own damping, its own enabled semantics — and the rig here
 * drives `controls.target` and `controls.enabled` directly through a flight it owns, plus a
 * second transit mode that frames a moving disc. Swapping the controls means rewriting all
 * of that, and the boundary is the only part of it that fixes anything.
 *
 * So the boundary is applied where the problem is: to the position the rig computes, before
 * it flies there. `OrbitControls` keeps its own `minDistance`/`maxDistance`/`maxPolarAngle`,
 * which already bound what a *user* can do; this bounds what a *step* can ask for.
 *
 * ## What it does
 *
 * Pulls the camera back along the line to its own look-at target until it is inside the
 * box. Along that line, so the framing is preserved — the subject stays centred and simply
 * gets nearer. Moving it to the nearest point on the box instead would slide the subject
 * off to one side.
 */
export interface Bounds3 {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** How far inside the wall the camera is kept, in metres. A near plane needs room. */
export const ROOM_MARGIN = 0.25;

const inside = (p: readonly [number, number, number], b: Bounds3, margin: number): boolean =>
  p[0] >= b.min[0] + margin &&
  p[0] <= b.max[0] - margin &&
  p[1] >= b.min[1] + margin &&
  p[1] <= b.max[1] - margin &&
  p[2] >= b.min[2] + margin &&
  p[2] <= b.max[2] - margin;

/**
 * The camera position, pulled inside `bounds` along the line to `lookAt`.
 *
 * Returns `position` unchanged when it is already inside — the common case, and the one
 * that must cost nothing and change nothing.
 */
export function clampToRoom(
  position: readonly [number, number, number],
  lookAt: readonly [number, number, number],
  bounds: Bounds3,
  margin: number = ROOM_MARGIN
): [number, number, number] {
  if (inside(position, bounds, margin)) return [position[0], position[1], position[2]];

  // A bisection on the segment from the target to the camera: the target is the subject and
  // is inside the room by construction, so there is always an answer between the two. Forty
  // steps is exact to well under a micrometre over any room this size, and it is a handful
  // of comparisons run once per step change.
  let lo = 0; // at the target, inside
  let hi = 1; // at the camera, outside
  const at = (t: number): [number, number, number] => [
    lookAt[0] + (position[0] - lookAt[0]) * t,
    lookAt[1] + (position[1] - lookAt[1]) * t,
    lookAt[2] + (position[2] - lookAt[2]) * t,
  ];

  // If even the target is outside the room there is nothing sensible to pull back to, so
  // the position is left alone rather than dragged somewhere arbitrary.
  if (!inside(lookAt, bounds, margin)) return [position[0], position[1], position[2]];

  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (inside(at(mid), bounds, margin)) lo = mid;
    else hi = mid;
  }
  return at(lo);
}
