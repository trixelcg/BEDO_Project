/**
 * Pointer plumbing for dragging an object in the 3D scene.
 *
 * The scene's half of `src/interaction/drag.ts`: that module decides what a gesture
 * *means*, this one deals with the browser — pointer capture, which pointer owns the
 * gesture, and keeping OrbitControls out of the way while an object is being carried.
 *
 * Everything here is refs. A drag produces sixty pointer moves a second and not one of
 * them is a React render: the caller is handed the live session imperatively and moves its
 * own three.js objects. `BEDO-021 §34` asks that dragging cost no permanent frames, and
 * re-rendering the apparatus on every pointer move would have been the expensive way to
 * lose that.
 *
 * ## Pointer events, not mouse events
 *
 * Desktop is the primary target and no mobile UX is promised, but the handlers are pointer
 * handlers throughout, so a touch or a stylus behaves rather than throws. A second pointer
 * arriving mid-drag is ignored rather than allowed to steal the object, and every exit —
 * drop, cancel, lost capture, unmount — runs the same teardown, so there is no path that
 * leaves the scene holding a pointer it will never hear from again (`§16`, `§17`).
 *
 * ## OrbitControls
 *
 * Camera navigation is suspended for the life of the gesture — from the press, not from
 * the moment the threshold is passed. three's `OrbitControls` begins orbiting on
 * `pointerdown`, so waiting for the threshold means the first few pixels of every drag
 * also swing the camera. It checks `enabled` in both its `pointerdown` and its
 * `pointermove` handler, so clearing the flag inside our own `pointerdown` stops it
 * whichever order the two listeners run in. It is restored on every exit path, including
 * unmount (`§14`).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import type * as THREE from 'three';
import {
  beginDrag,
  dragThresholdPx,
  resolveDrop,
  trackPointer,
  type DragSession,
  type DragSource,
  type DropOutcome,
} from '../interaction/drag';

/** The capture handle R3F hands to an event handler. */
interface CaptureTarget {
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
}

export interface ObjectDragCallbacks {
  /** Whether a press on this source may begin a gesture at all. Asked once, at press. */
  canDrag(source: DragSource): boolean;
  /** Is the pointer over this source's drop region? Geometry only — never policy. */
  isOverTarget(source: DragSource, ray: THREE.Ray): boolean;
  /** Raise whatever follows the pointer. */
  onGrab(source: DragSource): void;
  /** Place it. Called only once the gesture has become a drag. */
  onCarry(session: DragSession, ray: THREE.Ray): void;
  /**
   * The gesture ended.
   *
   * `commit` and `activate` both mean *put this to the gate*; `return` means the learner
   * missed and nothing should be asked of the simulation at all.
   */
  onRelease(session: DragSession, outcome: DropOutcome): void;
}

export interface ObjectDragHandlers {
  onPointerDown(event: ThreeEvent<PointerEvent>): void;
  onPointerMove(event: ThreeEvent<PointerEvent>): void;
  onPointerUp(event: ThreeEvent<PointerEvent>): void;
}

export interface ObjectDrag {
  /** Handlers to spread onto the hit proxy for one draggable source. */
  handlersFor(source: DragSource): ObjectDragHandlers;
  /** The gesture in flight, read straight from the ref. Never triggers a render. */
  current(): DragSession | null;
  /** Abandons any gesture without committing. Used by resets and experiment switches. */
  cancel(): void;
}

