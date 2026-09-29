// One tooltip that rides above the mouse pointer (BEDO-UX-ENV).
//
// Imperative on purpose. The scene lives in React Three Fiber's reconciler, where a
// `react-dom` portal cannot be rendered, and a world-anchored `<Html>` label stays put while
// the pointer moves. So this owns a single fixed-position element on `document.body` and
// moves it from one passive `pointermove` listener with a transform — no React re-render
// per mouse move, and no raycasting of its own: which part is under the pointer is still
// decided by the scene's existing hit proxies, which call `show` and `hide`.
//
// The element is `pointer-events: none`, so it can never capture a click or steal the
// hover from the part it names.

/** Gap between the cursor tip and the tooltip's nearest edge, CSS px. */
export const TOOLTIP_GAP = 14;
/** Keep this far from every viewport edge, CSS px. */
export const TOOLTIP_MARGIN = 8;

let el: HTMLDivElement | null = null;
let visible = false;
let lastX = -1;
let lastY = -1;
let listening = false;

function ensure(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (el && el.isConnected) return el;
  el = document.createElement('div');
  el.className = 'cursor-tooltip';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

/**
 * Where the tooltip goes for a pointer at (x, y): centred above it, flipped below when the
 * top edge has no room, and clamped inside the viewport either way.
 */
export function placeTooltip(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: { width: number; height: number }
): { left: number; top: number; below: boolean } {
  let left = x - width / 2;
  left = Math.max(TOOLTIP_MARGIN, Math.min(left, viewport.width - width - TOOLTIP_MARGIN));
  let top = y - TOOLTIP_GAP - height;
  let below = false;
  if (top < TOOLTIP_MARGIN) {
    // A cursor is ~20 px tall below its hotspot; clear it when flipping underneath.
    top = y + TOOLTIP_GAP + 18;
    below = true;
  }
  top = Math.max(TOOLTIP_MARGIN, Math.min(top, viewport.height - height - TOOLTIP_MARGIN));
  return { left, top, below };
}

function position() {
  if (!el || !visible || lastX < 0) return;
  const { left, top } = placeTooltip(lastX, lastY, el.offsetWidth, el.offsetHeight, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

function onMove(e: PointerEvent) {
  lastX = e.clientX;
  lastY = e.clientY;
  position();
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('pointermove', onMove, { passive: true });
  // Leaving the window or losing focus must never leave a stale label behind.
  document.documentElement.addEventListener('pointerleave', hideCursorTooltip);
  window.addEventListener('blur', hideCursorTooltip);
}

/** Start tracking the pointer early, so the first `show` already knows where it is. */
export function trackCursorTooltip(): void {
  listen();
}

/**
 * What the tooltip says: the part's name, then what it does and how to open its card
 * (F17). A bare string is still accepted and shown as the name alone.
 */
export type CursorTooltipContent = string | { title: string; body?: string; hint?: string };

/** One key per distinct content, so an unchanged label is not rebuilt on every hover. */
const keyOf = (c: CursorTooltipContent) => (typeof c === 'string' ? c : `${c.title}\u0000${c.body ?? ''}\u0000${c.hint ?? ''}`);
let shownKey = '';

// --- Off while the camera moves (user request, 2026-09-29) ------------------------
//
// While the view is orbiting, panning, zooming or flying, parts stream under the pointer
// and the label flickers from name to name over a moving scene. So camera motion turns
// the tooltip off: `show` still records what the pointer is on, but nothing is drawn
// until the camera has settled, and then the last requested label returns on its own —
// the pointer has not moved, so no new pointer event would re-show it.

let cameraMoving = false;
/** What the last `show` asked for, so a label hidden by camera motion can return. */
let requested: { content: CursorTooltipContent; dir: 'ltr' | 'rtl' } | null = null;

/** The scene reports camera motion here; true hides the tooltip, false lets it back. */
export function setCursorTooltipCameraMoving(moving: boolean): void {
  if (moving === cameraMoving) return;
  cameraMoving = moving;
  if (moving) {
    visible = false;
    if (el) el.hidden = true;
  } else if (requested) {
    showCursorTooltip(requested.content, requested.dir);
  }
}

function render(node: HTMLDivElement, content: CursorTooltipContent) {
  const key = keyOf(content);
  if (key === shownKey && node.childNodes.length) return;
  shownKey = key;
  node.replaceChildren();
  const line = (cls: string, text: string) => {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    node.appendChild(span);
  };
  if (typeof content === 'string') {
    line('cursor-tooltip-title', content);
    return;
  }
  line('cursor-tooltip-title', content.title);
  if (content.body) line('cursor-tooltip-body', content.body);
  if (content.hint) line('cursor-tooltip-hint', content.hint);
}

export function showCursorTooltip(
  content: CursorTooltipContent,
  dir: 'ltr' | 'rtl',
  at?: { x: number; y: number }
): void {
  const node = ensure();
  if (!node) return;
  listen();
  if (at) {
    lastX = at.x;
    lastY = at.y;
  }
  requested = { content, dir };
  if (cameraMoving) return;
  render(node, content);
  node.dir = dir;
  node.hidden = false;
  visible = true;
  position();
}

export function hideCursorTooltip(): void {
  visible = false;
  requested = null;
  if (el) el.hidden = true;
}

/** The part name currently shown, or null — for the browser checks. */
export function currentCursorTooltip(): string | null {
  if (!visible || !el) return null;
  return el.querySelector('.cursor-tooltip-title')?.textContent ?? el.textContent;
}

/** Everything the tooltip currently says, line by line — for the browser checks. */
export function currentCursorTooltipLines(): string[] | null {
  if (!visible || !el) return null;
  return Array.from(el.children).map((c) => c.textContent ?? '');
}
