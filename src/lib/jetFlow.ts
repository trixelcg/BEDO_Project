// The water's path, computed from the simulation's own state every frame (F08).
//
// ## What this replaces
//
// The water used to be eight Alembic caches BEDO authored, played back and switched between
// (`waterCache.ts`, `waterJet.ts`). A cache is a fixed shape, so none of the following could
// follow the state that was supposed to drive it (measured, `docs/57` §1):
//
//   * the deflector's spray was drawn whether or not a deflector was fitted;
//   * each spray's impact sat at a fixed height — 7.5 mm *below* the flat deflector at rest,
//     and it did not follow the carrier up;
//   * below 46 % valve — including the first reading — the drawn water stopped at the nozzle
//     mouth although the jet force on the deflector was being applied;
//   * the caches reach up to 29 mm below the tank floor, into the base, and a fade band hid
//     that by ending the water in mid-air;
//   * flow only switched between two caches.
//
// ## What this is
//
// One path in the (radius, height) half-plane about the nozzle axis — the water is
// axisymmetric, like every one of the authored caches — traced from the nozzle to the base:
//
//   1. **Free jet.** Straight up from the nozzle mouth at the exit velocity v0 the domain
//      computes. It slows under gravity, v(h)² = v0² − 2gh, and so widens by continuity:
//      r = r0·√(v0 / v). No spreading anywhere in free space.
//   2. **Contact** with the fitted deflector, where the jet actually meets it: the underside
//      profile is measured off the part's own mesh (`measureWettedSurface`) and rides the
//      carrier's lift. No deflector, or one too high for the jet to reach: there is no
//      deflection at all.
//   3. **Film** along that underside to the rim, with Bernoulli's speed along the surface.
//   4. **Free sheet** from the rim, at the deflector's own deflection angle, under gravity —
//      30° and 60° climb, 90° goes out level, 120°/135° go down and out, 180° turns back.
//   5. **On a solid**, it follows the solid: along the cover's underside to the wall, down the
//      wall, down the outside of the nozzle tube — to the pool on the tank's floor, which is
//      where the path ends. Never through anything.
//
// Everything that moves the path is state: the flow (through v0 and Q), the fitted deflector
// (its measured surface and its angle) and the carrier's height. Nothing here is a tuning
// knob except the two presentation offsets below, which only keep a drawn film off the
// surface it runs on.
//
// Presentation only: nothing in `src/domain` reads this, so no force, velocity or reading
// can be perturbed by it.

import * as THREE from 'three';
import { GRAVITY_MS2 } from '../domain/physics';

/** How far a film is drawn off the solid it runs along, so it never z-fights or dips in. */
export const FILM_OFFSET_M = 0.0006;

/** The standing film on the tank floor the water lands in. Presentation only. */
export const POOL_DEPTH_M = 0.002;

/** The widest the free jet is drawn as it slows towards its apex, in bore radii. */
export const MAX_COLUMN_SPREAD = 2;

/** Where each part of the path is. */
export type PathSegment = 'column' | 'film' | 'free' | 'ceiling' | 'wall' | 'tube';

export interface PathPoint {
  /** Distance from the nozzle axis, metres. */
  r: number;
  /** Height, model metres. */
  y: number;
  /** Seconds since this water left the nozzle. */
  t: number;
  /** Local speed, m/s. */
  speed: number;
  /** Film thickness from continuity, metres — how much water there is here. */
  thickness: number;
  segment: PathSegment;
}

/** The apparatus's own geometry around the jet, measured at load. Model metres. */
export interface JetGeometry {
  /** Top of the nozzle tube. */
  mouthY: number;
  /** The bore the jet leaves: `NOZZLE_DIAMETER_M / 2`. */
  boreRadius: number;
  /** Outside of the nozzle tube. */
  tubeRadius: number;
  /** The tank's inner wall, its floor and the cover's underside (`measureTankInterior`). */
  wallRadius: number;
  floorY: number;
  ceilingY: number;
}

