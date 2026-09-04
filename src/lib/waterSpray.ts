/**
 * Droplets thrown off the deflector, over BEDO's authored sheet.
 *
 * ## What this is, and what it is not
 *
 * It is **not** the spray. The spray is the eight Alembic caches BEDO authored — one per
 * deflector, 81 frames each — and they already carry the shape every deflector throws:
 * a horizontal disc off the flat plate, a sheet turned back down off the hemisphere, a
 * cone off the conical faces. Replacing them with generated geometry would trade drawn
 * art for a guess.
 *
 * What the caches cannot do is *move* once they have played out. They are one-shot startup
 * transients that end mid-motion and hold (`src/lib/waterCache.ts`), so a settled plume is
 * a still shape with a ripple shader on it. This adds the part that keeps moving: droplets
 * leaving the impact and falling away under gravity, at a rate and a speed the flow sets.
 *
 * ## Why the emission direction is one formula
 *
 * A jet arriving along +Y and deflected through θ leaves along a direction making an angle
 * θ with the direction it came in. So the cone's half-angle from +Y *is* the deflection
 * angle, for every deflector on the tray:
 *
 *   30° / 60°   a narrow cone still travelling upward
 *   90°         a horizontal disc
 *   120° / 135° a sheet thrown downward and outward
 *   180°        turned back on itself, straight down
 *
 * No per-deflector table, and nothing to keep in step with `DEFLECTORS`.
 *
 * ## Cost
 *
 * One `THREE.Points`, one draw call, 2 000 vertices, and three uniforms written per frame.
 * Every droplet's position is computed in the vertex shader from a per-vertex seed and the
 * clock, so nothing is uploaded and no attribute is rewritten after construction. Thinning
 * the spray at low flow is `geometry.setDrawRange`, which costs nothing at all.
 */

import * as THREE from 'three';

/** Ceiling on the droplet count, per the brief's budget. */
export const MAX_DROPLETS = 2000;

/** Gravity in model units per second squared. One model unit is one metre. */
const GRAVITY = 9.81;

/** How long a droplet lives before it is recycled, in seconds. */
const LIFETIME_S = 0.55;

export interface SprayState {
  /** Delivered flow as a share of the pump's rating, 0..1. Sets the count and the speed. */
  readonly flowFraction: number;
  /** The jet's speed at the vane, m/s — the speed droplets leave at. */
  readonly impactVelocityMS: number;
  /** The installed deflector's deflection angle, degrees. */
  readonly deflectorAngleDeg: number;
  /** Seconds since the scene started. */
  readonly elapsedS: number;
}

export interface SprayField {
  readonly object: THREE.Points;
  /** Drive one frame. Cheap: three uniform writes and a draw range. */
  update(state: SprayState): void;
  dispose(): void;
}

const VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aAzimuth;
  attribute float aSpread;

  uniform float uTime;
  uniform float uSpeed;
  uniform float uElevation;
  uniform float uSize;
  uniform float uLifetime;

  varying float vAge;

  void main() {
    // Each droplet runs its own loop, offset by its seed, so they leave continuously
    // rather than in pulses.
    float age = fract(aSeed + uTime / uLifetime);
    vAge = age;
    float t = age * uLifetime;

    // The cone the deflector throws: elevation from +Y is the deflection angle, jittered
    // per droplet so the sheet has thickness instead of being a wire frame.
    float elevation = uElevation + aSpread;
    float s = sin(elevation);
    vec3 dir = vec3(s * cos(aAzimuth), cos(elevation), s * sin(aAzimuth));

    // Ballistic, because that is what a droplet leaving a vane does. The speed spread
    // keeps the leading edge from arriving as a shell.
    float speed = uSpeed * (0.65 + 0.7 * fract(aSeed * 7.13));
    vec3 offset = dir * speed * t;
    offset.y -= 0.5 * ${GRAVITY.toFixed(2)} * t * t;

    vec4 mv = modelViewMatrix * vec4(position + offset, 1.0);
    gl_Position = projectionMatrix * mv;
    // Perspective sizing, and a droplet that shrinks as it breaks up.
    gl_PointSize = uSize * (1.0 - 0.45 * age) / max(-mv.z, 0.05);
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uColour;
  uniform float uOpacity;
  varying float vAge;

  void main() {
    // A round droplet, not a square. Cheaper than a texture and never blurry.
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;

    // Fades in as it leaves the vane and out as it falls away, so neither end pops.
    float fade = smoothstep(0.0, 0.12, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
    // A brighter core: droplets read as lit water rather than as flat dots.
    float core = 1.0 - smoothstep(0.0, 0.25, r2);
    gl_FragColor = vec4(uColour + vec3(0.22) * core, uOpacity * fade * (0.45 + 0.55 * core));
  }
`;

/**
 * Builds the droplet field. Parented by the caller to whatever marks the impact point.
 *
 * `maxCount` exists for tests and for a future low-end tier; nothing in the application
 * passes anything but the default.
 */
export function createSpray(maxCount: number = MAX_DROPLETS): SprayField {
  const count = Math.max(0, Math.min(MAX_DROPLETS, Math.floor(maxCount)));

  const positions = new Float32Array(count * 3); // all at the emitter; the shader moves them
  const seeds = new Float32Array(count);
  const azimuths = new Float32Array(count);
  const spreads = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    // Deterministic rather than `Math.random`: the same scene draws the same spray every
    // run, which is what makes a visual regression a regression rather than noise. The
    // multipliers are irrational-ish so the three attributes do not correlate.
    seeds[i] = (i * 0.618033988749895) % 1;
    azimuths[i] = ((i * 2.399963229728653) % (Math.PI * 2)) - Math.PI;
    spreads[i] = (((i * 0.7548776662466927) % 1) - 0.5) * 0.42;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aAzimuth', new THREE.BufferAttribute(azimuths, 1));
  geometry.setAttribute('aSpread', new THREE.BufferAttribute(spreads, 1));
  // The droplets travel well beyond the emitter, and the bounding sphere is computed from
  // vertices that all sit on it — so frustum culling would drop the field the moment the
  // emitter left the view while its spray was still on screen.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);

  const uniforms = {
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uElevation: { value: Math.PI / 2 },
    uSize: { value: 26 },
    uLifetime: { value: LIFETIME_S },
    uColour: { value: new THREE.Color(0.52, 0.68, 0.78) },
    uOpacity: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    // Additive would blow out against the bright tank; normal blending keeps droplets
    // reading as water in front of glass.
    blending: THREE.NormalBlending,
    toneMapped: false,
  });

  const object = new THREE.Points(geometry, material);
  object.name = 'BedoWaterSpray';
  object.frustumCulled = false;
  object.renderOrder = 4;
  object.visible = false;

  return {
    object,

    update({ flowFraction, impactVelocityMS, deflectorAngleDeg, elapsedS }) {
      const flow = Math.max(0, Math.min(1, flowFraction));
      // Below a trickle there is no spray to speak of, and drawing two droplets reads as
      // dirt on the glass rather than as water.
      if (flow < 0.02 || impactVelocityMS <= 0) {
        object.visible = false;
        return;
      }
      object.visible = true;

      uniforms.uTime.value = elapsedS;
      // The droplets leave at the speed the jet arrives with. Scaled back because a vane
      // sheds a sheet, not a hose: the fastest droplet in the field is about the jet's own
      // speed and the median is well under it.
      uniforms.uSpeed.value = impactVelocityMS * 0.42;
      uniforms.uElevation.value = (deflectorAngleDeg * Math.PI) / 180;
      uniforms.uOpacity.value = 0.55 * flow;

      // Count follows the flow. `setDrawRange` rather than rebuilding anything: the
      // attributes never change, only how many of them are drawn.
      geometry.setDrawRange(0, Math.max(1, Math.round(count * flow)));
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
