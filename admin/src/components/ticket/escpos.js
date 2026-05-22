/**
 * ESC/POS command encoder for thermal receipt printers.
 *
 * ESC/POS is the de-facto standard for POS thermal printers (Epson, Star,
 * SNBC, Bixolon, etc.). Commands are escape sequences; text is raw bytes.
 *
 * This encoder produces a Uint8Array of ESC/POS commands that render the
 * ticket content on an 80mm (48 chars) or 58mm (32 chars) printer.
 */

import {
  formatTaxLineLabel,
  slipGrossTaxNetForTicket,
} from "../../utils/winningsTax.js";
import { formatCashierReceiptLine } from "./receiptFormat.js";
import {
  createBarcodeCanvasForPrint,
  getBarcodePayload,
} from "./ticketBarcode.js";
import receiptLogoUrl from "../../assets/image.png";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CMD = {
  INIT: [ESC, 0x40],
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  DOUBLE_HEIGHT_ON: [ESC, 0x21, 0x10],
  DOUBLE_WIDTH_ON: [ESC, 0x21, 0x20],
  DOUBLE_ON: [ESC, 0x21, 0x30],
  NORMAL: [ESC, 0x21, 0x00],
  CUT_PARTIAL: [GS, 0x56, 0x01],
  CUT_FULL: [GS, 0x56, 0x00],
  FEED_LINES: (n) => [ESC, 0x64, n],
  /** Restore default line spacing after ESC * bit images */
  DEFAULT_LINE_SPACING: [ESC, 0x32],
};

const CHARS_80MM = 48;
const CHARS_58MM = 32;

/** Target raster width in dots (~203 dpi layouts) */
const LOGO_DOTS = {
  "58mm": 384,
  "80mm": 576,
};

/** @type {Record<string, Promise<Uint8Array>>} */
const logoEscPosCache = {};

/** @type {Map<string, Promise<Uint8Array>>} */
const barcodeEscPosCache = new Map();

function textEncoder() {
  return new TextEncoder();
}

function toBytes(text) {
  return textEncoder().encode(text);
}

function sanitizeEscPosText(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/·/g, "|")
    .replace(/[^\x20-\x7E]/g, " ");
}

function concat(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr instanceof Uint8Array ? arr : new Uint8Array(arr), offset);
    offset += arr.length;
  }
  return result;
}

function line(text = "") {
  return concat(toBytes(sanitizeEscPosText(text)), [LF]);
}

function center(text, width) {
  const trimmed = text.slice(0, width);
  const pad = Math.max(0, Math.floor((width - trimmed.length) / 2));
  return " ".repeat(pad) + trimmed;
}

function leftRight(left, right, width) {
  const maxLeft = width - right.length - 1;
  const trimmedLeft = left.slice(0, maxLeft);
  const gap = width - trimmedLeft.length - right.length;
  return trimmedLeft + " ".repeat(Math.max(1, gap)) + right;
}

function divider(width, char = "-") {
  return char.repeat(width);
}

