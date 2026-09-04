// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { click, renderApp, setValve, stubConfigFetch, walkLesson } from '../helpers/app-harness';
import { flowRateLMin } from '../../src/domain/physics';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * The software board as a live instrument (BEDO-UX-12).
 *
 * The board used to show only the results table, which is computed at the four fixed
 * openings the procedure records at — so it could not report the valve the learner was
 * holding, and its "Total Weight" summed the recorded rows rather than the tray. Measured
 * before the fix: with 70 g loaded and the valve at 0.35, the board read `0 g` and showed
 * no flow, velocity or force for the current state at all.
 *
 * What is pinned here is the distinction the board now has to keep: LIVE values follow the
 * rig continuously, RECORDED rows freeze when a reading is taken, and F_ac appears only
 * once Calculate is pressed.
 */

/**
 * The board is a full-viewport overlay (`.monitor-fullscreen`, 100vw x 100vh, opaque), so
 * the valve and the weight buttons are not reachable while it is open. Liveness is
 * therefore exercised the way a learner actually meets it: set the rig, open the board,
 * read it — and, for a second value, close, change, reopen.
 */
const openBoard = () => click('Open Data Monitor');
const closeBoard = () => click(/^Close$/);

/**
 * Free mode, with the pump running.
 *
 * The guided steps each expose only the control that step asks for, so at the step that
 * opens the board the valve and the weights are deliberately not rendered. Free mode is
 * where every control is live at once, which is what these assertions need — and the valve
 * is inert until the pump runs, by domain rule.
 */
const freeRig = () => {
  click('Free Mode');
  click(/Turn On Pump/);
};

/**
 * Free mode with a chosen deflector on the rod.
 *
 * Order matters, and it is the domain's order, not a convenience: the rod is only
 * reachable with the plate unscrewed (`DEFLECTOR_NEEDS_OPEN_COVER`), and the tank may not
 * be opened while the pump is running. So the deflector goes on first, then the cover
 * closes, then the pump starts.
 */
const freeRigWith = (deflector: RegExp) => {
  click('Free Mode');
  click(/Open tank cover/i);
  click(deflector);
  click(/Close tank cover/i);
  click(/Turn On Pump/);
};

const liveCell = (label: string): HTMLElement => {
  const found = Array.from(document.querySelectorAll('.mon-cell')).find((el) =>
    el.querySelector('.mon-lbl')?.textContent?.includes(label)
  );
  if (!found) throw new Error(`no live cell labelled "${label}"`);
  return found as HTMLElement;
};

const liveValue = (label: string): string =>
  liveCell(label).querySelector('.mon-val')?.textContent?.trim() ?? '';

const totalWeightText = (): string => {
  const card = Array.from(document.querySelectorAll('.indicator-card')).find((el) =>
    el.textContent?.includes('Total Weight')
  );
  const spans = card?.querySelectorAll('span');
  return spans?.[spans.length - 1]?.textContent?.trim() ?? '';
};

/** The recorded table, row by row, as the learner sees it. */
const tableRow = (oneBased: number): string[] =>
  Array.from(
    document.querySelectorAll('.data-table tbody tr')[oneBased - 1]?.querySelectorAll('td') ?? []
  ).map((td) => td.textContent?.trim() ?? '');

beforeEach(() => {
  stubConfigFetch();
  renderApp();
});

afterEach(() => {
  cleanup();
  /*
    The language choice is persisted, and `cleanup()` does not touch storage — so the
    Arabic test below left every later test rendering in Arabic, where the pump button
    reads `تشغيل المضخة` and an English query finds nothing. Cleared before the mocks are
    restored, because the reverse order throws inside the hook and leaks a broken global.
  */
  try {
    localStorage.clear();
  } catch {
    // A storage-less environment is fine; there is nothing to clear.
  }
  vi.restoreAllMocks();
});

