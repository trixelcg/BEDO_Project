# 68 — The part tooltip is off while the camera moves

This is a working-tree change on top of F03–F19 and docs/67. It is not committed and not deployed.

**Request (user, 2026-09-29):** “make tool tip for objects off when camera move.”

## What it does

While the view is in motion — orbiting, panning, zooming, OrbitControls' damping tail, the guided rig's flights, the cover-lift reframe — parts stream under the pointer and the F17 hover label flickers from name to name over a moving scene. Now any camera motion turns the tooltip off, and it comes back by itself once the view has settled.

## How

* **`src/lib/cursorTooltip.ts`** — a camera-motion switch (`setCursorTooltipCameraMoving`). While it is on, `show` still records what the pointer is on but draws nothing; turning it off re-shows the last requested label on its own, because the pointer has not moved, so no new pointer event would bring it back. An owner `hide` also forgets the request, so nothing stale returns later.
* **`src/components/Scene3D.tsx`** — `CameraMotionGate`, mounted in the Canvas. It watches the camera itself each frame (position and quaternion deltas against `CAMERA_STILL_EPSILON`), so every source of motion counts the same with no coupling to who moved the camera. The label may return only after `CAMERA_STILL_FRAMES` (8) consecutive still frames, so the damping tail does not flicker it. Unmounting mid-move switches the tooltip back on.

## Verified

* `f17-component-info.spec.ts` 18 (two new tests pin the suppress/re-show wiring and the frame gate); full suite otherwise identical to the docs/67 baseline; `tsc` clean.
* Live (dev build, driven run 2026-09-29): hover the weight carrier → label shows; camera set rotating → label off for the whole motion; rotation stopped → label returns by itself once the damping tail settles.

## Notes

The label that returns is the last hover the scene knows: three.js sends no pointer-out for a pointer that has not moved, so after a large rotation the named part may sit elsewhere on screen until the mouse next moves. That is the pre-existing F17 hover model, unchanged.
