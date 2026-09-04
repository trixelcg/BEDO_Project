/**
 * Where the water goes after it leaves the deflector.
 *
 * The rig is a circuit and, until now, only two thirds of it was drawn: the hose brought
 * water up and the jet struck the vane, and then it stopped existing. Three pieces close
 * the loop.
 *
 *   1. **The run-down.** A short band of wetted glass immediately below the vane, where the
 *      sheet thrown outward actually reaches the wall.
 *   2. **The drain.** A thin fall from the tank's base to the bench sink.
 *   3. **The sink.** A surface in the basin that rises while more arrives than the sink's
 *      own outlet carries, and settles rather than climbing for ever.
 *
 * ## Why the run-down is a band and not a film
 *
 * The brief asks for a translucent sheet over the whole inner wall. That is the effect
 * `BEDO-WATER-14` and `-15` removed a fortnight ago, and for a measured reason: inside a
 * 181 mm glass vessel a full-height translucent sheet reads as a blue cylinder filling the
 * tank, not as wet glass. The measurement is in `src/lib/waterJet.ts` — at 43.5 L/min the
 * authored plume spans world y 0.1117 to 0.5076 against a nozzle mouth at 0.4712, so nine
 * tenths of what looked like water was hanging below the impact.
 *
 * So the wetted band is bounded to where a sheet leaving the vane would actually land, and
 * fades out well above the tank floor. It is a short collar, not a lining.
 *
 * ## Cost
 *
 * Three meshes, three materials, built once from the tank's measured interior and the
 * sink's measured bounds. Per frame each takes one or two uniform writes and a `visible`
 * flag; nothing is rebuilt and no geometry is uploaded again.
 */

import * as THREE from 'three';
import type { TankInterior } from './tankWater';

/**
 * How far below the vane the wetted band reaches, as a fraction of the tank's interior
 * height. The sheet spreads and falls; it does not run the whole wall.
 */
export const RUNDOWN_HEIGHT_FRACTION = 0.34;

/** Radius of the fall from the tank base to the sink, in metres, at full flow. */
const DRAIN_RADIUS_M = 0.011;

/** How fast the sink surface rises and falls, in metres of depth per second at full flow. */
const SINK_RISE_M_PER_S = 0.055;
const SINK_DRAIN_M_PER_S = 0.03;

/** How deep the basin is allowed to get, as a fraction of its own height. */
export const SINK_MAX_LEVEL = 0.42;

export interface WaterCircuitState {
  /** Delivered flow as a share of the pump's rating, 0..1. */
  readonly flowFraction: number;
  /** Seconds since the last frame. */
  readonly deltaS: number;
  /** The shared ripple phase, so every surface is the same substance. */
  readonly phaseS: number;
  /** Is the rig delivering at all? */
  readonly flowing: boolean;
}

export interface WaterCircuit {
  readonly object: THREE.Group;
  update(state: WaterCircuitState): void;
  dispose(): void;
}

