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

/** A quarter turn, in radians. The travel BEDO gives every rotary control. */
export const QUARTER_TURN = Math.PI / 2;

/**
 * Which local axis the power switch turns about: its own face normal.
 *
 * The knob's bounding box is 29.8 x 43.8 x 45.0 mm — thinnest across **X** — so X is the
 * axis it faces along, and the operator stands at -X looking down +X (`FRONT`). A disc
 * spins about the axis it faces along; turning it about anything else tips it out of the
 * panel, which is exactly what the scene used to do (it turned the knob about Z, the
 * operator's left-to-right axis, and ON rendered as a flat ellipse lying down).
 */
export const POWER_SWITCH_AXIS = 'x' as const;

/**
 * Where the knob sits for a given power state, in radians about `POWER_SWITCH_AXIS`.
 *
 * **Source.** `Jetforce_Storyboard.pptx` sl. 29, state A: *"The red power switch is off.
 * (Rotate it smoothly 90 degrees **clockwise** to turn it on.)"*
 *
 * Sl. 30 appears to contradict it — *"The red power switch is on. (Rotate it smoothly 90
 * degrees anticlockwise to turn it on.)"* — but that sentence describes turning **on** a
 * switch it has just said is already on, which is not a transition that exists. It is sl.
 * 29's sentence copied and half-edited, and the two agree the moment it is read as "to turn
 * it off". Sl. 29 is the only one describing a transition from the state it is documenting,
 * so it wins. `docs/42 §2` sets out the evidence.
 *
 * **Sign.** Clockwise for an eye at -X looking along +X is a *positive* turn about X: the
 * right-hand rule carries +Y to +Z, and for that observer +Y is up and +Z is to the right,
 * so up-to-right — clockwise.
 */
export const powerSwitchTurn = (isPowerOn: boolean): number => (isPowerOn ? QUARTER_TURN : 0);
