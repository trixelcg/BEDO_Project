// One water material for everything that carries water: the jet and its sheets, and the
// supply hose (product-owner request, 2026-09-28: "more realistic, with water flow").
//
// ## What makes it read as water
//
//  1. **Reflection and refraction.** Water is nearly clear; what the eye sees is the room
//     reflected off its surface — Fresnel-weighted, strongest at grazing angles — and what is
//     behind it *refracted* through it (three's transmission), both bent by the moving
//     ripples. That bending is what makes water look wavy rather than like tinted plastic.
//  2. **Beer–Lambert by thickness.** The water's own depth decides its tint: a 10 mm jet is a
//     clear rod with a faint cyan core; a 0.2 mm sheet is nearly invisible except for its
//     highlights; a full hose is blue-green through the middle and clear at its walls.
//  3. **A surface that moves with the water.** Every ripple, streak and bubble is sampled at
//     the *parcel* coordinate — how long ago the water at that point left its source — so the
//     pattern is carried along at the water's own speed, not scrolled at a made-up rate. The
//     ripples are stretched along the flow, the way a moving surface stretches them.
//  4. **Air where the flow does work.** Foam over a deflector, the torn edge of a thinning
//     sheet, entrained bubbles in a fast jet and in a filling hose, rivulets running down
//     the glass.
//
// Geometry supplies two attributes (`jetFlowMesh.ts` for the jet; `measureConduit` below for
// the hose):
//
//   * `aFlowUv` — x: around the stream, 0..1; y: the parcel coordinate, in seconds of travel
//     (at the reference speed, for a conduit, so a constant-bore pipe needs no per-frame
//     rewrite — its clock runs at the water's speed instead).
//   * `aFlow`   — x: thickness of water, metres; y: segment kind (`WATER_SEGMENT`); z: speed.
//
// Presentation only: nothing in `src/domain` reads any of this.

import * as THREE from 'three';

/** Segment kinds, as carried in `aFlow.y`. */
export const WATER_SEGMENT = {
  column: 0,
  film: 1,
  free: 2,
  runoff: 3,
  conduit: 4,
} as const;

/**
 * Absorption coefficients of the drawn water, per metre (red, green, blue).
 *
 * Pure water absorbs far too little to tint anything a few millimetres thick, but the rig's
 * water is dyed in the reference recording and reads blue-green through the glass. These
 * give a 10 mm column a faint cyan core (it transmits ~55 / 80 / 91 %), a 0.2 mm sheet next
 * to nothing, and a 16 mm hose bore a clear blue-green — the ratios of real water, scaled.
 */
export const WATER_ABSORPTION_PER_M: readonly [number, number, number] = [60, 22, 9];

/** Parcel coordinate units for a conduit: seconds of travel at this speed. */
export const CONDUIT_REFERENCE_SPEED = 1;

/**
 * The fastest the pattern inside a hose is carried, m/s.
 *
 * At full valve the water crosses the delivery line at well over 10 m/s. Carried at that
 * speed, the pattern jumps more than its own length every frame and reads as flicker, not
 * as water moving — the eye sees flow in a hose as a shimmer travelling at a pace it can
 * follow. The front of the water still fills the hose at the true speed; only the pattern
 * is held to this.
 */
export const CONDUIT_PATTERN_SPEED_MAX = 1.6;

/** How fast a hose's pattern clock runs for water moving at `speed` m/s through it. */
export const conduitPatternSpeed = (speed: number) =>
  CONDUIT_PATTERN_SPEED_MAX * Math.tanh(Math.max(speed, 0) / CONDUIT_PATTERN_SPEED_MAX);

export interface WaterUniforms {
  /** The parcel clock: seconds for a stream; distance / reference speed for a conduit. */
  uClock: { value: number };
  /** How hard the water is being driven, 0..1 (the valve opening). */
  uFlow: { value: number };
  /** Water further along than this has not arrived yet (parcel units). */
  uHead: { value: number };
  /** Water nearer the source than this has gone (parcel units). */
  uTail: { value: number };
  /**
   * Conduit only: how full the tube stands when nothing flows, 0..1. A pressurised supply
   * line stays full of still water; a delivery line drains back (0).
   */
  uFill: { value: number };
  /** Conduit only: the mean speed of the water in the bore, m/s. */
  uSpeed: { value: number };
}

export const createWaterUniforms = (): WaterUniforms => ({
  uClock: { value: 0 },
  uFlow: { value: 0 },
  uHead: { value: 1e6 },
  uTail: { value: -1 },
  uFill: { value: 0 },
  uSpeed: { value: 0 },
});

/** What a conduit's own wall is made of: its tint (linear RGB) and how much it hides. */
export interface ConduitWall {
  tint: readonly [number, number, number];
  /** Opacity of the wall seen face-on; the rim always shows more. */
  opacity: number;
}

/**
 * The two tubes of the circuit.
 *
 * `clear`: the pump's delivery line (`Line010`), clear PVC — the water inside is the
 * whole picture.
 * `smoked`: the supply hose from the wall tap, grey reinforced PVC — the hose keeps its
 * grey, and the water running through it shows through the wall.
 */
export const CONDUIT_WALLS = {
  clear: { tint: [0.82, 0.87, 0.9], opacity: 0.08 },
  smoked: { tint: [0.3, 0.31, 0.33], opacity: 0.5 },
} as const satisfies Record<string, ConduitWall>;

/**
 * The water body inside a tube, looked at from outside it.
 *
 * `boreApparent`: the bore is 0.8 of the tube's radius, but water and wall together
 * magnify it, so from outside it fills this much of the tube's width.
 * `coreSpeed` / `wallSpeed`: the water on the axis runs faster than the mean, the water
 * at the wall slower — the velocity profile of a pipe flow, which is what makes the
 * pattern inside shear rather than slide as one piece.
 */

export const CONDUIT_FLOW = { boreApparent: 0.93, coreSpeed: 1.22, wallSpeed: 0.72 } as const;

/**
 * `stream-body`: the jet and the film over the deflector — bodies of water, refracted.
 * `stream-sheet`: the free sheets and the run-off — layers a fraction of a millimetre thick,
 * blended over what is behind them. The two share one geometry (`jetFlowMesh.ts`); each
 * discards the other's segments. They are separate materials because a transmissive
 * material is also drawn into three's transmission buffer, and a thin blended layer must
 * not be.
 * `conduit`: the hose.
 */
export type WaterKind = 'stream-body' | 'stream-sheet' | 'conduit';

/**
 * How much deeper the refraction treats the water than it is.
 *
 * A 10 mm jet displaces what is behind it by a fraction of a millimetre — physically right,
 * and invisible at the lesson's viewing distance. The refraction depth is scaled up so the
 * bending reads; the absorption distance is scaled by the same factor, so the colour is still
 * the one the real thickness gives.
 */
export const REFRACTION_DEPTH_SCALE = 3;

