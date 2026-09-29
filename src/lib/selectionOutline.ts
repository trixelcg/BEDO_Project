// Selection and guidance highlight: a translucent wash and an outline (BEDO-LOOK-04, F07).
//
// ## What this replaces
//
// A part used to be highlighted by cloning its material and writing a gold `emissive`
// into the clone. That recolours the whole surface: a chrome weight under the cursor turned
// into a flat yellow disc, its texture, roughness and reflections drowned under the
// emissive term for as long as it was hovered or pulsing. The reference simulator uses
// Unity's Highlight Plus, whose default look is a thin coloured line on the silhouette,
// and the object itself untouched.
//
// ## How it is drawn
//
// An inverted hull, masked by the part itself. For every mesh of the highlighted part:
//
//   1. **Mark** — the part's own geometry, both sides, drawn after everything opaque with
//      colour and depth writes off. Where the part is visible (depth test on) it writes
//      `OUTLINE_STENCIL_REF` into the stencil buffer, and nothing else.
//   2. **Keyline**, then **line** — two back-face hulls sharing the geometry, each vertex
//      pushed outward along its normal by a fixed number of *screen* pixels. Depth tested,
//      so a hull is hidden wherever another object stands in front; stencil tested
//      (`NotEqual`), so a hull can never draw on a pixel of the part.
//
// The stencil is what keeps the material visible (F07-AC01). Without it the hull covered
// the part wherever the part does not hide its own back faces:
//
//   * open or concave parts — the deflectors' cups and cones, the bore of a weight — showed
//     the hull on their inner faces (11–22 % of a tray deflector's own pixels changed);
//   * see-through parts had to be given a depth-only pre-pass to hide the hull behind them,
//     and that pre-pass made them opaque to everything: the tank, highlighted as a drop
//     target, turned solid and hid the rod and the water inside it (92 % of its pixels).
//
// With the mask there is no pre-pass and no special case: the part occludes its own
// outline exactly, glass included, and nothing about the part is written to at all.
//
// ## Two tones
//
// A single light line vanishes on the white bench and cover; a single dark line vanishes
// on the black tray. The outline is a pale amber line with a thin dark keyline outside it:
// whatever the luminance behind the part, one of the two contrasts with it by at least
// 3 : 1 (`outlineContrast`, WCAG's non-text threshold) — the old gold line managed 1.4 : 1
// on a mid grey.
//
// ## The wash
//
// Over the part itself, a translucent warm colour (product-owner direction, 2026-09-28):
// the part's own geometry drawn once more on top of itself, blended at 28 % face-on and
// 45 % at the silhouette. It is laid *over* the material, never in place of it — the steel,
// the engraving and the shading all show through, which is the difference from the deployed
// build's gold `emissive`, which replaced the surface outright (QA IMG11).
//
// ## Cost
//
// Four draw calls per highlighted mesh, no extra render pass, no framebuffer, no
// post-processing. The target the scene is rendered into needs a stencil buffer
// (`labPostProcessing.ts`, and `stencil: true` on the canvas). The part's own material is
// never touched — no clone, no property to restore, nothing to leak to other meshes that
// share it.
//
// The hulls are not children of the GLB nodes. They live in a group of their own and copy
// the source mesh's world matrix each frame in `onBeforeRender`, which runs before the
// renderer builds the model-view matrix. Keeping them out of the asset hierarchy means
// every traversal that measures, clones or reclassifies the model never sees them.

import * as THREE from 'three';

export interface OutlineStyle {
  /** The line itself: light, so it reads on dark materials. */
  color: THREE.ColorRepresentation;
  /** Width of the line, in CSS pixels. */
  lineWidth: number;
  /** The keyline just outside it: dark, so the outline reads on light materials. */
  keylineColor: THREE.ColorRepresentation;
  /** Outer width of the keyline, in CSS pixels; the band shown is `keylineWidth − lineWidth`. */
  keylineWidth: number;
  /** Keyline opacity at full intensity; the line is drawn at 1.0. */
  keylineOpacity: number;
  /** The colour laid over the part itself, translucent so its material shows through. */
  overlayColor: THREE.ColorRepresentation;
  /** Overlay opacity where the surface faces the eye. */
  overlayOpacity: number;
  /** Overlay opacity at the part's silhouette, where the surface turns away: a soft rim. */
  overlayRimOpacity: number;
}

export const DEFAULT_OUTLINE_STYLE: OutlineStyle = {
  // A pale warm amber, not gold: it names the part without tinting the eye towards brass.
  color: '#ffe2a0',
  // A 2.5 px contour reads at learner distance now that the outline only appears under
  // the pointer (BEDO-UX-ENV).
  lineWidth: 2.5,
  keylineColor: '#140e04',
  // 2 px of keyline outside the line. Narrow on purpose: the hull's inner wall is pushed
  // into a weight's ~14 px centre bore by this width.
  keylineWidth: 4.5,
  keylineOpacity: 0.9,
  // A warm wash over the part (product-owner direction, 2026-09-28): the colour says
  // "this one", and at 28 % the steel, its engraving and its shading still read through —
  // 72 % of the texture's contrast survives face-on. Firmer towards the silhouette, where
  // there is little texture to hide and a lit edge reads as a highlight, not as paint.
  overlayColor: '#ffd27a',
  overlayOpacity: 0.28,
  overlayRimOpacity: 0.45,
};

/** How much of a highlighted surface's own texture contrast survives the overlay. */
export const overlayTextureRetention = (opacity: number): number => 1 - opacity;

