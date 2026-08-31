import React from 'react';
import { DEFLECTORS, type DeflectorFamily } from '../domain/apparatus';
import type { Language } from '../types/index';

/**
 * The deflector reference area of the software board.
 *
 * The original board lists the available deflectors down the left and carries a diagram
 * area naming four families with their V1 / V2 / F relationship. Both are reproduced here
 * from domain data rather than from the screenshot: the seven deflectors, their families
 * and their momentum factors all come from `src/domain/apparatus.ts`, so the board cannot
 * disagree with the physics or list a deflector the rig does not have.
 *
 * Informational only. Selection stays where it already is — this does not introduce a
 * second deflector state.
 *
 * Drawn in SVG on purpose: no bitmap, no second WebGL scene, nothing new to download.
 */

interface DeflectorBoardProps {
  /** Which deflector is on the rod. Read-only here — the board never writes rig state. */
  installedDeflectorId: number;
  language: Language;
}

const FAMILY_LABEL: Record<DeflectorFamily, { en: string; ar: string }> = {
  flat: { en: 'Flat Deflector', ar: 'العاكس المسطح' },
  semi: { en: 'Hemi-sphere Deflector', ar: 'العاكس نصف الكروي' },
  oblique: { en: 'Oblique Deflector', ar: 'العاكس المنحرف' },
  conical: { en: 'Conical Deflector', ar: 'العاكس المخروطي' },
};

/** Family order as the reference board prints it. */
const FAMILY_ORDER: DeflectorFamily[] = ['flat', 'semi', 'oblique', 'conical'];

/**
 * One diagram per family: the jet arriving (V1), leaving (V2), and the reaction (F).
 * The surface path is what distinguishes them, so each family draws its own profile.
 */
const SURFACE: Record<DeflectorFamily, string> = {
  flat: 'M 14 26 L 62 26',
  semi: 'M 16 30 A 20 20 0 0 1 60 30',
  oblique: 'M 14 34 L 62 18',
  conical: 'M 16 30 L 38 12 L 60 30',
};

const Diagram: React.FC<{ family: DeflectorFamily; active: boolean }> = ({ family, active }) => (
  <svg viewBox="0 0 76 62" className={`dfl-diagram${active ? ' is-active' : ''}`} aria-hidden="true">
    <path d={SURFACE[family]} className="dfl-surface" />
    {/* V1: the jet arriving from the nozzle below. */}
    <line x1="38" y1="58" x2="38" y2="36" className="dfl-v1" markerEnd="url(#dfl-arrow)" />
    <text x="41" y="54" className="dfl-lbl">V1</text>
    {/* V2: what leaves, turned by the surface. */}
    <line x1="30" y1="22" x2="18" y2="10" className="dfl-v2" markerEnd="url(#dfl-arrow)" />
    <line x1="46" y1="22" x2="58" y2="10" className="dfl-v2" markerEnd="url(#dfl-arrow)" />
    <text x="7" y="9" className="dfl-lbl">V2</text>
    {/* F: the reaction the spring measures. */}
    <line x1="38" y1="16" x2="38" y2="4" className="dfl-f" markerEnd="url(#dfl-arrow-f)" />
    <text x="41" y="9" className="dfl-lbl is-f">F</text>
  </svg>
);

export const DeflectorBoard: React.FC<DeflectorBoardProps> = ({
  installedDeflectorId,
  language,
}) => {
  const isAr = language === 'ar';
  const selected = DEFLECTORS.find((d) => d.id === installedDeflectorId);

  return (
    <div className="dfl-board">
      <svg width="0" height="0" aria-hidden="true">
        <defs>
          <marker id="dfl-arrow" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--accent-blue)" />
          </marker>
          <marker id="dfl-arrow-f" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--accent-gold)" />
          </marker>
        </defs>
      </svg>

      <section className="dfl-list-wrap">
        <h4 className="dfl-heading">{isAr ? 'العواكس' : 'Deflectors'}</h4>
        <ul className="dfl-list">
          {DEFLECTORS.map((d) => {
            const on = d.id === installedDeflectorId;
            return (
              <li key={d.id} className={`dfl-item${on ? ' is-selected' : ''}`}>
                <span className="dfl-angle">{d.id}°</span>
                <span className="dfl-name">{isAr ? d.nameAr : d.nameEn}</span>
                {/* The installed deflector, as the board's indicator light shows it. */}
                {on && (
                  <span className="dfl-dot" aria-label={isAr ? 'مركّب' : 'installed'} />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="dfl-diagrams">
        <h4 className="dfl-heading">{isAr ? 'أنواع العواكس' : 'Deflector types'}</h4>
        <div className="dfl-grid">
          {FAMILY_ORDER.map((f) => {
            const active = selected?.family === f;
            return (
              <figure key={f} className={`dfl-fig${active ? ' is-active' : ''}`}>
                <Diagram family={f} active={active} />
                <figcaption>{isAr ? FAMILY_LABEL[f].ar : FAMILY_LABEL[f].en}</figcaption>
              </figure>
            );
          })}
        </div>
        {selected && (
          <p className="dfl-selected-note">
            {isAr ? 'المركّب:' : 'Installed:'} <strong>{isAr ? selected.nameAr : selected.nameEn}</strong>
            {' · '}
            <span className="dfl-k">k = {selected.momentumFactor.toFixed(3)}</span>
          </p>
        )}
      </section>
    </div>
  );
};