/**
 * How much the water shows as water, not only as a bend in what is behind it (product
 * owner, 2026-09-29: "not too transparent — a little visible").
 *
 * Physically clear water at these depths is nearly invisible; a learner has to see where
 * the jet, the sheets and the hose water are. Each is given a light aqua body on top of
 * its refraction and reflection:
 *
 *   body     the jet and the film under the deflector: this much of the colour is the tint
 *   hose     the water in the hose, while it is there
 *   sheet    the least a free sheet or film shows, however thin
 *   runoff   the film on the glass between its rivulets
 */
// 50 % for the jet, the sheets and the hose (product owner, 2026-09-29). The film on the
// glass stays lighter: it coats the whole wall, and at 50 % it would hide the tank's inside.
// The jet's body lowered to 28 % (QA, 2026-09-30: "the water still does not look real"):
// at 50 % a clear jet read as a frosted plastic rod. It stays visible by what makes a real
// jet visible — the room bent through it, its bright edges and core line, and the probe's
// reflection of the room (`reflectionProbe.ts`) — with a light aqua body under those.
// The film on the tank wall from 18 % to 8 % in the same pass: at 18 % it covered the whole
// glass as one milky band and read as frosted acrylic. Water running down clear acrylic is
// mostly clear; its rivulets carry what shows.
// Raised again to 45 % / 12 % (user, 2026-09-30: "too transparent, we need to feel the
// water"), now that what shows is no longer a flat aqua wash: the body is lit by the room,
// deepens to blue-green where the eye crosses more water, and carries turbulence moving
// with the flow (`WATER_BODY`), so more of it reads as water rather than as frosting.
// Raised once more (user, 2026-09-30: "still high transparency — should not be fully
// clear"): 70 % for the jet, 72 % for the hose water, 68 % for the sheets, 20 % for the
// film on the wall. Water this visible stays water rather than plastic because what shows
// is structured — lit, deeper down the axis, streaked with entrained air moving with the
// flow — and the refraction and the room's reflection still show over and through it.
export const WATER_VISIBILITY = { body: 0.7, hose: 0.72, sheet: 0.68, runoff: 0.2 } as const;
/**
 * The colour a body of water scatters back, lit white: where the eye crosses little of it
 * (a jet's edge, a thin sheet) and where it crosses the most (down a jet's axis). The
 * blue-green of the dyed water in the reference recording, saturated enough to read as a
 * colour under the room's light rather than as grey.
 */
export const WATER_BODY = {
  shallow: [0.5, 0.76, 0.84],
  deep: [0.12, 0.4, 0.54],
} as const;

/**
 * The colour of the water body in a tube, lit white: where the line of sight crosses little
 * of it (near the bore's edge) and where it crosses the whole bore. Clear water in a hose
 * is not pale aqua — seen through a bore it is a cool blue-green, darker down the middle,
 * and most of what is light about it is its caustics and the wall's highlights.
 */
// The same water as the jet: the circuit is one substance.
export const CONDUIT_WATER = WATER_BODY;
/** The tint that visibility is drawn in — light aqua, the dyed water of the reference. */
export const WATER_TINT = [0.6, 0.8, 0.88] as const;

/**
 * What refracting water shows where three's transmission buffer has nothing (it holds opaque
 * objects only): the lab's light, near the tank's own background tone.
 */
export const WATER_FILL_LIGHT = [0.78, 0.8, 0.8] as const;

/** Absorption is expressed to three.js as the colour left after this depth of water. */
const ATTENUATION_DISTANCE_M = 0.01 * REFRACTION_DEPTH_SCALE;

/**
 * Surface waves on the jet and its sheets (product-owner request: more reflection and
 * refraction, more wavy).
 *
 * Four wave trains laid out on the distance along the path, not on travel time: a fast jet's
 * ripples stand nearly still where the nozzle and the deflector make them, and a pattern
 * carried at 3 m/s would move several wavelengths a frame and read as flicker. Each drifts
 * slowly, so the surface lives.
 *
 * Wavelengths (m), and a weight each. Round the axis, the column has its necking (0), bending
 * (1) and oval (2) modes, and fine capillary rings (0); a sheet flaps in lobes. Integer modes
 * close the seam.
 */
export const WATER_WAVE_LENGTHS_M = [0.012, 0.0065, 0.0031, 0.0017] as const;
export const WATER_WAVE_WEIGHTS = [0.45, 0.3, 0.18, 0.1] as const;
/** Wave amplitude (m): the column in proportion to its radius, films by what their gap allows. */
export const WATER_WAVE_AMPLITUDE = {
  /** × the column's radius. */
  column: 0.08,
  /** Under the deflector: well inside the 0.6 mm film gap. */
  film: 0.00015,
  /** A free sheet flaps more the further it has flown. */
  free: 0.001,
  /** On the glass, the cover or the tube: inside the film gap. */
  runoff: 0.00022,
} as const;

const glslVec4 = (v: readonly number[]) => `vec4(${v.map((x) => x.toFixed(4)).join(', ')})`;

/** Shared by the vertex and fragment stages. */
const WAVE_DECLARATIONS = `
#if WATER_CONDUIT == 0
varying float vWAmp;
varying vec3 vRun;
varying vec3 vWTan;
varying vec3 vWBit;
const vec4 WATER_WAVE_WEIGHT = ${glslVec4(WATER_WAVE_WEIGHTS)};
const vec4 WATER_WAVE_K = 6.2831853 / ${glslVec4(WATER_WAVE_LENGTHS_M)};
// Slow drift of each train (rad/s): the surface lives without the pattern racing.
const vec4 WATER_WAVE_DRIFT = vec4(2.3, -1.7, 3.1, -4.3);
vec4 waterWaveModes(float column) {
  return mix(vec4(2.0, 3.0, 5.0, 6.0), vec4(0.0, 1.0, 2.0, 0.0), column);
}
float waterWaveAmplitude(float seg, float thickness, float since, float flow) {
  float column = 1.0 - step(0.5, seg);
  float film = step(0.5, seg) * (1.0 - step(1.5, seg));
  float free = step(1.5, seg) * (1.0 - step(2.5, seg));
  float runoff = step(2.5, seg);
  float a = column * max(thickness, 0.0) * ${WATER_WAVE_AMPLITUDE.column.toFixed(4)}
          + film * ${WATER_WAVE_AMPLITUDE.film.toFixed(5)}
          + free * ${WATER_WAVE_AMPLITUDE.free.toFixed(5)} * (1.0 - exp(-since / 0.004))
          + runoff * ${WATER_WAVE_AMPLITUDE.runoff.toFixed(5)};
  return a * (0.35 + 0.65 * clamp(flow * 1.6, 0.0, 1.0));
}
// Height (x, in units of the amplitude), and its slope along the path (y, per metre) and
// round the axis (z, per radian).
vec4 waterWaves(float along, float around, float time, vec4 modes, vec4 weight) {
  vec4 ph = WATER_WAVE_K * along + modes * around - WATER_WAVE_DRIFT * time;
  vec4 sn = sin(ph);
  vec4 cs = cos(ph);
  return vec4(dot(weight, sn), dot(weight * WATER_WAVE_K, cs), dot(weight * modes, cs), 0.0);
}
#endif
`;

