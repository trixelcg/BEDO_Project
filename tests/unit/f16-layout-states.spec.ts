import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * F16 — Layout, responsive behaviour and control-state readability (QA, 2026-09-29).
 *
 * Observed: guided text wrapping word by word, bottom controls overlapping content, an
 * enabled "Open Data Monitor" reading as disabled (it measured 1.0:1 — blank), overlays
 * crowding the apparatus. Required: a shell that reflows instead of hand-placed offsets,
 * scrolling inside panels, reachable close controls, and states that are distinct without
 * relying on colour. The rendered checks at 1280x720 … 2560x1440 are in `docs/63`; these
 * are the structural guarantees that make them hold.
 */

const source = (path: string) => readFileSync(path, 'utf8');
// Comments stripped: several explain the old values they replaced.
const CSS = source('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');
const OVERLAY = source('src/components/UIOverlay.tsx');
const MONITOR = source('src/components/SoftwareMonitor.tsx');
const RESET = source('src/components/ResetDialog.tsx');
const SHEET = source('src/components/AnswerSheet.tsx');

/** The body of the first rule whose selector list is exactly `sel`. */
const rule = (sel: string) => {
  const at = CSS.indexOf(sel + ' {');
  expect(at, `no rule for ${sel}`).toBeGreaterThanOrEqual(0);
  return CSS.slice(at, CSS.indexOf('}', at));
};

