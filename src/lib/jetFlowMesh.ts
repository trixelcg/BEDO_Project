// Drawing the water path (`jetFlow.ts`) — geometry and material (F08).
//
// The path is a curve in the (radius, height) half-plane; the water is that curve swept
// once around the nozzle axis. One mesh of fixed topology is allocated up front and its
// vertices rewritten each frame, so a moving carrier, a new flow or a different deflector
// changes the water in the very frame it changes the state, with no allocation.
//
// The material is the water family's (absorption tint, Fresnel rim, ripple normals from
// the shared ripple texture), keyed to the water rather than to the mesh:
//
//   * ripples and aeration are sampled at `uTime − t`, where `t` is how long the water at a
//     vertex has been travelling since it left the nozzle — so the pattern belongs to
//     parcels of water and moves along the path at the water's own speed. Open the valve
//     and it visibly runs faster.
//   * opacity comes from the sheet's thickness by continuity (Q / 2πrv), so more flow is
//     more water, a sheet thins as it spreads, and a thin free sheet breaks up.
//   * `uHead` / `uTail` reveal the path from the nozzle outward when the flow starts, and
//     empty it from the nozzle end when it stops, at the water's own travel time.

import * as THREE from 'three';
import { JET_FLOW_AZIMUTHS, type JetPath, type PathPoint, type PathSegment } from './jetFlow';
import { WATER_SEGMENT, createWaterMaterial, createWaterUniforms, type WaterUniforms } from './waterMaterial';

/** Vertices around the axis: one per traced azimuth. */
export const JET_FLOW_SEGMENTS = JET_FLOW_AZIMUTHS;
/** The most path points one frame can draw; a longer path is decimated to fit. */
export const JET_FLOW_MAX_POINTS = 640;

const SEGMENT_CODE: Record<PathSegment, number> = {
  column: WATER_SEGMENT.column,
  film: WATER_SEGMENT.film,
  free: WATER_SEGMENT.free,
  ceiling: WATER_SEGMENT.runoff,
  wall: WATER_SEGMENT.runoff,
  tube: WATER_SEGMENT.runoff,
};

/** The swept surface, allocated once. */
export function createJetFlowGeometry(): THREE.BufferGeometry {
  const rings = JET_FLOW_MAX_POINTS;
  const around = JET_FLOW_SEGMENTS + 1;
  const count = rings * around;
  const geometry = new THREE.BufferGeometry();
  const attr = (size: number) => {
    const a = new THREE.BufferAttribute(new Float32Array(count * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  geometry.setAttribute('position', attr(3));
  geometry.setAttribute('normal', attr(3));
  // x: around (0..1), y: seconds since leaving the nozzle.
  geometry.setAttribute('aFlowUv', attr(2));
  // x: sheet thickness (m), y: segment code, z: local speed (m/s).
  geometry.setAttribute('aFlow', attr(3));
  // x: seconds since this stretch of the path (column, film, sheet, run-off) began,
  // y: distance along the path from the nozzle (m), z: distance from the axis (m) — what
  // the surface waves are laid out on (`waterMaterial.ts`).
  geometry.setAttribute('aRun', attr(3));
  const index: number[] = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < JET_FLOW_SEGMENTS; j++) {
      const a = i * around + j;
      const b = a + around;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  geometry.setIndex(index);
  geometry.setDrawRange(0, 0);
  // The mesh is rewritten every frame; a generous fixed sphere keeps it from being culled.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
  return geometry;
}

/** A path resampled to `count` points evenly along its length. */
function resample(points: PathPoint[], count: number): PathPoint[] {
  if (points.length === count) return points;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].r - points[i - 1].r, points[i].y - points[i - 1].y));
  }
  const total = lengths[lengths.length - 1] || 1;
  const out: PathPoint[] = [];
  let k = 1;
  for (let i = 0; i < count; i++) {
    const at = (total * i) / Math.max(count - 1, 1);
    while (k < points.length - 1 && lengths[k] < at) k++;
    const a = points[k - 1];
    const b = points[k];
    const f = Math.min(1, Math.max(0, (at - lengths[k - 1]) / Math.max(lengths[k] - lengths[k - 1], 1e-12)));
    out.push({
      r: a.r + (b.r - a.r) * f,
      y: a.y + (b.y - a.y) * f,
      t: a.t + (b.t - a.t) * f,
      speed: a.speed + (b.speed - a.speed) * f,
      thickness: a.thickness + (b.thickness - a.thickness) * f,
      segment: f < 0.5 ? a.segment : b.segment,
    });
  }
  return out;
}

