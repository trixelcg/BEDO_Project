/**
 * The force law for one deflector, written out with its own momentum factor (F09).
 *
 * The experiment sheet's law (`experiments.ts` `lawEn`) describes a *family* — "F = ρAV²
 * (1 − cos β)" — and was printed beside whichever deflector happened to be on the rod. In
 * free mode that put the conical sheet's "F = 1.707 ρAV²" beside a 90° plate labelled
 * k = 1.000 (QA IMG25). This states the law of the deflector actually fitted, with the
 * factor the physics uses (`DeflectorDef.momentumFactor`), so the equation, the k and the
 * force can only agree.
 */

import { getDeflector, type DeflectorDef } from './apparatus';

export interface ForceLaw {
  deflector: DeflectorDef;
  /** The momentum factor k in F_th = k·ρ·A·v². */
  k: number;
  /** The law as the family writes it. */
  equation: string;
  /** How k follows from the angle, with the number. */
  factorEn: string;
  factorAr: string;
}

export function forceLawFor(deflectorId: number): ForceLaw {
  const deflector = getDeflector(deflectorId);
  const k = deflector.momentumFactor;
  const kText = k.toFixed(3);
  const angle = deflector.id;
  switch (deflector.family) {
    case 'flat':
      return {
        deflector,
        k,
        equation: 'F_th = ρ·A·v²',
        factorEn: `k = 1 (the plate turns the jet through ${angle}°)`,
        factorAr: `k = 1 (يحرف اللوح النفث بزاوية ${angle}°)`,
      };
    case 'oblique':
      return {
        deflector,
        k,
        equation: 'F_th = ρ·A·v²·sin²θ',
        factorEn: `k = sin²${angle}° = ${kText}`,
        factorAr: `k = sin²${angle}° = ${kText}`,
      };
    case 'semi':
    case 'conical':
      return {
        deflector,
        k,
        equation: 'F_th = ρ·A·v²·(1 − cos β)',
        factorEn: `k = 1 − cos ${angle}° = ${kText}`,
        factorAr: `k = 1 − cos ${angle}° = ${kText}`,
      };
  }
}
