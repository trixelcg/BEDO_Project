import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  GRAVITY_MS2,
  NOZZLE_AREA_M2,
  SPRING_RATE_N_PER_M,
  TRAVEL_HEIGHT_M,
  flowRateLMin,
  jetState,
} from '../../src/domain/physics';
import { springDeflectionMm, springHeightMm } from '../../src/domain/spring';
import { createSimulationRuntime, type SimulationCommand } from '../../src/simulation/runtime';
import { selectLiveReadout, selectReadingStatuses, selectReadings } from '../../src/simulation/selectors';
import { toCsv } from '../../src/lib/exportSchema';

/**
 * F19 — one calculation, the workbook's (QA, 2026-09-29). `docs/66`.
 *
 * The rows below are `Logic(final) 2.xlsx` as the user supplied it on 2026-09-29 (a
 * screenshot of columns P–AF, rows 1–20; column Y is hidden in it). Values are pinned at
 * the precision the sheet displays them. The formulas behind them — Y38's `#REF!`, Y24→T15,
 * Y37→T29 — are not visible in a screenshot and are audited in `docs/66` §3 from the values
 * only.
 */

/** Flat block, rows 5–9: n, Q (L/min), V₀, V, F_th (N), mass (g). */
const FLAT = [
  [0.2, 6.9537984, 1.476, 1.222, 0.12, 11.95],
  [0.4, 15.7144704, 3.336, 3.232, 0.82, 83.58],
  [0.6, 43.4568384, 9.227, 9.189, 6.63, 675.71],
  [0.8, 84.7129344, 17.986, 17.967, 25.34, 2583.07],
  [1.0, 111.372, 23.646, 23.631, 43.84, 4468.66],
] as const;

/** Oblique 45 block, rows 15–19: n, F_th (N), mass (g). */
const OBLIQUE_45 = [
  [0.2, 0.0586, 5.97],
  [0.4, 0.41, 41.79],
  [0.6, 3.3145, 337.87],
  [0.8, 12.6704, 1291.58],
  [1.0, 21.9196, 2234.42],
] as const;

const decimals = (value: number) => (String(value).split('.')[1] ?? '').length;
const massG = (forceN: number) => (forceN / GRAVITY_MS2) * 1000;

describe('AC03 — the valve → Q mapping is the workbook’s, defined once', () => {
  it('Q at n = 0, 0.2 … 1.0 with QT = 120 is the workbook series, to the digits it shows', () => {
    expect(flowRateLMin(0)).toBe(0);
    for (const [n, q] of FLAT) expect(flowRateLMin(n)).toBeCloseTo(q, 7);
  });

  it('the build’s other series were the same mapping at Q_total = 200, not a second formula', () => {
    // IMG24: live Q 185.620 and table rows 26.191, 45.040, 72.428 L/min.
    expect(flowRateLMin(1, 200).toFixed(3)).toBe('185.620');
    expect([0.4, 0.5, 0.6].map((n) => flowRateLMin(n, 200).toFixed(3))).toEqual(['26.191', '45.040', '72.428']);
    // …and the same V₀ = 39.410, V = 39.401, F_th = 121.8668 N that screen shows.
    const jet = jetState(1, 90, 200);
    expect(jet.nozzleVelocityMS.toFixed(3)).toBe('39.410');
    expect(jet.impactVelocityMS.toFixed(3)).toBe('39.401');
    expect(jet.theoreticalForceN.toFixed(4)).toBe('121.8668');
  });

  it('no second copy of the curve, the nozzle area, g or the litre conversion anywhere in src', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const owners = new Set(['src/domain/physics.ts', 'src/domain/units.ts']);
    for (const path of files('src').filter((p) => /\.(ts|tsx)$/.test(p))) {
      if (owners.has(path.replace(/\\/g, '/'))) continue;
      const code = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, path).not.toMatch(/4\.9138|8\.8783|3\.7629|0\.7265/);
      expect(code, path).not.toMatch(/0\.0000785|7\.85e-5/);
      expect(code, path).not.toMatch(/\b9\.81\b/);
      expect(code, path).not.toMatch(/\/\s*60000\b/);
    }
  });
});