describe('the live software board', () => {
  it('names the installed deflector with its angle and momentum factor', () => {
    walkLesson(1, 9);
    const cell = liveCell('Installed deflector');
    expect(cell.textContent).toContain('90°');
    expect(cell.textContent).toContain('Flat surface');
    // k = 1.000 for the flat plate — the domain's own momentum factor.
    expect(cell.textContent).toContain('k = 1.000');
  });

  it('reports the nozzle as the 10 mm bore the physics uses', () => {
    walkLesson(1, 9);
    expect(liveValue('Nozzle diameter')).toBe('10 mm');
  });

  it('follows the valve, reporting the flow the pump curve gives', () => {
    freeRig();

    setValve(0.35);
    openBoard();
    expect(liveValue('Valve opening')).toBe('35 %');
    expect(liveValue('Q')).toBe(`${flowRateLMin(0.35).toFixed(3)} L/min`);
    expect(flowRateLMin(0.35)).toBeCloseTo(8.3, 1);

    closeBoard();
    setValve(0.6);
    openBoard();
    expect(liveValue('Valve opening')).toBe('60 %');
    expect(liveValue('Q')).toBe(`${flowRateLMin(0.6).toFixed(3)} L/min`);
    expect(flowRateLMin(0.6)).toBeCloseTo(18.6, 1);
  });

  it('moves the velocities and the theoretical force with the valve', () => {
    freeRig();
    setValve(0.35);
    openBoard();
    const low = {
      v0: liveValue('V_nozzle'),
      v: liveValue('V_impact'),
      f: liveValue('F_th'),
    };
    closeBoard();
    setValve(0.6);
    openBoard();
    expect(liveValue('V_nozzle')).not.toBe(low.v0);
    expect(liveValue('V_impact')).not.toBe(low.v);
    expect(liveValue('F_th')).not.toBe(low.f);
    // Higher flow, larger force — the direction the equation gives.
    expect(parseFloat(liveValue('F_th'))).toBeGreaterThan(parseFloat(low.f));
  });

  it('reports the tray as it stands, not the sum of the recorded rows', () => {
    freeRig();

    // Whatever is on the pan when the board is opened is what it must report. Before this
    // change the board summed `recordedRows`, which read 0 g in free mode and the sum of
    // both readings once they were taken.
    click('Add 50 g');
    openBoard();
    expect(totalWeightG()).toBe(50);

    closeBoard();
    click('Add 20 g');
    openBoard();
    expect(totalWeightG()).toBe(70);

    closeBoard();
    click(/Clear pan/);
    openBoard();
    expect(totalWeightG()).toBe(0);
  });

  it('keeps a recorded row frozen when the live state moves on afterwards', () => {
    walkLesson(1, 8);
    openBoard();
    // Reading 1 has been taken; row 2 of the table is its record.
    const recorded = tableRow(2);
    expect(recorded[1], 'row 2 carries a recorded flow').not.toBe('0.000');

    // Moving the valve afterwards changes the live panel and must not touch the record.
    // Free mode is used only because the step that opens the board does not offer the
    // valve; the recorded rows belong to the rig and survive the mode switch.
    closeBoard();
    click('Free Mode');
    setValve(0.9);
    openBoard();
    expect(liveValue('Valve opening')).toBe('90 %');
    expect(tableRow(2)).toEqual(recorded);
  });

  it('switches the family diagram and k with the deflector on the rod', () => {
    freeRig();
    openBoard();
    expect(document.querySelector('.dfl-item.is-selected')?.textContent).toContain('90°');
    expect(document.querySelector('.dfl-fig.is-active figcaption')?.textContent).toBe(
      'Flat Deflector'
    );
    expect(document.querySelector('.dfl-selected-note')?.textContent).toContain('k = 1.000');

    closeBoard();
    click(/Reset simulator/i);
    freeRigWith(/Conical surface/);
    openBoard();

    expect(document.querySelector('.dfl-item.is-selected')?.textContent).toContain('135°');
    expect(document.querySelector('.dfl-fig.is-active figcaption')?.textContent).toBe(
      'Conical Deflector'
    );
    // 1.707 = 1 - cos(135°), the domain's own momentum factor.
    expect(document.querySelector('.dfl-selected-note')?.textContent).toContain('k = 1.707');
    // Exactly one family is emphasised, and all seven deflectors stay listed.
    expect(document.querySelectorAll('.dfl-fig.is-active')).toHaveLength(1);
    expect(document.querySelectorAll('.dfl-item')).toHaveLength(7);
  });

  it('carries the deflector through to the theoretical force', () => {
    freeRig();
    setValve(0.6);
    openBoard();
    const flat = parseFloat(liveValue('F_th'));

    closeBoard();
    click(/Reset simulator/i);
    freeRigWith(/Conical surface/);
    setValve(0.6);
    openBoard();
    const conical = parseFloat(liveValue('F_th'));

    // The only thing that changed is k, so the forces must stand in exactly that ratio.
    expect(conical / flat).toBeCloseTo(1.707, 2);
  });

  it('returns the live board to rest after Reset', () => {
    freeRig();
    setValve(0.6);
    click('Add 50 g');
    openBoard();
    expect(liveValue('Valve opening')).toBe('60 %');
    expect(totalWeightG()).toBe(50);

    click(/^Reset$/);
    openBoard();
    expect(liveValue('Valve opening')).toBe('0 %');
    expect(liveValue('Q')).toBe('0.000 L/min');
    expect(totalWeightG()).toBe(0);
  });

  it('shows F_ac only once Calculate is pressed', () => {
    // Stop at 9: `walkLesson`'s step-10 action is the Calculate press itself.
    walkLesson(1, 9);
    expect(tableRow(2).at(-1), 'unrecorded actual force reads as a dash').toBe('—');

    click(/^Calculate$/);
    expect(tableRow(2).at(-1)).not.toBe('—');
    expect(Number(tableRow(2).at(-1))).toBeGreaterThan(0);
  });
});

