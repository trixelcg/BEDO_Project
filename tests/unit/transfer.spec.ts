import { describe, expect, it } from 'vitest';
import {
  RETURN_SECONDS,
  TRANSFER_SECONDS,
  createTransferSet,
  durationOf,
  easeInOutCubic,
  removedWeightIndex,
} from '../../src/interaction/transfer';

/**
 * The two-second physical transfer (BEDO-021 §9).
 *
 * The number is not a design decision and this is where that is written down:
 * `Jetforce_Storyboard.pptx` says "in 2 seconds" for the deflector on sl. 7, 8 and 14, and
 * "in 2 sec" for the weight on sl. 16, 29, 30 and 32.
 */

describe('durations', () => {
  it('gives BEDO its two seconds, for both transfers the storyboard specifies', () => {
    expect(TRANSFER_SECONDS).toBe(2);
    expect(durationOf('deflector-install')).toBe(2);
    expect(durationOf('weight-removal')).toBe(2);
  });

  it('recovers from a miss briskly — implementation timing, not source truth', () => {
    expect(durationOf('return-to-source')).toBe(RETURN_SECONDS);
    expect(RETURN_SECONDS).toBeLessThan(TRANSFER_SECONDS);
  });
});

describe('easing', () => {
  it('starts and ends at rest, and is symmetric about the middle', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 10);
  });

  it('is monotonic, so a part never backs up mid-flight', () => {
    let previous = -1;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const y = easeInOutCubic(Math.min(x, 1));
      expect(y).toBeGreaterThanOrEqual(previous);
      previous = y;
    }
  });
});

describe('the set of flights', () => {
  it('is empty, and costs nothing, when the scene is at rest', () => {
    const transfers = createTransferSet();
    expect(transfers.size).toBe(0);
    expect(transfers.advance(0.016)).toEqual([]);
    expect(transfers.progressOf('deflector:90')).toBeNull();
  });

  it('runs for exactly the specified time and then reports itself settled', () => {
    const transfers = createTransferSet();
    transfers.start('deflector:90', 'deflector-install');

    // 1.98 s in — still flying.
    for (let i = 0; i < 99; i++) expect(transfers.advance(0.02)).toEqual([]);
    expect(transfers.has('deflector:90')).toBe(true);
    expect(transfers.progressOf('deflector:90')).toBeGreaterThan(0.99);

    expect(transfers.advance(0.02)).toEqual(['deflector:90']);
    expect(transfers.has('deflector:90')).toBe(false);
    expect(transfers.size).toBe(0);
  });

  it('is unaffected by frame rate — two seconds is two seconds', () => {
    const smooth = createTransferSet();
    const stuttering = createTransferSet();
    smooth.start('a', 'weight-removal');
    stuttering.start('a', 'weight-removal');
    for (let i = 0; i < 60; i++) smooth.advance(1 / 60);
    stuttering.advance(1);
    expect(smooth.progressOf('a')).toBeCloseTo(stuttering.progressOf('a')!, 10);
  });

  it('ignores a restart of a flight already in the air', () => {
    // An accepted SELECT_DEFLECTOR can be noticed twice — by the handler that dispatched
    // it and by the state-transition observer that catches the 2D panel. One ghost.
    const transfers = createTransferSet();
    transfers.start('deflector:90', 'deflector-install');
    transfers.advance(1);
    transfers.start('deflector:90', 'deflector-install');
    expect(transfers.size).toBe(1);
    expect(transfers.progressOf('deflector:90')).toBeCloseTo(easeInOutCubic(0.5), 10);
  });

  it('cancels without settling, so an interrupted flight triggers no arrival', () => {
    const transfers = createTransferSet();
    transfers.start('weight:0', 'weight-removal');
    transfers.advance(0.5);
    transfers.cancel('weight:0');
    expect(transfers.advance(5)).toEqual([]);
    expect(transfers.size).toBe(0);
  });

  it('clears everything at once, for a reset or an experiment switch', () => {
    const transfers = createTransferSet();
    transfers.start('deflector:90', 'deflector-install');
    transfers.start('weight:0', 'weight-removal');
    transfers.clear();
    expect(transfers.size).toBe(0);
    expect(transfers.advance(5)).toEqual([]);
  });
});

describe('reading which disc left the holder', () => {
  it('finds the position that emptied', () => {
    expect(removedWeightIndex([50, 100, 200], [100, 200])).toBe(0);
    expect(removedWeightIndex([50, 100, 200], [50, 200])).toBe(1);
    expect(removedWeightIndex([50, 100, 200], [50, 100])).toBe(2);
    expect(removedWeightIndex([500], [])).toBe(0);
  });

  it('reports a position for duplicate denominations, not a mass', () => {
    // BEDO-022's identity rule survives: two 100 g discs are two discs, and one of them
    // left. Which of the two is genuinely undetermined by the state alone — the lists are
    // equal up to the last position — so this reports the topmost consistent one, which
    // is the disc that was on top of the pile and the one a learner would expect to see
    // lifted. The runtime's own answer is unaffected either way: it removed by index.
    expect(removedWeightIndex([100, 100], [100])).toBe(1);
    expect(removedWeightIndex([50, 100, 100], [50, 100])).toBe(2);
    // Where the masses differ there is no ambiguity at all.
    expect(removedWeightIndex([100, 50, 100], [100, 100])).toBe(1);
  });

  it('says nothing when the whole tray is cleared between readings', () => {
    // REMOVE_ALL_WEIGHTS is the lesson tidying up, and BEDO gives it no transfer.
    expect(removedWeightIndex([50, 100], [])).toBeNull();
  });

  it('says nothing when a disc was added, or when nothing changed', () => {
    expect(removedWeightIndex([50], [50, 100])).toBeNull();
    expect(removedWeightIndex([50], [50])).toBeNull();
    expect(removedWeightIndex([], [])).toBeNull();
  });

  it('says nothing when the list changed in a way no single removal explains', () => {
    expect(removedWeightIndex([50, 100, 200], [50, 500])).toBeNull();
  });
});
