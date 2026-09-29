// One physical family for every slotted mass the learner can load (F04).
//
// ## What was wrong
//
// The model ships four discs (50, 100, 200 and 500 g) that are all 57.4 mm across and
// differ only in thickness, 5.5 to 16.5 mm — not in proportion to their mass (the 500 g
// disc is three times the 50 g one's thickness for ten times its mass, which would make it
// a 12.3 g/cm³ metal, denser than lead). A fifth disc, `Weight_Custom`, is 16.5 mm thick —
// exactly the 500 g disc — and stood in for 10 g on the tray and for 20 g, 25 g and every
// custom mass in the air and on the pan. So the lightest weights on the rig looked like
// the heaviest. The labels were baked into five separate 2048² atlases, read upright only
// from the side of the bench, and the 10 g disc had none.
//
// ## The family
//
// Every disc is the same part in the same material, and is sized from its mass alone:
//
//   * **One material.** Chrome-finished steel, 7.85 g/cm³. Volume is therefore exactly
//     proportional to mass, and a heavier disc can never look smaller than a lighter one.
//   * **One bore.** 12.7 mm, what every authored disc already has; it slides over the pan's
//     10.3 mm post (`holderAnchor.ts`).
//   * **Diameter grows with mass**, as a power law pinned to the authored 500 g disc:
//     D = 57.4 mm · (m / 500 g)^0.16. The exponent is the one choice here, and it was
//     measured, not picked: geometric similarity would be 1/3, which shrinks a 10 g disc to
//     a 15.6 mm washer with a 1.5 mm face — no room for a mass at all. 0.16 is where the
//     10 g disc's engraving reads at 6 px of cap height in the lesson's own balancing view
//     (0.18 gave 5.3 px); every step up in mass is still a visible step up in diameter.
//   * **Thickness follows from the volume**, so it rises with mass too:
//     t = (m / ρ) / (π/4 · (D² − bore²)).
//
// Both dimensions rise with mass, so a disc is bigger than every lighter disc in *both*
// directions and the order reads from size alone; the printed mass confirms it.
//
//   mass   diameter  thickness  type       mass   diameter  thickness  type
//   10 g   30.7 mm    2.1 mm   4.6 mm    100 g   44.4 mm    9.0 mm   7.8 mm
//   20 g   34.3 mm    3.2 mm   5.6 mm    200 g   49.6 mm   14.1 mm   8.0 mm
//   50 g   39.7 mm    5.7 mm   7.2 mm    500 g   57.4 mm   25.9 mm   8.0 mm
//
// ## The custom weight is not part of it
//
// The disc by the tank is the **custom weight** — the one the custom-weight control
// (5-500 g, 25 g to start) sets — not a denomination. It keeps the model's own part,
// `Weight_Custom`: its shape, its finish, its place, and **no mass engraved on it**,
// because it has no single mass to engrave. On the tray and on the pan, whatever the
// control is set to, it is that part.
//
// The heaviest load any lesson balances is 520 g (500 + 20): 31 mm of stack on a 57 mm
// post, so the family still fits the apparatus it hangs on.
//
// ## The label
//
// Engraved on the top face, on the far side of the bore, as large as the face allows: 8 mm
// capitals on the 200 g and 500 g discs, stepping down with the disc to 4.6 mm on the 10 g
// one — never smaller than the model's own baked labels (about 4 mm, on every disc). Turned to read upright from
// where the lesson's camera looks at the tray (`ANCHOR_VIEW.weights`) rather than from the
// side of the bench. "500g", as the panel's buttons write it, not the baked "500 gm".
//
// ## The tray
//
// The authored tray has no recesses — the discs stand on a flat box top — so the fixed
// denominations are laid out as one row, 7 mm between rims, **lightest nearest the
// operator** (who stands at -X, `apparatusView.ts`), running out to just short of the tray
// box's far carrying handle. Measured from the lesson's own balancing view (steps 6 and 8,
// 1920 x 889), that order is what keeps every engraving legible: the type on the small
// discs is the smallest, so they stand where the camera is closest — heaviest-first put
// the 10 g label at 3.7 px of cap height; lightest-first, no label is under 6 px — while
// perspective still leaves each heavier disc wider on screen than every lighter one. The
// custom weight keeps its own place by the tank. Every position is measured
// off the model at load (the authored discs, the handles), not written down.
//
// That view is also 10 % further back than it was (`ANCHOR_VIEW.weights`): at the old
// distance the operator's end of the tray ran out of the bottom of the frame — the authored
// 500 g disc sat there half cut off — and the pan out of the top.

