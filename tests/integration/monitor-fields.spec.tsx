// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, renderFreshApp, stubConfigFetch, walkLesson } from '../helpers/app-harness';
import { GRAVITY_MS2 } from '../../src/domain/physics';

vi.mock('../../src/components/Scene3D', async () => await import('../helpers/scene3d-mock'));

/**
 * Software-monitor readouts (Jetforce_Storyboard sl. 23).
 *
 * The storyboard lists a gravity display beside the total-weight display, each with the
 * unit symbol in a fixed position. Two things are pinned here.
 *
 * First, the gravity readout must show the same constant the force equations use. If it
 * were retyped as a literal, the monitor could drift from the physics module and report a
 * `g` the calculation never used.
 *
 * Second, both readouts must be bidi-isolated. They mix an Arabic label with a
 * left-to-right technical expression, and in the RTL document the bidi algorithm reorders
 * the neutral characters inside that expression: "0 g × g = 0.000 N" rendered as
 * "g × g = 0.000 N 0", which separates the value from its unit. Isolation is what keeps
 * the expression readable, so it is asserted rather than left to survive by luck.
 */

const card = (label: string): HTMLElement => {
  const found = Array.from(document.querySelectorAll('.indicator-card')).find((el) =>
    el.textContent?.includes(label)
  );
  if (!found) throw new Error(`no indicator card containing "${label}"`);
  return found as HTMLElement;
};

/** The value span of a readout row — the last span, after the label. */
const readout = (label: string): HTMLElement => {
  const spans = card(label).querySelectorAll('span');
  return spans[spans.length - 1] as HTMLElement;
};

beforeEach(() => {
  stubConfigFetch();
  renderFreshApp();
  walkLesson(1, 10);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the monitor readouts', () => {
  it('shows a gravity display carrying the constant the equations use', () => {
    const text = readout('Gravity').textContent ?? '';
    expect(text).toContain(GRAVITY_MS2.toFixed(2));
    expect(text, 'the unit symbol is part of the readout').toContain('m/s²');
  });

  it('still shows total weight times g in newtons', () => {
    expect(readout('Total Weight').textContent).toMatch(/\d+ g × g = \d+\.\d{3} N/);
  });

  it.each(['Gravity', 'Total Weight'])(
    'isolates the %s expression from the surrounding text direction',
    (label) => {
      const el = readout(label);
      // Without these two the RTL layout reorders the expression and strands the unit.
      expect(el.style.direction).toBe('ltr');
      expect(el.style.unicodeBidi).toBe('isolate');
    }
  );

  it('keeps the readouts present in Arabic', () => {
    click('العربية');
    expect(readout('تسارع الجاذبية').textContent).toContain(GRAVITY_MS2.toFixed(2));
    expect(readout('الوزن الكلي').style.unicodeBidi).toBe('isolate');
  });
});
