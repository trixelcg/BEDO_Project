import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BLOCKING_COVERAGE,
  FRAMING_PADDING,
  fitDistance,
  regionOffset,
  usableRect,
  type Rect,
} from '../../src/lib/cameraFraming';
import { REPO_ROOT } from '../helpers/glb';
import { TRANSFER_SECONDS } from '../../src/interaction/transfer';

/**
 * Framing the head of the apparatus into the part of the screen the learner can see.
 *
 * The defect: on the install step the camera stayed at the tray while the deflector flew to
 * the rod, so the learner lost sight of it and arrived at a view that showed neither the
 * rod nor the plate they were being asked to close next.
 *
 * Two things had to be true for the fix. The camera has to stand far enough back that the
 * deflector, rod and plate all fit — derived from their bounds, not authored as an offset —
 * and it has to fit them into the region the 380 px instructional panel leaves free, since
 * that panel is drawn *over* the canvas rather than beside it.
 */

/** 1920x1080 with the sidebar on the left, which is the primary supported size. */
const CANVAS: Rect = { left: 0, top: 0, width: 1920, height: 1080 };
const LEFT_PANEL: Rect = { left: 24, top: 24, width: 380, height: 1032 };
const RIGHT_PANEL: Rect = { left: 1920 - 404, top: 24, width: 380, height: 1032 };
/** The stacked layout under 800 px puts the panel across the top instead. */
const TOP_PANEL: Rect = { left: 16, top: 16, width: 768, height: 384 };

const SIZES: Array<[string, Rect]> = [
  ['1920x1080', { left: 0, top: 0, width: 1920, height: 1080 }],
  ['1366x768', { left: 0, top: 0, width: 1366, height: 768 }],
  ['1440x900', { left: 0, top: 0, width: 1440, height: 900 }],
  ['2560x1440', { left: 0, top: 0, width: 2560, height: 1440 }],
];

describe('the region the 2D panel leaves free', () => {
  it('trims the side the panel is actually on', () => {
    const left = usableRect(CANVAS, [LEFT_PANEL]);
    expect(left.left).toBeCloseTo(404, 6);
    expect(left.width).toBeCloseTo(1920 - 404, 6);

    // Arabic reverses the flex row, so the same panel appears on the right. No branch on
    // language: the rectangle says where it is.
    const right = usableRect(CANVAS, [RIGHT_PANEL]);
    expect(right.left).toBeCloseTo(0, 6);
    expect(right.width).toBeCloseTo(1920 - 404, 6);
  });

  it('trims the top when the layout stacks', () => {
    const canvas: Rect = { left: 0, top: 0, width: 800, height: 900 };
    const region = usableRect(canvas, [TOP_PANEL]);
    expect(region.top).toBeCloseTo(400, 6);
    expect(region.height).toBeCloseTo(500, 6);
    expect(region.width).toBeCloseTo(800, 6);
  });

  it('ignores a small floating element rather than eating the viewport', () => {
    // A warning popup covers neither edge. Treating it as blocking would push the camera
    // back for no reason every time an error was on screen.
    const popup: Rect = { left: 700, top: 400, width: 300, height: 120 };
    expect(usableRect(CANVAS, [popup])).toEqual(CANVAS);
    expect(BLOCKING_COVERAGE).toBeGreaterThan(0.5);
  });

  it('is the whole canvas when nothing is over it', () => {
    expect(usableRect(CANVAS, [])).toEqual(CANVAS);
  });

  it('never collapses to nothing, whatever it is handed', () => {
    const swallow: Rect = { left: 0, top: 0, width: 4000, height: 4000 };
    const region = usableRect(CANVAS, [swallow]);
    expect(region.width).toBeGreaterThan(0);
    expect(region.height).toBeGreaterThan(0);
  });
});