/** A fitted deflector's wetted underside along one azimuth, at rest. */
export interface WettedProfile {
  /** Radii (ascending, from 0) and the underside's height at each, model metres. */
  radii: number[];
  heights: number[];
  /** Where the water leaves: the outermost radius with a surface. */
  rimRadius: number;
  rimY: number;
}

/**
 * A fitted deflector's wetted underside, at rest: one profile per azimuth of the drawn
 * water (`JET_FLOW_AZIMUTHS`, the same angles the mesh is swept at).
 *
 * Six of the seven deflectors are solids of revolution and every profile is the same. The
 * 45° deflector is not: its underside is a wedge — two faces at 45° meeting in a level
 * ridge — so the water leaves it along each azimuth at that azimuth's own slope.
 */
export interface WettedSurface {
  profiles: WettedProfile[];
  axisymmetric: boolean;
}

/** Azimuths the water is traced and drawn along. */
export const JET_FLOW_AZIMUTHS = 40;

export interface Deflection {
  profile: WettedProfile;
  /** How far the deflector stands above its rest height right now (the carrier's lift). */
  liftM: number;
  /** The angle the deflector turns the water through, from straight up. */
  deflectionRad: number;
}

export interface JetFlowInput {
  /** Exit velocity at the nozzle, m/s (`JetState.nozzleVelocityMS`). */
  v0: number;
  /** Volumetric flow, m³/s (`JetState.flowRateM3S`). */
  q: number;
  geometry: JetGeometry;
  /** The fitted deflector, or null when none is on the rod. */
  deflector: Deflection | null;
}

export interface JetPath {
  points: PathPoint[];
  /** Where the jet meets the deflector, or null: no contact, no deflection. */
  contact: { r: number; y: number } | null;
  /** Radius at which the water lands in the pool. */
  landingRadius: number;
  /** Where the free sheet left the deflector, if it did. */
  release: { r: number; y: number; angleRad: number } | null;
  /** The height of the pool surface the path ends in. */
  poolY: number;
}

const G = GRAVITY_MS2;

/** The underside's height at radius `r`, linearly interpolated; null outside the part. */
export function surfaceAt(surface: WettedProfile, r: number): number | null {
  const { radii, heights } = surface;
  if (r < radii[0] || r > surface.rimRadius) return null;
  for (let i = 1; i < radii.length; i++) {
    if (r <= radii[i]) {
      const k = (r - radii[i - 1]) / Math.max(radii[i] - radii[i - 1], 1e-12);
      return heights[i - 1] + (heights[i] - heights[i - 1]) * k;
    }
  }
  return heights[heights.length - 1];
}

/** Speed at height `y` of water that had speed `v` at height `y0`; 0 where it cannot get. */
const speedAt = (v: number, y0: number, y: number) =>
  Math.sqrt(Math.max(0, v * v - 2 * G * (y - y0)));

/** Thickness of an annular sheet at radius r carrying q at speed v. */
const sheetThickness = (q: number, r: number, v: number) =>
  // Floored at 0.3 m/s: where the water turns onto a wall its speed along the new surface
  // starts near zero, and continuity would otherwise give a sheet metres thick for a frame.
  q / (2 * Math.PI * Math.max(r, 1e-4) * Math.max(v, 0.3));

/**
 * The whole path, nozzle to pool.
 *
 * Pure: the same state always gives the same path, so it can be tested without a renderer
 * and asserted against the model's own solids.
 */
