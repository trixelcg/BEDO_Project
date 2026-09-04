import React from 'react';
import { Modal } from './Modal';

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
 * V_nozzle, V_impact, F_th and F_ac by hand and plots F against Q (`docs/32 §3`).
 *
 * The document is fetched only when this mounts, so it costs nothing at boot.
 *
 * It used to hand-roll its own overlay, and carried a comment explaining that it was
 * rendered as a sibling of the monitor to avoid inheriting the walkthrough video's
 * unclosable-modal defect. That defect is fixed rather than avoided now: `Modal` takes its
 * own pointer events, owns Escape, traps Tab and restores focus, and both surfaces use it.
 */
export const AnswerSheet: React.FC<AnswerSheetProps> = ({
  url,
  experimentName,
  isArabic,
  onClose,
}) => (
  <Modal
    title={isArabic ? 'ورقة الإجابة' : 'Answer Sheet'}
    subtitle={experimentName}
    onClose={onClose}
    isAr={isArabic}
    zIndex={200}
    data-testid="answer-sheet"
    actions={
      <a
        className="btn-secondary"
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: 'none' }}
      >
        {isArabic ? 'فتح في نافذة جديدة' : 'Open in new tab'}
      </a>
    }
  >
    <iframe
      src={url}
      title={isArabic ? `ورقة الإجابة — ${experimentName}` : `Answer sheet — ${experimentName}`}
      style={{ flex: 1, width: '100%', border: 'none', borderRadius: 12, background: '#fff' }}
    />
  </Modal>
);
