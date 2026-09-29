import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFLECTORS, MESH, WEIGHTS } from '../../src/domain/apparatus';
import { FIRST_READING_VALVE, SECOND_READING_VALVE, targetMassG } from '../../src/domain/physics';
import { gltfName } from '../../src/lib/gltfNames';
import { SEATING_CLEARANCE, measureHolderAnchor, type HolderAnchor } from '../../src/lib/holderAnchor';
import {
  BORE_DIAMETER_MM,
  CUSTOM_WEIGHT_MESH,
  FACE_GROUP,
  HANDLE_CLEARANCE_MM,
  LABEL_UP,
  STEEL_DENSITY_G_PER_CM3,
  TRAY_HANDLES,
  TRAY_ROW,
  applyWeightFamily,
  drawWeightFace,
  labelText,
  weightDimensions,
  type WeightFamily,
} from '../../src/lib/weightFamily';
import { ANCHOR_VIEW, FRONT } from '../../src/lib/apparatusView';
import { DEFAULT_CUSTOM_WEIGHT_G, loadApparatus, mountApparatus } from '../helpers/model';

/**
 * F04 acceptance criteria, asserted against the shipped model with the weight family on it —
 * exactly what `DeviceModel` renders (`tests/helpers/model.ts` applies it, as the app does).
 *
 *   AC1  10, 20, 25, 50, 100, 200 and 500 g have a coherent progression.
 *   AC2  The label remains legible at normal inspection distance.
 *   AC3  The mass hierarchy is understandable without reading every label.
 *
 * Every size is measured off the disc the scene would draw: the tray nodes for the fixed
 * denominations, and for 25 g — the custom control's starting mass — the custom disc.
 */

let model: THREE.Group;
let apparatus: THREE.Group;
let family: WeightFamily;
let anchor: HolderAnchor;

/**
 * The denominations on the tray. QA's list also names 25 g — that is the custom weight's
 * starting setting, not a denomination, and the custom weight is checked on its own below.
 */
const REVIEWED = [10, 20, 50, 100, 200, 500];

interface Measured {
  grams: number;
  diameterMm: number;
  thicknessMm: number;
  /** Swept steel volume, from the measured outline and the bore. */
  volumeMm3: number;
  centre: THREE.Vector3;
}

const measure = (object: THREE.Object3D, grams: number): Measured => {
  const clone = object.clone(true);
  clone.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(clone, true);
  const size = box.getSize(new THREE.Vector3());
  const diameterMm = Math.max(size.x, size.z) * 1000;
  const thicknessMm = size.y * 1000;
  return {
    grams,
    diameterMm,
    thicknessMm,
    volumeMm3: (Math.PI / 4) * (diameterMm ** 2 - BORE_DIAMETER_MM ** 2) * thicknessMm,
    centre: box.getCenter(new THREE.Vector3()),
  };
};

const discOf = (grams: number) => measure(family.discFor(grams), grams);

/** The viewport the browser checks ran at. */
const VIEWPORT = { width: 1920, height: 889 };

/**
 * The camera the lesson frames the weights with, rebuilt the way the app builds it: the
 * `weights` anchor is the centre of the tray discs and the pointer (`DeviceModel`), the
 * camera stands at anchor + `ANCHOR_VIEW.weights.offset` and looks at the anchor
 * (`Scene3D`'s CameraRig), with the scene's 42° lens.
 */
const lessonCamera = (): THREE.PerspectiveCamera => {
  const box = new THREE.Box3();
  for (const name of [...TRAY_ROW.map((w) => w.mesh), MESH.pointer]) {
    box.expandByObject(model.getObjectByName(gltfName(name))!);
  }
  const anchor = apparatus.worldToLocal(box.getCenter(new THREE.Vector3()));
  const camera = new THREE.PerspectiveCamera(42, VIEWPORT.width / VIEWPORT.height, 0.05, 60);
  const [ox, oy, oz] = ANCHOR_VIEW.weights.offset;
  camera.position.copy(apparatus.localToWorld(anchor.clone().add(new THREE.Vector3(ox, oy, oz))));
  camera.lookAt(apparatus.localToWorld(anchor.clone()));
  camera.updateMatrixWorld(true);
  return camera;
};

