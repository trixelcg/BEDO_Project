// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The pointer plumbing (BEDO-021 §14, §16, §17, §23, §29).
 *
 * `useObjectDrag` is the one piece of the drag path that touches the browser, so it is
 * tested against a browser rather than against three.js: a fake `OrbitControls`, a real
 * jsdom canvas, and hand-built pointer events. Nothing here renders a scene — the
 * questions are "is the camera released again", "does a second finger steal the object",
 * "is the capture always given back", and none of them needs a GPU.
 */

const controls = { enabled: true };
const canvas = { current: null as HTMLCanvasElement | null };

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: any) => unknown) =>
    selector({ controls, gl: { domElement: canvas.current } }),
}));

const { useObjectDrag } = await import('../../src/components/useObjectDrag');
import type { DragSource, DropOutcome } from '../../src/interaction/drag';

const DEFLECTOR: DragSource = { kind: 'deflector', deflectorId: 90 };

/** A stand-in for R3F's synthetic pointer event. */
const pointerEvent = (
  pointerId: number,
  x: number,
  y: number,
  extra: Record<string, unknown> = {}
) =>
  ({
    pointerId,
    button: 0,
    stopPropagation: () => {},
    nativeEvent: { clientX: x, clientY: y },
    ray: { fake: true },
    target: {
      setPointerCapture: capture.set,
      releasePointerCapture: capture.release,
    },
    ...extra,
  }) as any;

const capture = { set: vi.fn(), release: vi.fn() };

interface Recorder {
  grabs: DragSource[];
  carries: number;
  releases: { source: DragSource; outcome: DropOutcome }[];
}

const setup = (options: { overTarget?: boolean; canDrag?: boolean } = {}) => {
  const log: Recorder = { grabs: [], carries: 0, releases: [] };
  const view = renderHook(() =>
    useObjectDrag({
      canDrag: () => options.canDrag ?? true,
      isOverTarget: () => options.overTarget ?? false,
      onGrab: (source) => log.grabs.push(source),
      onCarry: () => {
        log.carries += 1;
      },
      onRelease: (session, outcome) => log.releases.push({ source: session.source, outcome }),
    })
  );
  return { log, view, handlers: () => view.result.current.handlersFor(DEFLECTOR) };
};

beforeEach(() => {
  controls.enabled = true;
  capture.set.mockClear();
  capture.release.mockClear();
  canvas.current = document.createElement('canvas');
  document.body.appendChild(canvas.current);
  window.devicePixelRatio = 1;
});

describe('camera navigation', () => {
  it('suspends orbiting for the life of the gesture and restores it on release', () => {
    const { handlers } = setup();
    expect(controls.enabled).toBe(true);

    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    expect(controls.enabled, 'the camera must not swing while an object is carried').toBe(false);

    act(() => handlers().onPointerUp(pointerEvent(1, 100, 100)));
    expect(controls.enabled, 'navigation must come back the moment the drag ends').toBe(true);
  });

  it('restores it after a refused drop, not only after a successful one', () => {
    const { handlers } = setup({ overTarget: false });
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    act(() => handlers().onPointerMove(pointerEvent(1, 300, 300)));
    act(() => handlers().onPointerUp(pointerEvent(1, 300, 300)));
    expect(controls.enabled).toBe(true);
  });

  it('restores it when the browser cancels the gesture', () => {
    const { handlers, log } = setup();
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    act(() => {
      canvas.current!.dispatchEvent(
        new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })
      );
    });
    expect(controls.enabled, 'an interrupted drag must not leave the camera locked').toBe(true);
    expect(log.releases.at(-1)?.outcome, 'a cancelled gesture commits nothing').toBe('return');
  });

  it('restores it if the component unmounts mid-drag', () => {
    const { handlers, view } = setup();
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    expect(controls.enabled).toBe(false);
    act(() => view.unmount());
    expect(controls.enabled).toBe(true);
  });

  it('leaves navigation alone entirely when the press is not on a draggable', () => {
    const { handlers, log } = setup({ canDrag: false });
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    expect(controls.enabled).toBe(true);
    expect(log.grabs).toEqual([]);
  });
});