export function useObjectDrag(callbacks: ObjectDragCallbacks): ObjectDrag {
  const controls = useThree((state) => state.controls) as
    | (THREE.EventDispatcher & { enabled: boolean })
    | null;
  const domElement = useThree((state) => state.gl?.domElement) as HTMLCanvasElement | undefined;

  const session = useRef<DragSession | null>(null);
  const capture = useRef<{ target: CaptureTarget; pointerId: number } | null>(null);
  /** OrbitControls' `enabled` as we found it, so suspending is reversible. */
  const orbitWasEnabled = useRef<boolean | null>(null);

  // Read through a ref so the handlers below never go stale and never need rebuilding.
  const api = useRef(callbacks);
  api.current = callbacks;

  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const suspendOrbit = useCallback(() => {
    const orbit = controlsRef.current;
    if (!orbit || orbitWasEnabled.current !== null) return;
    orbitWasEnabled.current = orbit.enabled;
    orbit.enabled = false;
  }, []);

  const restoreOrbit = useCallback(() => {
    const orbit = controlsRef.current;
    if (orbit && orbitWasEnabled.current !== null) orbit.enabled = orbitWasEnabled.current;
    orbitWasEnabled.current = null;
  }, []);

  /** The one teardown. Every exit path goes through it, so none can leave state behind. */
  const teardown = useCallback(() => {
    const held = capture.current;
    // Cleared *before* the release, because `releasePointerCapture` queues a
    // `lostpointercapture` event on the canvas and the listener below must be able to tell
    // "the browser took this gesture away" from "we finished with it".
    capture.current = null;
    session.current = null;
    if (held) {
      // Releasing a pointer that has already gone (a cancelled gesture, a closed tab)
      // throws in some browsers; the point is to end up holding nothing either way.
      try {
        held.target.releasePointerCapture(held.pointerId);
      } catch {
        /* already released */
      }
    }
    restoreOrbit();
    if (typeof document !== 'undefined') document.body.style.cursor = 'default';
  }, [restoreOrbit]);

  /** A gesture that ends without reaching the gate: cancel, lost capture, unmount. */
  const abandon = useCallback(() => {
    const active = session.current;
    teardown();
    if (active) api.current.onRelease(active, 'return');
  }, [teardown]);

  useEffect(() => () => abandon(), [abandon]);

  /**
   * The gestures the browser ends for us.
   *
   * These have to be native listeners rather than props on the proxy: R3F handles
   * `pointercancel` and `lostpointercapture` itself — it uses them to flush its hover
   * bookkeeping — and never forwards either to an object's handlers, so a gesture the
   * system tears down (a context menu, a window losing focus, a touch cancelled by a
   * scroll) would otherwise leave the session open, the camera locked and the object
   * stranded in mid-air. `BEDO-021 §16`, `§23`.
   */
  useEffect(() => {
    const canvas = domElement;
    if (!canvas) return;
    const owner = canvas.ownerDocument;
    const onLost = (event: PointerEvent) => {
      if (capture.current?.pointerId === event.pointerId) abandon();
    };
    canvas.addEventListener('pointercancel', onLost);
    canvas.addEventListener('lostpointercapture', onLost);
    owner.addEventListener('pointercancel', onLost);
    return () => {
      canvas.removeEventListener('pointercancel', onLost);
      canvas.removeEventListener('lostpointercapture', onLost);
      owner.removeEventListener('pointercancel', onLost);
    };
  }, [domElement, abandon]);

  const handlersFor = useCallback(
    (source: DragSource): ObjectDragHandlers => ({
      onPointerDown(event) {
        // One object at a time, primary button only. A second pointer landing on another
        // deflector while one is already in hand is dropped on the floor, not honoured.
        if (session.current) return;
        if (event.button !== undefined && event.button !== 0) return;
        if (!api.current.canDrag(source)) return;

        event.stopPropagation();
        const point = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
        session.current = beginDrag(source, event.pointerId, point);

        // Capture on the canvas, so the gesture survives the pointer crossing another
        // mesh or leaving the canvas entirely.
        const target = event.target as unknown as CaptureTarget;
        try {
          target.setPointerCapture(event.pointerId);
          capture.current = { target, pointerId: event.pointerId };
        } catch {
          // No capture available (synthetic events in a test renderer). The gesture still
          // works while the pointer stays over the scene.
        }

        suspendOrbit();
        if (typeof document !== 'undefined') document.body.style.cursor = 'grabbing';
        api.current.onGrab(source);
      },

      onPointerMove(event) {
        const active = session.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.stopPropagation();

        const point = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
        const next = trackPointer(active, event.pointerId, point, {
          overValidTarget: api.current.isOverTarget(active.source, event.ray),
          thresholdPx: dragThresholdPx(
            typeof window === 'undefined' ? 1 : window.devicePixelRatio
          ),
        });
        if (next === active) return;
        session.current = next;
        if (next.isDragging) api.current.onCarry(next, event.ray);
      },

      onPointerUp(event) {
        const active = session.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.stopPropagation();

        const outcome = resolveDrop(active, event.pointerId);
        teardown();
        api.current.onRelease(active, outcome);
      },

    }),
    [suspendOrbit, teardown]
  );

  return useMemo(
    () => ({
      handlersFor,
      current: () => session.current,
      cancel: () => {
        if (session.current) abandon();
      },
    }),
    [handlersFor, abandon]
  );
}
