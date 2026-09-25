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

export function showCursorTooltip(text: string, dir: 'ltr' | 'rtl', at?: { x: number; y: number }): void {
  const node = ensure();
  if (!node) return;
  listen();
  if (at) {
    lastX = at.x;
    lastY = at.y;
  }
  if (node.textContent !== text) node.textContent = text;
  node.dir = dir;
  node.hidden = false;
  visible = true;
  position();
}

export function hideCursorTooltip(): void {
  visible = false;
  if (el) el.hidden = true;
}

/** The label currently shown, or null — for the browser checks. */
export function currentCursorTooltip(): string | null {
  return visible && el ? el.textContent : null;
}