describe('the docked software board', () => {
  /*
    The board used to be a 100vw x 100vh opaque overlay, so opening it hid the apparatus:
    the learner could not watch Q move while turning the valve, which is what a live
    monitor is for. It now docks beside the rig by default and expands on request.

    What is pinned here is that the apparatus stays *operable* while the board is open —
    the same controls, in the same document, driving the same live values.
  */

  it('opens docked, not over the apparatus', () => {
    freeRig();
    openBoard();
    expect(document.querySelector('.monitor-docked')).not.toBeNull();
    expect(document.querySelector('.monitor-fullscreen')).toBeNull();
    // The width the dock reserves is what shrinks the canvas and re-centres the HUD.
    expect(document.querySelector('.app-container')?.className).toContain(
      'has-docked-monitor'
    );
  });

  it('leaves the apparatus controls reachable while it is open', () => {
    freeRig();
    openBoard();
    // The valve, the weight buttons and the cover are all still in the document and
    // operable — before this they were behind an opaque full-viewport panel.
    expect(document.querySelector('.valve-slider-container input[type="range"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Add 50 g' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Open tank cover/i })).toBeDefined();
  });

  it('tracks the valve while the board stays open', () => {
    freeRig();
    openBoard();

    setValve(0.35);
    expect(liveValue('Valve opening')).toBe('35 %');
    expect(liveValue('Q')).toBe(`${flowRateLMin(0.35).toFixed(3)} L/min`);

    // No close, no reopen — the same open panel follows the rig.
    setValve(0.6);
    expect(liveValue('Valve opening')).toBe('60 %');
    expect(liveValue('Q')).toBe(`${flowRateLMin(0.6).toFixed(3)} L/min`);
  });

  it('tracks weights going on and coming off while the board stays open', () => {
    freeRig();
    openBoard();

    click('Add 50 g');
    expect(totalWeightG()).toBe(50);
    click('Add 100 g');
    expect(totalWeightG()).toBe(150);
    click(/Clear pan/);
    expect(totalWeightG()).toBe(0);
  });

  it('keeps a recorded row frozen while the live panel moves', () => {
    walkLesson(1, 8);
    openBoard();
    const recorded = tableRow(2);

    click('Free Mode');
    setValve(0.9);
    expect(liveValue('Valve opening')).toBe('90 %');
    expect(tableRow(2), 'a recorded reading must not follow the valve').toEqual(recorded);
  });

  it('expands, collapses and closes', () => {
    freeRig();
    openBoard();
    expect(document.querySelector('.monitor-docked')).not.toBeNull();

    click(/Expand/);
    expect(document.querySelector('.monitor-fullscreen')).not.toBeNull();
    expect(document.querySelector('.monitor-docked')).toBeNull();
    expect(document.querySelector('.app-container')?.className).not.toContain(
      'has-docked-monitor'
    );

    click(/Collapse/);
    expect(document.querySelector('.monitor-docked')).not.toBeNull();

    click(/^Close$/);
    expect(document.querySelector('.monitor-docked')).toBeNull();
    expect(document.querySelector('.monitor-fullscreen')).toBeNull();
  });

  it('reopens docked after having been expanded', () => {
    freeRig();
    openBoard();
    click(/Expand/);
    click(/^Close$/);
    openBoard();
    // Opening never blocks the apparatus, whatever the last size was.
    expect(document.querySelector('.monitor-docked')).not.toBeNull();
  });

  it('docks on the other side in Arabic, and keeps its values live', () => {
    freeRig();
    click('العربية');
    // The control is translated too, so it is opened by its Arabic name.
    click(/فتح شاشة البيانات/);
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.querySelector('.monitor-docked')).not.toBeNull();

    setValve(0.6);
    // Arabic labels, but the numeric run stays left-to-right and intact.
    const q = Array.from(document.querySelectorAll('.mon-cell')).find((el) =>
      el.querySelector('.mon-lbl')?.textContent?.includes('Q')
    );
    expect(q?.querySelector('.mon-val')?.textContent).toBe(
      `${flowRateLMin(0.6).toFixed(3)} L/min`
    );
    expect(getComputedStyle(q?.querySelector('.mon-val') as Element).unicodeBidi).toBe(
      'isolate'
    );
  });
});

