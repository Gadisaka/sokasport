/**
 * PDF fallback for thermal POS receipts.
 *
 * We render the same DOM that the print path uses (TicketTemplate) and hand
 * it to html2pdf.js so the PDF is byte-identical to the printed paper.
 *
 * html2pdf.js is dynamically imported so the ~600KB worker doesn't ship in
 * the main bundle for cashiers who never hit the unhappy path.
 */

const PAGE_SIZES = {
  "80mm": { width: 80, height: 297 },
  "58mm": { width: 58, height: 297 },
};

/**
 * Capture an off-screen DOM node as a PDF and trigger browser download.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.node      The TicketTemplate root element.
 * @param {string} opts.filename       e.g. "ticket-02186-97513.pdf"
 * @param {"80mm"|"58mm"} [opts.width="80mm"]
 * @returns {Promise<void>}
 */
export async function downloadTicketPdf({ node, filename, width = "80mm" }) {
  if (!node) throw new Error("downloadTicketPdf: node is required");

  const html2pdfMod = await import("html2pdf.js");
  const html2pdf = html2pdfMod.default || html2pdfMod;

  const size = PAGE_SIZES[width] || PAGE_SIZES["80mm"];
  const safeName = filename || `ticket-${Date.now()}.pdf`;

  const opt = {
    margin: 0,
    filename: safeName,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: {
      scale: 2,
      backgroundColor: "#ffffff",
      letterRendering: true,
      useCORS: true,
    },
    jsPDF: {
      unit: "mm",
      format: [size.width, size.height],
      orientation: "portrait",
      compress: true,
    },
    pagebreak: { mode: ["css", "legacy"] },
  };

  await html2pdf().set(opt).from(node).save();
}

/**
 * Build a deterministic file name based on the ticket coupon.
 */
export function buildTicketPdfFilename(ticket) {
  const id =
    ticket?.receiptNumber ||
    String(ticket?.couponNumber || "ticket")
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-+|-+$/g, "");
  const safe = String(id || "unknown").replace(/[^a-z0-9-]+/gi, "-");
  return `ticket-${safe || "unknown"}.pdf`;
}