function wrapText(text, width) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }
    if (current.length + word.length + (current ? 1 : 0) <= width) {
      current += (current ? " " : "") + word;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.00 ETB";
  return `${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
}

function formatOdds(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatKickoff(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * RGBA ImageData -> GS v 0 raster bit image (1-bit threshold).
 *
 * Many thermal printers are more reliable with GS v 0 raster mode than ESC *
 * row mode when receiving bytes over serial/COM transport.
 */
function imageDataToGsV0(imageData, w, h) {
  const data = imageData;
  const rowByteCount = Math.ceil(w / 8);

  // Some printers reject very tall single raster commands.
  const MAX_ROWS_PER_CHUNK = 96;
  const chunks = [];

  for (let yStart = 0; yStart < h; yStart += MAX_ROWS_PER_CHUNK) {
    const chunkRows = Math.min(MAX_ROWS_PER_CHUNK, h - yStart);
    const raster = new Uint8Array(rowByteCount * chunkRows);

    for (let y = 0; y < chunkRows; y++) {
      const srcY = yStart + y;
      for (let xb = 0; xb < rowByteCount; xb++) {
        let bits = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xb * 8 + bit;
          if (x < w) {
            const i = 4 * (srcY * w + x);
            const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (lum < 180) bits |= 0x80 >> bit;
          }
        }
        raster[y * rowByteCount + xb] = bits;
      }
    }

    const xL = rowByteCount & 0xff;
    const xH = (rowByteCount >> 8) & 0xff;
    const yL = chunkRows & 0xff;
    const yH = (chunkRows >> 8) & 0xff;

    // GS v 0 m xL xH yL yH d1...dk (m=0 normal density)
    chunks.push(
      concat(new Uint8Array([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]), raster),
    );
  }

  return concat(...chunks);
}

/**
 * Rasterize logo PNG to ESC/POS ESC * rows (browser only).
 */
async function rasterLogoToEscPos(src, targetWidthDots) {
  if (typeof Image === "undefined" || typeof document === "undefined" || !src) {
    return new Uint8Array(0);
  }

  const img = new Image();
  img.decoding = "async";
  img.crossOrigin = "anonymous";
  img.src = src;

  try {
    await img.decode();
  } catch {
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo load failed"));
    });
  }

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return new Uint8Array(0);

  const w = targetWidthDots;
  const h = Math.max(1, Math.round((ih * w) / iw));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Uint8Array(0);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h).data;
  return imageDataToGsV0(imageData, w, h);
}

/**
 * Code 128 barcode → ESC * rows (browser only).
 */
function rasterBarcodeToEscPos(text, targetWidthDots) {
  if (!text || typeof document === "undefined") {
    return Promise.resolve(new Uint8Array(0));
  }
  try {
    const canvas = createBarcodeCanvasForPrint(text, targetWidthDots);
    if (!canvas) return Promise.resolve(new Uint8Array(0));
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(new Uint8Array(0));
    const { data } = ctx.getImageData(0, 0, w, h);
    return Promise.resolve(imageDataToGsV0(data, w, h));
  } catch {
    return Promise.resolve(new Uint8Array(0));
  }
}

function getLogoEscPosPromise(width) {
  const key = width === "58mm" ? "58mm" : "80mm";
  if (!logoEscPosCache[key]) {
    logoEscPosCache[key] = rasterLogoToEscPos(
      receiptLogoUrl,
      LOGO_DOTS[key],
    ).catch(() => new Uint8Array(0));
  }
  return logoEscPosCache[key];
}

function getBarcodeEscPosPromise(width, payload) {
  const paper = width === "58mm" ? "58mm" : "80mm";
  const key = `${paper}:${payload}`;
  if (!barcodeEscPosCache.has(key)) {
    barcodeEscPosCache.set(
      key,
      rasterBarcodeToEscPos(payload, LOGO_DOTS[paper]).catch(
        () => new Uint8Array(0),
      ),
    );
  }
  return barcodeEscPosCache.get(key);
}

function ticketDateForEscpos(ticket) {
  return formatDate(ticket?.printedAt || ticket?.createdAt);
}

function pushCashierLines(parts, ticket, chars) {
  const full = formatCashierReceiptLine(ticket);
  const valueWidth = Math.max(8, chars - 9);
  const wrapped = wrapText(full, valueWidth);
  if (wrapped.length === 0) {
    parts.push(line(leftRight("Cashier:", "-", chars)));
    return;
  }
  parts.push(line(leftRight("Cashier:", wrapped[0], chars)));
  const indent = " ".repeat(9);
  for (let i = 1; i < wrapped.length; i++) {
    parts.push(line(indent + wrapped[i]));
  }
}

/**
 * Ticket body after optional logo: metadata, legs, totals, footer. No INIT.
 */
function buildTicketEscPosParts(ticket, opts) {
  const { width = "80mm", platformWinningsTax = null } = opts;

  const chars = width === "58mm" ? CHARS_58MM : CHARS_80MM;
  const selections = Array.isArray(ticket?.selections) ? ticket.selections : [];

  const { tax, net, gross } = slipGrossTaxNetForTicket(
    ticket?.potentialWin,
    ticket,
  );
  const showTax = tax != null && tax > 0;
  const taxLabel = formatTaxLineLabel(ticket, platformWinningsTax);

  const parts = [];

  parts.push(new Uint8Array(CMD.ALIGN_LEFT));
  parts.push(line(divider(chars)));
  parts.push(new Uint8Array(CMD.BOLD_ON));

  parts.push(line(leftRight("Coupon:", ticket.couponNumber || "-", chars)));
  pushCashierLines(parts, ticket, chars);
  parts.push(line(leftRight("Date:", ticketDateForEscpos(ticket), chars)));

  parts.push(line(divider(chars)));

  if (selections.length === 0) {
    parts.push(new Uint8Array(CMD.ALIGN_CENTER));
    parts.push(line(center("(no selections)", chars)));
    parts.push(new Uint8Array(CMD.ALIGN_LEFT));
  } else {
    for (let i = 0; i < selections.length; i++) {
      const sel = selections[i];
      const home = sel?.match?.homeTeam || "";
      const away = sel?.match?.awayTeam || "";
      const matchName = away ? `${home} vs ${away}` : home || "Match";
      const kickoff = formatKickoff(sel?.match?.startTime);
      const pick = sel?.selection || sel?.pick || "-";
      const market = sel?.marketLabel || "";
      const odds = formatOdds(sel?.odds);

      const matchLines = wrapText(`${i + 1}. ${matchName}`, chars);
      for (const ml of matchLines) {
        parts.push(line(ml));
      }

      if (kickoff) {
        parts.push(line(`   ${kickoff}`));
      }

      const pickLabel = market ? `${market}: ${pick}` : pick;
      const pickLines = wrapText(pickLabel, chars - 8);
      for (let j = 0; j < pickLines.length; j++) {
        if (j === pickLines.length - 1) {
          parts.push(line(leftRight(`   ${pickLines[j]}`, odds, chars)));
        } else {
          parts.push(line(`   ${pickLines[j]}`));
        }
      }

      if (i < selections.length - 1) {
        parts.push(line(divider(chars)));
      }
    }
  }

  parts.push(line(divider(chars)));

  parts.push(line(leftRight("Bets:", String(selections.length), chars)));
  parts.push(line(leftRight("Stake:", formatCurrency(ticket.stake), chars)));
  parts.push(
    line(leftRight("Total Odds:", formatOdds(ticket.totalOdds), chars)),
  );
  if (showTax) {
    parts.push(line(leftRight("Gross win:", formatCurrency(gross), chars)));
    parts.push(line(leftRight(`${taxLabel}:`, formatCurrency(tax), chars)));
    parts.push(line(leftRight("Net payout:", formatCurrency(net), chars)));
  } else {
    parts.push(
      line(
        leftRight("Possible Win:", formatCurrency(ticket.potentialWin), chars),
      ),
    );
  }

  parts.push(line(divider(chars)));

  parts.push(new Uint8Array(CMD.ALIGN_CENTER));
  parts.push(
    line(center(ticket.receiptNumber || ticket.couponNumber || "", chars)),
  );

  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(new Uint8Array(CMD.FEED_LINES(2)));
  parts.push(new Uint8Array(CMD.CUT_PARTIAL));

  return parts;
}

/**
 * Encode a ticket (text body only, no raster logo). For tests / non-browser.
 *
 * @param {Object} ticket
 * @param {Object} [opts]
 * @returns {Uint8Array}
 */
export function encodeTicket(ticket, opts = {}) {
  const parts = [new Uint8Array(CMD.INIT)];
  parts.push(...buildTicketEscPosParts(ticket, opts));
  return concat(...parts);
}

/**
 * Encode a ticket with proportional raster logo (browser canvas rasterization).
 *
 * @param {Object} ticket
 * @param {Object} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function encodeTicketAsync(ticket, opts = {}) {
  const { width = "80mm" } = opts;
  const logoBytes = await getLogoEscPosPromise(width);
  const barcodePayload = getBarcodePayload(ticket);

  const parts = [new Uint8Array(CMD.INIT)];

  if (logoBytes.length > 0) {
    parts.push(new Uint8Array(CMD.ALIGN_CENTER));
    parts.push(logoBytes);
  }

  if (barcodePayload) {
    const barcodeBytes = await getBarcodeEscPosPromise(width, barcodePayload);
    if (barcodeBytes.length > 0) {
      parts.push(new Uint8Array(CMD.ALIGN_CENTER));
      parts.push(barcodeBytes);
    }
  }

  parts.push(...buildTicketEscPosParts(ticket, opts));
  return concat(...parts);
}