describe('the board during the guided experiment', () => {
  /*
    The board is instrumentation, not a step.

    It reaches the learner through `alwaysAvailable` — the same lesson-level list the
    volumetric valve uses — and through a secondary button in the guided footer, so no
    step's `panelControls` had to change. Opening it must not move the lesson on, and the
    step's own contextual control must keep working while it is up.
  */

  const openUtility = () => click(/Open Data Monitor/i);
  const stepNow = () => Number(/(\d+)/.exec(stepBadgeText())?.[1] ?? 0);

  it('offers the board at the flow step, without advancing the lesson', () => {
    walkLesson(1, 4);
    const before = stepNow();
    openUtility();
    expect(document.querySelector('.monitor-docked')).not.toBeNull();
    expect(stepNow(), 'opening the board must not advance the lesson').toBe(before);
  });

  it('offers the board at the weight step, without advancing the lesson', () => {
    walkLesson(1, 5);
    const before = stepNow();
    openUtility();
    expect(document.querySelector('.monitor-docked')).not.toBeNull();
    expect(stepNow()).toBe(before);
  });

  it('keeps the flow step usable, and tracks it live', () => {
    walkLesson(1, 4);
    openUtility();

    // The step's own control is still there, and still drives the board.
    setValve(0.35);
    expect(liveValue('Q')).toBe(`${flowRateLMin(0.35).toFixed(3)} L/min`);
    expect(liveValue('Valve opening')).toBe('35 %');
  });

  it('keeps the weight step usable, and tracks it live', () => {
    walkLesson(1, 5);
    openUtility();

    click('Add 50 g');
    expect(totalWeightG()).toBe(50);
    click('Add 20 g');
    expect(totalWeightG()).toBe(70);
    click(/Clear pan/);
    expect(totalWeightG()).toBe(0);
  });

  it('restores the full-width experiment when closed', () => {
    walkLesson(1, 4);
    openUtility();
    expect(document.querySelector('.app-container')?.className).toContain(
      'has-docked-monitor'
    );
    click(/^Close$/);
    expect(document.querySelector('.app-container')?.className).not.toContain(
      'has-docked-monitor'
    );
    expect(document.querySelector('.monitor-docked')).toBeNull();
  });

  it('does not offer the footer utility at the steps whose own control is the board', () => {
    // Steps 9-11 name the board in `panelControls`, so the contextual control is shown and
    // the footer stays quiet — exactly one way to open it at any moment.
    walkLesson(1, 8);
    const footer = document.querySelector('.guided-footer');
    expect(footer?.textContent).not.toContain('Monitor');
  });
});

/** The step badge's text, or empty when the lesson is not showing one. */
function stepBadgeText(): string {
  return document.querySelector('.step-badge')?.textContent ?? '';
}

/** Total mass the board reports, as a number. */
function totalWeightG(): number {
  return Number(/(-?\d+(?:\.\d+)?)\s*g/.exec(totalWeightText())?.[1] ?? NaN);
}