import * as THREE from 'three';
import { ANCHOR_VIEW } from './apparatusView';

/** Chrome-finished steel. */
export const STEEL_DENSITY_G_PER_CM3 = 7.85;
/** The authored discs' bore; the pan's post is 10.3 mm (`holderAnchor.ts`). */
export const BORE_DIAMETER_MM = 12.7;
/** The authored 500 g disc's diameter — the family is pinned to it. */
export const REFERENCE_MASS_G = 500;
export const REFERENCE_DIAMETER_MM = 57.4;
/** Diameter ∝ mass^k. See the header for why 0.16, and why not 1/3. */
export const DIAMETER_EXPONENT = 0.16;
/** Edge break on every corner of the disc — a machined part, not a knife edge. */
export const CHAMFER_MM = 0.4;
/** Engraved type height: as large as the face allows, up to this. */
export const LABEL_MAX_HEIGHT_MM = 8;
/**
 * Fraction of the face's radial band the type's cap height may take, before it is fitted
 * to the face. 0.6 keeps even the 10 g disc's type (4.6 mm) above the size of the model's
 * own baked labels.
 */
export const LABEL_BAND_FRACTION = 0.6;
/** Clear steel kept between the engraving and the bore or rim chamfer. */
export const LABEL_MARGIN_MM = 0.5;
/** Arial's cap height and descender, in ems — the fallback when a canvas cannot measure ink. */
export const CAP_HEIGHT_EM = 0.716;
export const DESCENDER_EM = 0.21;

/** The custom weight: the model's own unlabelled disc, whatever mass the control sets. */
export const CUSTOM_WEIGHT_MESH = 'Weight_Custom';
/** Discs the family adds to the tray: the model has none for these denominations. */
export const FAMILY_CREATED_NODES: readonly string[] = ['Weight_10', 'Weight_20'];
/** Authored discs whose placement defines the tray row, and the custom disc's own place. */
export const AUTHORED_ROW = ['Weight_500', 'Weight_200', 'Weight_100', 'Weight_50'] as const;

export interface WeightDimensions {
  grams: number;
  diameterMm: number;
  thicknessMm: number;
  boreMm: number;
  /** Steel volume, bore excluded. */
  volumeMm3: number;
}

/** The disc for a mass: diameter and thickness both from the mass alone. */
export function weightDimensions(grams: number): WeightDimensions {
  const mass = Math.max(grams, 1);
  const diameterMm = REFERENCE_DIAMETER_MM * (mass / REFERENCE_MASS_G) ** DIAMETER_EXPONENT;
  const volumeMm3 = (mass / STEEL_DENSITY_G_PER_CM3) * 1000;
  const faceMm2 = (Math.PI / 4) * (diameterMm ** 2 - BORE_DIAMETER_MM ** 2);
  return {
    grams,
    diameterMm,
    thicknessMm: volumeMm3 / faceMm2,
    boreMm: BORE_DIAMETER_MM,
    volumeMm3,
  };
}

/**
 * "500g" — engraved the way the panel's buttons write it (`+500g`), and the way stamped
 * masses are: without the space, which on the 10 g disc's narrow face is what lets the
 * type stay as large as the model's own labels.
 */
export const labelText = (grams: number): string =>
  `${Number.isInteger(grams) ? grams : grams.toFixed(1)}g`;

/**
 * Which way "up the page" points on a disc's face, in the apparatus's XZ plane.
 *
 * Away from the camera that frames the weights, so the mass reads upright from there.
 */