describe('AC04 — the code reproduces the workbook row for row', () => {
  it('Flat: Q, V₀, V, F_th and mass', () => {
    for (const [n, q, v0, v, fth, mass] of FLAT) {
      const jet = jetState(n, 90);
      expect(jet.flowRateLMin, `Q @ n=${n}`).toBeCloseTo(q, 7);
      expect(jet.nozzleVelocityMS.toFixed(3), `V0 @ n=${n}`).toBe(v0.toFixed(3));
      expect(jet.impactVelocityMS.toFixed(3), `V @ n=${n}`).toBe(v.toFixed(3));
      expect(jet.theoreticalForceN.toFixed(decimals(fth)), `F_th @ n=${n}`).toBe(fth.toFixed(decimals(fth)));
      expect(massG(jet.theoreticalForceN).toFixed(2), `mass @ n=${n}`).toBe(mass.toFixed(2));
    }
  });

  it('Oblique 45: the sheet’s law ρAV²·sin²θ, within 0.01 % — the sheet’s own block differs by that', () => {
    // docs/66 §3.2: the Oblique block's V at n = 1 reads 23.632 against the Flat block's
    // 23.631 for the same Q. Its forces are 0.002–0.004 % above ρAV²·0.5 computed from the
    // Flat block's V; the code follows the Flat block.
    for (const [n, fth, mass] of OBLIQUE_45) {
      const jet = jetState(n, 45);
      expect(Math.abs(jet.theoreticalForceN - fth) / fth, `F_th @ n=${n}`).toBeLessThan(1e-4 + 0.00005 / fth);
      expect(Math.abs(massG(jet.theoreticalForceN) - mass) / mass, `mass @ n=${n}`).toBeLessThan(1e-4 + 0.005 / mass);
    }
  });

  it('the Manual row (Q = 25 L/min) by the same equations', () => {
    // No manual-entry path exists in the app; Q = 25 is reached here through the same
    // curve at the Q_total that makes the valve deliver exactly 25 L/min at n = 1.
    const qTotal = 25 / flowRateLMin(1, 1);
    const jet = jetState(1, 90, qTotal);
    expect(jet.flowRateLMin).toBeCloseTo(25, 9);
    expect(jet.nozzleVelocityMS.toFixed(3)).toBe('5.308');
    expect(jet.impactVelocityMS.toFixed(3)).toBe('5.243');
    expect(jet.theoreticalForceN.toFixed(3)).toBe('2.158');
    expect(massG(jet.theoreticalForceN).toFixed(3)).toBe('219.949');
    expect((jetState(1, 45, qTotal).theoreticalForceN).toFixed(3)).toBe('1.079');
  });

  it('F_ac is the weight of what is loaded, as the sheet’s F(ac) = ideal mass × g', () => {
    // Flat rows 7–10: 150 g → 1.47 N, 650 g → 6.38 N, 1100 g → 10.79 N, 200 g → 1.962 N.
    const r = createSimulationRuntime();
    for (const [grams, fac] of [[150, '1.47'], [650, '6.38'], [1100, '10.79']] as const) {
      expect(((grams * GRAVITY_MS2) / 1000).toFixed(2)).toBe(fac);
    }
    for (const c of [
      { type: 'BEGIN_READING', index: 1 },
      { type: 'ADD_WEIGHT', massG: 200 },
    ] as SimulationCommand[]) r.dispatch(c);
    expect(selectReadings(r.getState())[1].measuredForceN.toFixed(3)).toBe('1.962');
  });

  it('the constants are the sheet’s: A = 7.85e-5 m², s = 0.035 m, g = 9.81, k = 200 N/m', () => {
    expect(NOZZLE_AREA_M2).toBe(0.0000785);
    expect(TRAVEL_HEIGHT_M).toBe(0.035);
    expect(GRAVITY_MS2).toBe(9.81);
    expect(SPRING_RATE_N_PER_M).toBe(200);
    // hW (mm) column, Flat rows 4–7: the loads 0.05, 0.1, 0.2, 0.5 kg over k.
    expect([0.05, 0.1, 0.2, 0.5].map((kg) => Math.round(springHeightMm(kg * GRAVITY_MS2)))).toEqual([2, 5, 10, 25]);
  });
});

describe('AC04 — one physical state, one set of numbers on every surface', () => {
  const RIG: SimulationCommand[] = [
    { type: 'OPEN_COVER' },
    { type: 'SELECT_DEFLECTOR', deflectorId: 90 },
    { type: 'CLOSE_COVER' },
    { type: 'POWER_ON' },
    { type: 'SET_VALVE', opening: 0.4 },
    { type: 'BEGIN_READING', index: 1 },
    { type: 'ADD_WEIGHT', massG: 50 },
    { type: 'ADD_WEIGHT', massG: 20 },
    { type: 'ADD_WEIGHT', massG: 10 },
    { type: 'END_READING' },
  ];

  it('live panel, recorded row and CSV agree with each other and with the workbook at n = 0.4', () => {
    const r = createSimulationRuntime();
    for (const c of RIG) r.dispatch(c);
    const s = r.getState();
    const live = selectLiveReadout(s);
    const row = selectReadings(s)[1];
    for (const key of ['flowRateLMin', 'nozzleVelocityMS', 'impactVelocityMS', 'theoreticalForceN'] as const) {
      expect(live[key], key).toBe(row[key]);
    }
    expect(row.theoreticalForceN.toFixed(4)).toBe('0.8199');
    expect(row.measuredForceN.toFixed(4)).toBe('0.7848');
    const csv = toCsv(selectReadings(s), { title: 't', isCalculated: true, statuses: selectReadingStatuses(s) }).split('\n');
    expect(csv[3]).toBe('2,120.0,0.40,15.714,2.6191e-4,3.336,3.232,80,3.92,0.8199,0.7848');
  });

  it('board, monitor and 3D read those same selector values, never their own', () => {
    const DEVICE = readFileSync('src/components/DeviceModel.tsx', 'utf8');
    const MONITOR = readFileSync('src/components/SoftwareMonitor.tsx', 'utf8');
    expect(DEVICE).toMatch(/flowLMin: state\.live\.flowRateLMin,/);
    expect(DEVICE).toMatch(/theoreticalForceN: state\.live\.theoreticalForceN,/);
    expect(DEVICE).toMatch(/const weightForceN = gramsToNewtons\(seatedMassG, GRAVITY_MS2\);/);
    expect(MONITOR).not.toMatch(/jetState\(|flowRateLMin\(/);
  });
});

describe('AC05 — spring height is separate from the geometric stop', () => {
  it('h = F / k is a pure function of force; the limits are the caller’s, not the domain’s', () => {
    expect(springHeightMm(0.8199)).toBeCloseTo(4.0995, 4);
    // With no limits supplied the travel is zero, not an invented stop.
    expect(springDeflectionMm(0.8199, 0, 0)).toBe(0);
    expect(springDeflectionMm(0.8199, 0, 100)).toBeCloseTo(4.0995, 4);
    expect(springDeflectionMm(0.8199, 0, 3)).toBe(3);
    const SPRING = readFileSync('src/domain/spring.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(SPRING).not.toMatch(/0\.035|TRAVEL_HEIGHT_M/);
  });
});