export function buildJetPath({ v0, q, geometry: g, deflector }: JetFlowInput): JetPath {
  const points: PathPoint[] = [];
  const poolY = g.floorY + POOL_DEPTH_M;
  const wall = g.wallRadius - FILM_OFFSET_M;
  const ceiling = g.ceilingY - FILM_OFFSET_M;
  const tube = g.tubeRadius + FILM_OFFSET_M;
  const push = (p: PathPoint) => points.push(p);

  const out: JetPath = { points, contact: null, landingRadius: tube, release: null, poolY };
  if (!(v0 > 0) || !(q > 0)) return out;

  const columnRadius = (v: number) =>
    Math.min(g.boreRadius * Math.sqrt(v0 / Math.max(v, 1e-6)), g.boreRadius * MAX_COLUMN_SPREAD);
  const apexY = g.mouthY + (v0 * v0) / (2 * G);

  // --- 1. The free jet, and where it stops ---------------------------------------------
  //
  // The column's edge rises until it meets a solid: the deflector's underside at the
  // column's own radius (so it fills a cup or runs up a cone rather than stopping short of
  // it), the cover's underside, or its own apex.
  let top = Math.min(apexY, ceiling);
  let meets: 'deflector' | 'ceiling' | 'apex' = apexY < ceiling ? 'apex' : 'ceiling';
  const surfaceY = (r: number) => {
    if (!deflector) return null;
    const s = surfaceAt(deflector.profile, r);
    return s === null ? null : s + deflector.liftM - FILM_OFFSET_M;
  };
  if (deflector) {
    // Solve for the height where the column's edge reaches the underside: the edge widens
    // as it climbs, so step up until it is at or above the surface over it.
    const steps = 200;
    const limit = Math.min(apexY, ceiling);
    for (let i = 0; i <= steps; i++) {
      const y = g.mouthY + ((limit - g.mouthY) * i) / steps;
      const s = surfaceY(columnRadius(speedAt(v0, g.mouthY, y)));
      if (s !== null && y >= s) {
        // Settle it: the edge's radius at the meeting height, and the surface over that.
        top = s;
        for (let k = 0; k < 8; k++) {
          const next = surfaceY(columnRadius(speedAt(v0, g.mouthY, top)));
          if (next === null) break;
          top = next;
        }
        meets = 'deflector';
        break;
      }
    }
  }

  const columnSteps = 24;
  for (let i = 0; i <= columnSteps; i++) {
    // Denser near the top, where the radius changes fastest as the jet slows.
    const k = 1 - (1 - i / columnSteps) ** 2;
    const y = g.mouthY + (top - g.mouthY) * k;
    const v = speedAt(v0, g.mouthY, y);
    push({
      r: columnRadius(v),
      y,
      t: (v0 - v) / G,
      speed: v,
      thickness: columnRadius(v),
      segment: 'column',
    });
  }
  let last = points[points.length - 1];

  // --- 2-4. Contact, film, release --------------------------------------------------
  let vr = 0;
  let vy = 0;
  if (meets === 'deflector' && deflector) {
    const contactY = (surfaceAt(deflector.profile, 0) ?? last.y) + deflector.liftM;
    out.contact = { r: 0, y: contactY };
    const vc = last.speed;
    const yc = last.y;
    const { radii, rimRadius } = deflector.profile;
    let stalled = false;
    for (const r of [...radii.filter((x) => x > last.r && x < rimRadius), rimRadius]) {
      const y = surfaceY(r)!;
      const v = speedAt(vc, yc, y);
      if (v <= 1e-3) {
        stalled = true;
        break;
      }
      const ds = Math.hypot(r - last.r, y - last.y);
      push({
        r,
        y,
        t: last.t + ds / Math.max((v + last.speed) / 2, 1e-3),
        speed: v,
        thickness: sheetThickness(q, r, v),
        segment: 'film',
      });
      last = points[points.length - 1];
    }
    // Leaves the rim along the deflection, or — if it cannot climb that far — drops off
    // where it stalled.
    const angle = stalled ? Math.PI : deflector.deflectionRad;
    vr = last.speed * Math.sin(angle);
    vy = last.speed * Math.cos(angle);
    out.release = { r: last.r, y: last.y, angleRad: angle };
  } else if (meets === 'apex') {
    // A jet too weak to reach anything stalls and falls back around itself, over the mouth
    // and down the outside of the tube.
    const sheath = Math.min(Math.max(last.r, g.boreRadius) + 0.002, tube);
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const y = last.y + (g.mouthY - last.y) * (i / steps);
      const v = Math.sqrt(2 * G * Math.max(0, apexY - y));
      push({
        r: sheath + (tube - sheath) * (i / steps) ** 4,
        y,
        t: points[points.length - 1].t + Math.abs((g.mouthY - last.y) / steps) / Math.max(v, 0.05),
        speed: v,
        thickness: sheetThickness(q, sheath, Math.max(v, 0.05)),
        segment: 'free',
      });
    }
    last = points[points.length - 1];
    vr = 0;
    vy = -last.speed;
  } else {
    // Straight into the cover: the water spreads along its underside from the axis.
    vr = last.speed;
    vy = 0;
  }

  // --- 5. Free flight, then whatever solid it meets, down to the pool -----------------
  let r = last.r;
  let y = last.y;
  let t = last.t;
  let onCeiling = meets === 'ceiling';
  let onWall = false;
  let onTube = meets === 'apex';
  const maxSteps = 600;
  for (let i = 0; i < maxSteps && y > poolY; i++) {
    const speed = Math.hypot(vr, vy);
    if (onCeiling) {
      // Along the underside of the cover to the wall.
      const next = Math.min(wall, r + 0.004);
      t += (next - r) / Math.max(speed, 1e-3);
      r = next;
      y = ceiling;
      push({ r, y, t, speed, thickness: sheetThickness(q, r, speed), segment: 'ceiling' });
      if (r >= wall) {
        onCeiling = false;
        onWall = true;
        vr = 0;
        vy = 0;
      }
      continue;
    }
    if (onWall || onTube) {
      // Down the wall (or the tube), accelerating under gravity.
      const next = Math.max(poolY, y - 0.006);
      const v1 = Math.sqrt(vy * vy + 2 * G * (y - next));
      t += (y - next) / Math.max((Math.abs(vy) + v1) / 2, 1e-3);
      vy = -v1;
      y = next;
      r = onWall ? wall : tube;
      push({ r, y, t, speed: v1, thickness: sheetThickness(q, r, v1), segment: onWall ? 'wall' : 'tube' });
      continue;
    }
    // Ballistic: steps of about 2 mm of travel.
    const dt = Math.min(0.004, 0.002 / Math.max(speed, 0.05));
    let nr = r + vr * dt;
    let ny = y + vy * dt - 0.5 * G * dt * dt;
    const nvy = vy - G * dt;
    if (ny >= ceiling) {
      const k = (ceiling - y) / Math.max(ny - y, 1e-9);
      nr = r + (nr - r) * k;
      ny = ceiling;
      onCeiling = true;
      vr = Math.hypot(vr, nvy);
      vy = 0;
    } else if (nr >= wall) {
      const k = (wall - r) / Math.max(nr - r, 1e-9);
      ny = y + (ny - y) * k;
      nr = wall;
      onWall = true;
      vr = 0;
      vy = Math.min(0, nvy);
    } else if (ny <= g.mouthY && nr <= tube) {
      nr = tube;
      onTube = true;
      vr = 0;
      vy = Math.min(0, nvy);
    } else {
      vy = nvy;
    }
    if (ny < poolY) {
      const k = (y - poolY) / Math.max(y - ny, 1e-9);
      nr = r + (nr - r) * k;
      ny = poolY;
    }
    t += dt;
    r = nr;
    y = ny;
    const v = Math.hypot(vr, vy);
    push({ r, y, t, speed: v, thickness: sheetThickness(q, r, v), segment: 'free' });
  }
  out.landingRadius = r;
  return out;
}