/** On-screen distance, in CSS pixels, between two apparatus-local points. */
const screenPx = (camera: THREE.Camera, a: THREE.Vector3, b: THREE.Vector3): number => {
  const pa = apparatus.localToWorld(a.clone()).project(camera);
  const pb = apparatus.localToWorld(b.clone()).project(camera);
  return Math.hypot(((pa.x - pb.x) / 2) * VIEWPORT.width, ((pa.y - pb.y) / 2) * VIEWPORT.height);
};

/**
 * A drawing context that measures type the way a browser does for bold Arial — the face
 * the label asks for — so the layout can be checked here, without a canvas.
 */
const arialBold = () => {
  const advance: Record<string, number> = { g: 0.611, '.': 0.278, ' ': 0.278 };
  for (const digit of '0123456789') advance[digit] = 0.556;
  let px = 10;
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, key) => {
      if (key === 'measureText') {
        return (text: string) => ({
          width: [...text].reduce((w, c) => w + (advance[c] ?? 0.6), 0) * px,
          actualBoundingBoxAscent: 0.716 * px,
          actualBoundingBoxDescent: 0.21 * px,
        });
      }
      return () => {};
    },
    set: (_t, key, value) => {
      if (key === 'font') px = parseFloat(String(value).split(' ')[1]);
      return true;
    },
  });
};

beforeAll(async () => {
  model = await loadApparatus();
  apparatus = mountApparatus(model);
  apparatus.updateMatrixWorld(true);
  family = applyWeightFamily(model, { customGrams: DEFAULT_CUSTOM_WEIGHT_G })!;
  const rod = model.getObjectByName(gltfName(MESH.rod))!;
  anchor = measureHolderAnchor(rod, apparatus)!;
});

describe('AC1 — one family, a coherent progression', () => {
  it('every reviewed mass has a disc of its own, and none borrows another mass’s', () => {
    for (const { grams, mesh } of TRAY_ROW) {
      expect(family.discFor(grams).name).toBe(gltfName(mesh));
    }
    // Any other mass is the custom weight, and no denomination borrows it.
    expect(family.discFor(25).name).toBe(gltfName(CUSTOM_WEIGHT_MESH));
    expect(WEIGHTS.map((w) => w.mesh)).not.toContain(CUSTOM_WEIGHT_MESH);
  });

  it('diameter and thickness both rise with every step up in mass', () => {
    const discs = REVIEWED.map(discOf);
    for (let i = 1; i < discs.length; i++) {
      const [lighter, heavier] = [discs[i - 1], discs[i]];
      expect(heavier.diameterMm, `${heavier.grams} g vs ${lighter.grams} g`).toBeGreaterThan(
        lighter.diameterMm
      );
      expect(heavier.thicknessMm, `${heavier.grams} g vs ${lighter.grams} g`).toBeGreaterThan(
        lighter.thicknessMm
      );
    }
  });

  it('is one material: every disc’s drawn volume gives steel’s density, so size is mass', () => {
    for (const disc of REVIEWED.map(discOf)) {
      const density = disc.grams / (disc.volumeMm3 / 1000);
      // Within 1 %: the chamfers are the only steel the outline does not describe.
      expect(density, `${disc.grams} g`).toBeGreaterThan(STEEL_DENSITY_G_PER_CM3 * 0.99);
      expect(density, `${disc.grams} g`).toBeLessThan(STEEL_DENSITY_G_PER_CM3 * 1.03);
    }
  });

  it('the sizing is continuous: any mass it is asked for gets a coherent disc', () => {
    let previous = weightDimensions(5);
    for (let grams = 10; grams <= 500; grams += 5) {
      const d = weightDimensions(grams);
      expect(d.diameterMm).toBeGreaterThan(previous.diameterMm);
      expect(d.thicknessMm).toBeGreaterThan(previous.thicknessMm);
      previous = d;
    }
  });

  it('every disc threads the post: one bore, wider than the post', () => {
    for (const grams of REVIEWED) {
      expect(weightDimensions(grams).boreMm).toBe(BORE_DIAMETER_MM);
    }
    // The post's radius is 5.15 mm (`holderAnchor.ts`).
    expect(BORE_DIAMETER_MM / 2).toBeGreaterThan(5.15);
    // And the largest disc still sits within the pan.
    expect(discOf(500).diameterMm / 2000).toBeLessThan(anchor.radius);
  });

  it('every load a lesson asks for still fits on the post', () => {
    // The fewest discs that make each target, from the tray's denominations.
    const denominations = WEIGHTS.map((w) => w.grams).sort((a, b) => b - a);
    const targets = DEFLECTORS.flatMap((d) =>
      [FIRST_READING_VALVE, SECOND_READING_VALVE].map((n) => targetMassG(n, d.id))
    );
    expect(Math.max(...targets)).toBe(520);
    for (const target of targets) {
      let left = target;
      let height = 0;
      for (const grams of denominations) {
        while (left >= grams) {
          left -= grams;
          height += weightDimensions(grams).thicknessMm / 1000 + SEATING_CLEARANCE;
        }
      }
      expect(left).toBe(0);
      expect(height, `${target} g`).toBeLessThan(anchor.postHeight);
    }
  });
});

