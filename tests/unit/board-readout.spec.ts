import { describe, expect, it, vi } from 'vitest';
import { boardSignature, drawBoard, type BoardValues } from '../../src/components/boardReadout';
import { GRAVITY_MS2, NOZZLE_AREA_M2, jetState } from '../../src/domain/physics';
import { getDeflector } from '../../src/domain/apparatus';

/**
 * The values printed on the physical board (BEDO-UX-14).
 *
 * The board is a texture, so there is no DOM to query and no element to assert on. What
 * can be pinned is the two things that decide what a learner sees: the formatting passed
 * to the canvas, and the signature that decides whether the canvas is repainted at all.
 *
 * The board must never derive anything. Every number here arrives already computed by the
 * domain — the same `jetState` the software monitor and the results table read — so these
 * tests check the values are *carried*, not recalculated.
 */

const values = (over: Partial<BoardValues> = {}): BoardValues => {
  const jet = jetState(0.35, 90);
  return {
    deflectorAngle: 90,
    deflectorName: 'Flat surface (90°)',
    momentumFactor: getDeflector(90).momentumFactor,
    nozzleMm: 2 * Math.sqrt(NOZZLE_AREA_M2 / Math.PI) * 1000,
    nozzleAreaM2: NOZZLE_AREA_M2,
    valvePct: 35,
    flowLMin: jet.flowRateLMin,
    flowM3S: jet.flowRateM3S,
    nozzleVelocity: jet.nozzleVelocityMS,
    impactVelocity: jet.impactVelocityMS,
    theoreticalForceN: jet.theoreticalForceN,
    loadedMassG: 0,
    measuredForceN: 0,
    rows: [],
    ...over,
  };
};

/** A 2D context that records what was written, so the drawing can be asserted. */
const recordingContext = () => {
  const text: string[] = [];
  const ctx = {
    clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), roundRect: vi.fn(),
    fillText: (t: string) => text.push(t),
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
    textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, text };
};

describe('the physical board readout', () => {
  it('prints the nozzle bore derived from the domain constant', () => {
    const { ctx, text } = recordingContext();
    drawBoard(ctx, values());
    expect(text.join(' ')).toContain('Ø 10 mm');
  });

  it('prints the flow the domain computed, not a rounded retelling', () => {
    const { ctx, text } = recordingContext();
    drawBoard(ctx, values());
    // 0.35 on the pump curve is 8.283 L/min — the figure the monitor shows too.
    expect(text.join(' ')).toContain(jetState(0.35, 90).flowRateLMin.toFixed(3));
    expect(jetState(0.35, 90).flowRateLMin).toBeCloseTo(8.283, 3);
  });

  it('prints the tray mass and its weight', () => {
    const { ctx, text } = recordingContext();
    drawBoard(ctx, values({ loadedMassG: 150, measuredForceN: (150 * GRAVITY_MS2) / 1000 }));
    expect(text).toContain('150');
    expect(text).toContain('1.472');
  });

  it('marks the installed deflector with its momentum factor', () => {
    const { ctx, text } = recordingContext();
    drawBoard(ctx, values({ deflectorAngle: 135, momentumFactor: getDeflector(135).momentumFactor }));
    expect(text.join(' ')).toContain('k = 1.707');
  });

  it('leaves a row blank until the lesson has recorded it', () => {
    const row = {
      recorded: false, flowLMin: 15.714, flowM3S: 2.619e-4,
      nozzleVelocity: 3.336, impactVelocity: 3.232, theoreticalForceN: 0.8199, measuredForceN: null,
    };
    const blank = recordingContext();
    drawBoard(blank.ctx, values({ rows: [row] }));
    expect(blank.text.join(' '), 'an unrecorded reading must not appear').not.toContain('15.714');

    const taken = recordingContext();
    drawBoard(taken.ctx, values({ rows: [{ ...row, recorded: true }] }));
    expect(taken.text).toContain('15.714');
  });

  it('shows F_ac as a dash until Calculate has run', () => {
    const row = {
      recorded: true, flowLMin: 15.714, flowM3S: 2.619e-4,
      nozzleVelocity: 3.336, impactVelocity: 3.232, theoreticalForceN: 0.8199,
      measuredForceN: null as number | null,
    };
    const before = recordingContext();
    drawBoard(before.ctx, values({ rows: [row] }));
    expect(before.text).toContain('—');

    const after = recordingContext();
    drawBoard(after.ctx, values({ rows: [{ ...row, measuredForceN: 0.7358 }] }));
    expect(after.text).toContain('0.7358');
  });
});

describe('the board repaint signature', () => {
  it('is stable while nothing the board shows has changed', () => {
    expect(boardSignature(values())).toBe(boardSignature(values()));
  });

  it('changes when a printed value changes', () => {
    const base = boardSignature(values());
    expect(boardSignature(values({ loadedMassG: 50 }))).not.toBe(base);
    expect(boardSignature(values({ deflectorAngle: 135 }))).not.toBe(base);
    const faster = jetState(0.6, 90);
    expect(
      boardSignature(values({ flowLMin: faster.flowRateLMin, valvePct: 60 }))
    ).not.toBe(base);
  });

  it('ignores what the board does not print, so the texture is not re-uploaded', () => {
    // The deflector's name is not drawn — only its angle and k are — so changing the
    // language must not force a repaint of the board.
    expect(boardSignature(values({ deflectorName: 'عاكس مسطح (90 درجة)' }))).toBe(
      boardSignature(values())
    );
  });
});
