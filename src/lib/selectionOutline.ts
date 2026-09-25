// Edge-only selection and guidance highlight (BEDO-LOOK-04).
//
// ## What this replaces
//
// A part used to be highlighted by cloning its material and writing a gold `emissive`
// into the clone. That recolours the whole surface: a chrome weight under the cursor turned
// into a flat yellow disc, its texture, roughness and reflections drowned under the
// emissive term for as long as it was hovered or pulsing. The reference simulator uses
// Unity's Highlight Plus, whose default look is a thin coloured line on the silhouette with
// a soft glow just outside it, and the object itself untouched.
//
// ## How it is drawn
//
// An inverted hull. For every mesh of the highlighted part two extra meshes share its
// geometry and are drawn with only their back faces, each vertex pushed outward along its
// normal by a fixed number of *screen* pixels. Depth testing is on, so the hull is visible
// only in the band just outside the part's own silhouette and is hidden wherever another
// object stands in front — the outline follows the visible contour and respects occlusion.
// Two layers give the falloff: a thin opaque line and a wider, fainter glow.
//
// Parts whose materials are alpha-blended (the weights ship as `BLEND`, which the loader
// turns into `depthWrite: false`) write no depth of their own, and a hull behind such a part
// would show straight through it as a solid fill. Those parts get a third mesh: their own
// geometry drawn depth-only, before anything else, so the hull is occluded by the part
// exactly as if it were opaque.
//
// The hulls are not children of the GLB nodes. They live in a group of their own and copy
// the source mesh's world matrix each frame in `onBeforeRender`, which runs before the
// renderer builds the model-view matrix. Keeping them out of the asset hierarchy means
// every traversal that measures, clones or reclassifies the model never sees them.
//
// ## Cost
//
// Two draw calls per highlighted mesh (three for a blended one), no extra render pass, no
// framebuffer, no post-processing. The part's own material is never touched — there is no
// clone to make, no property to restore, and nothing to leak to other meshes that share
// the same material.

import * as THREE from 'three';

export interface OutlineStyle {
  color: THREE.ColorRepresentation;
  /** Width of the crisp line, in CSS pixels. */
  lineWidth: number;
  /** Width of the soft glow outside the line, in CSS pixels. */
  glowWidth: number;
  /** Opacity of the glow layer at full intensity; the line is drawn at 1.0. */
  glowOpacity: number;
}

export const DEFAULT_OUTLINE_STYLE: OutlineStyle = {
  color: '#ffc233',
  // A 2.5 px contour reads at learner distance now that the outline only appears under
  // the pointer (BEDO-UX-ENV). The glow stays narrow: the hull's inner wall is pushed into
  // a weight's ~14 px centre bore by the glow width, so a wider glow would fill the hole.
  lineWidth: 2.5,
  glowWidth: 4.0,
  glowOpacity: 0.3,
};

/** Drawn after every transparent object so the glow composites over water and glass. */
const OUTLINE_RENDER_ORDER = 1000;

const VERTEX = /* glsl */ `
  uniform float uWidth;
  uniform vec2 uResolution;
  void main() {
    vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 clipNormal = projectionMatrix * modelViewMatrix * vec4(normal, 0.0);
    vec2 n = clipNormal.xy;
    float len = length(n);
    n = len > 1e-5 ? n / len : vec2(0.0);
    // A fixed pixel width whatever the distance: scale by w so the perspective divide
    // brings it back to uWidth device pixels.
    clipPos.xy += n * (uWidth * 2.0 / uResolution) * clipPos.w;
    gl_Position = clipPos;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
    #include <colorspace_fragment>
  }
`;

function hullMaterial(color: THREE.ColorRepresentation, width: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uWidth: { value: width },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
}

/** Depth only: makes a blended part occlude its own hull. */
function depthOnlyMaterial(side: THREE.Side): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side });
}

function writesNoDepth(material: THREE.Material | THREE.Material[]): boolean {
  return (Array.isArray(material) ? material : [material]).some((m) => m && !m.depthWrite);
}

function isShown(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** One highlighted part: every hull mesh built for it, and the source each follows. */
export interface OutlineHandle {
  /** 0 hides the outline, 1 is full strength; the guidance pulse runs between. */
  setIntensity(intensity: number): void;
  dispose(): void;
}

/**
 * Where the hulls live. One per scene; add it anywhere in the graph — hull world
 * matrices are copied from their sources, never derived from this group's transform.
 */
export function createOutlineLayer(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bedoSelectionOutlines';
  group.matrixWorldAutoUpdate = false;
  return group;
}

export function attachOutline(
  layer: THREE.Group,
  target: THREE.Object3D,
  style: OutlineStyle = DEFAULT_OUTLINE_STYLE
): OutlineHandle {
  const size = new THREE.Vector2();
  const hulls: { mesh: THREE.Mesh; source: THREE.Mesh; opacity: number | null }[] = [];

  const follow = (hull: THREE.Mesh, source: THREE.Mesh, material: THREE.ShaderMaterial | null) => {
    hull.matrixAutoUpdate = false;
    hull.matrixWorldAutoUpdate = false;
    hull.frustumCulled = false;
    hull.castShadow = false;
    hull.receiveShadow = false;
    // Never a pointer target: the part's own hit proxy stays the only thing that is.
    hull.raycast = () => {};
    hull.onBeforeRender = (renderer) => {
      hull.matrixWorld.copy(source.matrixWorld);
      if (material) {
        // Widths are in CSS pixels, so a Retina display and a 1x monitor draw the same
        // line: the buffer size is divided by the pixel ratio before it scales the offset.
        renderer.getDrawingBufferSize(size).divideScalar(renderer.getPixelRatio());
        (material.uniforms.uResolution.value as THREE.Vector2).copy(size);
      }
    };
    layer.add(hull);
  };

  target.traverse((object) => {
    const source = object as THREE.Mesh;
    if (!source.isMesh || !source.geometry) return;

    if (writesNoDepth(source.material)) {
      const side = (Array.isArray(source.material) ? source.material[0] : source.material).side;
      const depth = new THREE.Mesh(source.geometry, depthOnlyMaterial(side));
      depth.renderOrder = -1;
      follow(depth, source, null);
      hulls.push({ mesh: depth, source, opacity: null });
    }

    const glow = new THREE.Mesh(source.geometry, hullMaterial(style.color, style.glowWidth));
    glow.renderOrder = OUTLINE_RENDER_ORDER;
    follow(glow, source, glow.material as THREE.ShaderMaterial);
    hulls.push({ mesh: glow, source, opacity: style.glowOpacity });

    const line = new THREE.Mesh(source.geometry, hullMaterial(style.color, style.lineWidth));
    line.renderOrder = OUTLINE_RENDER_ORDER + 1;
    follow(line, source, line.material as THREE.ShaderMaterial);
    hulls.push({ mesh: line, source, opacity: 1 });
  });

  return {
    setIntensity(intensity) {
      const k = THREE.MathUtils.clamp(intensity, 0, 1);
      for (const { mesh, source, opacity } of hulls) {
        mesh.visible = k > 0 && isShown(source);
        if (opacity !== null) {
          (mesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = opacity * k;
        }
      }
    },
    dispose() {
      for (const { mesh } of hulls) {
        layer.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
      hulls.length = 0;
    },
  };
}