/** WCAG 2 contrast ratio of two #rrggbb colours. */
const contrast = (a: string, b: string) => {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('F16 — the guided shell reflows instead of hand positioning', () => {
  it('is a grid of rails, a centre column and a bottom row, padded to the safe area', () => {
    const shell = rule('.guided-shell');
    expect(shell).toMatch(/display: grid;/);
    expect(shell).toMatch(/grid-template-columns: auto minmax\(0, 1fr\) auto;/);
    expect(shell).toMatch(/grid-template-rows: minmax\(0, 1fr\) auto;/);
    for (const side of ['top', 'right', 'bottom', 'left']) expect(shell).toContain(`env(safe-area-inset-${side})`);
    expect(OVERLAY).toMatch(/className=\{`guided-shell is-\$\{asideForWeights \? 'aside' : 'centre'\}`\}/);
    for (const part of ['guided-rail is-start', 'guided-centre', 'guided-rail is-end', 'guided-bottom'])
      expect(OVERLAY).toContain(`className="${part}"`);
  });

  it('the dock and the footer are in flow — no guessed bottom offsets left', () => {
    expect(rule('.guided-dock')).not.toMatch(/position: absolute|bottom:/);
    expect(rule('.guided-footer')).not.toMatch(/position: absolute|bottom:/);
    expect(rule('.guided-chip')).not.toMatch(/position: absolute/);
    expect(CSS).not.toMatch(/bottom: 1(16|24)px/);
    expect(CSS).not.toMatch(/\.guided-(dock|footer)\.is-aside/);
  });

  it('long content scrolls inside its own panel', () => {
    const dock = rule('.guided-dock');
    expect(dock).toMatch(/overflow-y: auto;/);
    expect(dock).toMatch(/max-height: min\(62vh, 100%\);/);
    expect(rule('.step-progress-list')).toMatch(/overflow-y: auto;/);
    expect(rule('.step-progress-list')).toMatch(/min-height: 0;/);
    expect(rule('.guided-rail')).toMatch(/min-height: 0;/);
    expect(rule('.sidebar-panel')).toMatch(/overflow-y: auto;/);
  });

  it('popups sit in the centre column during guided work, never over the rails', () => {
    expect(OVERLAY).toMatch(/<div className="guided-centre">\{popups\}<\/div>/);
    expect(OVERLAY).toMatch(/\{!inGuidedShell && popups\}/);
    expect(rule('.guided-centre .warning-popup')).toMatch(/position: static;/);
  });

  it('the step card lays out from the dock width, so its instruction cannot go word-per-line', () => {
    expect(rule('.guided-dock')).toMatch(/container-type: inline-size;/);
    expect(rule('.guided-dock')).toMatch(/container-name: dock;/);
    expect(CSS).toMatch(/@container dock \(max-width: 620px\) \{\s*\.step-card \{[^}]*grid-template-areas: 'num actions' 'body body';/);
  });

  it('the docked monitor keeps its content inside the panel', () => {
    expect(rule('.monitor-content')).toMatch(/grid-template-columns: minmax\(0, 3fr\) minmax\(0, 2fr\);/);
    expect(rule('.monitor-docked .monitor-content')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
  });

  it('the sidebar header is one wrapping row, its buttons at the inline end in either direction', () => {
    expect(rule('.sidebar-header')).toMatch(/display: flex;[\s\S]*flex-wrap: wrap;/);
    expect(rule('.sidebar-header-actions')).toMatch(/margin-inline-start: auto;/);
    expect(rule('.lang-btn')).not.toMatch(/margin-left: auto/);
    expect(OVERLAY).toContain('<div className="sidebar-header-actions">');
  });
});

describe('F16 — control states are distinct, and not by colour alone', () => {
  it('focus has its own 3px ring on every focusable control', () => {
    expect(CSS).toMatch(/--focus-ring: #ffd166;/);
    expect(CSS).toMatch(/:where\(button, \[role='button'\], input, select, a, \[tabindex\]\):focus-visible \{\s*outline: 3px solid var\(--focus-ring\) !important;/);
  });

  it('disabled is faded, dashed, desaturated and not-allowed', () => {
    const disabled = CSS.slice(CSS.indexOf("button:disabled,\nbutton[aria-disabled='true'] {"));
    expect(disabled).toMatch(/^[^}]*opacity: 0\.5 !important;/);
    expect(disabled).toMatch(/^[^}]*border-style: dashed !important;/);
    expect(disabled).toMatch(/^[^}]*cursor: not-allowed !important;/);
    expect(disabled).toMatch(/^[^}]*filter: saturate\(0\.25\);/);
    expect(disabled).toMatch(/^[^}]*outline: 1px dashed rgba\(255, 255, 255, 0\.45\);/);
  });

  it('selected is a leading-edge bar and bold text, mirrored for RTL, with aria-pressed', () => {
    const selected = CSS.slice(CSS.indexOf('button.is-selected,\n.guided-footer-btn.is-active {'));
    expect(selected).toMatch(/^[^}]*font-weight: 700 !important;/);
    expect(selected).toMatch(/^[^}]*box-shadow: inset 4px 0 0 var\(--accent-blue\) !important;/);
    expect(CSS).toMatch(/\.rtl button\.is-selected \{ box-shadow: inset -4px 0 0 var\(--accent-blue\) !important; \}/);
    // Deflector choice, mode toggle and panel tabs: class + aria-pressed, no inline colour.
    expect(OVERLAY.match(/' is-selected' : ''\}`\}\s*aria-pressed=/g)).toHaveLength(3);
    expect(OVERLAY).not.toMatch(/border: selectedDeflectorId === d\.id/);
    expect(OVERLAY).toMatch(/className=\{`guided-footer-btn\$\{showSteps \? ' is-active' : ''\}`\}\s*onClick=\{[^}]*\}\s*aria-pressed=\{showSteps\}/);
  });

  it('warnings and notes say what they are in words and an icon, not only in colour', () => {
    expect(OVERLAY).toMatch(/warning-popup is-warning interactive[\s\S]{0,120}<AlertTriangle size=\{18\} aria-hidden="true" \/>\s*<strong className="popup-kind">\{isAr \? 'غير مسموح' : 'Not allowed'\}<\/strong>/);
    expect(OVERLAY).toMatch(/warning-popup is-note interactive[\s\S]{0,200}<Info size=\{18\} aria-hidden="true" \/>\s*<strong className="popup-kind">\{isAr \? 'ملاحظة' : 'Note'\}<\/strong>/);
    expect(rule('.warning-popup.is-note')).toMatch(/border: 1px solid var\(--accent-blue\);/);
  });

  it('the monitor button names what it will do: open, or close once the board is docked', () => {
    expect(OVERLAY).toMatch(/className=\{state\.showMonitor \? 'btn-secondary' : 'btn-primary'\}/);
    expect(OVERLAY).toMatch(/\? 'إغلاق شاشة البيانات'\s*: 'Close Data Monitor'/);
    expect(rule('.guided-chip-code')).toMatch(/white-space: nowrap;/);
  });

  it('success carries a tick as well as green', () => {
    expect(OVERLAY).toMatch(/\{readingsDone && <CheckCircle2 size=\{12\} aria-hidden="true"/);
    expect(OVERLAY).toMatch(/<CheckCircle2/);
  });
});

describe('F16 — enabled controls are readable (WCAG AA 4.5:1)', () => {
  it('the primary dock action keeps its own fill (the blank "Open Data Monitor")', () => {
    expect(CSS).toContain('.guided-controls > button:not(.btn-primary) {');
    expect(CSS).not.toMatch(/^\.guided-controls > button \{/m); // sizing-only rules elsewhere are fine
  });

  it('dark text on the orange and green fills; white only on the deeper danger red', () => {
    expect(rule('.step-card-actions .ok-confirm-btn')).toMatch(/color: #141517;/);
    expect(CSS).toMatch(/\.step-card-actions \.answer-sheet-btn \{ background: var\(--success-green\); color: #141517;/);
    expect(CSS).toMatch(/--danger-fill: #c81e4a;/);
    expect(contrast('#141517', '#f58220')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#141517', '#4caf50')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', '#c81e4a')).toBeGreaterThanOrEqual(4.5);
    // What they replaced, for the record.
    expect(contrast('#ffffff', '#f58220')).toBeLessThan(4.5);
    expect(contrast('#ffffff', '#ff3d71')).toBeLessThan(4.5);
  });

  it('destructive outline buttons have a solid backing and a lighter red', () => {
    expect(rule('.is-danger:not(.btn-primary)')).toMatch(/background: rgba\(20, 21, 23, 0\.92\) !important;[\s\S]*color: #ff6b8e !important;/);
    expect(contrast('#ff6b8e', '#141517')).toBeGreaterThanOrEqual(4.5);
    expect(OVERLAY).toContain('className="btn-secondary is-danger"');
    expect(OVERLAY).toContain('className="weight-add-btn is-danger"');
    expect(OVERLAY).not.toMatch(/opacity: onTop \? 1 : 0\.45/);
  });

  it('every filled danger action uses the readable red', () => {
    expect(MONITOR).toMatch(/background: 'var\(--danger-fill\)', color: '#fff'/);
    expect(RESET).toContain('var(--danger-fill)');
    expect(SHEET).toContain('var(--danger-fill)');
    expect(rule('.warning-popup')).toMatch(/background: rgba\(200, 30, 74, 0\.97\);/);
  });
});