describe('the fit distance', () => {
  const FOV = 42;

  it('stands back far enough that the subject actually fits', () => {
    // Checked against the projection rather than against a remembered number: at the
    // returned distance the subject's angular size must be inside the region's own share
    // of the frustum.
    for (const [label, canvas] of SIZES) {
      const region = usableRect(canvas, [{ ...LEFT_PANEL, height: canvas.height - 48 }]);
      const radius = 0.35;
      const d = fitDistance(radius, FOV, canvas, region);

      const vFov = (FOV * Math.PI) / 180;
      const halfHeightAtD = d * Math.tan(vFov / 2);
      const halfWidthAtD = halfHeightAtD * (canvas.width / canvas.height);
      const visibleHalfHeight = halfHeightAtD * (region.height / canvas.height);
      const visibleHalfWidth = halfWidthAtD * (region.width / canvas.width);

      expect(visibleHalfHeight, `${label} height`).toBeGreaterThanOrEqual(radius);
      expect(visibleHalfWidth, `${label} width`).toBeGreaterThanOrEqual(radius);
    }
  });

  it('leaves the stated padding rather than framing edge to edge', () => {
    expect(FRAMING_PADDING).toBeGreaterThan(1);
    const canvas = CANVAS;
    const tight = fitDistance(0.35, FOV, canvas, canvas, 1);
    const padded = fitDistance(0.35, FOV, canvas, canvas, FRAMING_PADDING);
    expect(padded).toBeCloseTo(tight * FRAMING_PADDING, 9);
  });

  it('never stands closer because something is in the way', () => {
    const full = fitDistance(0.35, FOV, CANVAS, CANVAS);
    const blocked = fitDistance(0.35, FOV, CANVAS, usableRect(CANVAS, [LEFT_PANEL]));
    expect(blocked).toBeGreaterThanOrEqual(full);

    // On a 16:9 canvas at this field of view the *vertical* extent is the binding one, so
    // losing a fifth of the width to the sidebar does not move the camera at all — the
    // subject already fits across. What keeps it clear of the panel is the lateral shift,
    // not extra distance. Worth pinning: a test that demanded a bigger number here would
    // be asserting a worse framing.
    expect(blocked).toBeCloseTo(full, 9);
  });

  it('does stand further back when the covered edge is the binding one', () => {
    const canvas: Rect = { left: 0, top: 0, width: 800, height: 900 };
    const full = fitDistance(0.35, FOV, canvas, canvas);
    const stacked = fitDistance(0.35, FOV, canvas, usableRect(canvas, [TOP_PANEL]));
    expect(stacked).toBeGreaterThan(full);
  });

  it('scales with the subject and not with anything else', () => {
    const a = fitDistance(0.2, FOV, CANVAS, CANVAS);
    const b = fitDistance(0.4, FOV, CANVAS, CANVAS);
    expect(b).toBeCloseTo(a * 2, 9);
  });

  it('needs less room through a wider lens', () => {
    expect(fitDistance(0.35, 60, CANVAS, CANVAS)).toBeLessThan(
      fitDistance(0.35, 30, CANVAS, CANVAS)
    );
  });

  it('degrades safely rather than dividing by zero', () => {
    expect(Number.isFinite(fitDistance(0, FOV, CANVAS, CANVAS))).toBe(true);
    const empty: Rect = { left: 0, top: 0, width: 0, height: 0 };
    expect(Number.isFinite(fitDistance(0.35, FOV, empty, empty))).toBe(true);
  });
});

describe('shifting the frame off the panel', () => {
  const FOV = 42;

  it('slides the subject toward the free side', () => {
    // Panel on the left means the free region's centre is right of the canvas centre, so
    // the view moves left and the subject appears right — clear of the panel.
    const region = usableRect(CANVAS, [LEFT_PANEL]);
    const d = fitDistance(0.35, FOV, CANVAS, region);
    const shift = regionOffset(CANVAS, region, d, FOV);
    expect(shift.right).toBeLessThan(0);

    const mirrored = usableRect(CANVAS, [RIGHT_PANEL]);
    expect(regionOffset(CANVAS, mirrored, d, FOV).right).toBeGreaterThan(0);
  });

  it('pushes down when the panel is across the top', () => {
    const canvas: Rect = { left: 0, top: 0, width: 800, height: 900 };
    const region = usableRect(canvas, [TOP_PANEL]);
    const shift = regionOffset(canvas, region, 2, FOV);
    expect(shift.up).toBeGreaterThan(0);
  });

  it('does not move the frame when nothing is covering it', () => {
    const shift = regionOffset(CANVAS, CANVAS, 2, FOV);
    expect(shift.right).toBeCloseTo(0, 12);
    expect(shift.up).toBeCloseTo(0, 12);
  });

  it('puts the subject inside the free region at every supported size', () => {
    // The acceptance condition itself: after standing back and sliding across, the whole
    // subject projects inside the region the panel leaves free — not merely inside the
    // canvas, which is what the old framing satisfied while sitting behind the panel.
    for (const [label, canvas] of SIZES) {
      const panel = { ...LEFT_PANEL, height: canvas.height - 48 };
      const region = usableRect(canvas, [panel]);
      const radius = 0.35;
      const d = fitDistance(radius, FOV, canvas, region);
      const shift = regionOffset(canvas, region, d, FOV);

      const vFov = (FOV * Math.PI) / 180;
      const halfHeight = d * Math.tan(vFov / 2);
      const halfWidth = halfHeight * (canvas.width / canvas.height);

      // Where the subject's centre lands on screen once the frame has been slid.
      const centreX = canvas.left + canvas.width / 2 - (shift.right / (2 * halfWidth)) * canvas.width;
      const centreY = canvas.top + canvas.height / 2 + (shift.up / (2 * halfHeight)) * canvas.height;
      const radiusPx = (radius / (2 * halfHeight)) * canvas.height;

      expect(centreX - radiusPx, `${label} left`).toBeGreaterThanOrEqual(region.left - 1);
      expect(centreX + radiusPx, `${label} right`).toBeLessThanOrEqual(
        region.left + region.width + 1
      );
      expect(centreY - radiusPx, `${label} top`).toBeGreaterThanOrEqual(region.top - 1);
      expect(centreY + radiusPx, `${label} bottom`).toBeLessThanOrEqual(
        region.top + region.height + 1
      );
    }
  });
});

