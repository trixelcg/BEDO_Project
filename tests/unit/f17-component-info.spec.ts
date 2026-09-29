import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  anchorIdOf,
  COMPONENTS,
  COMPONENT_KEYS,
  describeComponent,
  isOperational,
  nozzleBoreMm,
  type ComponentRef,
} from '../../src/domain/componentInfo';
import { DEFLECTORS, WEIGHTS } from '../../src/domain/apparatus';
import { NOZZLE_AREA_M2, SPRING_RATE_N_PER_M } from '../../src/domain/physics';
import { CARD_GAP, CARD_MARGIN, placeCard } from '../../src/lib/componentAnchor';

/**
 * F17 — Hover identification and anchored component information (QA, 2026-09-29).
 *
 * Observed: hovering did not consistently identify a part or say what it does, and there
 * were no popups anchored to parts. Required: a compact tooltip (name + function) on
 * hover and focus, a richer card on a deliberate click, anchored to the part by a stable
 * anchor id, all from one definition; hover never acts. `docs/64`.
 */

const source = (path: string) => readFileSync(path, 'utf8');
const DEVICE = source('src/components/DeviceModel.tsx');
const CARD = source('src/components/ComponentCard.tsx');
const APP = source('src/App.tsx');
const OVERLAY = source('src/components/UIOverlay.tsx');
const TOOLTIP = source('src/lib/cursorTooltip.ts');

/** Every part a learner can point at, including each deflector and each weight. */
const ALL_REFS: ComponentRef[] = [
  ...COMPONENT_KEYS.filter((k) => k !== 'deflector' && k !== 'weight').map((key) => ({ key })),
  ...DEFLECTORS.flatMap((d) => [
    { key: 'deflector' as const, variant: d.id },
    { key: 'deflector' as const, variant: d.id, installed: true },
  ]),
  ...WEIGHTS.flatMap((w) => [
    { key: 'weight' as const, variant: w.grams },
    { key: 'weight' as const, variant: w.grams, onCarrier: true },
  ]),
  { key: 'weight', variant: 25 },
];