export const LABEL_UP: readonly [number, number] = (() => {
  const [x, , z] = ANCHOR_VIEW.weights.offset;
  const length = Math.hypot(x, z);
  return [-x / length, -z / length];
})();

/** Type height for a disc, in millimetres: as large as its face allows, capped. */
export function labelHeightMm(d: WeightDimensions): number {
  const band = (d.diameterMm - d.boreMm) / 2 - 2 * CHAMFER_MM;
  return Math.min(LABEL_MAX_HEIGHT_MM, LABEL_BAND_FRACTION * band);
}

// ---------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------

/** Material slots on a family disc. */
export const BODY_GROUP = 0;
export const FACE_GROUP = 1;

const SEGMENTS = 96;

/**
 * The disc, in metres, centred on its own origin, axis along +Y.
 *
 * A turned profile — bottom face, outer wall, bore and the four chamfers — with the flat
 * top face as its own group, mapped straight onto the label: `u` runs to the reader's
 * right and `v` away from them (`LABEL_UP`), both across the full diameter.
 *
 * Normals are per profile segment, so the corners stay crisp while the round stays round.
 */
export function weightGeometry(grams: number): THREE.BufferGeometry {
  const d = weightDimensions(grams);
  const R = d.diameterMm / 2000;
  const b = d.boreMm / 2000;
  const h = d.thicknessMm / 2000;
  const c = Math.min(CHAMFER_MM / 1000, h * 0.3, (R - b) * 0.15);

  // Closed cross-section in (r, y), counter-clockwise, so each segment's outward normal
  // is (dy, -dr). The top face (index 4) is the label.
  const profile: Array<[number, number]> = [
    [b + c, -h],
    [R - c, -h],
    [R, -h + c],
    [R, h - c],
    [R - c, h],
    [b + c, h],
    [b, h - c],
    [b, -h + c],
  ];
  const TOP = 4;

  const [ux, uz] = LABEL_UP;
  // Reader's right: forward × up, with forward = LABEL_UP and up = +Y.
  const rx = -uz;
  const rz = ux;

  const body = { position: [] as number[], normal: [] as number[], uv: [] as number[] };
  const face = { position: [] as number[], normal: [] as number[], uv: [] as number[] };

  const n = profile.length;
  for (let s = 0; s < n; s++) {
    const [r0, y0] = profile[s];
    const [r1, y1] = profile[(s + 1) % n];
    const len = Math.hypot(r1 - r0, y1 - y0);
    const nr = (y1 - y0) / len;
    const ny = -(r1 - r0) / len;
    const target = s === TOP ? face : body;

    for (let k = 0; k < SEGMENTS; k++) {
      const a0 = (k / SEGMENTS) * Math.PI * 2;
      const a1 = ((k + 1) / SEGMENTS) * Math.PI * 2;
      const corner = (r: number, y: number, a: number): number[] => [
        r * Math.cos(a),
        y,
        -r * Math.sin(a),
      ];
      const normalAt = (a: number): number[] => [nr * Math.cos(a), ny, -nr * Math.sin(a)];
      const p00 = corner(r0, y0, a0);
      const p01 = corner(r0, y0, a1);
      const p10 = corner(r1, y1, a0);
      const p11 = corner(r1, y1, a1);
      const n0 = normalAt(a0);
      const n1 = normalAt(a1);
      const uvOf = (p: number[], t: number, a: number): number[] =>
        s === TOP
          ? [0.5 + (p[0] * rx + p[2] * rz) / (2 * R), 0.5 + (p[0] * ux + p[2] * uz) / (2 * R)]
          : [a / (Math.PI * 2), (s + t) / n];

      // Two triangles, wound so their face normal agrees with the outward normal.
      const tri = (
        pa: number[], na: number[], ta: number[],
        pb: number[], nb: number[], tb: number[],
        pc: number[], nc: number[], tc: number[]
      ) => {
        const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        const cross = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        const facing = cross[0] * na[0] + cross[1] * na[1] + cross[2] * na[2];
        const order = facing >= 0 ? [[pa, na, ta], [pb, nb, tb], [pc, nc, tc]] : [[pa, na, ta], [pc, nc, tc], [pb, nb, tb]];
        for (const [p, nn, t] of order) {
          target.position.push(...p);
          target.normal.push(...nn);
          target.uv.push(...t);
        }
      };
      const t00 = uvOf(p00, 0, a0);
      const t01 = uvOf(p01, 0, a1);
      const t10 = uvOf(p10, 1, a0);
      const t11 = uvOf(p11, 1, a1);
      if (len > 1e-9) {
        tri(p00, n0, t00, p10, n0, t10, p11, n1, t11);
        tri(p00, n0, t00, p11, n1, t11, p01, n1, t01);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  const all = (key: 'position' | 'normal' | 'uv') => [...body[key], ...face[key]];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(all('position'), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(all('normal'), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(all('uv'), 2));
  const bodyCount = body.position.length / 3;
  const faceCount = face.position.length / 3;
  geometry.addGroup(0, bodyCount, BODY_GROUP);
  geometry.addGroup(bodyCount, faceCount, FACE_GROUP);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = `weight-family-${grams}g`;
  geometry.userData.weightFamily = d;
  return geometry;
}

// ---------------------------------------------------------------------------------------
// The engraved face
// ---------------------------------------------------------------------------------------

/** The finish every disc shares, as an sRGB grey: the turned steel's mean tone. */
export const STEEL_TONE = '#c3c6c9';

/** A small deterministic generator, so a disc's turning marks never change between loads. */
const random = (seed: number) => {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
};

/**
 * Paint a disc's top face: turned steel and the engraved mass.
 *
 * The canvas spans the face's full diameter, square, in the orientation `weightGeometry`
 * maps it with: canvas up is `LABEL_UP`. Pure drawing — no DOM beyond the context it is
 * given — so the layout can be checked without a browser.
 *
 * Returns where the type was set, in millimetres on the face, for the checks.
 */
export function drawWeightFace(
  ctx: CanvasRenderingContext2D,
  grams: number,
  size: number
): { heightMm: number; widthMm: number; inkHeightMm: number; centreMm: number; fitsFace: boolean } {
  const d = weightDimensions(grams);
  const R = d.diameterMm / 2;
  const b = d.boreMm / 2;
  const pxPerMm = size / d.diameterMm;
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = STEEL_TONE;
  ctx.fillRect(0, 0, size, size);

  // Turning marks: fine concentric rings of slightly lighter and darker steel.
  const next = random(Math.round(grams * 10) + 7);
  for (let i = 0; i < 900; i++) {
    const r = (b + next() * (R - b)) * pxPerMm;
    const light = next() > 0.5;
    ctx.strokeStyle = light
      ? `rgba(255,255,255,${0.04 + next() * 0.08})`
      : `rgba(40,44,48,${0.03 + next() * 0.06})`;
    ctx.lineWidth = 0.6 + next() * 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // The mass, on the reader's far side of the bore. Centred in the band between bore and
  // rim when it fits there; otherwise moved in towards the bore, where the band is widest
  // across; only if it still does not fit is the type made smaller.
  const text = labelText(grams);
  const rim = R - CHAMFER_MM - LABEL_MARGIN_MM;
  const inner = b + CHAMFER_MM + LABEL_MARGIN_MM;
  const font = (mm: number) =>
    `700 ${(mm / CAP_HEIGHT_EM) * pxPerMm}px "Arial", "Helvetica", sans-serif`;
  const inkOf = (capMm: number) => {
    ctx.font = font(capMm);
    const m = ctx.measureText(text);
    const em = capMm / CAP_HEIGHT_EM;
    const ascent = (m.actualBoundingBoxAscent || CAP_HEIGHT_EM * em * pxPerMm) / pxPerMm;
    const descent = (m.actualBoundingBoxDescent || DESCENDER_EM * em * pxPerMm) / pxPerMm;
    return { width: m.width / pxPerMm, ascent, descent, height: ascent + descent };
  };
  const place = (capMm: number) => {
    const ink = inkOf(capMm);
    const inside = (centre: number) =>
      centre - ink.height / 2 >= inner - 1e-9 &&
      Math.hypot(ink.width / 2, centre + ink.height / 2) <= rim + 1e-9;
    const centred = (b + R) / 2;
    if (inside(centred)) return { ink, centre: centred, fits: true };
    const low = inner + ink.height / 2;
    return { ink, centre: low, fits: inside(low) };
  };

  let heightMm = labelHeightMm(d);
  let placed = place(heightMm);
  for (let i = 0; i < 40 && !placed.fits; i++) {
    heightMm *= 0.97;
    placed = place(heightMm);
  }
  const { ink, centre: centreMm, fits: fitsFace } = placed;
  ctx.font = font(heightMm);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Baseline so the ink, descender included, is centred on `centreMm`.
  const x = cx;
  const y = cy - centreMm * pxPerMm + ((ink.ascent - ink.descent) / 2) * pxPerMm;
  // Engraved: a dark cut with a thin highlight on its lower lip.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(text, x, y + Math.max(1, pxPerMm * 0.12));
  ctx.fillStyle = '#23272b';
  ctx.fillText(text, x, y);

  return { heightMm, widthMm: ink.width, inkHeightMm: ink.height, centreMm, fitsFace };
}

/** Pixels across a face texture. Twice the density of the baked atlases' discs. */
export const FACE_TEXTURE_SIZE = 512;

/** The face texture, in a browser. Returns null where there is no DOM (the Node specs). */
export function createWeightFaceTexture(grams: number, anisotropy = 1): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = FACE_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawWeightFace(ctx, grams, FACE_TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.name = `weight-face-${grams}g`;
  return texture;
}

/**
 * The deflectors' own steel (`skjirting.001` in the model): the weights are the same kit,
 * so they are the same metal.
 */
export const KIT_STEEL = { color: '#ced3d7', metalness: 1, roughness: 0.2 } as const;

/**
 * The family's two materials for one disc: the turned body, and the engraved face.
 *
 * The body is the deflectors' polished steel exactly. The face is the same steel turned
 * flat, which catches more of the room's diffuse light than a mirror would — a flat
 * polished face otherwise reflects only the dim ceiling above the bench and reads grey —
 * so it is a little rougher and not quite a pure conductor, as the authored discs' faces
 * were (metalness 0.85). Its colour comes from the face texture.
 */
export function weightMaterials(face: THREE.Texture | null): THREE.Material[] {
  const body = new THREE.MeshPhysicalMaterial({
    name: 'weight family steel',
    color: new THREE.Color(KIT_STEEL.color),
    metalness: KIT_STEEL.metalness,
    roughness: KIT_STEEL.roughness,
  });
  const top = new THREE.MeshPhysicalMaterial({
    name: 'weight family face',
    color: face ? new THREE.Color(0xffffff) : new THREE.Color(STEEL_TONE),
    map: face,
    metalness: 0.7,
    roughness: 0.32,
  });
  return [body, top];
}

// ---------------------------------------------------------------------------------------
// The tray
// ---------------------------------------------------------------------------------------

/**
 * The fixed denominations, in the order they stand on the tray: lightest first, from the
 * operator's end of the row (-X) outwards. See the header for why.
 */
export const TRAY_ROW: ReadonlyArray<{ grams: number; mesh: string }> = [
  { grams: 10, mesh: 'Weight_10' },
  { grams: 20, mesh: 'Weight_20' },
  { grams: 50, mesh: 'Weight_50' },
  { grams: 100, mesh: 'Weight_100' },
  { grams: 200, mesh: 'Weight_200' },
  { grams: 500, mesh: 'Weight_500' },
];

/**
 * The front tray box's two carrying handles, which stand across the row's line at either
 * end (`control_lab1_512` at the operator's end, `_511` at the far end, 34 mm tall).
 */
export const TRAY_HANDLES = { near: 'control_lab1_512', far: 'control_lab1_511' } as const;
/** Clear box top kept between a handle and the nearest disc's rim. */
export const HANDLE_CLEARANCE_MM = 8;
/** Clear box top between neighbouring rims on the row. */
export const ROW_GAP_MM = 7;

export interface TrayGeometry {
  /** The authored row's extent along X — what the four model discs spanned. */
  authoredMinX: number;
  authoredMaxX: number;
  /**
   * Where the row ends, at the heaviest disc's far rim: just short of the far handle.
   *
   * The lesson frames the weights from the operator's side, looking along the row, and the
   * operator's end of the tray falls out of the bottom of that frame (the authored 500 g
   * disc sat there, half cut off). So the row is set against the far handle, where the
   * camera sees it whole; `f04-acceptance.spec.ts` checks every disc is in that frame.
   */
  rowFarX: number;
  /** Rim-to-rim gap along the row. */
  rowGap: number;
  /** The row's line in Z. */
  rowZ: number;
  /** The box top the row stands on. */
  rowSurfaceY: number;
  /** The custom disc's own place, and the surface under it. */
  customX: number;
  customZ: number;
  customSurfaceY: number;
}

/**
 * Where each disc stands: its centre, in apparatus-local metres.
 *
 * One row, lightest to heaviest along +X — away from the operator — with equal gaps
 * between rims, ending at `rowFarX`.
 */
export function trayLayout(tray: TrayGeometry): Map<string, [number, number, number]> {
  const dims = TRAY_ROW.map((w) => weightDimensions(w.grams));
  const widths = dims.map((d) => d.diameterMm / 1000);
  const gap = tray.rowGap;
  const length = widths.reduce((a, w) => a + w, 0) + gap * (widths.length - 1);
  const slots = new Map<string, [number, number, number]>();
  let x = tray.rowFarX - length;
  TRAY_ROW.forEach((w, i) => {
    slots.set(w.mesh, [x + widths[i] / 2, tray.rowSurfaceY + dims[i].thicknessMm / 2000, tray.rowZ]);
    x += widths[i] + gap;
  });
  return slots;
}

// ---------------------------------------------------------------------------------------
// Putting the family on the loaded model
// ---------------------------------------------------------------------------------------

export interface WeightFamilyOptions {
  /** The mass the custom control is set to. */
  customGrams: number;
  /** Makes a face texture; omitted in Node, where only geometry is measured. */
  faceTexture?: (grams: number) => THREE.Texture | null;
}

export interface WeightFamily {
  /** The tray the layout was measured from. */
  tray: TrayGeometry;
  /**
   * The disc that carries a mass, standing where it belongs on the tray: a fixed
   * denomination's own tray node, or — for any other mass — the custom weight, the
   * authored `Weight_Custom` part by the tank. The stack and the flights clone it.
   */
  discFor(grams: number): THREE.Object3D;
  /**
   * The custom control changed. The custom weight is one part whatever it is set to — the
   * model's own plain, unlabelled disc — so nothing about it changes.
   */
  setCustomGrams(grams: number): void;
}

const FAMILY = 'bedoWeightFamily';

/**
 * Replace the authored discs with the family, and add the denominations the model lacks.
 *
 * Run once, on the adapted scene (`modelAdapter.ts`), before anything measures a disc: the
 * pan's stack, the flights, the removal targets and the click targets are all measured
 * off these nodes, so they follow without knowing the family exists.
 *
 * Idempotent on the cached scene. Returns null when the authored row is not there to
 * measure (a model without discs is left alone).
 */
export function applyWeightFamily(
  scene: THREE.Object3D,
  options: WeightFamilyOptions
): WeightFamily | null {
  const existing = scene.userData[FAMILY] as WeightFamily | undefined;
  if (existing) {
    existing.setCustomGrams(options.customGrams);
    return existing;
  }

  scene.updateMatrixWorld(true);
  const toScene = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const boxOf = (name: string): THREE.Box3 | null => {
    const node = scene.getObjectByName(name);
    if (!node) return null;
    node.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(node, true);
    return box.isEmpty() ? null : box.applyMatrix4(toScene);
  };

  const row = AUTHORED_ROW.map(boxOf);
  const customBox = boxOf(CUSTOM_WEIGHT_MESH);
  if (row.some((b) => !b) || !customBox) return null;
  const rowBoxes = row as THREE.Box3[];
  const authoredMinX = Math.min(...rowBoxes.map((b) => b.min.x));
  const authoredMaxX = Math.max(...rowBoxes.map((b) => b.max.x));
  const rowZ = rowBoxes.reduce((sum, b) => sum + (b.min.z + b.max.z) / 2, 0) / rowBoxes.length;

  // Against the far handle when it stands on the row's line and the row still clears the
  // near one; otherwise the authored row's own far end.
  const clearance = HANDLE_CLEARANCE_MM / 1000;
  const rowGap = ROW_GAP_MM / 1000;
  const rowLength =
    TRAY_ROW.reduce((sum, w) => sum + weightDimensions(w.grams).diameterMm / 1000, 0) +
    rowGap * (TRAY_ROW.length - 1);
  const onRowLine = (box: THREE.Box3 | null) =>
    box !== null && box.min.z <= rowZ && box.max.z >= rowZ;
  const far = boxOf(TRAY_HANDLES.far);
  const near = boxOf(TRAY_HANDLES.near);
  let rowFarX = authoredMaxX;
  if (far && onRowLine(far)) {
    const candidate = far.min.x - clearance;
    const nearLimit = near && onRowLine(near) ? near.max.x + clearance : -Infinity;
    if (candidate - rowLength >= nearLimit) rowFarX = candidate;
  }

  const tray: TrayGeometry = {
    authoredMinX,
    authoredMaxX,
    rowFarX,
    rowGap,
    rowZ,
    rowSurfaceY: Math.min(...rowBoxes.map((b) => b.min.y)),
    customX: (customBox.min.x + customBox.max.x) / 2,
    customZ: (customBox.min.z + customBox.max.z) / 2,
    customSurfaceY: customBox.min.y,
  };

  const faces = new Map<number, THREE.Texture | null>();
  const faceFor = (grams: number) => {
    if (!faces.has(grams)) faces.set(grams, options.faceTexture?.(grams) ?? null);
    return faces.get(grams)!;
  };

  /** Turn a node into the family disc for `grams`, standing at `centre`. */
  const shape = (mesh: THREE.Mesh, grams: number, centre: [number, number, number]) => {
    const old = mesh.geometry;
    const oldMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.geometry = weightGeometry(grams);
    mesh.material = weightMaterials(faceFor(grams));
    if (old && !old.userData.weightFamily) old.dispose();
    for (const m of oldMaterials) {
      const map = (m as THREE.MeshStandardMaterial | undefined)?.map;
      if (map && !String(map.name).startsWith('weight-face-')) map.dispose();
      m?.dispose();
    }
    mesh.position.set(...centre);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.userData.weightGrams = grams;
    mesh.updateMatrixWorld(true);
  };

  /** A family disc directly under the scene root, where apparatus-local space is. */
  const adopt = (name: string): THREE.Mesh => {
    let node = scene.getObjectByName(name) as THREE.Mesh | undefined;
    if (node && !node.isMesh) {
      // Not a single mesh (a future export might group one): the family disc replaces it.
      node.removeFromParent();
      node = undefined;
    }
    if (!node) {
      node = new THREE.Mesh();
      node.name = name;
    }
    if (node.parent !== scene) scene.attach(node);
    return node;
  };

  const layout = trayLayout(tray);
  for (const { grams, mesh } of TRAY_ROW) shape(adopt(mesh), grams, layout.get(mesh)!);
  // The custom weight is not re-made: it keeps the model's own shape, finish and place.
  const customWeight = scene.getObjectByName(CUSTOM_WEIGHT_MESH)!;

  const fixed = new Map(TRAY_ROW.map((w) => [w.grams, w.mesh]));

  const family: WeightFamily = {
    tray,
    discFor(grams: number) {
      const mesh = fixed.get(grams);
      return mesh ? scene.getObjectByName(mesh)! : customWeight;
    },
    setCustomGrams() {},
  };
  scene.userData[FAMILY] = family;
  return family;
}