/** Drawn after every transparent object so the outline composites over water and glass. */
export const OUTLINE_RENDER_ORDER = 1000;

/** The stencil value a highlighted part writes where it is visible. */
export const OUTLINE_STENCIL_REF = 1;

/** Relative luminance of a colour, in linear working space. */
export function relativeLuminance(color: THREE.ColorRepresentation): number {
  const c = new THREE.Color(color);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

const contrastRatio = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * How well the outline stands out against a background of the given relative luminance
 * (0 black … 1 white): the better of the line's and the keyline band's contrast with it,
 * each composited over that background as the renderer blends it. Linear working space,
 * before the output transform — which is monotonic, so it preserves which of the two
 * layers wins.
 */
export function outlineContrast(
  backgroundLuminance: number,
  style: OutlineStyle = DEFAULT_OUTLINE_STYLE
): number {
  const bg = THREE.MathUtils.clamp(backgroundLuminance, 0, 1);
  const line = relativeLuminance(style.color);
  const keyline =
    bg * (1 - style.keylineOpacity) + relativeLuminance(style.keylineColor) * style.keylineOpacity;
  return Math.max(contrastRatio(line, bg), contrastRatio(keyline, bg));
}

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

const MARK_VERTEX = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MARK_FRAGMENT = /* glsl */ `
  void main() {
    gl_FragColor = vec4(0.0);
  }
`;

/** A hull layer: drawn only off the part (stencil ≠ ref), behind whatever stands in front. */
export function hullMaterial(color: THREE.ColorRepresentation, width: number): THREE.ShaderMaterial {
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
    stencilWrite: true,
    stencilRef: OUTLINE_STENCIL_REF,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
  });
}

const OVERLAY_VERTEX = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewV;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewV = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const OVERLAY_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uRimOpacity;
  uniform float uIntensity;
  varying vec3 vNormalV;
  varying vec3 vViewV;
  void main() {
    float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
    float rim = pow(1.0 - facing, 2.0);
    gl_FragColor = vec4(uColor, mix(uOpacity, uRimOpacity, rim) * uIntensity);
    #include <colorspace_fragment>
  }
`;

/**
 * The translucent colour over the part: its own geometry, drawn again on top of itself
 * (depth-equal, pulled a hair towards the eye so it never z-fights), blended — never a
 * replacement. The part's material, texture and shading stay underneath, visible through it.
 */
export function overlayMaterial(style: OutlineStyle, side: THREE.Side): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(style.overlayColor) },
      uOpacity: { value: style.overlayOpacity },
      uRimOpacity: { value: style.overlayRimOpacity },
      uIntensity: { value: 1 },
    },
    vertexShader: OVERLAY_VERTEX,
    fragmentShader: OVERLAY_FRAGMENT,
    side,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    toneMapped: false,
  });
}

/**
 * The part's visible pixels, into the stencil only.
 *
 * A `ShaderMaterial` on purpose: the ambient-occlusion pre-pass hides shader materials
 * (`labPostProcessing.ts`), so the mark never becomes an occluder there. Both sides, so an
 * open part's inner faces are part of it; no depth write, so it hides nothing.
 */
export function markMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: MARK_VERTEX,
    fragmentShader: MARK_FRAGMENT,
    side: THREE.DoubleSide,
    transparent: true,
    colorWrite: false,
    depthWrite: false,
    depthTest: true,
    stencilWrite: true,
    stencilRef: OUTLINE_STENCIL_REF,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });
}

function isShown(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** One highlighted part: every mesh built for it, and the source each follows. */
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

    const sourceSide = (Array.isArray(source.material) ? source.material[0] : source.material)?.side;
    const overlay = new THREE.Mesh(
      source.geometry,
      overlayMaterial(style, sourceSide === THREE.FrontSide ? THREE.FrontSide : THREE.DoubleSide)
    );
    overlay.renderOrder = OUTLINE_RENDER_ORDER - 2;
    overlay.userData.bedoHighlight = 'overlay';
    follow(overlay, source, null);
    hulls.push({ mesh: overlay, source, opacity: null });

    const mark = new THREE.Mesh(source.geometry, markMaterial());
    mark.renderOrder = OUTLINE_RENDER_ORDER - 1;
    mark.userData.bedoHighlight = 'mark';
    follow(mark, source, null);
    hulls.push({ mesh: mark, source, opacity: null });

    const keyline = new THREE.Mesh(
      source.geometry,
      hullMaterial(style.keylineColor, style.keylineWidth)
    );
    keyline.renderOrder = OUTLINE_RENDER_ORDER;
    keyline.userData.bedoHighlight = 'keyline';
    follow(keyline, source, keyline.material as THREE.ShaderMaterial);
    hulls.push({ mesh: keyline, source, opacity: style.keylineOpacity });

    const line = new THREE.Mesh(source.geometry, hullMaterial(style.color, style.lineWidth));
    line.renderOrder = OUTLINE_RENDER_ORDER + 1;
    line.userData.bedoHighlight = 'line';
    follow(line, source, line.material as THREE.ShaderMaterial);
    hulls.push({ mesh: line, source, opacity: 1 });
  });

  return {
    setIntensity(intensity) {
      const k = THREE.MathUtils.clamp(intensity, 0, 1);
      for (const { mesh, source, opacity } of hulls) {
        mesh.visible = k > 0 && isShown(source);
        const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
        if (opacity !== null) uniforms.uOpacity.value = opacity * k;
        else if (uniforms?.uIntensity) uniforms.uIntensity.value = k;
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
