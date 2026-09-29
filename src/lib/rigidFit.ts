// The rotation that takes one copy of a part onto another (F03).
//
// Every deflector exists twice in the GLB: once on the tray (`*_base`) and once fitted to
// the rod (`*.001`). The model is baked — both carry identity transforms and the pose is in
// the vertices — so nothing in the file says how the two copies relate. For six of the
// seven they differ only by a translation; the 45° oblique deflector is stored on the tray
// **turned over** (its bounds are 22.8 × 22.8 × 32.4 mm on the tray and 32.4 × 23.7 × 32.2
// mm on the rod). A flight that only translated it arrived in the tray pose and then
// swapped, in one frame, to a different orientation.
//
// When the two copies share a vertex order — they are duplicates of one mesh — the rigid
// transform between them is recoverable exactly. This finds it with Horn's closed-form
// quaternion method (J. Opt. Soc. Am. A 4(4), 1987): the best rotation is the eigenvector of
// a 4 × 4 symmetric matrix built from the centred point pairs, found here by Jacobi sweeps.
//
// Pure arithmetic, no three.js; quaternions are returned in three.js's [x, y, z, w] order.

export type Vec3 = readonly [number, number, number];
export type Quat = [number, number, number, number];

export interface RigidFit {
  /** Rotation about the source centroid, [x, y, z, w]. */
  readonly rotation: Quat;
  /** Centroid of the source points. */
  readonly fromCentre: Vec3;
  /** Centroid of the target points. */
  readonly toCentre: Vec3;
  /** Largest distance between a rotated, translated source point and its target. */
  readonly maxResidual: number;
}

const centroid = (points: readonly Vec3[]): Vec3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length;
  return [x / n, y / n, z / n];
};

/** Rotates `v` by the unit quaternion `q` ([x, y, z, w]). */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  // v' = v + w * t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Eigen-decomposition of a symmetric 4 × 4 matrix by cyclic Jacobi rotations. */
function symmetricEigen4(input: number[][]): { values: number[]; vectors: number[][] } {
  const a = input.map((row) => [...row]);
  const v = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2], a[3][3]], vectors: v };
}

/**
 * The rigid transform taking `from[i]` onto `to[i]` for every i.
 *
 * Returns null when the two sets cannot correspond — different lengths, or fewer than three
 * points — so a caller falls back to a plain translation rather than inventing a rotation.
 */
export function fitRigid(from: readonly Vec3[], to: readonly Vec3[]): RigidFit | null {
  if (from.length !== to.length || from.length < 3) return null;
  const ca = centroid(from);
  const cb = centroid(to);

  // Cross-covariance S = Σ a' b'ᵀ over the centred pairs.
  let sxx = 0, sxy = 0, sxz = 0, syx = 0, syy = 0, syz = 0, szx = 0, szy = 0, szz = 0;
  for (let i = 0; i < from.length; i++) {
    const ax = from[i][0] - ca[0], ay = from[i][1] - ca[1], az = from[i][2] - ca[2];
    const bx = to[i][0] - cb[0], by = to[i][1] - cb[1], bz = to[i][2] - cb[2];
    sxx += ax * bx; sxy += ax * by; sxz += ax * bz;
    syx += ay * bx; syy += ay * by; syz += ay * bz;
    szx += az * bx; szy += az * by; szz += az * bz;
  }

  // Horn's N matrix, in (w, x, y, z) order.
  const n = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  const { values, vectors } = symmetricEigen4(n);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i;
  let w = vectors[0][best];
  let x = vectors[1][best];
  let y = vectors[2][best];
  let z = vectors[3][best];
  const length = Math.hypot(w, x, y, z) || 1;
  w /= length; x /= length; y /= length; z /= length;
  // One canonical sign, so the same pair of meshes always yields the same quaternion.
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const rotation: Quat = [x, y, z, w];

  let maxResidual = 0;
  for (let i = 0; i < from.length; i++) {
    const r = rotate(rotation, [from[i][0] - ca[0], from[i][1] - ca[1], from[i][2] - ca[2]]);
    const d = Math.hypot(
      r[0] + cb[0] - to[i][0],
      r[1] + cb[1] - to[i][1],
      r[2] + cb[2] - to[i][2]
    );
    if (d > maxResidual) maxResidual = d;
  }
  return { rotation, fromCentre: ca, toCentre: cb, maxResidual };
}