/**
 * The water material.
 *
 * `stream`: water in air — the jet, the films on the deflector, the free sheets, the run-off.
 * Water that has not arrived or has already gone is not drawn.
 *
 * `conduit`: water inside a clear tube, drawn on the tube's own surface — the tube's wall is
 * always there; the water fills it from the source end as it arrives.
 */
export function createWaterMaterial(
  rippleTexture: THREE.Texture,
  uniforms: WaterUniforms,
  kind: WaterKind,
  wall: ConduitWall = CONDUIT_WALLS.clear
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    // Transmission tint only: water's colour comes from its volume absorption below and from
    // what it reflects, not from an albedo.
    color: new THREE.Color(kind === 'stream-sheet' ? '#0c2a36' : '#f2fbfd'),
    // Real refraction (product-owner request, 2026-09-28): what is behind the water is seen
    // *through* it, bent by its surface — the ripples below move the refracted image, which
    // is what makes water look wavy. three already renders the opaque scene into its
    // transmission buffer every frame for the model's transmissive labels (`docs/52`), so this
    // samples a buffer that exists anyway.
    // Only the jet and the film over the deflector refract. The hose did too, and seen
    // across the tank's collar its refracted view broke into black and white speckle along
    // the collar's edge (QA, 2026-09-29); at the distance it is seen from, refraction adds
    // nothing a see-through tint does not. It is blended instead, like the sheets.
    transmission: kind === 'stream-body' ? 1 : 0,
    // Per-fragment, from the water's own thickness — see `waterThickness` in the shader.
    thickness: 0.01,
    attenuationDistance: ATTENUATION_DISTANCE_M,
    // The colour left after `attenuationDistance` of *refraction* depth, which is the real
    // depth × REFRACTION_DEPTH_SCALE: so the absorption of the real depth.
    attenuationColor: new THREE.Color(...WATER_ABSORPTION_PER_M.map((k) => Math.exp((-k * ATTENUATION_DISTANCE_M) / REFRACTION_DEPTH_SCALE)) as [number, number, number]),
    // A touch of dispersion: the thin coloured fringes a real jet shows at its edges.
    dispersion: 0.25,
    transparent: true,
    premultipliedAlpha: true,
    roughness: 0.02,
    metalness: 0,
    ior: 1.333,
    specularIntensity: 1,
    specularColor: new THREE.Color('#ffffff'),
    // More of the room in the surface: water is, above all, a mirror at a glancing angle.
    envMapIntensity: 2.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  mat.name = kind === 'conduit' ? 'Water in hose' : kind === 'stream-sheet' ? 'Water sheets' : 'Water';
  // The three kinds share one `onBeforeCompile` source, which is three's default program
  // cache key: without a key of their own, whichever kind compiled first would be reused for
  // the others (the jet drawn with the hose's shader — nothing discarded, the whole tank
  // refracted). The defines on the material itself are part of the key as well.
  mat.defines = {
    ...(mat.defines ?? {}),
    WATER_CONDUIT: kind === 'conduit' ? 1 : 0,
    WATER_SHEET: kind === 'stream-sheet' ? 1 : 0,
  };
  mat.customProgramCacheKey = () => `bedo-water-${kind}`;
  // Tells the ambient-occlusion pre-pass (`labPostProcessing.ts`) to leave the water out: it
  // draws with an override material, which knows nothing of the segments this shader
  // discards, and would shade a dark halo round the whole path.
  mat.userData.seeThrough = true;
  // Reflects the room itself once the probe is taken (`reflectionProbe.ts`).
  mat.userData.bedoReflect = 'water';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uWaterTex: { value: rippleTexture },
      // Per material, not shared: the two hoses share a program but not a wall.
      uConduitWall: { value: new THREE.Vector4(...wall.tint, wall.opacity) },
    });
    shader.vertexShader =
      'uniform float uClock;\nuniform float uFlow;\n' +
      'attribute vec2 aFlowUv;\nattribute vec3 aFlow;\n' +
      'varying vec2 vFlowUv;\nvarying vec2 vAround;\nvarying vec3 vFlowData;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\n' +
      WAVE_DECLARATIONS +
      '#if WATER_CONDUIT == 0\nattribute vec3 aRun;\n#endif\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vFlowUv = aFlowUv;
         // Around the stream as a direction, not a number, so it interpolates across the
         // seam where 0.99 meets 0.01 instead of sweeping back through the whole texture.
         vAround = vec2(cos(aFlowUv.x * 6.2831853), sin(aFlowUv.x * 6.2831853));
         vFlowData = aFlow;
         #if WATER_CONDUIT == 0
         {
           // Surface waves: the long trains move the surface itself, so the jet's outline
           // and the sheets' edges ripple; the fine ones only tilt the normal (fragment),
           // where the mesh is too coarse to carry them.
           float seg = aFlow.y;
           float column = 1.0 - step(0.5, seg);
           float ang = aFlowUv.x * 6.2831853;
           vWAmp = waterWaveAmplitude(seg, aFlow.x, aRun.x, uFlow);
           vRun = aRun;
           vec4 wave = waterWaves(aRun.y, ang, uClock, waterWaveModes(column),
                                  WATER_WAVE_WEIGHT * vec4(1.0, 1.0, column, 0.0));
           transformed += objectNormal * vWAmp * wave.x;
           // The path's own directions, for the fragment: along it, and around the axis.
           float c = cos(ang);
           float sn = sin(ang);
           float nr = dot(objectNormal.xz, vec2(c, sn));
           vWTan = normalize(mat3(modelMatrix) * vec3(-objectNormal.y * c, nr, -objectNormal.y * sn));
           vWBit = normalize(mat3(modelMatrix) * vec3(-sn, 0.0, c));
         }
         #endif
         vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vWNorm = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader =
      'uniform float uClock;\nuniform float uFlow;\nuniform float uHead;\nuniform float uTail;\n' +
      'uniform float uFill;\nuniform float uSpeed;\nuniform vec4 uConduitWall;\n' +
      'uniform sampler2D uWaterTex;\n' +
      `const vec3 WATER_TINT_RGB = vec3(${WATER_TINT.map((x) => x.toFixed(3)).join(', ')});\n` +
      `const vec3 WATER_BODY_SHALLOW = vec3(${WATER_BODY.shallow.map((x) => x.toFixed(3)).join(', ')});\n` +
      `const vec3 WATER_BODY_DEEP = vec3(${WATER_BODY.deep.map((x) => x.toFixed(3)).join(', ')});\n` +
      `const vec3 CONDUIT_WATER_SHALLOW = vec3(${CONDUIT_WATER.shallow.map((x) => x.toFixed(3)).join(', ')});\n` +
      `const vec3 CONDUIT_WATER_DEEP = vec3(${CONDUIT_WATER.deep.map((x) => x.toFixed(3)).join(', ')});\n` +
      'varying vec2 vFlowUv;\nvarying vec2 vAround;\nvarying vec3 vFlowData;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\n' +
      WAVE_DECLARATIONS +
      'float waterAround() { return fract(atan(vAround.y, vAround.x) / 6.2831853 + 1.0); }\n' +
      shader.fragmentShader
        .replace(
          'void main() {',
          `void main() {
             // The water's surface normal (world) with its waves, and how far up a wave
             // crest this point is (-1 trough … 1 crest); set with the normal below.
             vec3 waterNW = normalize(vWNorm);
             float waterCrest = 0.0;
             // The normal the refraction is traced with (view space): the surface and its long
             // waves only. The fine ripples shape the reflection, but refracted through, they
             // made neighbouring pixels sample far-apart parts of the scene — bright wall
             // beside black cover plate — which read as a jagged black edge.
             vec3 waterRefractN = vec3(0.0, 0.0, 1.0);
             // Is there water here? A stream is nothing but water; a conduit is a tube that
             // may or may not have water in it yet.
             // three draws a double-sided refracting material's back faces into its own
             // refraction buffer first (side flipped to BackSide, so FLIP_SIDED), with this
             // shader — which samples that same buffer while it is being drawn, and came out
             // black. The water is left out of that pass: what it refracts is the room.
             #ifdef FLIP_SIDED
               discard;
             #endif
             float present = step(vFlowUv.y, uHead) * step(uTail, vFlowUv.y);
             #if WATER_CONDUIT == 0
               if (present < 0.5) discard;
             #endif
             // How much water the refracted light crosses: a round body (jet, hose bore) its
             // diameter, a sheet its thickness — with a floor, so thin water still bends the
             // view a little. An empty hose is its plastic wall.
             float waterSeg = vFlowData.y;
             float waterRound = 1.0 - step(0.5, waterSeg) + step(3.5, waterSeg);
             float waterT = max(vFlowData.x, 0.0);
             float waterThickness = mix(0.0015 + waterT, 2.0 * waterT, waterRound);
             #if WATER_CONDUIT == 1
               waterThickness = mix(0.0015, waterThickness, present * max(clamp(uFlow * 3.0, 0.0, 1.0), uFill));
             #endif
             // The exaggerated depth is for the jet, whose bending is otherwise invisible. The
             // hose lies in front of the dark apparatus base: at that depth its view of the
             // tank's collar came from the base below it, and read as black patches. It
             // refracts at its true depth.
             #if WATER_CONDUIT == 0
               waterThickness *= ${REFRACTION_DEPTH_SCALE.toFixed(1)};
             #endif
             // Refraction where there is a body of water to look through — the jet, the
             // film over the deflector, the hose. A free sheet or a film on the glass is a
             // fraction of a millimetre: it bends nothing visibly, and is drawn as a thin
             // layer over what is behind it instead (see the end of the shader).
             float waterTransmission = step(waterSeg, 1.5) + step(3.5, waterSeg);
             #if WATER_CONDUIT == 0
               #if WATER_SHEET == 1
                 if (waterTransmission > 0.5) discard;
               #else
                 if (waterTransmission < 0.5) discard;
                 // A jet is a closed body: its far side is not drawn. Drawn, three also puts
                 // it into the very buffer the near side refracts, so the jet refracted a
                 // dark copy of itself. (The film under a deflector is seen from either side.)
                 if (waterSeg < 0.5 && dot(normalize(vWNorm), normalize(cameraPosition - vWPos)) < 0.0) discard;
               #endif
             #endif`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           waterRefractN = normal;
           {
             // Ripples carried by the water, stretched along the flow: three scales, each an
             // integer number of times around so they close seamlessly.
             float parcel = uClock - vFlowUv.y;
             float u = waterAround();
             float drive = clamp(uFlow * 1.6, 0.0, 1.0) * present;
             vec2 g = (texture2D(uWaterTex, vec2(u * 3.0, parcel * 7.0)).rg - 0.5) * 0.55
                    + (texture2D(uWaterTex, vec2(u * 7.0 + 0.37, parcel * 19.0)).rg - 0.5) * 0.45
                    + (texture2D(uWaterTex, vec2(u * 13.0 + 0.71, parcel * 43.0)).rg - 0.5) * 0.30;
             vec3 nW = normalize(vWNorm);
             vec3 tW = normalize(cross(nW, abs(nW.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
             vec3 bW = cross(nW, tW);
             vec3 bump = (viewMatrix * vec4(tW * g.x + bW * g.y, 0.0)).xyz;
             #if WATER_CONDUIT == 1
               // The outside of a hose is smooth plastic: its highlights run straight along
               // both edges. The water moving inside is drawn in the body, not the wall.
               normal = normalize(normal + bump * 0.04);
             #else
               normal = normalize(normal + bump * (0.30 + 0.70 * drive));
             #endif
             #if WATER_CONDUIT == 0
               // The surface waves' slope, every train, per pixel: this is what bends the
               // refracted view and breaks up the reflection.
               float column = 1.0 - step(0.5, vFlowData.y);
               vec4 wave = waterWaves(vRun.y, atan(vAround.y, vAround.x), uClock,
                                      waterWaveModes(column), WATER_WAVE_WEIGHT);
               vec3 slope = vWAmp * (wave.y * normalize(vWTan)
                                   + wave.z / max(vRun.z, 0.0005) * normalize(vWBit));
               float steep = length(slope);
               if (steep > 0.7) slope *= 0.7 / steep;
               normal = normalize(normal - faceDirection * (viewMatrix * vec4(slope, 0.0)).xyz);
               waterNW = normalize(waterNW - slope);
               // The long trains only, for the refraction.
               vec4 longWave = waterWaves(vRun.y, atan(vAround.y, vAround.x), uClock,
                                          waterWaveModes(column), WATER_WAVE_WEIGHT * vec4(1.0, 1.0, 0.0, 0.0));
               vec3 longSlope = vWAmp * (longWave.y * normalize(vWTan)
                                       + longWave.z / max(vRun.z, 0.0005) * normalize(vWBit));
               float longSteep = length(longSlope);
               if (longSteep > 0.35) longSlope *= 0.35 / longSteep;
               waterRefractN = normalize(waterRefractN - faceDirection * (viewMatrix * vec4(longSlope, 0.0)).xyz);
               waterCrest = wave.x / dot(WATER_WAVE_WEIGHT, vec4(1.0));
             #endif
             // Tilted by ripples and waves, a normal at the outline can end up facing away from
             // the camera, and three lights such a normal black — the jagged dark edge along
             // the jet. Keep it facing the viewer, as the real surface there does.
             {
               vec3 toEye = normalize(vViewPosition);
               float facing = dot(normal, toEye);
               if (facing < 0.08) normal = normalize(normal + toEye * (0.08 - facing));
               facing = dot(waterRefractN, toEye);
               if (facing < 0.08) waterRefractN = normalize(waterRefractN + toEye * (0.08 - facing));
             }
           }`
        )
        .replace(
          '#include <transmission_fragment>',
          THREE.ShaderChunk.transmission_fragment
            .replace('material.thickness = thickness;', 'material.thickness = waterThickness;')
            // The thickness is in the mesh's units and three scales the ray by the model's
            // scale; the absorption distance must be in the same units, or a scaled-up model
            // (the rig is drawn at ×1.8) absorbs as if its water were thicker.
            .replace(
              'material.attenuationDistance = attenuationDistance;',
              'material.attenuationDistance = attenuationDistance * length( vec3( modelMatrix[ 0 ].xyz ) );'
            )
            .replace(
              'vec3 n = inverseTransformDirection( normal, viewMatrix );',
              'vec3 n = inverseTransformDirection( waterRefractN, viewMatrix );'
            )
            .replace(
              'totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );',
              `// three's transmission buffer holds only opaque objects; where the refracted ray
               // lands on anything else — the deflectors, the nozzle, the glass are transmissive
               // themselves — it is empty, and water refracting it turned black in jagged
               // patches. Fill what the buffer lacks with what is straight behind the water,
               // and failing that the lab's light, dimmed by the water as the rest is.
               {
                 vec3 wRay = getVolumeTransmissionRay( n, v, material.thickness, material.ior, modelMatrix );
                 vec4 wNdc = projectionMatrix * viewMatrix * vec4( pos + wRay, 1.0 );
                 float wCover = getTransmissionSample( wNdc.xy / wNdc.w * 0.5 + 0.5, material.roughness, material.ior ).a;
                 vec4 bNdc = projectionMatrix * viewMatrix * vec4( pos, 1.0 );
                 vec4 behind = getTransmissionSample( bNdc.xy / bNdc.w * 0.5 + 0.5, material.roughness, material.ior );
                 vec3 fill = behind.rgb + ( 1.0 - clamp( behind.a, 0.0, 1.0 ) ) * vec3( ${WATER_FILL_LIGHT.map((x) => x.toFixed(3)).join(', ')} );
                 vec3 through = volumeAttenuation( length( wRay ), material.attenuationColor, material.attenuationDistance );
                 transmitted.rgb += ( 1.0 - clamp( wCover, 0.0, 1.0 ) ) * through * fill;
               }
               totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );`
            )
        )
        .replace(
          '#include <premultiplied_alpha_fragment>',
          // The colour below is already premultiplied: reflection added, body scaled.
          ''
        )
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
           {
             vec3 V = normalize(cameraPosition - vWPos);
             float cosView = clamp(abs(dot(waterNW, V)), 0.0, 1.0);
             float fres = 0.02 + 0.98 * pow(1.0 - cosView, 5.0);
             float parcel = uClock - vFlowUv.y;
             float u = waterAround();
             float drive = clamp(uFlow * 1.6, 0.0, 1.0);
             float seg = vFlowData.y;
             float isColumn = 1.0 - step(0.5, seg);
             float isFilm = step(0.5, seg) * (1.0 - step(1.5, seg));
             float isFree = step(1.5, seg) * (1.0 - step(2.5, seg));
             float isRunoff = step(2.5, seg) * (1.0 - step(3.5, seg));
             float isConduit = step(3.5, seg);
             float speed = vFlowData.z;

             // Everything three.js has just computed: the room reflected off the rippled
             // surface, and what is behind the water refracted through it and dimmed by the
             // water's own absorption (transmission, attenuationColor).
             vec3 lit = gl_FragColor.rgb;
             // A sheet is never more than a couple of millimetres thick.
             float t = isColumn + isConduit > 0.5 ? max(vFlowData.x, 0.0) : clamp(vFlowData.x, 0.0, 0.002);

             // Air carried by the water: bubbles and churn, moving with it.
             float c1 = texture2D(uWaterTex, vec2(u * 5.0, parcel * 13.0)).b;
             float c2 = texture2D(uWaterTex, vec2(u * 11.0 + 0.5, parcel * 29.0)).b;
             float crest = c1 * 0.6 + c2 * 0.4;
             // Small and sparse: a fast jet carries fine bubbles, not white blotches.
             float bubbles = smoothstep(0.84, 0.9, texture2D(uWaterTex, vec2(u * 29.0 + 0.2, parcel * 97.0)).b);
             float churn = smoothstep(0.50, 0.88, crest);
             float sheetK = 1.0 - exp(-t / 0.00035);

             // Ligaments: a spreading or falling sheet is not a uniform film — it gathers
             // into streaks stretched along the flow, denser water between clearer gaps
             // (product request, 2026-09-29: realistic water). Narrow around the axis,
             // long along the travel, carried with the parcels like everything else.
             float lig = smoothstep(0.30, 0.72, texture2D(uWaterTex, vec2(u * 26.0 + 0.05, parcel * 2.2)).g);

             // The splash where the jet strikes the deflector: air churned into the first
             // centimetre of the film, a white ring around the impact that every real
             // impinging jet shows. vRun.z is the distance from the axis, so the ring
             // rides the impact point wherever the carrier — and so the deflector — is.
             float impactRing = 0.0;
             #if WATER_CONDUIT == 0
               impactRing = isFilm * exp(-vRun.z / 0.012) * (0.5 + 0.5 * churn);
             #endif
             float aeration =
                 impactRing * 0.9
               + isFilm * churn * 0.75
               + isFree * churn * (1.0 - sheetK) * 0.55
               + isColumn * bubbles * smoothstep(3.0, 9.0, speed) * 0.3
               + isConduit * bubbles * 0.35 * drive * present
               ;
             aeration *= clamp(drive * 1.4, 0.25, 1.0);

             // Rivulets down the glass: narrow around, long along the flow.
             float rivulet = smoothstep(0.62, 0.84, texture2D(uWaterTex, vec2(u * 23.0, parcel * 4.0)).b);

             // A water jet reads as a glass rod: a bright line down its core where the room's
             // light is focused through it.
             float core = isColumn * pow(cosView, 12.0) * 0.18 * (0.6 + 0.4 * crest);
             // Light caught by the moving surface: short bright streaks that travel with the
             // water — the cue that says "flowing" rather than "glass".
             float streak = smoothstep(0.66, 0.92,
               texture2D(uWaterTex, vec2(u * 9.0 + 0.13, parcel * 27.0)).b);
             vec3 flowLight = vec3(0.80, 0.88, 0.96) * streak * (0.10 + 0.14 * drive)
                            * (isColumn + isConduit * present + isFilm * 0.6) * (0.4 + 0.6 * fres + 0.3 * cosView);
             // A little more of the room at grazing angles, where water is nearly a mirror.
             vec3 sheen = vec3(0.70, 0.78, 0.88) * fres * 0.30;
             // How much light reaches the water here: what a white matte surface would show.
             // The body is lit by the room, so it is darker in shade and brighter in the
             // light — not a flat wash that glows the same everywhere.
             float waterLight = clamp(dot(totalDiffuse / max(diffuseColor.rgb, vec3(0.05)),
                                          vec3(0.2126, 0.7152, 0.0722)), 0.35, 1.2);
             // Turbulence carried by the water, long along the flow: denser and clearer
             // water passing by, which is what makes a stream read as moving.
             float waterTurb = texture2D(uWaterTex, vec2(u * 3.0 + 0.17, parcel * 5.0)).b * 0.6
                             + texture2D(uWaterTex, vec2(u * 7.0 + 0.53, parcel * 11.0)).b * 0.4;

             #if WATER_CONDUIT == 1
               // The hose: a tube wall, always there, and inside it a body of water where the
               // water has got to — moving at the water's speed, faster down the axis than at
               // the wall, with its caustic network, its bubbles and its filling front.
               //
               // Drawn on the tube's outer surface only, and only on the half facing the eye:
               // the near half already pictures the whole bore (the chord below), so the far
               // half drawn again doubled the water and put a second wall inside it.
               if (dot(normalize(vWNorm), V) < 0.0) discard;
               float wall = pow(1.0 - cosView, 3.0);
               float filled = present * max(clamp(uFlow * 3.0, 0.0, 1.0), uFill);
               // How much light reaches this point: what a white matte surface here would show.
               vec3 irr = totalDiffuse / max(diffuseColor.rgb, vec3(0.05));
               float light = clamp(dot(irr, vec3(0.2126, 0.7152, 0.0722)), 0.3, 1.1);

               // Where across the tube the eye looks: 0 down the axis, 1 at the silhouette.
               float offAxis = sqrt(max(1.0 - cosView * cosView, 0.0));
               const float BORE = ${CONDUIT_FLOW.boreApparent.toFixed(3)};
               float inBore = 1.0 - smoothstep(BORE - 0.07, BORE, offAxis);
               // The chord the line of sight cuts through the water (1 on the axis), and so
               // how much the water tints what is seen through it (Beer–Lambert).
               float chordK = sqrt(max(BORE * BORE - offAxis * offAxis, 0.0)) / BORE;
               vec3 Tw = exp(-vec3(${WATER_ABSORPTION_PER_M.map((k) => k.toFixed(1)).join(', ')}) * (2.0 * t * chordK));
               float depthK = clamp((1.0 - dot(Tw, vec3(0.3333))) / 0.3, 0.0, 1.0);

               // The pipe-flow profile: the parcel coordinate at this depth into the bore.
               float pc = uClock * mix(${CONDUIT_FLOW.wallSpeed.toFixed(2)}, ${CONDUIT_FLOW.coreSpeed.toFixed(2)}, chordK) - vFlowUv.y;
               // Turbulence turns the pattern slowly round the axis as it travels.
               float us = u + pc * 0.23;
               // Large slow swirls, and finer detail warped by them.
               float h1 = texture2D(uWaterTex, vec2(us * 2.0, pc * 1.8)).b;
               float h2 = texture2D(uWaterTex, vec2(us * 4.0 + 0.31, pc * 3.6 + h1 * 0.5)).b;
               float turb = h1 * 0.6 + h2 * 0.4;
               // Caustics: thin bright filaments where the moving water focuses the light,
               // in patches rather than everywhere — the network that makes water in a
               // clear tube read as water, not as tint.
               float caust = pow(1.0 - abs(2.0 * h2 - 1.0), 18.0) * smoothstep(0.5, 0.75, h1);
               // A filled round tube is a lens: a bright line down its axis.
               float focus = pow(cosView, 14.0) * (0.7 + 0.6 * turb);

               // Bubbles, carried by the fast core and gathered at the top of the bore. At
               // high speed they blur into the water, as they do to the eye.
               float up = smoothstep(0.1, 0.8, normalize(vWNorm).y);
               float pb = uClock * ${(CONDUIT_FLOW.coreSpeed * 0.95).toFixed(3)} - vFlowUv.y;
               float bub = smoothstep(0.84, 0.9, texture2D(uWaterTex, vec2(u * 19.0 + 0.2, pb * 14.0)).b)
                         * drive * (0.25 + 0.75 * up) * (1.0 - 0.8 * smoothstep(0.8, 2.5, uSpeed)) * 0.6;
               // The filling front and the draining tail: churned, white, a few cm long.
               float front = (uHead < 1.0e5 ? exp(-max(uHead - vFlowUv.y, 0.0) / 0.03) : 0.0)
                           + (uTail >= 0.0 ? exp(-max(vFlowUv.y - uTail, 0.0) / 0.03) : 0.0);
               float froth = clamp(front * 0.9 + bub, 0.0, 1.0);

               // The water, premultiplied: clear aqua where the chord is short, deeper
               // blue-green down the middle, lighter and darker as the turbulence moves.
               vec3 bodyCol = mix(CONDUIT_WATER_SHALLOW, CONDUIT_WATER_DEEP, depthK) * (0.9 + 0.2 * turb);
               float aW = ${WATER_VISIBILITY.hose.toFixed(2)} * (0.55 + 0.45 * chordK) * (0.9 + 0.2 * turb);
               aW = mix(aW, 0.85, froth) * filled * inBore;
               vec3 cW = mix(bodyCol, vec3(0.92, 0.95, 0.97), froth) * light * aW;
               vec3 glints = vec3(0.88, 0.95, 1.0) * (caust * chordK * (0.3 + 0.7 * drive) * 0.2 + focus * 0.12)
                           * light * filled * inBore;

               // The wall over the water: its own tint, and more of it at the rim.
               float wallA = clamp(uConduitWall.a + wall * 0.45, 0.0, 0.95);
               vec3 col = uConduitWall.rgb * light * wallA + (1.0 - wallA) * (cW + glints);
               float a = wallA + (1.0 - wallA) * aW;
               // The room in the tube's surface: three's own specular, Fresnel already in it.
               vec3 reflection = totalSpecular;
               gl_FragColor = vec4(col + reflection + vec3(0.70, 0.77, 0.86) * wall * 0.25 * light, clamp(a, 0.0, 0.96));
             #else
               if (waterTransmission > 0.5) {
                 // A body of water: refracted, reflected, and whitened where air is in it.
                 // A wave crest is a lens: it gathers the light behind it into a bright band,
                 // and a trough spreads it — the moving light and shade inside a real jet.
                 // The water's own colour: clear aqua at the jet's edge, blue-green down its
                 // axis where the eye crosses the whole diameter, moving with the turbulence
                 // and lit by the room (WATER_BODY, WATER_VISIBILITY).
                 float chordB = isColumn > 0.5 ? cosView : 0.7;
                 vec3 bodyB = mix(WATER_BODY_SHALLOW, WATER_BODY_DEEP, chordB * 0.85)
                            * (0.78 + 0.5 * waterTurb) * (1.0 + 0.25 * waterCrest) * waterLight;
                 vec3 water = mix(lit * (1.0 + 0.45 * waterCrest), bodyB,
                                  min(${WATER_VISIBILITY.body.toFixed(2)} * (0.75 + 0.35 * chordB), 0.92));
                 // Entrained air: a fast jet is not glass-clear — it carries milky streaks of
                 // fine air, long along the flow and moving with it.
                 float airStreak = smoothstep(0.55, 0.85, waterTurb) * clamp(drive * 1.5, 0.3, 1.0) * isColumn;
                 water = mix(water, vec3(0.86, 0.92, 0.96) * waterLight, airStreak * 0.35);
                 // Foam: air churned in, white and lit, over everything else.
                 water = mix(water, vec3(0.9, 0.94, 0.97) * waterLight, clamp(aeration * 1.3, 0.0, 1.0));
                 // A rod of water's silhouette: light bent round its edge by total internal
                 // reflection, bright and rippling — the outline that makes a clear jet visible.
                 float edgeLight = isColumn * pow(1.0 - cosView, 2.0) * (0.35 + 0.35 * crest);
                 gl_FragColor = vec4(water + core + flowLight + sheen + vec3(0.78, 0.86, 0.94) * edgeLight, 1.0);
               } else {
                 // A thin layer over what is behind it: its reflection added at full strength,
                 // the background dimmed only by what the layer absorbs (premultiplied).
                 // A thin free sheet tears where the crest field is low — and a real sheet
                 // does not end at a clean cut: past the tear, what is left of the water
                 // flies on as droplets. Inside a torn patch only the droplet specks are
                 // kept, bright beads that travel with the sheet.
                 float droplet = 0.0;
                 if (isFree > 0.5 && crest < (1.0 - sheetK) * 0.42) {
                   if (texture2D(uWaterTex, vec2(u * 21.0 + 0.41, parcel * 33.0)).b < 0.88) discard;
                   droplet = 1.0;
                 }
                 vec3 Ts = exp(-vec3(${WATER_ABSORPTION_PER_M.map((k) => k.toFixed(1)).join(', ')}) * (t / max(cosView, 0.18)));
                 // On the glass, only the rivulets carry any body; between them the film is
                 // clear and shows as a faint reflection.
                 float a = (1.0 - dot(Ts, vec3(0.3333))) * 0.9 * (1.0 - isRunoff)
                         + isRunoff * (0.02 + rivulet * 0.28 * clamp(drive * 2.0, 0.3, 1.0))
                         + aeration * 0.6;
                 // Never fully see-through (WATER_VISIBILITY) — but not uniform either: the
                 // ligaments carry the body (up to ~1.4x the floor) and the gaps between
                 // them show less (~0.5x), so the sheet averages the visibility the product
                 // owner asked for while reading as streaked, moving water rather than as a
                 // frosted pane. A touch more at grazing angles, as a real film shows.
                 float sheetFloor = ${WATER_VISIBILITY.sheet.toFixed(2)} * (0.5 + 0.9 * lig) * (0.82 + 0.3 * fres);
                 a = max(a, sheetFloor * (1.0 - isRunoff)
                            + isRunoff * (${WATER_VISIBILITY.runoff.toFixed(2)} + rivulet * 0.2));
                 a = clamp(a, 0.0, 0.9);
                 // Light aqua rather than dark teal: at this opacity a dark body would read as
                 // a shadow, not as water.
                 vec3 bodyColour = mix(WATER_BODY_SHALLOW, WATER_BODY_DEEP, 0.35)
                                 * (0.6 + 0.4 * cosView) * (0.8 + 0.4 * waterTurb) * waterLight;
                 vec3 colour = mix(bodyColour, vec3(0.9, 0.94, 0.97) * waterLight, clamp(aeration * 1.4, 0.0, 1.0));
                 // The streaks are the water: a little brighter than the gaps.
                 colour *= 0.82 + 0.36 * lig;
                 if (droplet > 0.5) {
                   // A flying bead: nearly white, catching the light.
                   colour = vec3(0.90, 0.95, 0.99);
                   a = 0.85;
                 }
                 vec3 reflection = lit * mix(0.35, 1.0, fres) * (isRunoff > 0.5 ? 0.45 : 1.0)
                                 * (1.0 + 0.35 * waterCrest);
                 gl_FragColor = vec4(reflection + colour * a + flowLight * isFilm, a);
               }
             #endif
           }`
        );
  };
  return mat;
}

