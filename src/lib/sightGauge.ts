/**
 * The water column in the bench's graduated sight gauge.
 *
 * ## Why a clone of the window, and not a new plane
 *
 * The same reasoning as `boardReadout.ts`: the gauge window (`Rectangle003`) is a
 * zero-thickness plate authored in the bench's own space, and cloning its geometry gives a
 * column that inherits the plate's transform exactly. A plane built here would need its
 * position, rotation and size derived from somewhere, and every one of those is a chance to
 * be a centimetre out under a camera that can move.
 *
 * The clone is added as a child of the plate, so it rides the same matrix. Nothing is
 * projected per frame and nothing is fitted by eye.
 *
 * ## How the level is drawn
 *
 * A fragment shader discards everything above the water line, with the line expressed in
 * the plate's **own local Y** — measured from the cloned geometry's bounding box when the
 * column is attached. Local rather than world, so a plate that turns out to be rotated
 * still fills from its own bottom edge rather than from the room's.
 *
 * Scaling the mesh instead would have been simpler and wrong: a plate whose origin is not
 * on its bottom edge grows in both directions, and none of the authored geometry in this
 * model can be assumed to have a convenient origin.
 *
 * ## Cost
 *
 * One quad, one material, one uniform written per frame. No texture, no second render pass,
 * and the mesh is hidden outright at zero fill so an empty gauge draws nothing at all.
 */

import * as THREE from 'three';

/** Water in a narrow glass column reads darker and more saturated than the tank body. */
const WATER_COLOUR = new THREE.Color(0.06, 0.42, 0.62);

export interface SightGaugeColumn {
  /** Set the level, 0 at the bottom graduation and 1 at the top. */
  setFill(fraction: number): void;
  dispose(): void;
}

/**
 * Attaches a water column to the gauge window, or returns null when it is not in the scene.
 *
 * Null rather than throwing: most of the browser suite runs against a stub model with no
 * bench in it, and a missing gauge must not be an error there.
 */
export function attachSightGauge(window: THREE.Object3D | undefined): SightGaugeColumn | null {
  const plate = window as THREE.Mesh | undefined;
  if (!plate?.isMesh || !plate.geometry) return null;

  const geometry = plate.geometry.clone();
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) {
    geometry.dispose();
    return null;
  }

  const fill = { value: 0 };
  const span = { value: new THREE.Vector2(bounds.min.y, bounds.max.y) };

  const material = new THREE.MeshBasicMaterial({
    color: WATER_COLOUR,
    transparent: true,
    opacity: 0.86,
    // The plate is a flat billboard and may be seen from either face.
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFill = fill;
    shader.uniforms.uSpan = span;
    shader.vertexShader = `varying float vGaugeY;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vGaugeY = position.y;`
    );
    shader.fragmentShader = `uniform float uFill;\nuniform vec2 uSpan;\nvarying float vGaugeY;\n${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float surface = mix(uSpan.x, uSpan.y, uFill);
       if (vGaugeY > surface) discard;
       // A brighter band at the meniscus, so the level reads as a surface rather than as
       // the top of a coloured rectangle.
       float toSurface = clamp((surface - vGaugeY) / max(uSpan.y - uSpan.x, 1e-5), 0.0, 1.0);
       gl_FragColor.rgb += vec3(0.35, 0.45, 0.5) * smoothstep(0.03, 0.0, toSurface);`
    );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'BedoSightGaugeColumn';
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  mesh.visible = false;
  // Lifted off the plate along its own normal so it cannot z-fight the printed scale.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -4;
  material.polygonOffsetUnits = -4;
  plate.add(mesh);

  return {
    setFill(fraction) {
      const next = Math.max(0, Math.min(1, fraction));
      fill.value = next;
      // An empty gauge draws nothing rather than a fully discarded quad.
      mesh.visible = next > 0.001;
    },
    dispose() {
      plate.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