/** Consecutive runs of one kind — column, film, free sheet, run-off — in order. */
function runsOf(points: PathPoint[]): PathPoint[][] {
  const runs: PathPoint[][] = [];
  for (const p of points) {
    const run = runs[runs.length - 1];
    if (run && SEGMENT_CODE[run[0].segment] === SEGMENT_CODE[p.segment]) run.push(p);
    else runs.push([p]);
  }
  return runs;
}

/**
 * Different paths brought to one ring count, run by run: the column, the film, the free
 * sheet and the run-off are each resampled to the most points any azimuth has for that run,
 * so every run starts and ends on the same ring everywhere — the jet meets the deflector
 * on one ring, the sheet leaves it on another — whatever each azimuth does in between.
 */
function alignPaths(paths: readonly JetPath[], limit: number): PathPoint[][] {
  const runs = paths.map((p) => runsOf(p.points));
  const slots = Math.max(...runs.map((r) => r.length));
  const counts = Array.from({ length: slots }, (_, k) =>
    Math.max(2, ...runs.map((r) => (r[k] ? r[k].length : 0)))
  );
  const total = counts.reduce((a, b) => a + b, 0);
  if (total > limit) {
    const scale = limit / total;
    for (let k = 0; k < counts.length; k++) counts[k] = Math.max(2, Math.floor(counts[k] * scale));
  }
  return runs.map((r) => {
    const out: PathPoint[] = [];
    for (let k = 0; k < slots; k++) {
      // An azimuth with fewer runs holds its last point for the rest.
      const run = r[k] ?? [r[r.length - 1][r[r.length - 1].length - 1]];
      out.push(...resample(run.length > 1 ? run : [run[0], run[0]], counts[k]));
    }
    return out;
  });
}

/**
 * Sweep the paths — one per azimuth, `JET_FLOW_SEGMENTS` of them — around the axis into
 * the geometry. Returns how many rings were drawn.
 *
 * All the same path (a round deflector, or none) is swept as it is. Different paths (the
 * wedge) are aligned run by run first (`alignPaths`).
 */