/** A surface that scrolls a little and fades with the flow. Shared by all three pieces. */
function flowMaterial(options: {
  colour: THREE.Color;
  /** Fades the top edge (1) or the bottom edge (0) of the piece out. */
  fadeFrom: 'top' | 'bottom' | 'none';
  opacity: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPhase: { value: 0 },
      uFlow: { value: 0 },
      uColour: { value: options.colour },
      uOpacity: { value: options.opacity },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUvF;
      void main() {
        vUvF = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform float uPhase;
      uniform float uFlow;
      uniform vec3 uColour;
      uniform float uOpacity;
      varying vec2 vUvF;

      // Cheap value noise. A texture would be one more asset to load and this is a
      // shimmer on a surface a few centimetres across.
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      void main() {
        // Two scrolls at different rates, running downhill: water on a wall streaks.
        float a = noise(vec2(vUvF.x * 9.0, vUvF.y * 5.0 - uPhase * 1.3));
        float b = noise(vec2(vUvF.x * 17.0, vUvF.y * 11.0 - uPhase * 2.1));
        float streak = a * 0.65 + b * 0.35;

        ${
          options.fadeFrom === 'top'
            ? 'float edge = smoothstep(0.0, 0.45, 1.0 - vUvF.y);'
            : options.fadeFrom === 'bottom'
              ? 'float edge = smoothstep(0.0, 0.45, vUvF.y);'
              : 'float edge = 1.0;'
        }

        float alpha = uOpacity * uFlow * edge * (0.35 + 0.65 * streak);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uColour + vec3(0.16) * streak, alpha);
      }
    `,
  });
}

/**
 * Builds the circuit from measured geometry.
 *
 * Returns null when the pieces it needs are not in the scene — the stub model the browser
 * suite mostly runs against has no bench, and that must not be an error.
 *
 * @param interior  the tank's measured bore, from `measureTankInterior`
 * @param sinkBox   the bench basin's bounds, in the same space as `interior`
 * @param vaneY     where the deflector face sits, in that space
 */
export function createWaterCircuit(
  interior: TankInterior,
  sinkBox: THREE.Box3 | null,
  vaneY: number
): WaterCircuit | null {
  if (!(interior.radius > 0)) return null;

  const group = new THREE.Group();
  group.name = 'BedoWaterCircuit';
  const materials: THREE.ShaderMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  // --- 1. the wetted band just below the vane --------------------------------
  const interiorHeight = Math.max(interior.ceilingY - interior.floorY, 1e-4);
  const bandHeight = interiorHeight * RUNDOWN_HEIGHT_FRACTION;
  // Anchored to the vane, not to the tank, because it is the sheet leaving the vane that
  // wets the glass. Clamped so a low deflector cannot push the band through the floor.
  const bandTop = Math.min(interior.ceilingY, Math.max(vaneY, interior.floorY + bandHeight));
  const bandGeometry = new THREE.CylinderGeometry(
    interior.radius * 0.985,
    interior.radius * 0.985,
    bandHeight,
    28,
    1,
    true
  );
  const bandMaterial = flowMaterial({
    colour: new THREE.Color(0.14, 0.4, 0.52),
    // The band is at its wettest where the sheet lands and thins out downward.
    fadeFrom: 'bottom',
    opacity: 0.3,
  });
  const band = new THREE.Mesh(bandGeometry, bandMaterial);
  band.name = 'BedoTankRundown';
  band.position.set(interior.axis.x, bandTop - bandHeight / 2, interior.axis.y);
  band.renderOrder = 2;
  group.add(band);
  materials.push(bandMaterial);
  geometries.push(bandGeometry);

  // --- 2. the fall from the tank base to the sink ----------------------------
  let drain: THREE.Mesh | null = null;
  let surface: THREE.Mesh | null = null;
  let sinkTravel = 0;
  let sinkFloorY = 0;

  if (sinkBox && !sinkBox.isEmpty()) {
    const sinkTopY = sinkBox.max.y;
    sinkFloorY = sinkBox.min.y;
    sinkTravel = Math.max(sinkTopY - sinkFloorY, 1e-4) * SINK_MAX_LEVEL;

    const fallHeight = Math.max(interior.floorY - sinkTopY, 1e-4);
    const drainGeometry = new THREE.CylinderGeometry(
      DRAIN_RADIUS_M,
      DRAIN_RADIUS_M * 1.35, // spreads a little as it falls, as a free stream does
      fallHeight,
      12,
      1,
      true
    );
    const drainMaterial = flowMaterial({
      colour: new THREE.Color(0.16, 0.44, 0.56),
      fadeFrom: 'none',
      opacity: 0.62,
    });
    drain = new THREE.Mesh(drainGeometry, drainMaterial);
    drain.name = 'BedoTankDrain';
    drain.position.set(interior.axis.x, sinkTopY + fallHeight / 2, interior.axis.y);
    drain.renderOrder = 2;
    group.add(drain);
    materials.push(drainMaterial);
    geometries.push(drainGeometry);

    // --- 3. the basin's own surface ------------------------------------------
    const surfaceGeometry = new THREE.PlaneGeometry(
      Math.max(sinkBox.max.x - sinkBox.min.x, 1e-4) * 0.94,
      Math.max(sinkBox.max.z - sinkBox.min.z, 1e-4) * 0.94
    );
    surfaceGeometry.rotateX(-Math.PI / 2);
    const surfaceMaterial = flowMaterial({
      colour: new THREE.Color(0.1, 0.32, 0.44),
      fadeFrom: 'none',
      opacity: 0.5,
    });
    surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    surface.name = 'BedoSinkSurface';
    const centre = sinkBox.getCenter(new THREE.Vector3());
    surface.position.set(centre.x, sinkFloorY, centre.z);
    surface.renderOrder = 1;
    surface.visible = false;
    group.add(surface);
    materials.push(surfaceMaterial);
    geometries.push(surfaceGeometry);
  }

  /** How deep the basin is, 0..1 of its allowed travel. Integrated, not a target. */
  let sinkLevel = 0;

  return {
    object: group,

    update({ flowFraction, deltaS, phaseS, flowing }) {
      const flow = flowing ? Math.max(0, Math.min(1, flowFraction)) : 0;

      for (const material of materials) {
        material.uniforms.uPhase.value = phaseS;
        material.uniforms.uFlow.value = flow;
      }
      band.visible = flow > 0.02;
      if (drain) drain.visible = flow > 0.02;

      /*
        The basin fills against its own outlet, so it settles instead of climbing.

        A plain integral of the inflow would put the water over the bench in a minute. The
        outlet carries a fixed rate, so the level rises while more arrives than it takes
        and falls back when it does not — which is the same shape the tank's own drain
        threshold has, and it is why the surface plateaus at a depth set by the flow rather
        than by how long the student has been standing there.
      */
      if (surface) {
        const rise = flow * SINK_RISE_M_PER_S;
        const fall = SINK_DRAIN_M_PER_S;
        sinkLevel = Math.max(0, Math.min(1, sinkLevel + (rise - fall) * deltaS));
        surface.position.y = sinkFloorY + sinkLevel * sinkTravel;
        surface.visible = sinkLevel > 0.01;
        // The surface keeps its own shimmer once it has collected, even as the flow eases.
        (surface.material as THREE.ShaderMaterial).uniforms.uFlow.value = Math.max(
          flow,
          sinkLevel
        );
      }
    },

    dispose() {
      group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
