// Geometry facts about Bedo_baked_v2.glb.
//
// Every name below is verified to exist as a mesh node in the GLB. Earlier code
// referenced meshes that were never in this model at all (Upper_Plate, Cylinder005,
// Cylinder006/008/010, Object019/020/021, Sphere010/011), so the cover never moved
// and the pump switch animated an unrelated pipe fitting.
//
// Names are written exactly as they are authored in the GLB. Always look meshes up
// through `gltfName` — see below.

/**
 * The name three.js will actually give a node.
 *
 * GLTFLoader runs every node name through PropertyBinding.sanitizeNodeName, which
 * turns whitespace into underscores and strips `. [ ] : /`. So the GLB's
 * "JET Force 2_214" is loaded as "JET_Force_2_214", and "Flat_surface_deflector_90.001"
 * as "Flat_surface_deflector_90001".
 *
 * getObjectByName on the authored name therefore returns undefined and fails silently.
 * That is why the nozzle was never found (so the jet never rendered), why the mounted
 * deflector never appeared on the rod, and why all seven mounted deflectors stayed
 * visible inside the tank at once — the code that meant to hide them never matched a
 * single node.
 */
export const gltfName = (authored: string): string =>
  authored.replace(/\s/g, '_').replace(/[[\]./:]/g, '');

export const MESH = {
  tankCover: 'Tank_cover',
  screws: 'Screws',
  spring: 'deflector_spring',
  rod: 'deflector_rod',
  pointer: 'Pointer',
  nozzle: 'JET Force 2_214',
  flowValve: 'Valve',
  volumetricValve: 'Object307',
  powerSwitch: 'Power_Switch',
  powerButtonBody: 'power_button_body001',
  powerLight: 'Diagram_Green_light_off',
  liquid: 'LIQUID001',
} as const;

/**
 * Water jet silhouettes shipped in /public/WaterShapes.
 *
 * Their heights are measured at load time rather than listed here. Each file parks its
 * mesh a long way from the origin (Water90_Flat sits at y = +117.9), and Water_low and
 * Water60_Cone are rotated a quarter turn about X, so their true vertical extents
 * (17.48 and 24.72) bear no relation to the 5.08 and 17.02 that used to be hard-coded.
 * Measuring the loaded bounding box gets both the offset and the height right.
 */
export const WATER_SHAPES = {
  low: { url: '/WaterShapes/Water_low.glb' },
  flat: { url: '/WaterShapes/Water90_Flat.glb' },
  hemi: { url: '/WaterShapes/Water180_HemiSphere.glb' },
  cone: { url: '/WaterShapes/Water60_Cone.glb' },
  oblique: { url: '/WaterShapes/Water45_Oblique.glb' },
} as const;

export type WaterShapeKey = keyof typeof WATER_SHAPES;

/** Which experiment a deflector belongs to — each family has its own force law. */
export type DeflectorFamily = 'flat' | 'oblique' | 'semi' | 'conical';

export interface DeflectorDef {
  /** Deflection angle in degrees — also used as the stable id. */
  id: number;
  family: DeflectorFamily;
  nameEn: string;
  nameAr: string;
  /** Momentum factor: F = factor * rho * A * v^2. */
  factor: number;
  /** Mesh resting on the tray, selectable by the student. */
  shelf: string;
  /** Mesh shown mounted on the rod inside the tank once selected. */
  installed: string;
  water: WaterShapeKey;
}

/**
 * The momentum factor is NOT one formula across the board — each experiment derives its
 * own, per BEDO's Phase 2 documents, and Jet force_Mathematical model.xlsx tabulates the
 * same values:
 *
 *   Flat (90°)                F = rho*A*V^2                 -> 1
 *   Oblique (30/45/60°)       Fx = rho*A*V^2 * sin^2(theta) -> 0.25 / 0.5 / 0.75
 *   Semi-circular (120/180°)  F = rho*A*V^2 * (1 - cos B)   -> 1.5 / 2
 *   Conical (135°)            F = 1.707 * rho*A*V^2         -> 1.707  (= 1 - cos 135)
 *
 * Applying 1 - cos(theta) to the oblique family — the obvious-looking generalisation —
 * understates it badly: it gives 0.134 / 0.293 / 0.5 instead of 0.25 / 0.5 / 0.75.
 */
const sinSquared = (deg: number) => Math.round(Math.sin((deg * Math.PI) / 180) ** 2 * 1000) / 1000;
const oneMinusCos = (deg: number) => Math.round((1 - Math.cos((deg * Math.PI) / 180)) * 1000) / 1000;