describe('AC1 — tooltips exist for every reviewed part', () => {
  it('the eight named in the QA, and the other interactive parts', () => {
    for (const key of [
      'flowmeter',
      'volumetricValve',
      'nozzle',
      'deflector',
      'weightCarrier',
      'pointer',
      'spring',
      'tankCover',
      'flowValve',
      'powerSwitch',
      'weight',
    ] as const) {
      expect(COMPONENT_KEYS).toContain(key);
    }
  });

  it('every part has a name and a one-line function in both languages', () => {
    for (const ref of ALL_REFS) {
      for (const lang of ['en', 'ar'] as const) {
        const t = describeComponent(ref, lang);
        expect(t.name.length, `${anchorIdOf(ref)} ${lang} name`).toBeGreaterThan(1);
        expect(t.role.length, `${anchorIdOf(ref)} ${lang} role`).toBeGreaterThan(10);
        expect(t.use.length, `${anchorIdOf(ref)} ${lang} use`).toBeGreaterThan(5);
        expect(t.hint.length).toBeGreaterThan(5);
      }
    }
  });

  it('the scene has a hit proxy for each part that had none', () => {
    expect(DEVICE).toMatch(/spot\(MESH\.pointer, \{ kind: 'part', component: 'pointer' \}/);
    expect(DEVICE).toMatch(/spot\(MESH\.spring, \{ kind: 'part', component: 'spring' \}/);
    expect(DEVICE).toMatch(/spot\(CARRIER_MESH, \{ kind: 'part', component: 'weightCarrier' \}/);
    expect(DEVICE).toMatch(/spot\(FLOWMETER_MESHES, \{ kind: 'part', component: 'flowmeter' \}/);
    expect(DEVICE).toMatch(/component: 'installedDeflector'/);
    expect(DEVICE).toContain("const FLOWMETER_MESHES = ['Rectangle002', 'Rectangle003'];");
    // The cover used to have no label at all: `labelFor` returned null for it.
    expect(DEVICE).toMatch(/case 'cover':\s*return \{ key: 'tankCover' \};/);
  });
});

describe('AC2 — one component-information definition', () => {
  it('numbers are derived from the physics and the apparatus, not restated', () => {
    expect(nozzleBoreMm()).toBeCloseTo(2 * Math.sqrt(NOZZLE_AREA_M2 / Math.PI) * 1000, 9);
    expect(describeComponent({ key: 'nozzle' }, 'en').name).toBe('Nozzle — 10 mm bore');
    expect(describeComponent({ key: 'spring' }, 'en').details[0]).toBe(`Stiffness k = ${SPRING_RATE_N_PER_M} N/m.`);
    for (const d of DEFLECTORS) {
      const t = describeComponent({ key: 'deflector', variant: d.id }, 'en');
      expect(t.name).toBe(d.nameEn);
      expect(t.details[0]).toContain(`k = ${d.momentumFactor}`);
      expect(describeComponent({ key: 'deflector', variant: d.id }, 'ar').name).toBe(d.nameAr);
    }
    expect(describeComponent({ key: 'weight', variant: 50 }, 'en').name).toBe('50 g');
    expect(describeComponent({ key: 'weight', variant: 50 }, 'ar').name).toBe('وزن 50 غ');
    expect(describeComponent({ key: 'weight', variant: 25 }, 'en').name).toBe('Custom weight');
  });

  it('the hover tooltip, the card and the focus tooltip all read it', () => {
    expect(DEVICE).toMatch(/import \{ anchorIdOf, describeComponent, type ComponentRef \} from '\.\.\/domain\/componentInfo';/);
    expect(DEVICE).toMatch(/const text = describeComponent\(ref, isArabic \? 'ar' : 'en', \{ clickOpens: labelClickOpens \}\);/);
    expect(CARD).toMatch(/const text = describeComponent\(inspection\.ref, language\);/);
    // The inline labels are gone: no part name is composed in the scene any more.
    expect(DEVICE).not.toMatch(/const labelFor = useCallback/);
    for (const inline of ["'Power switch'", "'Flow control valve'", "'Volumetric valve'", 'mm bore`']) {
      expect(DEVICE).not.toContain(inline);
    }
  });

  it('anchor ids are stable and unique per part', () => {
    const ids = ALL_REFS.map(anchorIdOf);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^vlfm009\.[a-z-]+(\.[a-z]+)?(\.\d+)?$/);
    expect(anchorIdOf({ key: 'tankCover' })).toBe('vlfm009.tank-cover');
    expect(anchorIdOf({ key: 'deflector', variant: 90, installed: true })).toBe('vlfm009.deflector.installed.90');
    expect(anchorIdOf({ key: 'weight', variant: 50, onCarrier: true })).toBe('vlfm009.weight.carrier.50');
  });

  it('formulas inside Arabic text are isolated left-to-right', () => {
    const ar = describeComponent({ key: 'flowmeter' }, 'ar').details[0];
    expect(ar).toContain('\u2066Q\u00a0=\u00a0ΔV\u00a0/\u00a0Δt\u2069');
    for (const ref of ALL_REFS) {
      const t = describeComponent(ref, 'ar');
      for (const line of [t.role, ...t.details]) {
        // Any "x = y" in Arabic text sits inside an isolate.
        const bare = line.replace(/\u2066[^\u2069]*\u2069/g, '');
        expect(bare, `${anchorIdOf(ref)}: ${line}`).not.toMatch(/ = /);
      }
    }
  });
});

describe('AC3 — hover is informational; actions need explicit activation', () => {
  const hoverBody = DEVICE.slice(DEVICE.indexOf('const hoverProxy = ('), DEVICE.indexOf('/** Where the right button went down'));

  it('the hover path sets presentation state only and calls no handler', () => {
    expect(hoverBody.length).toBeGreaterThan(200);
    for (const call of ['handleHotspot', 'onCoverClick', 'onAddWeight', 'onPowerClick', 'onFlowValveClick', 'onVolumetricValveClick', 'onSelectDeflector', 'onRemoveWeight', 'onInspectComponent', 'dispatch']) {
      expect(hoverBody, call).not.toContain(call);
    }
    expect(DEVICE).toMatch(/onPointerOver=\{\(e\) => hoverProxy\(e, h, infoOnly, draggable\)\}/);
    expect(DEVICE).toMatch(/onPointerMove=\{\(e\) => hoverProxy\(e, h, infoOnly, draggable\)\}/);
  });

  it('operational parts keep their click for the action; the card is a right-click', () => {
    expect(DEVICE).toMatch(/onClick: \(e: \{ stopPropagation: \(\) => void \}\) => \{\s*e\.stopPropagation\(\);\s*handleHotspot\(h\.action\);/);
    expect(DEVICE).toMatch(/onContextMenu=\{\(e\) => \{\s*if \(winnerOf\(e\) !== e\.eventObject\) return;[\s\S]{0,160}if \(rightPressMoved\(e\.nativeEvent\)\) return;\s*inspectProxy\(h\);/);
    for (const ref of ALL_REFS) {
      const expected = ref.key === 'deflector' && ref.installed ? false : COMPONENTS[ref.key].operational;
      expect(isOperational(ref)).toBe(expected);
      expect(describeComponent(ref, 'en').hint).toBe(expected ? 'Right-click for details' : 'Click or right-click for details');
    }
  });

  it('an informational part never takes a click meant for a control behind it', () => {
    expect(DEVICE).toMatch(/if \(e\.intersections\.some\(\(i\) => i\.eventObject\.userData\.bedoProxy\?\.operational\)\) return;\s*e\.stopPropagation\(\);\s*inspectProxy\(h\);/);
    // …and then its hint does not promise a click either.
    expect(describeComponent({ key: 'spring' }, 'en', { clickOpens: false }).hint).toBe('Right-click for details');
  });

  it('opening a card is presentation state: no runtime command', () => {
    const block = APP.slice(APP.indexOf('// --- Component cards (F17)'), APP.indexOf('// --- Component cards (F17)') + 2400);
    expect(block).not.toMatch(/runtime\.dispatch|dispatch\(/);
    expect(APP.match(/runtime\.dispatch/g)?.length).toBe(5);
  });
});

describe('AC4 — popups appear near their part and stay readable', () => {
  const bounds = { left: 0, top: 0, right: 1366, bottom: 768 };
  const size = { width: 340, height: 220 };

  it('beside the anchor, never on it, inside the viewport', () => {
    for (const at of [
      { x: 624, y: 180 },
      { x: 20, y: 20 },
      { x: 1350, y: 400 },
      { x: 683, y: 760 },
      { x: 1300, y: 740 },
    ]) {
      const p = placeCard(at, size, bounds);
      const inside =
        p.left >= CARD_MARGIN - 0.5 &&
        p.top >= CARD_MARGIN - 0.5 &&
        p.left + size.width <= bounds.right - CARD_MARGIN + 0.5 &&
        p.top + size.height <= bounds.bottom - CARD_MARGIN + 0.5;
      expect(inside, JSON.stringify({ at, p })).toBe(true);
      const covers = at.x >= p.left && at.x <= p.left + size.width && at.y >= p.top && at.y <= p.top + size.height;
      expect(covers, JSON.stringify({ at, p })).toBe(false);
    }
  });

  it('the inline-end side first, flipped when there is no room', () => {
    expect(placeCard({ x: 624, y: 300 }, size, bounds, 'ltr')).toMatchObject({ side: 'right', left: 624 + CARD_GAP });
    expect(placeCard({ x: 624, y: 300 }, size, bounds, 'rtl')).toMatchObject({ side: 'left', left: 624 - CARD_GAP - 340 });
    expect(placeCard({ x: 1200, y: 300 }, size, bounds, 'ltr').side).toBe('left');
  });

  it('the scene projects the inspected anchor every frame; the card follows it', () => {
    expect(DEVICE).toMatch(/const insp = inspectionRef\.current;/);
    expect(DEVICE).toMatch(/publishAnchorPoint\(\{\s*x: rect\.left/);
    expect(CARD).toMatch(/useSyncExternalStore\(subscribeAnchorPoint, getAnchorPoint/);
    expect(CARD).toMatch(/placeCard\(point!, size, bounds, isAr \? 'rtl' : 'ltr'\)/);
    expect(CARD).toMatch(/data-anchor-id=\{inspection\.anchorId\}/);
  });

  it('a clicked card is a dialog with a close button and Escape; focus shows the compact one', () => {
    expect(CARD).toMatch(/role=\{full \? 'dialog' : 'tooltip'\}/);
    expect(CARD).toMatch(/data-bedo-component-close/);
    expect(CARD).toMatch(/if \(e\.key === 'Escape'\)/);
    expect(APP).toMatch(/if \(!target \|\| !target\.matches\?\.\(':focus-visible'\)\) return;/);
    for (const key of ['tankCover', 'powerSwitch', 'volumetricValve', 'flowValve', 'deflector', 'weight']) {
      expect(OVERLAY).toContain(`data-component="${key}"`);
    }
  });

  it('the hover tooltip carries name, function and hint as separate lines', () => {
    expect(TOOLTIP).toMatch(/line\('cursor-tooltip-title', content\.title\);/);
    expect(TOOLTIP).toMatch(/if \(content\.body\) line\('cursor-tooltip-body', content\.body\);/);
    expect(TOOLTIP).toMatch(/if \(content\.hint\) line\('cursor-tooltip-hint', content\.hint\);/);
  });
});

describe('the tooltip is off while the camera moves (user request, 2026-09-29)', () => {
  const SCENE = source('src/components/Scene3D.tsx');
  it('camera motion hides the label and blocks show; the last label returns when it settles', () => {
    // `show` records the request but draws nothing during motion.
    expect(TOOLTIP).toMatch(/requested = \{ content, dir \};\n  if \(cameraMoving\) return;/);
    // Turning motion on hides; turning it off re-shows what the pointer was on.
    expect(TOOLTIP).toMatch(/if \(moving\) \{\n    visible = false;\n    if \(el\) el\.hidden = true;\n  \} else if \(requested\) \{\n    showCursorTooltip\(requested\.content, requested\.dir\);\n  \}/);
    // An owner hide also forgets the request, so nothing stale returns later.
    expect(TOOLTIP).toMatch(/export function hideCursorTooltip\(\): void \{\n  visible = false;\n  requested = null;/);
  });
  it('the scene watches the camera itself, so every source of motion counts', () => {
    expect(SCENE).toMatch(/const CameraMotionGate/);
    expect(SCENE).toMatch(/l\.p\.distanceToSquared\(camera\.position\) > CAMERA_STILL_EPSILON/);
    expect(SCENE).toMatch(/1 - Math\.abs\(l\.q\.dot\(camera\.quaternion\)\) > CAMERA_STILL_EPSILON/);
    // The label returns only after a quiet run of frames, past the damping tail.
    expect(SCENE).toMatch(/\+\+still\.current === CAMERA_STILL_FRAMES/);
    expect(SCENE).toMatch(/<CameraMotionGate \/>/);
    // Unmounting mid-move never leaves the tooltip switched off.
    expect(SCENE).toMatch(/useEffect\(\(\) => \(\) => setCursorTooltipCameraMoving\(false\), \[\]\);/);
  });
});
