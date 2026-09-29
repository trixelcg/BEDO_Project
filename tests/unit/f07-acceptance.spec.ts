import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DEFLECTORS, MESH, WEIGHTS } from '../../src/domain/apparatus';
import { gltfName } from '../../src/lib/gltfNames';
import { CUSTOM_WEIGHT_MESH } from '../../src/lib/weightFamily';
import {
  DEFAULT_OUTLINE_STYLE,
  OUTLINE_STENCIL_REF,
  attachOutline,
  createOutlineLayer,
  outlineContrast,
  overlayTextureRetention,
  relativeLuminance,
} from '../../src/lib/selectionOutline';
import { assetPath } from '../helpers/glb';
import { loadApparatus } from '../helpers/model';

/**
 * F07 acceptance criteria — the selection highlight — asserted against the shipped model
 * with the outline attached exactly as `DeviceModel.setGlow` attaches it.
 *
 *   AC1  Original metal/texture remains visible while highlighted.
 *   AC2  The highlight is readable against dark and light materials.
 *   AC3  The highlight does not change the apparent geometry or material class.
 *
 * Pixels are measured in the browser (`docs/56`); what is asserted here is what makes those
 * measurements hold by construction.
 */

let model: THREE.Group;

/** Every part the learner can hover, plus the two drop targets a dragged deflector lights. */
const PARTS = () => [
  MESH.tankCover,
  MESH.powerSwitch,
  MESH.flowValve,
  MESH.volumetricValve,
  MESH.nozzle,
  MESH.tank,
  MESH.rod,
  ...DEFLECTORS.map((d) => d.shelf),
  ...WEIGHTS.map((w) => w.mesh!),
  CUSTOM_WEIGHT_MESH,
];

const part = (name: string) => {
  const o = model.getObjectByName(gltfName(name)) ?? model.getObjectByName(name);
  if (!o) throw new Error(`no ${name}`);
  return o;
};

const meshesOf = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) out.push(m);
  });
  return out;
};

const materialsOf = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material : [m.material]);

/** Everything about a part that would show if a highlight wrote to it. */
function fingerprint(o: THREE.Object3D): string {
  o.updateWorldMatrix(true, true);
  return JSON.stringify(
    meshesOf(o).map((m) => ({
      name: m.name,
      children: m.children.length,
      geometry: m.geometry.uuid,
      positions: m.geometry.getAttribute('position').array.length,
      visible: m.visible,
      world: m.matrixWorld.elements.map((e) => e.toFixed(9)),
      materials: materialsOf(m).map((mat) => {
        const s = mat as THREE.MeshPhysicalMaterial;
        return {
          uuid: mat.uuid,
          type: mat.type,
          version: mat.version,
          color: s.color?.getHexString(),
          emissive: s.emissive?.getHexString(),
          emissiveIntensity: s.emissiveIntensity,
          map: s.map?.uuid ?? null,
          metalness: s.metalness,
          roughness: s.roughness,
          opacity: mat.opacity,
          transparent: mat.transparent,
          depthWrite: mat.depthWrite,
          colorWrite: mat.colorWrite,
          stencilWrite: mat.stencilWrite,
          side: mat.side,
        };
      }),
    }))
  );
}

beforeAll(async () => {
  model = await loadApparatus();
});

