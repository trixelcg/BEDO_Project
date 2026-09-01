/**
 * Live values printed onto the physical board in the scene.
 *
 * The board is one baked panel — `White_Board_003_Baked`, 3.63 m x 2.42 m, sharing the
 * `MergedBake_Baked` atlas with seventeen other primitives. Its artwork therefore cannot
 * be edited: repainting that texture would repaint the room. What it has instead is empty
 * printed boxes, and this draws into them.
 *
 * ## Why a canvas texture on a child plane
 *
 * The plane is added as a **child of the board object**, so it inherits the board's world
 * transform exactly and the values are registered to their boxes under any camera — no
 * screen-space HUD, no per-frame projection, nothing to drift. One `CanvasTexture` carries
 * every field, redrawn only when a value actually changes and `needsUpdate` set only then;
 * there is no second scene, no second renderer, no new context and no render loop.
 *
 * ## No physics here
 *
 * Everything drawn is passed in, already computed by the domain — the same `selectLiveReadout`
 * and `recordedRows` the software monitor reads. This module formats; it does not derive.
 */

import * as THREE from 'three';

/**
 * The canvas the poster is drawn on.
 *
 * Half the artwork's own 4800x2950, which is ample: the values are large print, and a
 * smaller texture is a smaller upload each time one changes.
 */
const TEX_W = 2400;
const TEX_H = 1475;

/**
 * Where each printed box sits, in the poster's own UV space.
 *
 * The mesh (`Pitot`) carries a clean 0..1 UV map across the whole artwork, so these are
 * read straight off the texture and are resolution-independent. Measured from the
 * extracted 4800x2950 original, not guessed from a screenshot of the scene.
 */
const FIELD = {
  totalWeight: { u: 0.354, v: 0.753 },
  weightForce: { u: 0.532, v: 0.760 },
  nozzle: { u: 0.447, v: 0.891 },
  liveFlow: { u: 0.695, v: 0.601 },
  liveForce: { u: 0.905, v: 0.601 },
  liveV0: { u: 0.716, v: 0.891 },
  liveV: { u: 0.905, v: 0.891 },
} as const;

/** The seven printed angle chips down the left, top to bottom. */
const ANGLE_CHIP: Record<number, number> = {
  45: 0.254, 90: 0.360, 120: 0.465, 135: 0.571, 180: 0.677, 30: 0.783, 60: 0.889,
};
const CHIP_U = 0.090;
const CHIP_W = 0.0555;
const CHIP_H = 0.0374;

/** The six table columns, and the two rows the procedure records. */
const COL_U = [0.650, 0.710, 0.770, 0.8305, 0.891, 0.9515];
const ROW_V = [0.749, 0.814];

/** Everything the board shows. Formatted values only — no state, no derivation. */
export interface BoardValues {
  deflectorAngle: number;
  deflectorName: string;
  momentumFactor: number;
  nozzleMm: number;
  nozzleAreaM2: number;
  valvePct: number;
  flowLMin: number;
  flowM3S: number;
  nozzleVelocity: number;
  impactVelocity: number;
  theoreticalForceN: number;
  loadedMassG: number;
  measuredForceN: number;
  /** The two student readings, in order. `null` where nothing is recorded yet. */
  rows: {
    /** The lesson has taken this reading. Unrecorded rows stay blank on the board. */
    recorded: boolean;
    flowLMin: number;
    flowM3S: number;
    nozzleVelocity: number;
    impactVelocity: number;
    theoreticalForceN: number;
    measuredForceN: number | null;
  }[];
}

/** A change worth repainting for. Cheap, and the only thing that drives an update. */
export const boardSignature = (v: BoardValues): string =>
  [
    v.deflectorAngle,
    v.momentumFactor,
    v.valvePct.toFixed(0),
    v.flowLMin.toFixed(3),
    v.nozzleVelocity.toFixed(3),
    v.impactVelocity.toFixed(3),
    v.theoreticalForceN.toFixed(4),
    v.loadedMassG,
    v.rows
      .map((r) => `${r.recorded ? r.flowLMin.toFixed(3) : '-'}/${r.measuredForceN?.toFixed(4) ?? '-'}`)
      .join(','),
  ].join('|');

/** Board-local coordinates, normalised 0..1 across the face, origin top-left. */
const at = (u: number, v: number): [number, number] => [u * TEX_W, v * TEX_H];

