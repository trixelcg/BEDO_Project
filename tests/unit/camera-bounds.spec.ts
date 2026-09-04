import { describe, expect, it } from 'vitest';
import { ROOM_MARGIN, clampToRoom, type Bounds3 } from '../../src/lib/cameraFraming';

/**
 * Keeping the camera inside the laboratory (brief §4.5).
 *
 * The clamp is pure arithmetic on three numbers, so it can be stated exactly: the camera
 * ends up inside the room, on the line to its own subject, and as far back along that line
 * as the room allows.
 */

const room: Bounds3 = { min: [-6.5, 0, -6.4], max: [3.9, 3.5, 4.8] };

/** Is `p` inside `room` with the margin the clamp keeps? */
const inside = (p: readonly [number, number, number], margin = ROOM_MARGIN) =>
  p[0] >= room.min[0] + margin - 1e-6 &&
  p[0] <= room.max[0] - margin + 1e-6 &&
  p[1] >= room.min[1] + margin - 1e-6 &&
  p[1] <= room.max[1] - margin + 1e-6 &&
  p[2] >= room.min[2] + margin - 1e-6 &&
  p[2] <= room.max[2] - margin + 1e-6;

describe('clampToRoom', () => {
  it('leaves a camera that is already inside exactly where it is', () => {
    const position = [-1, 1.4, 0.5] as const;
    expect(clampToRoom(position, [0, 1, 0], room)).toEqual([-1, 1.4, 0.5]);
  });

  it('pulls a camera outside the far wall back inside it', () => {
    // Step 3's symptom: the offset is authored against the part it frames, and pulls the
    // camera through the window behind it.
    const out = clampToRoom([-9, 1.2, 0], [0, 1.2, 0], room);
    expect(inside(out)).toBe(true);
    expect(out[0]).toBeGreaterThan(-9);
  });

  it('keeps the subject centred — it moves along the line, not sideways', () => {
    const lookAt = [0.4, 1.1, -0.3] as const;
    const out = clampToRoom([-9, 4.6, 3], lookAt, room);
    // Same direction from the subject, shorter distance.
    const dirOf = (p: readonly [number, number, number]) => {
      const v = [p[0] - lookAt[0], p[1] - lookAt[1], p[2] - lookAt[2]];
      const n = Math.hypot(...v);
      return v.map((c) => c / n);
    };
    const before = dirOf([-9, 4.6, 3]);
    const after = dirOf(out);
    for (let i = 0; i < 3; i += 1) expect(after[i]).toBeCloseTo(before[i], 6);
  });

  it('stays as far back as the room allows', () => {
    // Not merely inside: on the boundary, so the framing is the widest the room permits.
    const lookAt = [0, 1.2, 0] as const;
    const out = clampToRoom([-20, 1.2, 0], lookAt, room);
    expect(out[0]).toBeCloseTo(room.min[0] + ROOM_MARGIN, 4);
  });

  it('clamps through the ceiling and the floor too', () => {
    expect(inside(clampToRoom([0, 40, 0], [0, 1, 0], room))).toBe(true);
    expect(inside(clampToRoom([0, -40, 0], [0, 1, 0], room))).toBe(true);
  });

  it('leaves the camera alone when the subject itself is outside the room', () => {
    // Nothing sensible to pull back to, and dragging it somewhere arbitrary would be worse
    // than the framing the step asked for.
    const position = [-9, 1, 0] as const;
    expect(clampToRoom(position, [-30, 1, 0], room)).toEqual([-9, 1, 0]);
  });

  it('keeps a margin, because a near plane needs room', () => {
    expect(ROOM_MARGIN).toBeGreaterThan(0);
    const out = clampToRoom([-20, 1.2, 0], [0, 1.2, 0], room);
    expect(out[0] - room.min[0]).toBeGreaterThanOrEqual(ROOM_MARGIN - 1e-6);
  });

  it('is deterministic', () => {
    const a = clampToRoom([-9, 4.6, 3], [0.4, 1.1, -0.3], room);
    const b = clampToRoom([-9, 4.6, 3], [0.4, 1.1, -0.3], room);
    expect(a).toEqual(b);
  });
});
