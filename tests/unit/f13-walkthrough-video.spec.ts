import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { clampTime, formatTime, SKIP_SECONDS, ARROW_SECONDS } from '../../src/lib/videoPlayback';

/**
 * F13 — the walkthrough video player trapped the learner (QA, 2026-09-29).
 *
 * The behaviour is driven in `tests/integration/walkthrough-video.spec.tsx` (jsdom, a fake
 * media element) and in the browser (`docs/60`). These pin the causes found, so they
 * cannot come back unnoticed.
 */

const source = (path: string) => readFileSync(path, 'utf8');
const PLAYER = source('src/components/WalkthroughVideo.tsx');
const OVERLAY = source('src/components/UIOverlay.tsx');
const SERVER = source('server.ts');

describe('cause 1 — the modal took no pointer input', () => {
  it('the player is `interactive` (`.ui-container` is pointer-events: none) and a modal dialog', () => {
    expect(PLAYER).toMatch(/className="monitor-fullscreen interactive walkthrough-video"/);
    expect(PLAYER).toMatch(/role="dialog"/);
    expect(PLAYER).toMatch(/aria-modal="true"/);
  });

  it('it is portalled to <body> and stacks above the docked Data Monitor', () => {
    // Inside `.ui-container` (z-index 10) no z-index could lift it over the monitor (100).
    expect(PLAYER).toMatch(/return createPortal\(/);
    expect(PLAYER).toMatch(/document\.body\s*\);\s*\};\s*$/);
    const css = source('src/index.css');
    const rule = css.slice(css.indexOf('.walkthrough-video {'), css.indexOf('}', css.indexOf('.walkthrough-video {')));
    expect(rule).toMatch(/position: fixed;/);
    expect(rule).toMatch(/z-index: 2000;/);
  });

  it('the overlay renders only the player component — no second inline <video>', () => {
    expect(OVERLAY).not.toMatch(/<video/);
    expect(OVERLAY).toMatch(/<WalkthroughVideo isArabic=\{isAr\} onClose=\{\(\) => setShowVideo\(false\)\} \/>/);
  });
});

describe('cause 2 — no way out but a reload', () => {
  it('Escape closes, in the capture phase, ahead of the app’s own Escape handlers', () => {
    expect(PLAYER).toMatch(/window\.addEventListener\('keydown', onKey, true\)/);
    expect(PLAYER).toMatch(/if \(event\.key === 'Escape'\) \{[\s\S]{0,120}stopImmediatePropagation\(\);\s*close\(\);/);
  });

  it('nothing about the video gates Close: it is never disabled', () => {
    const closeButton = PLAYER.slice(PLAYER.indexOf('<button ref={closeRef}'), PLAYER.indexOf('</button>', PLAYER.indexOf('<button ref={closeRef}')));
    expect(closeButton).not.toMatch(/disabled/);
    expect(closeButton).toMatch(/onClick=\{close\}/);
  });

  it('the player holds no simulator state and sends no commands', () => {
    const imports = PLAYER.match(/from '[^']+'/g);
    expect(imports).toEqual(["from 'react'", "from 'react-dom'", "from '../lib/videoPlayback'"]);
    const code = PLAYER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/dispatch|runtime|simulation|\binteract\(/);
    // Its only way out to the app is `onClose`.
    expect(code.match(/onCloseRef\.current\(\)/g)).toHaveLength(1);
  });
});

describe('cause 3 — the production server could not serve a byte range', () => {
  it('answers Range with 206 and Content-Range, bad ranges with 416, and advertises ranges', () => {
    expect(SERVER).toMatch(/res\.setHeader\('Accept-Ranges', 'bytes'\)/);
    expect(SERVER).toMatch(/res\.statusCode = 206;/);
    expect(SERVER).toMatch(/`bytes \$\{span\.start\}-\$\{span\.end\}\/\$\{size\}`/);
    expect(SERVER).toMatch(/res\.statusCode = 416;/);
  });

  it('every file response goes through the range-aware path (local, runtime and GCS)', () => {
    expect(SERVER.match(/sendLocalFile\(req, res, /g)).toHaveLength(2);
    expect(SERVER).toMatch(/file\.createReadStream\(\{ start: span\.start, end: span\.end \}\)/);
    // No whole-file stream is left outside `sendLocalFile`.
    expect(SERVER.match(/fs\.createReadStream\(/g)).toHaveLength(1);
  });
});

describe('the controls', () => {
  it('seek positions are clamped to the video', () => {
    expect(clampTime(-4, 120)).toBe(0);
    expect(clampTime(50, 120)).toBe(50);
    expect(clampTime(130, 120)).toBe(120);
    expect(clampTime(NaN, 120)).toBe(0);
    // Before metadata the duration is NaN: nowhere to go but the start.
    expect(clampTime(10, NaN)).toBe(0);
  });

  it('times read m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9.9)).toBe('0:09');
    expect(formatTime(95.5)).toBe('1:35');
    expect(formatTime(NaN)).toBe('0:00');
  });

  it('skip sizes', () => {
    expect([SKIP_SECONDS, ARROW_SECONDS]).toEqual([10, 5]);
  });

  it('play() rejections are caught, and the button follows the element’s events', () => {
    expect(PLAYER).toMatch(/v\.play\(\)\?\.catch\(/);
    expect(PLAYER).toMatch(/onPlay=\{\(\) => setPlaying\(true\)\}/);
    expect(PLAYER).toMatch(/onPause=\{\(\) => setPlaying\(false\)\}/);
    expect(PLAYER).toMatch(/onSeeked=/);
  });
});
