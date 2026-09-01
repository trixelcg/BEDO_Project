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
  /**
   * Head-on at the printed board, for the Board view.
   *
   * Straight out along the panel's own normal, which was measured rather than guessed:
   * the quad's face normal is (-0.9397, 0, -0.3420) in model space, so standing back along
   * it puts the camera square to the artwork and keeps the printed values free of skew.
   * 1.6 model units back frames the whole 1.94 x 1.11 panel with room around it — the
   * board is 3.49 m wide and the group is scaled 1.8.
   */
  board: { offset: [-1.503, 0, -0.547] },
};

// --- The spring's travel, in model terms -------------------------------------------
//
// The domain computes the spring's displacement in millimetres and knows nothing about
// the model (src/domain/spring.ts). These three constants are the scene's half of that
// contract: how long a millimetre is here, how tall the spring is, and how far it may
// travel before it meets the surface above it.

/**
 * One model unit is one metre.
 *
 * Measured, not assumed: the glass tank (`JET Force 2_205`) is 0.317 model units tall and
 * 0.181 wide, which is a ~32 cm bench-top tank. The apparatus group is then scaled by
 * 1.8 for the scene, which is why every offset below is applied inside the group.
 */
export const MODEL_UNITS_PER_METRE = 1;
export const mmToModelUnits = (mm: number): number => (mm / 1000) * MODEL_UNITS_PER_METRE;

/**
 * The spring's rest height, measured from `deflector_spring` in `Bedo_baked_v2.glb`:
 * 0.101532 world units over an apparatus scale of 1.8.
 *
 * `DeviceModel` re-measures this from the loaded mesh at runtime and passes what it finds;
 * this constant is the value the shipped model actually has, used as the fallback and by
 * the tests, and it replaces the bare `0.065` guess the old code fell back to.
 */
export const SPRING_REST_HEIGHT_MODEL_UNITS = 0.056407;

/**
 * How far the spring may rise, in millimetres.
 *
 * BEDO's storyboard states this as geometry — *"The spring will not exceed the cover or
 * holder surface"* (sl. 8, three times) — and gives no number, so none is invented here.
 * The fraction below is the one the implementation has always used, kept at its existing
 * value so that BEDO-007 changes only what the specification requires: the floor at zero.
 *
 * Deriving the true limit from where the cover and holder actually sit is open work; see
 * `docs/31 §5`.
 */
export const SPRING_TRAVEL_FRACTION_OF_REST = 0.45;

export const springTravelLimitMm = (restHeightModelUnits: number): number =>
  (restHeightModelUnits * SPRING_TRAVEL_FRACTION_OF_REST) / MODEL_UNITS_PER_METRE * 1000;

// --- The power switch's visible travel ------------------------------------------------
//
// Presentation only. The rig's power is `isPowerOn` in the domain and nothing here can
// change it; this decides which way the knob *looks* like it turned.
//
// The knob does **not** turn about a world axis. Its panel is an angled console, so the
// spindle is 29.45 degrees off world X and has to be derived from the asset — see
// `src/lib/powerSwitch.ts`, which owns the axis, the pivot and the direction together
// because none of the three means anything without the other two.
//
// `QUARTER_TURN` and `powerSwitchTurn` are re-exported here so the long-standing import
// site keeps working, but `powerSwitch.ts` is where they are defined and documented.
export { QUARTER_TURN, powerSwitchTurn } from './powerSwitch';