describe('pointer capture', () => {
  it('takes it on press and gives it back on release', () => {
    const { handlers } = setup();
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    expect(capture.set).toHaveBeenCalledWith(1);
    act(() => handlers().onPointerUp(pointerEvent(1, 140, 100)));
    expect(capture.release).toHaveBeenCalledWith(1);
  });

  it('gives it back on cancel and on unmount too', () => {
    const { handlers, view } = setup();
    act(() => handlers().onPointerDown(pointerEvent(1, 0, 0)));
    act(() => view.unmount());
    expect(capture.release).toHaveBeenCalledWith(1);
  });

  it('survives a browser that refuses to capture', () => {
    capture.set.mockImplementationOnce(() => {
      throw new Error('no capture here');
    });
    const { handlers, log } = setup();
    act(() => handlers().onPointerDown(pointerEvent(1, 0, 0)));
    expect(log.grabs).toHaveLength(1);
    act(() => handlers().onPointerUp(pointerEvent(1, 0, 0)));
    expect(log.releases.at(-1)?.outcome).toBe('activate');
  });
});

describe('one object at a time', () => {
  it('ignores a second pointer arriving mid-drag', () => {
    const { handlers, log } = setup();
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    act(() => handlers().onPointerDown(pointerEvent(2, 400, 400)));
    expect(log.grabs).toHaveLength(1);
  });

  it('ignores moves and releases from a pointer that does not own the gesture', () => {
    const { handlers, log } = setup();
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    act(() => handlers().onPointerMove(pointerEvent(2, 900, 900)));
    act(() => handlers().onPointerUp(pointerEvent(2, 900, 900)));
    expect(log.carries).toBe(0);
    expect(log.releases).toHaveLength(0);
    expect(controls.enabled, 'the real gesture is still running').toBe(false);
  });

  it('ignores a secondary mouse button', () => {
    const { handlers, log } = setup();
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100, { button: 2 })));
    expect(log.grabs).toEqual([]);
    expect(controls.enabled).toBe(true);
  });
});

describe('what a release means', () => {
  it('a press with no travel is a click', () => {
    const { handlers, log } = setup();
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    act(() => handlers().onPointerMove(pointerEvent(1, 102, 100)));
    act(() => handlers().onPointerUp(pointerEvent(1, 102, 100)));
    expect(log.carries, 'a click carries nothing about the scene').toBe(0);
    expect(log.releases).toEqual([{ source: DEFLECTOR, outcome: 'activate' }]);
  });

  it('a drag onto the target commits', () => {
    const { handlers, log } = setup({ overTarget: true });
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    act(() => handlers().onPointerMove(pointerEvent(1, 260, 180)));
    act(() => handlers().onPointerUp(pointerEvent(1, 260, 180)));
    expect(log.carries).toBeGreaterThan(0);
    expect(log.releases).toEqual([{ source: DEFLECTOR, outcome: 'commit' }]);
  });

  it('a drag away from the target returns', () => {
    const { handlers, log } = setup({ overTarget: false });
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    act(() => handlers().onPointerMove(pointerEvent(1, 600, 400)));
    act(() => handlers().onPointerUp(pointerEvent(1, 600, 400)));
    expect(log.releases).toEqual([{ source: DEFLECTOR, outcome: 'return' }]);
  });

  it('scales the threshold to the display', () => {
    window.devicePixelRatio = 4;
    const { handlers, log } = setup({ overTarget: true });
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    // 3 px would be a click on a 1x display; at 4x it is past the threshold.
    act(() => handlers().onPointerMove(pointerEvent(1, 103, 100)));
    act(() => handlers().onPointerUp(pointerEvent(1, 103, 100)));
    expect(log.releases).toEqual([{ source: DEFLECTOR, outcome: 'commit' }]);
  });
});

describe('cancelling from the application', () => {
  it('abandons the gesture and hands back everything it held', () => {
    const { handlers, view, log } = setup();
    act(() => handlers().onPointerDown(pointerEvent(1, 100, 100)));
    act(() => view.result.current.cancel());
    expect(view.result.current.current()).toBeNull();
    expect(controls.enabled).toBe(true);
    expect(capture.release).toHaveBeenCalledWith(1);
    expect(log.releases.at(-1)?.outcome).toBe('return');
  });

  it('is safe to call when nothing is being dragged', () => {
    const { view, log } = setup();
    act(() => view.result.current.cancel());
    expect(log.releases).toEqual([]);
  });
});
