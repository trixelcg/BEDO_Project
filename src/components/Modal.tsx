import React, { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * A dialog a keyboard can get out of.
 *
 * ## Why this exists as a component
 *
 * There were three overlays in the app and three different answers to "how do I close
 * this". The walkthrough video was the worst of them: it rendered inside `.ui-container`,
 * which carries `pointer-events: none` and hands it back only to children marked
 * `interactive` — so its Close button could not be clicked at all (`docs/28 §11`), and
 * there was no Escape handler either. The answer sheet worked around the same problem by
 * being rendered as a sibling of the monitor instead.
 *
 * One shell, so a surface cannot be added without the three things a dialog owes a
 * keyboard user:
 *
 *   - **Escape closes it.** Bound on the dialog itself, and stopped from propagating, so a
 *     nested overlay closes only its own layer.
 *   - **Focus is moved into it** on open and **restored** to whatever had it on close.
 *   - **Tab is trapped.** Without it, Tab walks straight out of the dialog into the
 *     controls behind it, which are still in the tab order and still visually covered.
 *
 * `aria-modal` and `role="dialog"` tell assistive technology the same thing the trap tells
 * the keyboard, and `aria-labelledby` points at the heading the caller renders.
 */

/** Everything focusable, in document order. `:not([disabled])` because a trap must not land on one. */
const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
]
  .map((selector) => `${selector}:not([hidden])`)
  .join(', ');

export interface ModalProps {
  title: string;
  /** Optional line under the title. */
  subtitle?: string;
  onClose: () => void;
  isAr: boolean;
  /** Extra controls in the header, before Close. */
  actions?: React.ReactNode;
  /** Stacking order, for a dialog opened over another one. */
  zIndex?: number;
  className?: string;
  children: React.ReactNode;
  'data-testid'?: string;
}

let dialogSeq = 0;

export const Modal: React.FC<ModalProps> = ({
  title,
  subtitle,
  onClose,
  isAr,
  actions,
  zIndex = 1000,
  className = '',
  children,
  'data-testid': testId,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useRef(`bedo-dialog-${(dialogSeq += 1)}`);

  const focusables = useCallback((): HTMLElement[] => {
    const root = ref.current;
    if (!root) return [];
    // Deliberately a selector and nothing else. Filtering on `offsetParent` would skip
    // anything `display: none`, which sounds right and is not testable: jsdom has no
    // layout, so every control reports as hidden and the trap silently does nothing. The
    // selector already excludes disabled and `[hidden]` controls, and no dialog here
    // renders a collapsed section.
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  }, []);

  // Move focus in, and put it back where it was on the way out. Both halves matter: a
  // dialog that opens without focus is invisible to a screen reader until the user hunts
  // for it, and one that closes without restoring drops the user at the top of the page.
  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    const first = focusables()[0] ?? ref.current;
    first?.focus?.();
    return () => restoreTo.current?.focus?.();
  }, [focusables]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      // Stopped, so a dialog over another dialog closes one layer at a time.
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;

    // Wrap at both ends. Without this Tab leaves the dialog and lands on the controls
    // behind it, which are covered but still in the tab order.
    if (event.shiftKey && (active === first || !ref.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={ref}
      className={`monitor-fullscreen interactive bedo-modal ${isAr ? 'rtl' : ''} ${className}`}
      style={{ zIndex, padding: 24 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId.current}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      data-testid={testId}
    >
      <div className="monitor-header" style={{ marginBottom: 16, paddingBottom: 16 }}>
        <div className="monitor-title-group">
          <h1 id={titleId.current}>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {actions}
          <button
            className="btn-primary"
            onClick={onClose}
            style={{ background: '#ff3d71', color: '#fff' }}
          >
            <X size={15} />
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>

      {children}
    </div>
  );
};
