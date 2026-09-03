// Geometry and identity facts about the VL-FM009 apparatus.
//
// This is *what the rig is*: which deflectors sit on the tray, what each one does to the
// jet, which weights exist, and the name each part is authored under in the model. It
// knows nothing about three.js, about how a name is looked up in a loaded scene, or about
// where a camera stands to look at a part — those live in `src/lib/gltfNames.ts` and
// `src/lib/apparatusView.ts`, on the presentation side of the boundary.
//
// Every name below is verified to exist as a node in Bedo_baked_v2.glb, and
// tests/unit/glb-contract.spec.ts checks all 33 of them against the shipped asset on
// every run. Earlier code referenced meshes that were never in this model at all
// (Upper_Plate, Cylinder005, Cylinder006/008/010, Object019/020/021, Sphere010/011), so
// the cover never moved and the pump switch animated an unrelated pipe fitting.
//
// Names are written exactly as they are authored in the GLB. Always resolve them through
// `gltfName` — see src/lib/gltfNames.ts for why the authored name is not the name
// three.js exposes.

export const MESH = {
  tankCover: 'Tank_cover',
  screws: 'Screws',
  spring: 'deflector_spring',
  rod: 'deflector_rod',
  pointer: 'Pointer',
  /** The thin vertical pin the pointer arm is clamped to — the arm swings about it. */
  pointerPin: 'JET Force 2_212',
  nozzle: 'JET Force 2_214',
  /**
   * The glass tank the jet plays inside — 0.181 wide by 0.317 tall, from y = 1.058 up to
   * the cover. The water meshes are sized to fill it, so this is what they scale against.
   */
  tank: 'JET Force 2_205',
  // The flow control valve's lever, on the black pipe under the bench, on the left.
  flowValve: 'Valve',
  /**
   * The volumetric (drain) valve's lever, under the bench on the operator's right, beside
   * the litre scale. This pointed at Object307 — a fitting on the *left*, next to the flow
   * valve — so step 5 turned the wrong part and framed the sump instead of the valve.
   * 1_087 has the same lever proportions as the flow handle (0.019 x 0.026 x 0.090), and
   * its valve body (1_086) sits right beside it.
   */
  volumetricValve: 'hydrolic bensh 1_087',
  powerSwitch: 'Power_Switch',
  powerButtonBody: 'power_button_body001',
  powerLight: 'Diagram_Green_light_off',
  liquid: 'LIQUID001',
} as const;

/**
 * The supply hose that the GLB assigns the tank's glass material (BEDO-WATER-12).
 *
 * `Galss_Material` has two users and only one of them is the vessel. This is the J-shaped
 * feed tube running into the tank base — the reference recording shows it translucent with
 * water visible inside — so `DeviceModel` gives it a hose material of its own rather than
 * the glass it inherited. Named here so that correction says what it acts on.
 */
export const MISMATERIALLED_HOSE = 'Line010';

/**
 * Water jet silhouettes shipped in /public/WaterShapes — one simulated plume per deflector,
 * plus the startup trickle.
 *
 * All eight are used. Three of them (30°, 120°, 135°) were not wired up at all, and their
 * deflectors borrowed another angle's plume: 120° showed the 60° cone, 135° showed the 180°
 * hemisphere, 30° showed the 60° cone again.
 *
 * Nothing about these files can be assumed:
 *  - Some park their mesh far from the origin (Water90_Flat sits at y = +117.9).
 *  - Some are rotated a quarter turn about X (Water_low, Water60_Cone) and some are not.
 *  - Water30/120/135 are authored lying down — their long axis is Z with no rotation node,
 *    so they render on their side unless stood upright.
 * Orientation, offset and size are therefore all measured from the loaded geometry rather
 * than trusted; see waterFit in DeviceModel.
 */
export const WATER_SHAPES = {
  low: { url: '/WaterShapes/Water_low.glb' },
  d30: { url: '/WaterShapes/Water30.glb' },
  d45: { url: '/WaterShapes/Water45_Oblique.glb' },
  d60: { url: '/WaterShapes/Water60_Cone.glb' },
  d90: { url: '/WaterShapes/Water90_Flat.glb' },
  d120: { url: '/WaterShapes/Water120_HemiSphere.glb' },
  d135: { url: '/WaterShapes/Water135_Conical.glb' },
  d180: { url: '/WaterShapes/Water180_HemiSphere.glb' },
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
  /** Momentum factor k in F = k * rho * A * v^2. Dimensionless. */
  momentumFactor: number;
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
    momentumFactor: sinSquared(45), // 0.5
    shelf: 'Oblique_surface_deflector_45_base',
    installed: 'Oblique_surface_deflector_45.001',
    water: 'd45',
  },
  {
    id: 90,
    family: 'flat',
    nameEn: 'Flat surface (90°)',
    nameAr: 'عاكس مسطح (90 درجة)',
    momentumFactor: 1.0,
    shelf: 'Flat_surface_deflector_90_base',
    installed: 'Flat_surface_deflector_90.001',
    water: 'd90',
  },
  {
    id: 135,
    family: 'conical',
    nameEn: 'Conical surface (135°)',
    nameAr: 'عاكس مخروطي (135 درجة)',
    momentumFactor: oneMinusCos(135), // 1.707
    shelf: 'Conical_deflector_135_base',
    installed: 'Conical_deflector_135.001',
    water: 'd135',
  },
  {
    id: 120,
    family: 'semi',
    nameEn: 'Semi-circular (120°)',
    nameAr: 'عاكس نصف دائري (120 درجة)',
    momentumFactor: oneMinusCos(120), // 1.5
    shelf: 'Hemi_sphere_deflector_120_base',
    installed: 'Hemi_sphere_deflector_120.001',
    water: 'd120',
  },
  {
    id: 180,
    family: 'semi',
    nameEn: 'Semi-circular (180°)',
    nameAr: 'عاكس نصف دائري (180 درجة)',
    momentumFactor: oneMinusCos(180), // 2.0
    shelf: 'Hemi_sphere_deflector_180_base',
    installed: 'Hemi_sphere_deflector_180.001',
    water: 'd180',
  },
  {
    id: 30,
    family: 'oblique',
    nameEn: 'Oblique surface (30°)',
    nameAr: 'عاكس منحرف (30 درجة)',
    momentumFactor: sinSquared(30), // 0.25
    shelf: 'Cone_surface_deflector_30_base',
    installed: 'Cone_surface_deflector_30.001',
    water: 'd30',
  },
  {
    id: 60,
    family: 'oblique',
    nameEn: 'Oblique surface (60°)',
    nameAr: 'عاكس منحرف (60 درجة)',
    momentumFactor: sinSquared(60), // 0.75
    shelf: 'Cone_surface_deflector_60_base',
    installed: 'Cone_surface_deflector_60.001',
    water: 'd60',
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

/**
 * Named points on the apparatus that a lesson step can be *about* — the part the step
 * asks the student to touch. The camera framing for each one is presentation, and lives
 * in src/lib/apparatusView.ts.
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
  | 'overview'
  /**
   * The printed wall board, framed head-on.
   *
   * Not a step's target and never in `panelControls`: it is where the *Board* utility
   * takes the camera so the learner can read the instrument, and it is restored to the
   * current step's own anchor on the way back (`BEDO-UX-14B`).
   */
  | 'board';
