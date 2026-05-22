import Modal from "../ui/Modal";

/**
 * Shown when:
 *   - the print dialog timed out (likely no printer / system blocked dialog)
 *   - or html2pdf.js threw while rendering the PDF
 *
 * Always offers an explicit "Download PDF" button so the cashier is never
 * stuck — browsers cannot truly enumerate printers from JS, so we have to
 * give them an out.
 */
export default function PrinterUnavailableModal({
  open,
  onClose,
  onRetryPrint,
  onDownloadPdf,
  busy = false,
  pdfReady = true,
}) {
  return (
    <Modal open={open} onClose={onClose} title="Printer not detected">
      <div className="space-y-3 text-sm">
        <p>
          We could not confirm the print job completed. The thermal printer
          may be offline, out of paper, or your browser blocked the dialog.
        </p>
        <p className="text-xs text-[var(--muted)]">
          You can retry the print, or download the ticket as a PDF and reprint
          it manually.
        </p>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            onClick={onRetryPrint}
            disabled={busy}
            className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-60"
          >
            Retry print
          </button>
          <button
            type="button"
            onClick={onDownloadPdf}
            disabled={busy || !pdfReady}
            className="rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Generating PDF..." : "Download PDF"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="ml-auto rounded-sm border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)] disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