/**
 * Shortest distances over a mesh's edge graph from seeded vertices (Dijkstra, binary heap).
 * The supply hose has ~4000 welded vertices: the O(n²) scan this replaced cost tens of
 * milliseconds of main thread at load, for each hose.
 */
function geodesic(edges: Map<number, number>[], seeds: [number, number][]): Float64Array {
  const dist = new Float64Array(edges.length).fill(Infinity);
  const heap: [number, number][] = [];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };
  for (const [v, d] of seeds) {
    if (d < dist[v]) {
      dist[v] = d;
      push([d, v]);
    }
  }
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    for (const [v, w] of edges[u]) {
      if (d + w < dist[v]) {
        dist[v] = d + w;
        push([dist[v], v]);
      }
    }
  }
  return dist;
}

/**
 * Give a tube mesh the flow coordinates the material needs, from its own vertices.
 *
 * The hose ships with positions and normals only. `along` is the distance from the source
 * end measured over the mesh's own edges (Dijkstra from a cut across the lower end — the
 * pump end of the delivery line, the tap end of the supply hose), so it follows the tube
 * round its bend, which a height or a straight-axis projection
 * cannot. `around` is the angle about the tube's local axis, measured against the ring of
 * vertices at the same distance.
 *
 * Returns the tube's length and bore radius, in the mesh's world units, or null for a mesh
 * that is not a tube.
 */