export function writeJetPath(
  geometry: THREE.BufferGeometry,
  paths: readonly JetPath[],
  axis: { x: number; z: number }
): number {
  const same = paths.every((p) => p === paths[0]);
  const rings: PathPoint[][] = same
    ? Array(JET_FLOW_SEGMENTS).fill(
        paths[0].points.length > JET_FLOW_MAX_POINTS
          ? resample(paths[0].points, JET_FLOW_MAX_POINTS)
          : paths[0].points
      )
    : alignPaths(paths, JET_FLOW_MAX_POINTS);
  const n = rings[0].length;
  if (n < 2) {
    geometry.setDrawRange(0, 0);
    return 0;
  }
  const around = JET_FLOW_SEGMENTS + 1;
  // Per path: how long the water has been on its current stretch, and how far it has come.
  const runOf = new Map<PathPoint[], { since: Float32Array; along: Float32Array }>();
  for (const points of rings) {
    if (runOf.has(points)) continue;
    const since = new Float32Array(n);
    const along = new Float32Array(n);
    let start = points[0].t;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      if (i > 0) {
        const q = points[i - 1];
        if (SEGMENT_CODE[q.segment] !== SEGMENT_CODE[p.segment]) start = q.t;
        along[i] = along[i - 1] + Math.hypot(p.r - q.r, p.y - q.y);
      }
      since[i] = Math.max(0, p.t - start);
    }
    runOf.set(points, { since, along });
  }
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const nor = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('aFlowUv') as THREE.BufferAttribute;
  const flow = geometry.getAttribute('aFlow') as THREE.BufferAttribute;
  const run = geometry.getAttribute('aRun') as THREE.BufferAttribute;
  for (let j = 0; j < around; j++) {
    const points = rings[j % JET_FLOW_SEGMENTS];
    const { since, along } = runOf.get(points)!;
    const a = (j / JET_FLOW_SEGMENTS) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(n - 1, i + 1)];
      let dr = next.r - prev.r;
      let dy = next.y - prev.y;
      const len = Math.hypot(dr, dy);
      // Where the path folds back on itself (a corner, or a collapsed end) the tangent
      // vanishes; face outward rather than hand the shader a zero normal, which lights black.
      if (len < 1e-9) {
        dr = 0;
        dy = 1;
      } else {
        dr /= len;
        dy /= len;
      }
      // In-plane normal of the generatrix: outward for water climbing, upward for water
      // spreading level.
      const nr = dy;
      const ny = -dr;
      const k = i * around + j;
      pos.setXYZ(k, axis.x + p.r * c, p.y, axis.z + p.r * s);
      nor.setXYZ(k, nr * c, ny, nr * s);
      uv.setXY(k, j / JET_FLOW_SEGMENTS, p.t);
      flow.setXYZ(k, p.thickness, SEGMENT_CODE[p.segment], p.speed);
      run.setXYZ(k, since[i], along[i], p.r);
    }
  }
  for (const attribute of [pos, nor, uv, flow, run]) {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, n * around * attribute.itemSize);
    attribute.needsUpdate = true;
  }
  geometry.setDrawRange(0, (n - 1) * JET_FLOW_SEGMENTS * 6);
  return n;
}

/** The jet's uniforms: the shared water material's (`waterMaterial.ts`), clock in seconds. */
export type JetFlowUniforms = WaterUniforms;
export const createJetFlowUniforms = createWaterUniforms;

/** The jet and the film over the deflector: the shared water material, refracting. */
export function createJetFlowMaterial(
  rippleTexture: THREE.Texture,
  uniforms: JetFlowUniforms
): THREE.MeshPhysicalMaterial {
  return createWaterMaterial(rippleTexture, uniforms, 'stream-body');
}

/** The free sheets and the run-off: the same water as a thin blended layer. */
export function createJetSheetMaterial(
  rippleTexture: THREE.Texture,
  uniforms: JetFlowUniforms
): THREE.MeshPhysicalMaterial {
  return createWaterMaterial(rippleTexture, uniforms, 'stream-sheet');
}

/**
 * The pool on the tank floor the water lands in — the receiver.
 *
 * An annulus between the nozzle tube and the wall, drawn at the path's pool height, with
 * rings running out from where the water lands and foam at the landing itself.
 */
export interface PoolUniforms {
  uTime: { value: number };
  uFlow: { value: number };
  /** Radius the water lands at, model metres. */
  uLanding: { value: number };
  /** The pool's centre in model space. */
  uAxis: { value: THREE.Vector2 };
  /** 0..1 fade in and out with the flow reaching the floor. */
  uWet: { value: number };
}

export const createPoolUniforms = (): PoolUniforms => ({
  uTime: { value: 0 },
  uFlow: { value: 0 },
  uLanding: { value: 0 },
  uAxis: { value: new THREE.Vector2() },
  uWet: { value: 0 },
});

