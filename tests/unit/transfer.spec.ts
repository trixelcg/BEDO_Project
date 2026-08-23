import { describe, expect, it } from 'vitest';
import {
  RETURN_SECONDS,
  TRANSFER_SECONDS,
  addedWeightIndex,
  createTransferSet,
  directionOf,
  durationOf,
  easeInOutCubic,
  removedWeightIndex,
} from '../../src/interaction/transfer';

/**
 * The two-second physical transfer (BEDO-021 §9, BEDO-021b).
 *
 * The number is not a design decision and this is where that is written down:
 * `Jetforce_Storyboard.pptx` says "in 2 seconds" for the deflector on sl. 7, 8 and 14, and
 * for the weight on sl. 15 ("moves to the tank holder", per denomination), sl. 16 ("in 2
 * seconds"), and sl. 29, 30 and 32 ("The weight moved to the tank holder in 2 sec").
 *
 * BEDO-021 built the deflector's install and the disc coming *off* the holder. BEDO-021b
 * added the disc going *on*, which the storyboard specifies four times over and which the
 * application had been performing instantly.
 */

describe('durations', () => {
  it('gives BEDO its two seconds, for every transfer the storyboard specifies', () => {
    expect(TRANSFER_SECONDS).toBe(2);
    expect(durationOf('deflector-install')).toBe(2);
    expect(durationOf('weight-install')).toBe(2);
    expect(durationOf('weight-removal')).toBe(2);
  });

  it('takes the same two seconds in both directions', () => {
    // sl. 32 lists them as one pair on one state: "Click on the weight -> The weight moved
    // to the tank holder in 2 sec" and "Click on the weight on holder -> The weight removed
    // from the tank holder in 2 sec". One move, two directions, one duration.
    expect(durationOf('weight-install')).toBe(durationOf('weight-removal'));
  });

  it('recovers from a miss briskly — implementation timing, not source truth', () => {
    expect(durationOf('return-to-source')).toBe(RETURN_SECONDS);
    expect(RETURN_SECONDS).toBeLessThan(TRANSFER_SECONDS);
  });
});

describe('direction', () => {
  it('names which way each weight is going', () => {
    expect(directionOf('weight-install')).toBe('TO_HOLDER');
    expect(directionOf('weight-removal')).toBe('TO_TRAY');
  });

  it('has nothing to say about a deflector or a recovery', () => {
    // A deflector has its own destination, and a return goes wherever the gesture began.
    expect(directionOf('deflector-install')).toBeNull();
    expect(directionOf('return-to-source')).toBeNull();
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

describe('reading which disc arrived on the holder', () => {
  it('finds the position that filled', () => {
    expect(addedWeightIndex([], [50])).toBe(0);
    expect(addedWeightIndex([50], [50, 100])).toBe(1);
    expect(addedWeightIndex([50, 100], [50, 100, 200])).toBe(2);
  });

  it('reports a position for duplicate denominations, not a mass', () => {
    // BEDO-022's identity-by-position. A second 50 g disc is a second disc, and it gets a
    // seat of its own — the answer is where it went, never what it weighs.
    expect(addedWeightIndex([50], [50, 50])).toBe(1);
    expect(addedWeightIndex([50, 50], [50, 50, 100])).toBe(2);
    expect(addedWeightIndex([100], [50, 100])).toBe(0);
  });

  it('says nothing when the pan is cleared, or when nothing changed', () => {
    // A reading step ends with REMOVE_ALL_WEIGHTS; that is the lesson tidying up, not a
    // learner adding anything, and BEDO gives it no transfer.
    expect(addedWeightIndex([50, 100], [])).toBeNull();
    expect(addedWeightIndex([50], [50])).toBeNull();
    expect(addedWeightIndex([], [])).toBeNull();
  });

  it('says nothing when a disc was removed', () => {
    expect(addedWeightIndex([50, 100], [50])).toBeNull();
  });

  it('says nothing when the list changed in a way no single addition explains', () => {
    expect(addedWeightIndex([50], [100, 200])).toBeNull();
    expect(addedWeightIndex([50, 100], [50, 200, 100, 500])).toBeNull();
  });

  it('is the exact inverse of a removal, which is what makes a roundtrip possible', () => {
    // BEDO-021b §26: add a disc, take the same one off, and the two observers must agree
    // about which position was involved.
    const before = [50, 100];
    const after = [50, 100, 200];
    const index = addedWeightIndex(before, after);
    expect(index).not.toBeNull();
    expect(removedWeightIndex(after, before)).toBe(index);
  });
});

describe('one flight per disc', () => {
  it('will not start a second transfer under an id already in the air', () => {
    // The arrival observer and the handler that dispatched the action can both see the
    // same accepted ADD_WEIGHT. Only one disc may fly.
    const transfers = createTransferSet();
    transfers.start('weight:0', 'weight-install');
    transfers.start('weight:0', 'weight-install');
    transfers.start('weight:0', 'weight-removal');
    expect(transfers.size).toBe(1);
    expect(transfers.kindOf('weight:0')).toBe('weight-install');
  });

  it('lets discs bound for different seats fly at once', () => {
    // Balancing a reading means three or four discs in quick succession, and the runtime
    // gave each one its own seat when it was clicked, so none can collide with another.
    const transfers = createTransferSet();
    transfers.start('weight:0', 'weight-install');
    transfers.start('weight:1', 'weight-install');
    transfers.start('weight:2', 'weight-install');
    expect(transfers.size).toBe(3);

    transfers.advance(TRANSFER_SECONDS / 2);
    expect(transfers.progressOf('weight:0')).toBeCloseTo(0.5, 6);
    expect(transfers.progressOf('weight:2')).toBeCloseTo(0.5, 6);
  });

  it('cancels an arrival without delivering it', () => {
    // What a reset, an experiment switch or a mid-flight REMOVE_ALL_WEIGHTS does. The
    // flight simply stops; nothing arrives, so no late callback can add anything.
    const transfers = createTransferSet();
    transfers.start('weight:0', 'weight-install');
    transfers.cancel('weight:0');
    expect(transfers.has('weight:0')).toBe(false);
    expect(transfers.advance(TRANSFER_SECONDS * 2)).toEqual([]);
  });
});
