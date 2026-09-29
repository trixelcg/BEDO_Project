import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DRAIN_RATE_L_PER_S,
  MEASURING_TANK_CAPACITY_L,
  advanceTankVolume,
  litreToV,
  SCALE_TEXTURE,
} from '../../src/lib/measuringTank';
import { flowRateLMin } from '../../src/domain/physics';

/**
 * F18, as revised (2026-09-29): the flowmeter column and the measuring tank are a picture.
 *
 * The measurement gating was rolled back at the user's request — steps 5 and 7 are set the
 * valve and OK again, and Q is the simulation's as before. What stays is the water: it
 * follows the bench's rules (shut, the tank collects the jet's water; open, it drains),
 * and nothing reads it back. `docs/65`.
 */

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

describe('the water follows the bench rules', () => {
  const Q = flowRateLMin(0.4); // 15.714 L/min

  it('shut, the tank collects the flow the jet delivers', () => {
    expect(advanceTankVolume(0, Q, false, 60)).toBeCloseTo(Q, 9);
    expect(advanceTankVolume(10, Q, false, 1)).toBeCloseTo(10 + Q / 60, 9);
  });

  it('open, it drains; with no flow and the valve shut, it holds', () => {
    expect(advanceTankVolume(10, Q, true, 1)).toBe(10 - DRAIN_RATE_L_PER_S);
    expect(advanceTankVolume(10, Q, true, 100)).toBe(0);
    expect(advanceTankVolume(10, 0, false, 100)).toBe(10);
  });

  it('never beyond the scale: 0 to 60 L, and never backwards in time', () => {
    expect(advanceTankVolume(59, Q, false, 1e4)).toBe(MEASURING_TANK_CAPACITY_L);
    expect(advanceTankVolume(5, Q, false, -3)).toBe(5);
  });

  it('draws the column where the scale texture puts each litre', () => {
    expect(litreToV(0)).toBeCloseTo(1, 3);
    expect(litreToV(60)).toBeCloseTo(58.7 / SCALE_TEXTURE.height, 3);
  });
});

describe('it is visual only', () => {
  it('only the scene imports it', () => {
    const importers = files('src').filter(
      (path) => /\.(ts|tsx)$/.test(path) && /from '[./]*\/?(lib\/)?measuringTank'/.test(readFileSync(path, 'utf8'))
    );
    expect(importers.map((p) => p.replace(/\\/g, '/'))).toEqual(['src/components/DeviceModel.tsx']);
  });

  it('the simulation, the lesson and the panels know nothing of a measurement', () => {
    for (const path of files('src/simulation').concat(files('src/lesson'), files('src/domain'))) {
      const code = readFileSync(path, 'utf8');
      expect(code, path).not.toMatch(/FLOW_TIMING|flowMeasurement|measuringTank/);
    }
    const OVERLAY = readFileSync('src/components/UIOverlay.tsx', 'utf8');
    expect(OVERLAY).not.toMatch(/FlowMeterPanel|measuredQ/);
  });

  it('the level is presentation state, emptied on reset', () => {
    const DEVICE = readFileSync('src/components/DeviceModel.tsx', 'utf8');
    expect(DEVICE).toMatch(/measuringTankL\.current = advanceTankVolume\(\s*measuringTankL\.current,\s*state\.live\.flowRateLMin,\s*state\.isVolumetricValveOpen,\s*delta\s*\);/);
    expect(DEVICE).toMatch(/if \(measuringTankRun\.current !== lesson\.runId\) \{/);
  });
});