describe('AC2 — the label is legible', () => {
  it('every disc carries its own mass, and it fits on the face with steel to spare', () => {
    for (const grams of REVIEWED) {
      const set = drawWeightFace(arialBold(), grams, 512);
      expect(set.fitsFace, `${labelText(grams)} does not fit its face`).toBe(true);
    }
  });

  it('the type is never smaller than the model’s own baked labels (about 4 mm)', () => {
    const heights = REVIEWED.map((grams) => drawWeightFace(arialBold(), grams, 512).heightMm);
    for (const [i, h] of heights.entries()) {
      expect(h, `${REVIEWED[i]} g`).toBeGreaterThanOrEqual(3.95);
    }
    // And it grows with the disc, so the larger masses read from further away.
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1] - 1e-9);
    }
  });

  it('every engraving is at least 6 px tall from the lesson’s own weights view', () => {
    // Measured as the camera sees it: the type lies flat on the face, so its height is
    // foreshortened by the view's elevation. 6 px of cap height at 1920 x 889 is the
    // smallest the browser check could read the 10 g disc's mass at; the others are 7-8 px.
    const camera = lessonCamera();
    const up = new THREE.Vector3(LABEL_UP[0], 0, LABEL_UP[1]);
    for (const grams of REVIEWED) {
      const disc = family.discFor(grams);
      const set = drawWeightFace(arialBold(), grams, 512);
      const top = disc.position.clone().setY(disc.position.y + weightDimensions(grams).thicknessMm / 2000);
      const low = top.clone().addScaledVector(up, (set.centreMm - set.heightMm / 2) / 1000);
      const high = top.clone().addScaledVector(up, (set.centreMm + set.heightMm / 2) / 1000);
      expect(screenPx(camera, low, high), `${grams} g`).toBeGreaterThanOrEqual(6);
    }
  });

  it('reads upright from where the lesson frames the weights, not from the side', () => {
    // "Up the page" points away from the camera that frames the tray.
    const [ox, , oz] = ANCHOR_VIEW.weights.offset;
    const away = new THREE.Vector2(-ox, -oz).normalize();
    expect(LABEL_UP[0]).toBeCloseTo(away.x, 9);
    expect(LABEL_UP[1]).toBeCloseTo(away.y, 9);

    // The face's texture follows it: v rises away from the camera, u to the reader's right.
    const disc = family.discFor(100) as THREE.Mesh;
    const geometry = disc.geometry;
    const face = geometry.groups.find((g) => g.materialIndex === FACE_GROUP)!;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const right = new THREE.Vector2(-LABEL_UP[1], LABEL_UP[0]);
    for (let i = face.start; i < face.start + face.count; i += 7) {
      const p = new THREE.Vector2(position.getX(i), position.getZ(i));
      const R = weightDimensions(100).diameterMm / 2000;
      expect(uv.getY(i)).toBeCloseTo(0.5 + p.dot(new THREE.Vector2(...LABEL_UP)) / (2 * R), 6);
      expect(uv.getX(i)).toBeCloseTo(0.5 + p.dot(right) / (2 * R), 6);
      // The face is the top of the disc, facing up.
      expect(position.getY(i)).toBeCloseTo(weightDimensions(100).thicknessMm / 2000, 9);
    }
  });
});

