// How the apparatus is framed and animated — presentation, not domain.
//
// The domain knows a step is about the cover (`AnchorKey`); this knows where a camera
// stands to look at it, how far the plate travels when it is unscrewed, and which way the
// rig faces. BEDO-013/014 fold this into a scene layer.

import type { AnchorKey } from '../domain/apparatus';

// How far each assembly travels when the tank cover is unscrewed, in model units.
// The cover carries the spring, rod and mounted deflector, so they all rise together;
// the screws lift clear above them.
export const COVER_LIFT = 0.286;
export const SCREW_LIFT = 0.36;

/**
 * Named points on the apparatus that the camera can focus and the guide arrow can
 * point at. Resolved at runtime from real mesh bounding boxes (see DeviceModel),
 * never hard-coded — a hard-coded hotspot is what left the old click targets
 * floating in empty space, metres from the parts they claimed to represent.
 */
export type Anchors = Partial<Record<AnchorKey, [number, number, number]>>;

export interface AnchorView {
  /** Camera position relative to the anchor, in model units (scaled by the group). */
  offset: [number, number, number];
  /**
   * Where the guide arrow floats relative to the anchor. Defaults to hovering above.
   * The valves live in the few centimetres under the bench top, so an arrow directly
   * above them is buried inside the cabinet — those push it out towards the viewer.
   */
  arrowOffset?: [number, number, number];
}

export const DEFAULT_ARROW_OFFSET: [number, number, number] = [0, 0.09, 0];

/**
 * Where the operator stands, in model space.
 *
 * The rig faces -X. Renders from each side settle it: from -X you get the view the
 * reference video opens on — the BEDO chart on the far wall, the red emergency-stop panel
 * square to you, the tank left, the deflector tray and weights right, and both valves
 * visible under the bench. Every other side looks at its back or into a wall.
 *
 * Facing +X with +Y up, the operator's right hand points along +Z. Camera offsets below
 * are read in those terms: negative X stands the camera in front, positive Z moves it to
 * the operator's right.
 */
export const FRONT: [number, number, number] = [-1, 0, 0];

/**
 * How to frame each part, so the camera can fly to whichever one the current step is
 * about — the way the reference simulator reframes between steps.
 */
export const ANCHOR_VIEW: Record<AnchorKey, AnchorView> = {
  cover: { offset: [-0.52, 0.22, 0.34] },
  tray: { offset: [-0.34, 0.34, 0.24] },
  power: { offset: [-0.44, 0.20, 0.12] },
  // Both valves live under the bench and are approached from the operator's right,
  // which is where they actually face.
  volumetricValve: { offset: [-0.50, 0.15, 0.30], arrowOffset: [-0.09, 0.05, 0] },
  flowValve: { offset: [-0.52, 0.22, 0.44], arrowOffset: [-0.09, 0.04, 0] },
  weights: { offset: [-0.44, 0.34, 0.34] },
  pointer: { offset: [-0.42, 0.24, 0.30] },
  pan: { offset: [-0.42, 0.24, 0.30] },
  overview: { offset: [-1.45, 0.70, 0.45] },
};