/**
 * The angle a profile turns the water through at its rim, from straight up: the water
 * leaves along the surface, so this is the surface's own slope over its last few
 * millimetres (the final half-millimetre, the rim's chamfer, left out).
 */
export function rimDeflection(profile: WettedProfile): number {
  const { radii, heights, rimRadius } = profile;
  const outer = rimRadius - 0.0005;
  const inner = Math.max(0, outer - 0.003);
  const pick = (r: number) => surfaceAt(profile, Math.min(Math.max(r, radii[0]), rimRadius)) ?? heights[0];
  const slope = (pick(outer) - pick(inner)) / Math.max(outer - inner, 1e-6);
  return Math.atan2(1, slope);
}

/** Everything `buildJetPath` needs, for every azimuth at once. */
export interface JetFlowSweepInput extends Omit<JetFlowInput, 'deflector'> {
  deflector: {
    surface: WettedSurface;
    liftM: number;
    /** The deflection the domain gives this deflector — used where the part is round. */
    nominalDeflectionRad: number;
  } | null;
}

/**
 * The path along every azimuth, `JET_FLOW_AZIMUTHS` of them.
 *
 * A round deflector turns the water by its nominal angle everywhere — the same angle its
 * momentum factor is derived from — so one path serves every azimuth. A non-round one (the
 * 45° wedge) turns it by its own slope along each.
 */