describe('the rig that uses it', () => {
  const scene = () => readFileSync(path.join(REPO_ROOT, 'src/components/Scene3D.tsx'), 'utf8');

  it('travels for exactly as long as the transfer it accompanies', () => {
    // BEDO's number, not a tuning choice: the storyboard says the deflector moves to the
    // rod in two seconds, so the camera move is that long and starts with it.
    expect(TRANSFER_SECONDS).toBe(2);
    expect(scene()).toMatch(/duration\.current = TRANSFER_SECONDS/);
  });

  it('starts the move with the transfer rather than on arrival', () => {
    const s = scene();
    // The signal is raised when the flight starts; nothing waits for it to settle.
    expect(s).toMatch(/pendingInstall\.current = true/);
    expect(s).not.toMatch(/onDeflectorInstallEnd|onArrive/);
  });

  it('keeps one camera authority instead of adding a second controller', () => {
    const s = scene();
    // Exactly one OrbitControls, still `makeDefault`, and the rig drives it rather than
    // running a camera of its own.
    expect(s.match(/<OrbitControls/g) ?? []).toHaveLength(1);
    expect(s).toMatch(/makeDefault/);
    expect(s.match(/const CameraRig/g) ?? []).toHaveLength(1);
  });

  it('always hands control back', () => {
    const s = scene();
    // Disabled for the move, and released on settle, on cancellation and on unmount.
    expect(s).toMatch(/controls\.enabled = false/);
    expect(s).toMatch(/controls\.enabled = true/);
    expect(s).toMatch(/useEffect\(\(\) => release, \[release\]\)/);
    expect(s).toMatch(/if \(progress\.current >= 1\) release\(\)/);
  });

  it('leaves free mode alone, and stands down only when the board covers the scene', () => {
    /*
      `sceneHidden`, not `showMonitor`.

      The guard used to stand the camera down whenever the board was open, which was right
      while the board was a fullscreen overlay. BEDO-UX-12C docks it beside the apparatus,
      so the rig stays visible and must keep reframing between steps — with the old guard,
      advancing while docked left the previous step's framing and put the tray off screen.
    */
    expect(scene()).toMatch(/if \(!guided \|\| sceneHidden \|\| !installFraming\) return/);
    expect(scene()).toMatch(/sceneHidden=\{state\.showMonitor && state\.monitorExpanded\}/);
  });

  it('derives the destination from bounds instead of a hard-coded pose', () => {
    const s = scene();
    expect(s).toMatch(/fitDistance\(/);
    expect(s).toMatch(/usableRect\(/);
    // The one fit algorithm, imported — not a second one written inline.
    expect(s).toMatch(/from '\.\.\/lib\/cameraFraming'/);
    const block = s.slice(s.indexOf('pendingInstall.current && installFraming'), s.indexOf('if (pending.current)'));
    expect(block).not.toMatch(/\bposition\.set\(\s*-?\d/);
  });
});