describe('AC1 — the original material stays visible while highlighted', () => {
  it('nothing about any highlighted part is written: materials, maps, colours, children', () => {
    for (const name of PARTS()) {
      const target = part(name);
      const before = fingerprint(target);
      const layer = createOutlineLayer();
      const handle = attachOutline(layer, target);
      handle.setIntensity(1);
      handle.setIntensity(0.4);
      handle.setIntensity(1);
      expect(fingerprint(target), name).toBe(before);
      handle.dispose();
      expect(fingerprint(target), `${name} after dispose`).toBe(before);
      expect(layer.children.length, `${name}: dispose leaves nothing`).toBe(0);
    }
  });

  it('every outline colour is stencil-masked off the part; only the wash is drawn on it', () => {
    for (const name of PARTS()) {
      const target = part(name);
      const layer = createOutlineLayer();
      attachOutline(layer, target).setIntensity(1);
      const drawn = layer.children as THREE.Mesh[];
      const role = (m: THREE.Mesh) => m.userData.bedoHighlight as string;
      // Four meshes per source mesh: the wash, the mark, the keyline, the line.
      expect(drawn.length, name).toBe(meshesOf(target).length * 4);
      for (const m of drawn) {
        const mat = m.material as THREE.Material;
        if (role(m) === 'overlay') {
          // The wash: over the part's own visible surface, blended, never replacing it.
          expect(mat.transparent, name).toBe(true);
          expect(mat.depthFunc, name).toBe(THREE.LessEqualDepth);
          expect(mat.blending, name).toBe(THREE.NormalBlending);
          continue;
        }
        expect(mat.stencilWrite, name).toBe(true);
        expect(mat.stencilRef, name).toBe(OUTLINE_STENCIL_REF);
        if (role(m) === 'mark') {
          // The mark: the part's visible pixels, both sides, into the stencil only.
          expect(mat.colorWrite, name).toBe(false);
          expect(mat.stencilFunc, name).toBe(THREE.AlwaysStencilFunc);
          expect(mat.stencilZPass, name).toBe(THREE.ReplaceStencilOp);
          expect(mat.side, name).toBe(THREE.DoubleSide);
          expect(mat.depthTest, name).toBe(true);
        } else {
          // A hull: only where the part is not.
          expect(['keyline', 'line']).toContain(role(m));
          expect(mat.stencilFunc, name).toBe(THREE.NotEqualStencilFunc);
          expect(mat.stencilZPass, name).toBe(THREE.KeepStencilOp);
          expect(mat.side, name).toBe(THREE.BackSide);
        }
      }
      // The wash, then every mark, then every hull.
      const order = (r: string) => drawn.filter((m) => role(m) === r).map((m) => m.renderOrder);
      expect(Math.max(...order('overlay'))).toBeLessThan(Math.min(...order('mark')));
      expect(Math.max(...order('mark'))).toBeLessThan(
        Math.min(...order('keyline'), ...order('line'))
      );
    }
  });

  it('the wash is translucent enough that the part’s texture still reads through it', () => {
    const { overlayOpacity, overlayRimOpacity } = DEFAULT_OUTLINE_STYLE;
    // Face-on, where the texture is: at least 70 % of its contrast survives.
    expect(overlayTextureRetention(overlayOpacity)).toBeGreaterThanOrEqual(0.7);
    // Even at the silhouette, more than half of the surface still shows.
    expect(overlayTextureRetention(overlayRimOpacity)).toBeGreaterThan(0.5);
    // And the pulse fades the wash with everything else.
    const layer = createOutlineLayer();
    const handle = attachOutline(layer, part(WEIGHTS[2].mesh!));
    handle.setIntensity(0.5);
    for (const m of layer.children as THREE.Mesh[]) {
      if (m.userData.bedoHighlight !== 'overlay') continue;
      expect((m.material as THREE.ShaderMaterial).uniforms.uIntensity.value).toBe(0.5);
    }
  });

  it('nothing the outline adds writes depth — a highlighted glass tank stays see-through', () => {
    // The old depth-only pre-pass for blended parts made the tank opaque: highlighted as a
    // drop target, it hid the rod and water inside it (92 % of its pixels changed).
    for (const name of PARTS()) {
      const layer = createOutlineLayer();
      attachOutline(layer, part(name)).setIntensity(1);
      for (const m of layer.children as THREE.Mesh[]) {
        expect((m.material as THREE.Material).depthWrite, name).toBe(false);
      }
    }
  });

  it('the frame is rendered into targets that have a stencil buffer', () => {
    const post = readFileSync(assetPath('src/lib/labPostProcessing.ts'), 'utf8');
    expect(post).toMatch(/new THREE\.WebGLRenderTarget\(width, height, \{[^}]*stencilBuffer:\s*true[^}]*\}\)/);
    const canvas = readFileSync(assetPath('src/components/Scene3D.tsx'), 'utf8');
    expect(canvas).toMatch(/gl=\{\{[^}]*stencil:\s*true/);
  });

  it('the highlight path never clones or recolours a material', () => {
    const source = readFileSync(assetPath('src/components/DeviceModel.tsx'), 'utf8');
    const start = source.indexOf('const setGlow = useCallback(');
    const end = source.indexOf('const clearGlow', start);
    expect(start).toBeGreaterThan(0);
    const setGlow = source.slice(start, end);
    expect(setGlow).toMatch(/attachOutline\(/);
    expect(setGlow).not.toMatch(/emissive|\.clone\(|material\s*=|\.color\./);
  });
});

describe('AC2 — readable against dark and light materials', () => {
  it('against any background from black to white, one of the two tones contrasts ≥ 3 : 1', () => {
    let worst = Infinity;
    for (let l = 0; l <= 1.0000001; l += 0.001) worst = Math.min(worst, outlineContrast(l));
    // WCAG 2.x non-text contrast for a graphical object: 3 : 1.
    expect(worst).toBeGreaterThanOrEqual(3);
  });

  it('the light tone carries dark materials, the dark tone carries light ones', () => {
    const line = relativeLuminance(DEFAULT_OUTLINE_STYLE.color);
    const keyline = relativeLuminance(DEFAULT_OUTLINE_STYLE.keylineColor);
    expect(line).toBeGreaterThan(0.6);
    expect(keyline).toBeLessThan(0.02);
    // Black tray, and a white bench.
    expect((line + 0.05) / (0 + 0.05)).toBeGreaterThan(7);
    expect(outlineContrast(1)).toBeGreaterThan(4.5);
  });

  it('the old single gold line was not readable on mid and light greys', () => {
    // #ffc233 alone, as shipped: the reason AC2 needed a second tone.
    const gold = relativeLuminance('#ffc233');
    const ratio = (bg: number) => (Math.max(gold, bg) + 0.05) / (Math.min(gold, bg) + 0.05);
    expect(ratio(0.44)).toBeLessThan(1.5);
    expect(ratio(1)).toBeLessThan(2);
  });

  it('pale amber, not gold: less saturated than the old highlight', () => {
    const hsl = (c: THREE.ColorRepresentation) => new THREE.Color(c).getHSL({ h: 0, s: 0, l: 0 });
    const now = new THREE.Color(DEFAULT_OUTLINE_STYLE.color).convertLinearToSRGB();
    const old = new THREE.Color('#ffc233').convertLinearToSRGB();
    const chroma = (c: THREE.Color) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    expect(chroma(now)).toBeLessThan(chroma(old));
    expect(hsl(DEFAULT_OUTLINE_STYLE.color).l).toBeGreaterThan(hsl('#ffc233').l);
  });
});

describe('AC3 — geometry and material class unchanged', () => {
  it('the outline is drawn from the part’s own geometry, shared and unmodified', () => {
    for (const name of PARTS()) {
      const target = part(name);
      const sources = meshesOf(target);
      const before = sources.map((m) => {
        m.geometry.computeBoundingBox();
        return m.geometry.boundingBox!.clone();
      });
      const layer = createOutlineLayer();
      attachOutline(layer, target).setIntensity(1);
      const geometries = new Set(sources.map((m) => m.geometry));
      for (const m of layer.children as THREE.Mesh[]) expect(geometries.has(m.geometry), name).toBe(true);
      sources.forEach((m, i) => {
        m.geometry.computeBoundingBox();
        expect(m.geometry.boundingBox!.equals(before[i]), name).toBe(true);
      });
      // Outside the asset hierarchy: nothing that measures the part can see the outline.
      for (const m of layer.children) {
        let o: THREE.Object3D | null = m;
        while (o && o !== target) o = o.parent;
        expect(o, name).toBeNull();
      }
    }
  });

  it('a thin contour outside the silhouette, in screen pixels — not a shell around the part', () => {
    const { lineWidth, keylineWidth } = DEFAULT_OUTLINE_STYLE;
    expect(lineWidth).toBeLessThanOrEqual(3);
    expect(keylineWidth).toBeGreaterThan(lineWidth);
    expect(keylineWidth).toBeLessThanOrEqual(5);
    // Pixel widths whatever the distance, so it never scales up into a halo that hides the
    // part's outline shape.
    const shader = readFileSync(assetPath('src/lib/selectionOutline.ts'), 'utf8');
    expect(shader).toMatch(/uWidth \* 2\.0 \/ uResolution\) \* clipPos\.w/);
  });

  it('the outline cannot be picked, and casts or receives no shadow', () => {
    const layer = createOutlineLayer();
    attachOutline(layer, part(MESH.tankCover)).setIntensity(1);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
    for (const m of layer.children as THREE.Mesh[]) {
      const hits: THREE.Intersection[] = [];
      m.raycast(ray, hits);
      expect(hits.length).toBe(0);
      expect(m.castShadow).toBe(false);
      expect(m.receiveShadow).toBe(false);
    }
  });
});