// The tray holds seven deflectors, matching the reference simulator's chart.
// Ordered left-to-right as they physically sit on the tray (by world x).
export const DEFLECTORS: DeflectorDef[] = [
  {
    id: 45,
    family: 'oblique',
    nameEn: 'Oblique surface (45°)',
    nameAr: 'عاكس منحرف (45 درجة)',
    factor: sinSquared(45), // 0.5
    shelf: 'Oblique_surface_deflector_45_base',
    installed: 'Oblique_surface_deflector_45.001',
    water: 'oblique',
  },
  {
    id: 90,
    family: 'flat',
    nameEn: 'Flat surface (90°)',
    nameAr: 'عاكس مسطح (90 درجة)',
    factor: 1.0,
    shelf: 'Flat_surface_deflector_90_base',
    installed: 'Flat_surface_deflector_90.001',
    water: 'flat',
  },
  {
    id: 135,
    family: 'conical',
    nameEn: 'Conical surface (135°)',
    nameAr: 'عاكس مخروطي (135 درجة)',
    factor: oneMinusCos(135), // 1.707
    shelf: 'Conical_deflector_135_base',
    installed: 'Conical_deflector_135.001',
    water: 'hemi',
  },
  {
    id: 120,
    family: 'semi',
    nameEn: 'Semi-circular (120°)',
    nameAr: 'عاكس نصف دائري (120 درجة)',
    factor: oneMinusCos(120), // 1.5
    shelf: 'Hemi_sphere_deflector_120_base',
    installed: 'Hemi_sphere_deflector_120.001',
    water: 'cone',
  },
  {
    id: 180,
    family: 'semi',
    nameEn: 'Semi-circular (180°)',
    nameAr: 'عاكس نصف دائري (180 درجة)',
    factor: oneMinusCos(180), // 2.0
    shelf: 'Hemi_sphere_deflector_180_base',
    installed: 'Hemi_sphere_deflector_180.001',
    water: 'hemi',
  },
  {
    id: 30,
    family: 'oblique',
    nameEn: 'Oblique surface (30°)',
    nameAr: 'عاكس منحرف (30 درجة)',
    factor: sinSquared(30), // 0.25
    shelf: 'Cone_surface_deflector_30_base',
    installed: 'Cone_surface_deflector_30.001',
    water: 'cone',
  },
  {
    id: 60,
    family: 'oblique',
    nameEn: 'Oblique surface (60°)',
    nameAr: 'عاكس منحرف (60 درجة)',
    factor: sinSquared(60), // 0.75
    shelf: 'Cone_surface_deflector_60_base',
    installed: 'Cone_surface_deflector_60.001',
    water: 'cone',
  },
];

export const DEFAULT_DEFLECTOR_ID = 90;

export const getDeflector = (id: number): DeflectorDef =>
  DEFLECTORS.find((d) => d.id === id) ?? DEFLECTORS.find((d) => d.id === DEFAULT_DEFLECTOR_ID)!;

export interface WeightDef {
  grams: number;
  /** Tray mesh the student can click. Denominations without one are panel-only. */
  mesh?: string;
}

// Balancing masses always land on a multiple of 10 g, so the set has to be able to
// make one. With only 50 g and up, the low-flow readings were unreachable and the
// step could never be completed honestly.
export const WEIGHTS: WeightDef[] = [
  { grams: 10, mesh: 'Weight_Custom' },
  { grams: 20 },
  { grams: 50, mesh: 'Weight_50' },
  { grams: 100, mesh: 'Weight_100' },
  { grams: 200, mesh: 'Weight_200' },
  { grams: 500, mesh: 'Weight_500' },
];

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
export type AnchorKey =
  | 'cover'
  | 'tray'
  | 'weights'
  | 'pointer'
  | 'pan'
  | 'power'
  | 'flowValve'
  | 'volumetricValve'
  | 'overview';

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
 * How to frame each part, so the camera can fly to whichever one the current step is
 * about — the way the reference simulator reframes between steps.
 *
 * The unit faces -Z: the control panel, both valves and the bench front all look that
 * way, and the pipework is boxed in behind them. Framing the valves from +Z puts the
 * camera inside the sump tank staring at the back of the cabinet, so those take
 * negative-Z offsets. The tray and cover sit on top and read fine from either side.
 */
export const ANCHOR_VIEW: Record<AnchorKey, AnchorView> = {
  cover: { offset: [0.28, 0.24, 0.62] },
  tray: { offset: [0.02, 0.30, 0.42] },
  power: { offset: [-0.30, 0.26, -0.58] },
  volumetricValve: { offset: [-0.28, 0.30, -0.90], arrowOffset: [0, 0.03, -0.11] },
  flowValve: { offset: [-0.24, 0.26, -0.78], arrowOffset: [0, 0.03, -0.10] },
  weights: { offset: [0.22, 0.38, 0.80] },
  pointer: { offset: [0.20, 0.26, 0.60] },
  pan: { offset: [0.20, 0.26, 0.60] },
  overview: { offset: [0.35, 0.75, 1.75] },
};