export function buildJetPaths(input: JetFlowSweepInput): JetPath[] {
  const { deflector, ...rest } = input;
  if (!deflector) {
    const path = buildJetPath({ ...rest, deflector: null });
    return Array.from({ length: JET_FLOW_AZIMUTHS }, () => path);
  }
  const { surface, liftM, nominalDeflectionRad } = deflector;
  if (surface.axisymmetric) {
    const path = buildJetPath({
      ...rest,
      deflector: { profile: surface.profiles[0], liftM, deflectionRad: nominalDeflectionRad },
    });
    return Array.from({ length: JET_FLOW_AZIMUTHS }, () => path);
  }
  return surface.profiles.map((profile) =>
    buildJetPath({
      ...rest,
      deflector: { profile, liftM, deflectionRad: rimDeflection(profile) },
    })
  );
}

/**
 * Measure a deflector's underside the way the jet sees it: along each azimuth of the drawn
 * water, upward rays from below at radii out from the axis, the first hit on the part.
 *
 * Read off the part's own mesh, so a cup is its inside, a cone its flank, a plate its face
 * and a wedge its two faces, and the rim is wherever the part actually ends. Heights are
 * returned at rest: `restOffsetY` (how far the part stands above its rest height as
 * measured) is subtracted. `toLocal` / `toWorld` map between the world and the model space
 * the path is built in.
 */
