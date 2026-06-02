import JsBarcode from "jsbarcode";

const OPTIONS_DATAURL = {
  format: "CODE128",
  width: 2,
  height: 56,
  margin: 4,
  displayValue: true,
  fontSize: 12,
  textMargin: 3,
  background: "#ffffff",
  lineColor: "#000000",
};

// Shorter bars for thermal print; the receipt number is printed on its own
// line just below, so the human-readable value is omitted here.
const OPTIONS_PRINT = {
  ...OPTIONS_DATAURL,
  height: 38,
  margin: 2,
  displayValue: false,
};

/** Receipt / coupon id for barcode (same as former QR payload). */
export function getBarcodePayload(ticket) {
  return String(ticket?.receiptNumber || ticket?.couponNumber || "").trim();
}

/**
 * PNG data URL for on-screen / PDF ticket (browser only).
 * @param {string} text
 * @returns {string} data URL or "" on failure / empty
 */
export function renderBarcodeToDataURL(text) {
  const t = String(text || "").trim();
  if (!t || typeof document === "undefined") return "";
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, t, OPTIONS_DATAURL);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

/**
 * Canvas scaled to `targetWidthDots` px width for ESC/POS raster (browser only).
 * @param {string} text
 * @param {number} targetWidthDots
 * @returns {HTMLCanvasElement | null}
 */
export function createBarcodeCanvasForPrint(text, targetWidthDots) {
  const t = String(text || "").trim();
  if (!t || typeof document === "undefined") return null;
  try {
    const srcCanvas = document.createElement("canvas");
    JsBarcode(srcCanvas, t, OPTIONS_PRINT);
    const srcW = srcCanvas.width;
    const srcH = srcCanvas.height;
    if (!srcW || !srcH) return null;

    const outW = Math.max(1, targetWidthDots);
    const outH = Math.max(1, Math.round((srcH * outW) / srcW));

    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(srcCanvas, 0, 0, outW, outH);
    return out;
  } catch {
    return null;
  }
}
