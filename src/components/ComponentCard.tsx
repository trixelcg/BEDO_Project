import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { describeComponent } from '../domain/componentInfo';
import {
  getAnchorPoint,
  placeCard,
  subscribeAnchorPoint,
  type CardSide,
  type Inspection,
} from '../lib/componentAnchor';

/**
 * A part's card, anchored to the part in the 3D view (F17).
 *
 * Opened by a deliberate click (`via: 'click'`): the full card — name, what it does, how it
 * works, what to do with it — which stays until it is closed. Opened by keyboard focus on
 * the panel control for a part (`via: 'focus'`): the compact version, name and function
 * only, which goes when focus leaves. Hover never opens either; it has the cursor tooltip.
 *
 * Everything it says comes from `describeComponent` — the same definition the hover
 * tooltip reads. Where it goes comes from the scene: the part's anchor is projected each
 * frame (`publishAnchorPoint`) and the card sits beside it, never on it, with a marker on
 * the part and a line from the marker to the card.
 */
export const ComponentCard: React.FC<{
  inspection: Inspection;
  language: 'en' | 'ar';
  onClose: () => void;
}> = ({ inspection, language, onClose }) => {
  const point = useSyncExternalStore(subscribeAnchorPoint, getAnchorPoint, () => null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const text = describeComponent(inspection.ref, language);
  const isAr = language === 'ar';
  const full = inspection.via === 'click';
  const titleId = `component-card-title-${inspection.anchorId.replace(/\./g, '-')}`;

  // Measure before placing, so the card is placed by its real size in either language.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    setSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
  });

  // Escape closes a clicked card. Captured, so a dialog's own Escape does not also fire.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [full, onClose]);

  if (typeof document === 'undefined') return null;
  // No anchor on screen (the part is behind the camera, or the scene is covered): nothing
  // to point at, so nothing is drawn. The card comes back when the part does.
  const visible = !!point && point.onScreen;
  const bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const placed =
    visible && size
      ? placeCard(point!, size, bounds, isAr ? 'rtl' : 'ltr')
      : { left: -9999, top: -9999, side: 'right' as CardSide };

  // The leader: from the marker on the part to the nearest point of the card's edge.
  let line: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (visible && size) {
    const cx = Math.max(placed.left, Math.min(point!.x, placed.left + size.width));
    const cy = Math.max(placed.top, Math.min(point!.y, placed.top + size.height));
    line = { x1: point!.x, y1: point!.y, x2: cx, y2: cy };
  }

  return createPortal(
    <div className="component-card-layer" data-bedo-component-layer>
      {visible && line && (
        <svg className="component-card-leader" aria-hidden="true">
          <line {...line} />
        </svg>
      )}
      {visible && (
        <span
          className="component-card-marker"
          aria-hidden="true"
          style={{ transform: `translate(${point!.x}px, ${point!.y}px)` }}
        />
      )}
      <div
        ref={cardRef}
        className={`component-card ${full ? 'is-full interactive' : 'is-compact'} side-${placed.side}`}
        dir={isAr ? 'rtl' : 'ltr'}
        role={full ? 'dialog' : 'tooltip'}
        aria-modal={full ? false : undefined}
        aria-labelledby={full ? titleId : undefined}
        data-anchor-id={inspection.anchorId}
        data-component={inspection.ref.key}
        style={{
          transform: `translate(${Math.round(placed.left)}px, ${Math.round(placed.top)}px)`,
          visibility: visible && size ? 'visible' : 'hidden',
        }}
      >
        <div className="component-card-head">
          <strong id={titleId} className="component-card-name">
            {text.name}
          </strong>
          {full && (
            <button
              type="button"
              className="component-card-close"
              onClick={onClose}
              aria-label={isAr ? 'إغلاق' : 'Close'}
              data-bedo-component-close
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="component-card-role">{text.role}</p>
        {full && (
          <>
            {text.details.length > 0 && (
              <ul className="component-card-details">
                {text.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
            <p className="component-card-use">
              <span className="component-card-use-label">{isAr ? 'الاستخدام' : 'Use'}</span>
              {text.use}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};