describe('AC3 — the hierarchy reads without the labels', () => {
  it('the tray stands the fixed denominations in one row, lightest nearest the operator', () => {
    // The operator stands at -X (`apparatusView.FRONT`); the row grows away from them.
    expect(FRONT).toEqual([-1, 0, 0]);
    const row = TRAY_ROW.map((w) => discOf(w.grams));
    for (let i = 1; i < row.length; i++) {
      expect(row[i].centre.x).toBeGreaterThan(row[i - 1].centre.x);
      expect(row[i].grams).toBeGreaterThan(row[i - 1].grams);
      // One line: every disc on the same row, standing on the same surface.
      expect(row[i].centre.z).toBeCloseTo(row[0].centre.z, 9);
      expect(row[i].centre.y - row[i].thicknessMm / 2000).toBeCloseTo(
        row[0].centre.y - row[0].thicknessMm / 2000,
        9
      );
    }
  });

  it('with equal gaps between rims, so size is the only thing that changes along it', () => {
    const row = TRAY_ROW.map((w) => discOf(w.grams));
    const gaps = row.slice(1).map((d, i) => {
      const left = row[i];
      return d.centre.x - d.diameterMm / 2000 - (left.centre.x + left.diameterMm / 2000);
    });
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(0.005);
      expect(gap).toBeCloseTo(gaps[0], 6);
    }
  });

  it('every step between neighbours is a visible step in both size and height', () => {
    // Relative, the way sizes are compared by eye: at least 3 % wider and 10 % taller than
    // the next lighter disc, all the way down. The tightest step is 20 g -> 25 g, a 25 %
    // mass difference: 3.6 % in diameter and 16 % in height.
    const discs = REVIEWED.map(discOf);
    for (let i = 1; i < discs.length; i++) {
      expect(discs[i].diameterMm / discs[i - 1].diameterMm).toBeGreaterThan(1.03);
      expect(discs[i].thicknessMm / discs[i - 1].thicknessMm).toBeGreaterThan(1.1);
    }
  });

  it('from the lesson’s weights view, every heavier disc on the row also looks wider', () => {
    // Perspective shrinks what is further away, so the order is checked on screen, not
    // only in the model: across the camera's view, rim to rim.
    const camera = lessonCamera();
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const across = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
    const widths = TRAY_ROW.map(({ grams }) => {
      const disc = family.discFor(grams);
      const R = weightDimensions(grams).diameterMm / 2000;
      const top = disc.position.clone().setY(disc.position.y + weightDimensions(grams).thicknessMm / 2000);
      return screenPx(
        camera,
        top.clone().addScaledVector(across, -R),
        top.clone().addScaledVector(across, R)
      );
    });
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i], `${TRAY_ROW[i].grams} g vs ${TRAY_ROW[i - 1].grams} g`).toBeGreaterThan(
        widths[i - 1] * 1.03
      );
    }
  });

  it('the heaviest disc is the biggest thing on the tray, the lightest the smallest', () => {
    const discs = REVIEWED.map(discOf);
    const byVolume = [...discs].sort((a, b) => a.volumeMm3 - b.volumeMm3).map((d) => d.grams);
    expect(byVolume).toEqual(REVIEWED);
  });

  it('the row stands clear of the tray box’s two carrying handles', () => {
    const inApparatus = (name: string) => {
      const clone = model.getObjectByName(name)!.clone(true);
      clone.updateWorldMatrix(true, true);
      return new THREE.Box3().setFromObject(clone, true);
    };
    const near = inApparatus(TRAY_HANDLES.near);
    const far = inApparatus(TRAY_HANDLES.far);
    const row = TRAY_ROW.map((w) => discOf(w.grams));
    const first = row[0];
    const last = row[row.length - 1];
    expect(first.centre.x - first.diameterMm / 2000 - near.max.x).toBeGreaterThanOrEqual(0.005);
    expect(far.min.x - (last.centre.x + last.diameterMm / 2000)).toBeCloseTo(
      HANDLE_CLEARANCE_MM / 1000,
      6
    );
  });

  it('every disc on the tray is wholly inside the frame the lesson balances the weights in', () => {
    // Steps 6 and 8 fly the camera to the `weights` anchor. The authored row ran out of the
    // bottom of that frame at the operator's end; the family's row does not.
    const camera = lessonCamera();
    const discs = [...TRAY_ROW.map((w) => w.grams), DEFAULT_CUSTOM_WEIGHT_G];
    for (const grams of discs) {
      const disc = family.discFor(grams);
      const box = new THREE.Box3().setFromObject(disc.clone(true), true);
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const p = apparatus.localToWorld(new THREE.Vector3(x, y, z)).project(camera);
            const px = ((p.x + 1) / 2) * VIEWPORT.width;
            const py = ((1 - p.y) / 2) * VIEWPORT.height;
            expect(px, `${grams} g`).toBeGreaterThan(0);
            expect(px, `${grams} g`).toBeLessThan(VIEWPORT.width);
            expect(py, `${grams} g`).toBeGreaterThan(0);
            expect(py, `${grams} g`).toBeLessThan(VIEWPORT.height);
          }
        }
      }
    }
  });

  it('the custom disc keeps its own place by the tank, out of the fixed row', () => {
    const custom = discOf(DEFAULT_CUSTOM_WEIGHT_G);
    const row = TRAY_ROW.map((w) => discOf(w.grams));
    expect(Math.abs(custom.centre.z - row[0].centre.z)).toBeGreaterThan(0.05);
  });
});