export function measureWettedSurface(
  part: THREE.Object3D,
  axis: { x: number; z: number },
  toLocal: (v: THREE.Vector3) => THREE.Vector3,
  toWorld: (v: THREE.Vector3) => THREE.Vector3,
  restOffsetY = 0
): WettedSurface | null {
  part.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(part, true);
  if (box.isEmpty()) return null;
  const lo = toLocal(box.min.clone());
  const hi = toLocal(box.max.clone());
  const bottom = Math.min(lo.y, hi.y);
  const reach = Math.max(
    Math.abs(lo.x - axis.x),
    Math.abs(hi.x - axis.x),
    Math.abs(lo.z - axis.z),
    Math.abs(hi.z - axis.z)
  );
  const ray = new THREE.Raycaster();
  const step = 0.0005;
  const profiles: WettedProfile[] = [];
  for (let a = 0; a < JET_FLOW_AZIMUTHS; a++) {
    const angle = (a / JET_FLOW_AZIMUTHS) * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const radii: number[] = [];
    const heights: number[] = [];
    for (let r = 0; r <= reach + step; r += step) {
      const from = toWorld(new THREE.Vector3(axis.x + r * c, bottom - 0.05, axis.z + r * s));
      const to = toWorld(new THREE.Vector3(axis.x + r * c, bottom + 1, axis.z + r * s));
      ray.set(from, to.sub(from).normalize());
      const hit = ray.intersectObject(part, true)[0];
      if (hit) {
        radii.push(r);
        heights.push(toLocal(hit.point.clone()).y - restOffsetY);
      } else if (radii.length) {
        break;
      }
    }
    if (radii.length < 2 || radii[0] > step * 4) return null;
    profiles.push({
      radii,
      heights,
      rimRadius: radii[radii.length - 1],
      rimY: heights[heights.length - 1],
    });
  }
  // Round if every azimuth tells the same story: the same underside, to within half a
  // millimetre, over the inner three-fifths of the part. The outer part is left out — a
  // faceted mesh turns steeply there (the cups) and ends a step sooner on some azimuths,
  // without being any less round; the 45° wedge differs by 8 mm well inside it.
  const common = Math.min(...profiles.map((p) => p.rimRadius)) * 0.6;
  let spread = 0;
  for (let r = 0; r <= common; r += step) {
    const hs = profiles.map((p) => surfaceAt(p, r) ?? p.heights[0]);
    spread = Math.max(spread, Math.max(...hs) - Math.min(...hs));
  }
  if (spread >= 0.0005) return { profiles, axisymmetric: false };
  // Round: one profile for every azimuth — the lowest the underside is at each radius, out
  // to the nearest rim, so a facet that sits a little lower on one azimuth still has the
  // film under it.
  const rim = Math.min(...profiles.map((p) => p.rimRadius));
  const radii: number[] = [];
  const heights: number[] = [];
  for (let r = 0; r <= rim + 1e-9; r += step) {
    radii.push(Math.min(r, rim));
    heights.push(Math.min(...profiles.map((p) => surfaceAt(p, Math.min(r, rim)) ?? Infinity)));
  }
  const round: WettedProfile = {
    radii,
    heights,
    rimRadius: radii[radii.length - 1],
    rimY: heights[heights.length - 1],
  };
  return { profiles: profiles.map(() => round), axisymmetric: true };
}

/**
 * The underside of whatever closes the tank, measured the way the water meets it: upward
 * rays from inside the bore, clear of the rod and the deflector, the lowest hit.
 *
 * Not `TankInterior.ceilingY`: that reads the node named `Tank_cover` alone, which spans the
 * bore only 8.4 mm above the plate the water actually strikes (`JET Force 2_206`, the cover's
 * lower plate, at y 1.3563). The water meets the first solid over it, whatever it is called.
 */
export function measureCeiling(
  root: THREE.Object3D,
  axis: { x: number; z: number },
  fromY: number,
  radii: number[],
  toLocal: (v: THREE.Vector3) => THREE.Vector3,
  toWorld: (v: THREE.Vector3) => THREE.Vector3
): number | null {
  root.updateWorldMatrix(true, true);
  const ray = new THREE.Raycaster();
  let lowest = Infinity;
  for (const r of radii) {
    for (let a = 0; a < 6; a++) {
      const angle = (a / 6) * Math.PI * 2 + 0.21;
      const from = toWorld(new THREE.Vector3(axis.x + r * Math.cos(angle), fromY, axis.z + r * Math.sin(angle)));
      const to = toWorld(new THREE.Vector3(axis.x + r * Math.cos(angle), fromY + 1, axis.z + r * Math.sin(angle)));
      ray.set(from, to.sub(from).normalize());
      for (const hit of ray.intersectObject(root, true)) {
        const mesh = hit.object as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        // Only something the water could strike: not a hidden proxy or an invisible part.
        if (!mesh.visible || materials.every((m) => !m || m.visible === false)) continue;
        lowest = Math.min(lowest, toLocal(hit.point.clone()).y);
        break;
      }
    }
  }
  return Number.isFinite(lowest) ? lowest : null;
}