export function createPoolMesh(
  inner: number,
  outer: number,
  axis: { x: number; z: number },
  y: number,
  rippleTexture: THREE.Texture,
  uniforms: PoolUniforms
): THREE.Mesh {
  const geometry = new THREE.RingGeometry(inner, outer, 96, 16);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(axis.x, y, axis.z);
  uniforms.uAxis.value.set(axis.x, axis.z);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#48628c'),
    transparent: true,
    premultipliedAlpha: true,
    roughness: 0.12,
    metalness: 0,
    ior: 1.33,
    clearcoat: 0.4,
    clearcoatRoughness: 0.15,
    envMapIntensity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // Left out of the ambient-occlusion pre-pass, like the rest of the water.
  mat.userData.seeThrough = true;
  mat.userData.bedoReflect = 'water';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uWaterTex: { value: rippleTexture } });
    shader.vertexShader =
      'uniform vec2 uAxis;\nvarying vec2 vPoolXZ;\nvarying vec3 vPoolW;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vPoolXZ = transformed.xz - uAxis;
         vPoolW = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader =
      'uniform float uTime;\nuniform float uFlow;\nuniform float uLanding;\nuniform float uWet;\n' +
      'uniform sampler2D uWaterTex;\nvarying vec2 vPoolXZ;\nvarying vec3 vPoolW;\n' +
      shader.fragmentShader
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           {
             float r = length(vPoolXZ);
             float d = r - uLanding;
             // Rings running out from the landing, faster and stronger with more flow.
             float k = 420.0;
             float w = sin(k * abs(d) - uTime * (14.0 + 20.0 * uFlow));
             float env = exp(-abs(d) * 45.0) * (0.3 + 0.7 * clamp(uFlow * 1.6, 0.0, 1.0));
             vec2 dir = r > 1e-5 ? vPoolXZ / r : vec2(0.0);
             vec2 grad = dir * sign(d) * w * env * 0.6
                       + (texture2D(uWaterTex, vPoolXZ * 18.0 + uTime * 0.05).rg - 0.5) * 0.25;
             vec3 bump = (viewMatrix * vec4(grad.x, 0.0, grad.y, 0.0)).xyz;
             normal = normalize(normal + bump);
           }`
        )
        .replace('#include <premultiplied_alpha_fragment>', '')
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
           {
             float r = length(vPoolXZ);
             float d = abs(r - uLanding);
             float churn = texture2D(uWaterTex, vPoolXZ * 30.0 + vec2(uTime * 0.4, -uTime * 0.3)).b;
             // Foam where the water lands, and a wider skirt of broken bubbles drifting out
             // from it (user, 2026-09-30: "we need to feel the water").
             float foam = exp(-d * 260.0) * smoothstep(0.35, 0.8, churn) * clamp(uFlow * 1.8, 0.25, 1.0);
             float skirt = exp(-d * 70.0) * smoothstep(0.62, 0.8,
                 texture2D(uWaterTex, vPoolXZ * 55.0 + vec2(-uTime * 0.25, uTime * 0.2)).b) * clamp(uFlow * 1.8, 0.2, 1.0);
             foam = clamp(foam + skirt * 0.6, 0.0, 1.0);
             vec3 V = normalize(cameraPosition - vPoolW);
             float fres = 0.02 + 0.98 * pow(1.0 - abs(V.y), 5.0);
             // Premultiplied: the room reflected (three's specular) at full strength, the
             // water's own lit blue-green body, and the foam.
             float light = clamp(dot(totalDiffuse / max(diffuseColor.rgb, vec3(0.05)), vec3(0.2126, 0.7152, 0.0722)), 0.35, 1.2);
             // Ripple-borne shading, so the pool moves where the water lands.
             float swell = texture2D(uWaterTex, vPoolXZ * 9.0 + vec2(uTime * 0.06, -uTime * 0.05)).b;
             vec3 body = vec3(0.12, 0.42, 0.56) * light * (0.8 + 0.4 * swell);
             float a = clamp((0.58 + fres * 0.2) * (1.0 - foam) + foam * 0.9, 0.0, 0.92) * uWet;
             vec3 col = mix(body, vec3(0.9, 0.94, 0.97) * light, foam);
             gl_FragColor = vec4(totalSpecular * 0.6 * uWet + col * a, a);
           }`
        );
  };
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = 'bedoWaterPool';
  mesh.renderOrder = 2;
  return mesh;
}