export function measureConduit(
  mesh: THREE.Mesh,
  toLocal: (v: THREE.Vector3) => THREE.Vector3 = (v) => v
): { length: number; radius: number } | null {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!position || !index || position.count < 16) return null;
  mesh.updateWorldMatrix(true, false);
  const n = position.count;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    pts.push(toLocal(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)));
  }

  // Weld coincident vertices (normal seams split them) so the graph is connected.
  const key = (v: THREE.Vector3) => `${Math.round(v.x * 1e5)},${Math.round(v.y * 1e5)},${Math.round(v.z * 1e5)}`;
  const weld = new Map<string, number>();
  const node = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = key(pts[i]);
    if (!weld.has(k)) weld.set(k, weld.size);
    node[i] = weld.get(k)!;
  }
  const m = weld.size;
  const where: THREE.Vector3[] = new Array(m);
  for (let i = 0; i < n; i++) where[node[i]] = pts[i];
  const edges: Map<number, number>[] = Array.from({ length: m }, () => new Map());
  for (let f = 0; f < index.count; f += 3) {
    const a = node[index.getX(f)];
    const b = node[index.getX(f + 1)];
    const c = node[index.getX(f + 2)];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const d = where[p].distanceTo(where[q]);
      edges[p].set(q, d);
      edges[q].set(p, d);
    }
  }

  // The two ends: the vertex farthest from anywhere, and the one farthest from that. The
  // water enters at the lower of the two — the tap end of the supply hose, the pump end of
  // the delivery line. (Seeding at the lowest *point* was wrong for a hose that sags just
  // short of its inlet: the water then ran both ways from the sag.)
  const farthest = (d: Float64Array) => {
    let best = 0;
    for (let i = 1; i < m; i++) if (Number.isFinite(d[i]) && (!Number.isFinite(d[best]) || d[i] > d[best])) best = i;
    return best;
  };
  const endA = farthest(geodesic(edges, [[0, 0]]));
  const fromA = geodesic(edges, [[endA, 0]]);
  const endB = farthest(fromA);
  const inlet = where[endA].y <= where[endB].y ? endA : endB;
  const rough = inlet === endA ? fromA : geodesic(edges, [[endB, 0]]);
  const roughLength = rough[farthest(rough)];
  if (!(roughLength > 0)) return null;

  // Start the count on a cut square across the tube, not at one point of its rim: the
  // vertices of the inlet's first few centimetres start at their distance from the end
  // plane, measured down the tube's axis there. Distance round the rim is not distance
  // along the hose.
  const near: number[] = [];
  for (let i = 0; i < m; i++) if (rough[i] < roughLength * 0.06) near.push(i);
  const centroid = (ids: number[]) => {
    const c = new THREE.Vector3();
    for (const i of ids) c.add(where[i]);
    return c.divideScalar(Math.max(ids.length, 1));
  };
  const first = centroid(near.filter((i) => rough[i] < roughLength * 0.03));
  const next = centroid(near.filter((i) => rough[i] >= roughLength * 0.03));
  const axisIn = next.sub(first).normalize();
  let plane = Infinity;
  for (const i of near) plane = Math.min(plane, where[i].dot(axisIn));
  const seeds: [number, number][] = near.map((i) => [i, Math.max(where[i].dot(axisIn) - plane, 0)]);
  const dist = geodesic(edges, seeds);
  let length = 0;
  for (let i = 0; i < m; i++) if (Number.isFinite(dist[i])) length = Math.max(length, dist[i]);
  if (!(length > 0)) return null;

  // Around: the angle about the local axis. The tube is cut into slices along its length;
  // each slice's centre and axis come from its own vertices, and the zero of the angle is
  // carried from slice to slice (parallel transport). A fixed "up" reference flipped the
  // frame wherever the tube ran vertical, and tore the pattern in the water there.
  const slices = 96;
  const sliceOf = (d: number) => Math.min(slices - 1, Math.max(0, Math.floor((d / length) * slices)));
  const centres = Array.from({ length: slices }, () => new THREE.Vector3());
  const counts = new Uint32Array(slices);
  for (let i = 0; i < m; i++) {
    if (!Number.isFinite(dist[i])) continue;
    const k = sliceOf(dist[i]);
    centres[k].add(where[i]);
    counts[k]++;
  }
  for (let k = 0; k < slices; k++) {
    if (counts[k]) centres[k].divideScalar(counts[k]);
    else if (k > 0) centres[k].copy(centres[k - 1]);
  }
  const axes = centres.map((_, k) => {
    const a = centres[Math.min(k + 1, slices - 1)].clone().sub(centres[Math.max(k - 1, 0)]);
    return a.lengthSq() > 0 ? a.normalize() : new THREE.Vector3(0, 1, 0);
  });
  const refs: THREE.Vector3[] = [];
  for (let k = 0; k < slices; k++) {
    const axis = axes[k];
    let ref = k === 0 ? (Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)) : refs[k - 1].clone();
    ref.addScaledVector(axis, -ref.dot(axis));
    if (ref.lengthSq() < 1e-10) ref = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x);
    refs.push(ref.normalize());
  }
  // Along, smoothed: the distance over the mesh's edges zigzags with the triangles by a
  // few millimetres, and the water's front — a cut across the tube at one distance — drew
  // as a sawtooth. Each vertex is placed instead by the slice's mean distance plus its
  // offset down the slice's axis: a cut square across the tube.
  const sliceMean = new Float64Array(slices);
  for (let i = 0; i < m; i++) if (Number.isFinite(dist[i])) sliceMean[sliceOf(dist[i])] += dist[i];
  for (let k = 0; k < slices; k++) sliceMean[k] = counts[k] ? sliceMean[k] / counts[k] : k > 0 ? sliceMean[k - 1] : 0;
  const along = new Float64Array(m);
  let alongMin = Infinity;
  let alongMax = 0;
  const offset = new THREE.Vector3();
  for (let i = 0; i < m; i++) {
    if (!Number.isFinite(dist[i])) continue;
    const k = sliceOf(dist[i]);
    along[i] = sliceMean[k] + offset.copy(where[i]).sub(centres[k]).dot(axes[k]);
    alongMin = Math.min(alongMin, along[i]);
  }
  for (let i = 0; i < m; i++) {
    along[i] = Number.isFinite(dist[i]) ? Math.max(along[i] - alongMin, 0) : 0;
    alongMax = Math.max(alongMax, along[i]);
  }
  length = alongMax;

  const around = new Float32Array(m);
  const radii: number[] = [];
  for (let i = 0; i < m; i++) {
    if (!Number.isFinite(dist[i])) continue;
    const k = sliceOf(dist[i]);
    const axis = axes[k];
    const u = refs[k];
    const w = new THREE.Vector3().crossVectors(axis, u);
    const r = where[i].clone().sub(centres[k]);
    r.addScaledVector(axis, -r.dot(axis));
    radii.push(r.length());
    around[i] = (Math.atan2(r.dot(w), r.dot(u)) / (Math.PI * 2) + 1) % 1;
  }
  // Smooth normals, straight out from the axis. The hoses ship flat-shaded — each face
  // its own normal — and water shaded by the angle to the eye then broke into facets
  // along the whole tube. The radial direction is what a round tube's normal is.
  // Measured in the rig's frame; the mesh's normals are in its own, so the direction is
  // carried back through the mesh-to-rig map (a normal goes by its transpose, which is
  // the inverse for the rotation and uniform scale this is).
  const origin = toLocal(new THREE.Vector3().applyMatrix4(mesh.matrixWorld));
  const basis = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((e) =>
    toLocal(e.applyMatrix4(mesh.matrixWorld)).sub(origin)
  );
  const smooth = new Float32Array(n * 3);
  const radial = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const j = node[i];
    if (!Number.isFinite(dist[j])) continue;
    const k = sliceOf(dist[j]);
    radial.copy(where[j]).sub(centres[k]);
    radial.addScaledVector(axes[k], -radial.dot(axes[k]));
    const x = radial.dot(basis[0]);
    const y = radial.dot(basis[1]);
    const z = radial.dot(basis[2]);
    const l = Math.hypot(x, y, z) || 1;
    smooth[i * 3] = x / l;
    smooth[i * 3 + 1] = y / l;
    smooth[i * 3 + 2] = z / l;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(smooth, 3));

  radii.sort((a, b) => a - b);
  const radius = radii[Math.floor(radii.length / 2)];

  const uv = new Float32Array(n * 2);
  const flow = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = node[i];
    uv[i * 2] = around[j];
    uv[i * 2 + 1] = along[j] / CONDUIT_REFERENCE_SPEED;
    // The water inside fills the bore — a little less than the tube's outer radius.
    flow[i * 3] = radius * 0.8;
    flow[i * 3 + 1] = WATER_SEGMENT.conduit;
    flow[i * 3 + 2] = 0;
  }
  geometry.setAttribute('aFlowUv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('aFlow', new THREE.BufferAttribute(flow, 3));
  return { length, radius };
}