describe('the custom weight', () => {
  it('is the model’s own part, untouched: its authored shape, finish and place', () => {
    const custom = family.discFor(DEFAULT_CUSTOM_WEIGHT_G) as THREE.Mesh;
    const measured = measure(custom, DEFAULT_CUSTOM_WEIGHT_G);
    // The authored `Weight_Custom`: 57.4 mm across, 16.5 mm thick, by the tank.
    expect(measured.diameterMm).toBeCloseTo(57.5, 0);
    expect(measured.thicknessMm).toBeCloseTo(16.5, 1);
    expect(measured.centre.x).toBeCloseTo(-0.1249, 3);
    expect(measured.centre.z).toBeCloseTo(-0.1258, 3);
    // Not a family disc: no family geometry, no family materials.
    expect(custom.geometry.userData.weightFamily).toBeUndefined();
    const materials = Array.isArray(custom.material) ? custom.material : [custom.material];
    expect(materials.map((m) => m.name)).toEqual(['Custom weight']);
  });

  it('carries no engraved mass', () => {
    const custom = family.discFor(DEFAULT_CUSTOM_WEIGHT_G) as THREE.Mesh;
    const materials = Array.isArray(custom.material) ? custom.material : [custom.material];
    for (const m of materials) expect(m.name).not.toMatch(/weight family/);
  });

  it('is the same part whatever the custom control is set to', () => {
    const before = family.discFor(25);
    family.setCustomGrams(150);
    expect(family.discFor(150)).toBe(before);
    expect(family.discFor(35)).toBe(before);
    family.setCustomGrams(DEFAULT_CUSTOM_WEIGHT_G);
  });
});