export interface BoardLayout {
  /** Draw a labelled grid instead of values, for calibrating field positions. */
  calibrate?: boolean;
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  values: BoardValues,
  layout: BoardLayout = {}
): void {
  ctx.clearRect(0, 0, TEX_W, TEX_H);

  if (layout.calibrate) {
    ctx.strokeStyle = 'rgba(255,0,0,0.55)';
    ctx.fillStyle = 'rgba(255,0,0,0.9)';
    ctx.lineWidth = 2;
    ctx.font = '600 20px system-ui, sans-serif';
    for (let i = 0; i <= 10; i += 1) {
      const [x] = at(i / 10, 0);
      const [, y] = at(0, i / 10);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, TEX_H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TEX_W, y); ctx.stroke();
      ctx.fillText((i / 10).toFixed(1), x + 4, 24);
      ctx.fillText((i / 10).toFixed(1), 4, y - 4);
    }
    return;
  }

  const INK = '#101418';
  ctx.textBaseline = 'middle';

  /** A value written into one of the printed boxes. */
  const write = (
    u: number,
    v: number,
    text: string,
    { size = 40, align = 'center' as CanvasTextAlign, colour = INK } = {}
  ) => {
    const [x, y] = at(u, v);
    ctx.font = `700 ${size}px "Inter", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  };

  /*
    The printed labels stay where they are.

    `Total Weight` prints `gm` inside its box and the force box prints `N`, both hard
    against the right edge, so the numbers are drawn left of them rather than centred —
    otherwise the value would sit on top of its own unit.
  */
  write(FIELD.totalWeight.u - 0.016, FIELD.totalWeight.v, `${Math.round(values.loadedMassG)}`, {
    size: 46,
    align: 'right',
  });
  write(FIELD.weightForce.u, FIELD.weightForce.v, values.measuredForceN.toFixed(3), {
    size: 44,
    align: 'right',
  });

  // Nozzle: the bore derived from the same constant the equations use, in the spare box.
  write(
    FIELD.nozzle.u,
    FIELD.nozzle.v,
    `NOZZLE  Ø ${values.nozzleMm.toFixed(0)} mm   A = ${values.nozzleAreaM2.toExponential(3)} m²`,
    { size: 27 }
  );

  // The four live readouts, in the poster's own empty boxes around the table.
  write(FIELD.liveFlow.u, FIELD.liveFlow.v, `Q  ${values.flowLMin.toFixed(3)} L/min`, { size: 30 });
  write(FIELD.liveForce.u, FIELD.liveForce.v, `F_th  ${values.theoreticalForceN.toFixed(4)} N`, {
    size: 30,
  });
  write(FIELD.liveV0.u, FIELD.liveV0.v, `V₀  ${values.nozzleVelocity.toFixed(3)} m/s`, { size: 30 });
  write(FIELD.liveV.u, FIELD.liveV.v, `V  ${values.impactVelocity.toFixed(3)} m/s`, { size: 30 });

  /*
    The installed deflector, marked rather than repainted.

    A ring around the printed chip and its momentum factor beside it. The artwork is
    untouched — this is an overlay, and the chip keeps its own label.
  */
  const chipV = ANGLE_CHIP[values.deflectorAngle];
  if (chipV !== undefined) {
    const [cx, cy] = at(CHIP_U, chipV);
    const w = CHIP_W * TEX_W;
    const h = CHIP_H * TEX_H;
    ctx.strokeStyle = '#f58220';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2 - 10, cy - h / 2 - 8, w + 20, h + 16, 8);
    ctx.stroke();
    write(CHIP_U + 0.075, chipV, `k = ${values.momentumFactor.toFixed(3)}`, {
      size: 30,
      align: 'left',
      colour: '#b4560f',
    });
  }

  /*
    The recorded rows.

    These are the readings the lesson has frozen, not the live state — the live figures are
    the four boxes above. F_ac stays a dash until Calculate has run, exactly as the software
    board shows it.
  */
  values.rows.forEach((row, i) => {
    const v = ROW_V[i];
    // A row appears when the lesson has actually taken that reading. The results array is
    // computed for all four fixed openings whether or not the learner has been there, and
    // printing those would put readings on the board that nobody took.
    if (v === undefined || !row.recorded) return;
    const cells = [
      row.flowLMin.toFixed(3),
      row.flowM3S.toExponential(3),
      row.nozzleVelocity.toFixed(3),
      row.impactVelocity.toFixed(3),
      row.theoreticalForceN.toFixed(4),
      row.measuredForceN === null ? '—' : row.measuredForceN.toFixed(4),
    ];
    cells.forEach((text, c) => write(COL_U[c], v, text, { size: 27 }));
  });
}

/**
 * Attaches the readout plane to the board and returns an updater.
 *
 * Returns `null` when the board is not in the scene — the stub model used by most of the
 * browser suite has no room in it, and that must not be an error.
 */
export function attachBoardReadout(board: THREE.Object3D | undefined): {
  update: (values: BoardValues, layout?: BoardLayout) => void;
  dispose: () => void;
} | null {
  if (!board) return null;

  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  /*
    glTF's convention, not three.js's default.

    A `CanvasTexture` starts with `flipY = true`, while every texture the loader brings in
    from the GLB has it false. Leaving the default turns the values upside down relative to
    the artwork they are supposed to sit in.
  */
  texture.flipY = false;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    // The poster's own material is double-sided; the overlay matches it so the values are
    // never the mirror image seen through the back of the quad.
    side: THREE.DoubleSide,
  });
  /*
    The poster's own geometry, copied.

    Cloning the quad rather than building a plane is what makes the registration exact: the
    copy inherits the artwork's 0..1 UV map, so a value drawn at a UV read off the texture
    lands on that very box, under any camera and at any distance. It is added as a child of
    the poster, so it rides the same transform — nothing is projected per frame.
  */
  const geometry = (board as THREE.Mesh).geometry.clone();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'BedoBoardReadout';
  // A millimetre off the face, along its own normal, so it cannot z-fight the artwork.
  mesh.position.set(0, 0, 0);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -4;
  material.polygonOffsetUnits = -4;
  board.add(mesh);

  let last = '';
  return {
    update: (values, layoutOptions) => {
      const signature = layoutOptions?.calibrate ? 'calibrate' : boardSignature(values);
      if (signature === last) return;
      last = signature;
      drawBoard(ctx, values, layoutOptions);
      texture.needsUpdate = true;
      /*
        Dev-only repaint counter.

        A texture upload is the one cost this overlay can impose, so it is counted rather
        than reasoned about: the audit reads this while driving the valve, the weights and
        the camera, and an upload that is not matched by a visible change is a defect.
        `import.meta.env.DEV` is compiled to false by `vite build`.
      */
      if (import.meta.env.DEV) {
        const w = window as unknown as Record<string, number>;
        w.__bedoBoardRepaints = (w.__bedoBoardRepaints ?? 0) + 1;
      }
    },
    dispose: () => {
      board.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
