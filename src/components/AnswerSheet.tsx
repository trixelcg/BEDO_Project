import React, { useMemo } from 'react';
import { Modal } from './Modal';
import { buildReportHtml, reportFilename, type ReportInput } from '../lib/report';

interface AnswerSheetProps {
  /** The blank worksheet BEDO delivered for this experiment, or null if none shipped. */
  url: string | null;
  experimentName: string;
  isArabic: boolean;
  onClose: () => void;
  /** Everything the generated report needs. Built by `App` from the session. */
  report: Omit<ReportInput, 'generatedAt'>;
}

/**
 * What the closing step hands over.
 *
 * BEDO's experiment sheets end with *"You finished! Click the 'Document' tab to view the
 * answer sheet"*, and the document they deliver is a **blank** worksheet: the student
 * computes Q, V_nozzle, V_impact, F_th and F_ac by hand and plots F against Q
 * (`docs/32 §3`). It is the same four files whatever anyone did.
 *
 * So the sheet is now the report of *this run* — the readings taken, the chart they make,
 * the error against theory and the assessment score, in both languages — and BEDO's blank
 * worksheet is still one click away for anyone who wants it. See `src/lib/report.ts` for
 * why the browser renders it rather than a PDF library.
 *
 * The document is built when this mounts, so it costs nothing at boot and always reflects
 * the session as it stands rather than as it was when some earlier screen was drawn.
 */
export const AnswerSheet: React.FC<AnswerSheetProps> = ({
  url,
  experimentName,
  isArabic,
  onClose,
  report,
}) => {
  /*
    A blob URL, so the iframe and "Open in new tab" show the same document.

    `useMemo` and not an effect: it is a pure function of the session, and revoking it on
    unmount would break the tab the learner opened from it — a blob URL outlives the
    document that created it only while it is still registered. The cost of leaving one
    registered is a few tens of kilobytes for the life of the page, and the page is
    reloaded to start another experiment.
  */
  const { html, href } = useMemo(() => {
    const input: ReportInput = { ...report, generatedAt: new Date() };
    const document = buildReportHtml(input);
    return {
      html: document,
      href: URL.createObjectURL(new Blob([document], { type: 'text/html;charset=utf-8' })),
      name: reportFilename(input),
    };
  }, [report]);

  return (
    <Modal
      title={isArabic ? 'تقرير التجربة' : 'Experiment report'}
      subtitle={experimentName}
      onClose={onClose}
      isAr={isArabic}
      zIndex={200}
      data-testid="answer-sheet"
      actions={
        <>
          <a
            className="btn-secondary"
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none' }}
          >
            {isArabic ? 'فتح في نافذة جديدة' : 'Open in new tab'}
          </a>
          {/*
            BEDO's own blank worksheet, kept. Some courses hand it in on paper, and this
            report does not replace a document somebody's marking scheme may expect.
          */}
          {url && (
            <a
              className="btn-secondary"
              href={url}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              {isArabic ? 'ورقة الإجابة الفارغة' : 'Blank worksheet'}
            </a>
          )}
        </>
      }
    >
      <iframe
        // `srcDoc` rather than the blob URL: an iframe rendered from a blob is a different
        // origin in some browsers, and the print button inside it would be unreachable.
        srcDoc={html}
        title={isArabic ? `تقرير — ${experimentName}` : `Report — ${experimentName}`}
        style={{ flex: 1, width: '100%', border: 'none', borderRadius: 12, background: '#fff' }}
      />
    </Modal>
  );
};
