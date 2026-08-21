import React from 'react';
import { X } from 'lucide-react';

interface AnswerSheetProps {
  url: string;
  experimentName: string;
  isArabic: boolean;
  onClose: () => void;
}

/**
 * The worksheet the closing step opens.
 *
 * BEDO's experiment sheets end with *"You finished! Click the 'Document' tab to view the
 * answer sheet"*, and the document itself is a blank worksheet: the student computes Q,
 * V₀, V², F_th and F_ac by hand and plots F against Q (`docs/32 §3`). The application had
 * never surfaced it.
 *
 * The document is fetched only when this mounts, so it costs nothing at boot.
 *
 * **Deliberately rendered as a sibling of the monitor, not inside the overlay.**
 * `.ui-container` carries `pointer-events: none` and hands it back only to children marked
 * `interactive`; the walkthrough video modal is inside it and is not marked, which is why
 * that modal cannot be closed (`docs/28 §11`). Mounting here — where `SoftwareMonitor`
 * already lives — means this surface never inherits the problem. The existing defect is
 * untouched: fixing it is UI work, and it is not this task's.
 */
export const AnswerSheet: React.FC<AnswerSheetProps> = ({
  url,
  experimentName,
  isArabic,
  onClose,
}) => (
  <div
    className={`monitor-fullscreen interactive ${isArabic ? 'rtl' : ''}`}
    // Above the software monitor, which the learner reaches this step through.
    style={{ zIndex: 200, padding: 24 }}
    data-testid="answer-sheet"
  >
    <div className="monitor-header" style={{ marginBottom: 16, paddingBottom: 16 }}>
      <div className="monitor-title-group">
        <h1>{isArabic ? 'ورقة الإجابة' : 'Answer Sheet'}</h1>
        <p>{experimentName}</p>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <a
          className="btn-secondary"
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: 'none' }}
        >
          {isArabic ? 'فتح في نافذة جديدة' : 'Open in new tab'}
        </a>
        <button className="btn-primary" onClick={onClose} style={{ background: '#ff3d71', color: '#fff' }}>
          <X size={15} />
          {isArabic ? 'إغلاق' : 'Close'}
        </button>
      </div>
    </div>

    <iframe
      src={url}
      title={isArabic ? `ورقة الإجابة — ${experimentName}` : `Answer sheet — ${experimentName}`}
      style={{ flex: 1, width: '100%', border: 'none', borderRadius: 12, background: '#fff' }}
    />
  </div>
);
