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
import {
  formatCashierReceiptLine,
  formatLeagueReceiptLine,
} from "./receiptFormat.js";
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

/**
 * Fraction of paper width the logo occupies. The raster stays full width
 * (multiple of 8 dots) so rows never skew; only the drawn logo shrinks.
 */
const LOGO_SCALE = 0.6;

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

/** Market left, selection centered, odds right — keeps pick away from the odds column. */
function marketPickOddsLine(market, pick, odds, width) {
  const oddsText = String(odds ?? "").trim();
  const pickText = String(pick ?? "-").trim();
  const marketText = String(market ?? "-").trim();

  const oddsLen = oddsText.length;
  const pickLen = pickText.length;
  const pickStart = Math.max(
    marketText.length + 1,
    Math.min(
      Math.floor((width - pickLen) / 2),
      width - oddsLen - pickLen - 1,
    ),
  );
  const trimmedMarket = marketText.slice(0, Math.max(1, pickStart - 1));

  return (
    trimmedMarket.padEnd(pickStart, " ") +
    pickText +
    " ".repeat(Math.max(1, width - oddsLen - pickStart - pickLen)) +
    oddsText
  ).slice(0, width);
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

/** Kickoff as "D/M/YYYY HH:MM" (matches the printed-ticket structure). */
function formatKickoffFull(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Kickoff time in ms for sorting; missing/invalid times sort last. */
function selectionStartMs(selection) {
  const value = selection?.match?.startTime;
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** Stable copy of selections ordered by kickoff date/time, earliest first. */
function selectionsByKickoff(selections) {
  return (Array.isArray(selections) ? [...selections] : []).sort(
    (a, b) => selectionStartMs(a) - selectionStartMs(b),
  );
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

  // Keep the raster the full paper width (multiple of 8 dots → no row skew),
  // but draw the logo smaller and centered within it so it appears reduced.
  const w = targetWidthDots;
  const logoW = Math.max(1, Math.round(w * LOGO_SCALE));
  const logoH = Math.max(1, Math.round((ih * logoW) / iw));
  const h = logoH;
  const dx = Math.max(0, Math.round((w - logoW) / 2));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Uint8Array(0);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, dx, 0, logoW, logoH);

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
  const { width = "80mm", platformWinningsTax = null, barcodeBytes = null } =
    opts;

  const chars = width === "58mm" ? CHARS_58MM : CHARS_80MM;
  const selections = selectionsByKickoff(ticket?.selections);

  const { tax, net, gross } = slipGrossTaxNetForTicket(
    ticket?.potentialWin,
    ticket,
  );
  const showTax = tax != null && tax > 0;
  const taxLabel = formatTaxLineLabel(ticket, platformWinningsTax);

  const parts = [];

  parts.push(new Uint8Array(CMD.ALIGN_LEFT));
  parts.push(line(divider(chars)));

  parts.push(line(leftRight("Coupon:", ticket.couponNumber || "-", chars)));
  parts.push(line(leftRight("Receipt:", ticket.receiptNumber || "-", chars)));
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
      const matchName = away ? `${home} Vs ${away}` : home || "Match";
      const kickoff = formatKickoffFull(sel?.match?.startTime);
      const leagueHeader = formatLeagueReceiptLine({
        leagueType: sel?.match?.leagueType,
        leagueCountry: sel?.match?.leagueCountry,
        country: sel?.match?.country,
        leagueName: sel?.match?.leagueName,
      });
      const pick = sel?.selection || sel?.pick || "-";
      const market = String(sel?.marketLabel || "").trim();
      const odds = formatOdds(sel?.odds);

      // 1) League type + name (bold). Falls back to the teams when no league.
      parts.push(new Uint8Array(CMD.BOLD_ON));
      for (const hl of wrapText(leagueHeader || matchName, chars)) {
        parts.push(line(hl));
      }
      parts.push(new Uint8Array(CMD.BOLD_OFF));

      // 2) Date / time
      if (kickoff) {
        parts.push(line(kickoff));
      }

      // 3) Teams (only when the league header already showed above)
      if (leagueHeader) {
        for (const tl of wrapText(matchName, chars)) {
          parts.push(line(tl));
        }
      }

      // 4) Market type + selection + odds
      const marketText = market || "-";
      const pickLen = String(pick).trim().length;
      const pickStart = Math.max(1, Math.floor((chars - pickLen) / 2));
      const marketWrapWidth = Math.max(1, pickStart - 1);
      if (marketText.length <= marketWrapWidth) {
        parts.push(line(marketPickOddsLine(marketText, pick, odds, chars)));
      } else {
        const mLines = wrapText(marketText, marketWrapWidth);
        for (let k = 0; k < mLines.length - 1; k++) {
          parts.push(line(mLines[k]));
        }
        parts.push(
          line(marketPickOddsLine(mLines[mLines.length - 1], pick, odds, chars)),
        );
      }

      if (i < selections.length - 1) {
        parts.push(line(divider(chars)));
      }
    }
  }

  parts.push(line(divider(chars)));

  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line(leftRight("Bets:", String(selections.length), chars)));
  parts.push(line(leftRight("Stake:", formatCurrency(ticket.stake), chars)));
  parts.push(
    line(leftRight("Total Odds:", formatOdds(ticket.totalOdds), chars)),
  );
  if (showTax) {
    parts.push(line(leftRight("Gross Win:", formatCurrency(gross), chars)));
    parts.push(line(leftRight(`${taxLabel}:`, formatCurrency(tax), chars)));
    parts.push(line(leftRight("Net Payout:", formatCurrency(net), chars)));
  } else {
    parts.push(
      line(
        leftRight("Possible Win:", formatCurrency(ticket.potentialWin), chars),
      ),
    );
  }

  parts.push(new Uint8Array(CMD.BOLD_OFF));

  // Footer: barcode at the bottom (raster when available), else printed code.
  parts.push(new Uint8Array(CMD.FEED_LINES(1)));
  parts.push(new Uint8Array(CMD.ALIGN_CENTER));
  if (barcodeBytes && barcodeBytes.length > 0) {
    parts.push(barcodeBytes);
  }
  parts.push(
    line(center(ticket.receiptNumber || ticket.couponNumber || "", chars)),
  );

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
 * Compact payout/cancel confirmation receipt — logo + summary only, no legs.
 *
 * Fields: logo, branch, receipt number, status, bets count, payout (payout
 * only), date. Intentionally small for a quick proof-of-action slip.
 *
 * @param {Object} ticket
 * @param {{ width?: string, type?: "payout"|"cancel" }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function encodeActionReceiptAsync(ticket, opts = {}) {
  const { width = "80mm", type = "payout" } = opts;
  const chars = width === "58mm" ? CHARS_58MM : CHARS_80MM;
  const isPayout = type === "payout";
  const selections = Array.isArray(ticket?.selections) ? ticket.selections : [];

  const logoBytes = await getLogoEscPosPromise(width);

  const parts = [new Uint8Array(CMD.INIT)];

  if (logoBytes.length > 0) {
    parts.push(new Uint8Array(CMD.ALIGN_CENTER));
    parts.push(logoBytes);
  }

  parts.push(new Uint8Array(CMD.ALIGN_CENTER));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line(isPayout ? "PAYOUT RECEIPT" : "CANCELLATION RECEIPT"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));

  parts.push(new Uint8Array(CMD.ALIGN_LEFT));
  parts.push(line(divider(chars)));
  parts.push(line(leftRight("Branch:", ticket?.branchName || "-", chars)));
  parts.push(
    line(leftRight("Receipt:", ticket?.receiptNumber || "-", chars)),
  );
  parts.push(line(leftRight("Status:", ticket?.status || "-", chars)));
  parts.push(line(leftRight("Bets:", String(selections.length), chars)));

  if (isPayout) {
    const { net } = slipGrossTaxNetForTicket(ticket?.potentialWin, ticket);
    const payoutAmount = net != null ? net : Number(ticket?.potentialWin || 0);
    parts.push(line(leftRight("Payout:", formatCurrency(payoutAmount), chars)));
  }

  parts.push(line(leftRight("Date:", formatDate(new Date()), chars)));
  parts.push(line(divider(chars)));

  parts.push(new Uint8Array(CMD.FEED_LINES(2)));
  parts.push(new Uint8Array(CMD.CUT_PARTIAL));

  return concat(...parts);
}

/**
 * Cashier sales report summary slip (logo + betting / payout / wallet totals).
 *
 * Mirrors the dashboard stats for a date range; printed on demand from the
 * cashier dashboard "Print" button.
 *
 * @param {Object} report
 * @param {{ width?: string }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function encodeSalesReportAsync(report, opts = {}) {
  const { width = "80mm" } = opts;
  const chars = width === "58mm" ? CHARS_58MM : CHARS_80MM;
  const n = (v) => String(Math.round(Number(v) || 0));

  const logoBytes = await getLogoEscPosPromise(width);

  const parts = [new Uint8Array(CMD.INIT)];

  if (logoBytes.length > 0) {
    parts.push(new Uint8Array(CMD.ALIGN_CENTER));
    parts.push(logoBytes);
  }

  parts.push(new Uint8Array(CMD.ALIGN_CENTER));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line("SALES REPORT SUMMARY"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));

  parts.push(new Uint8Array(CMD.ALIGN_LEFT));
  const rangeRight = report?.toLabel
    ? `${report?.fromLabel || ""} - ${report.toLabel}`
    : report?.fromLabel || "";
  parts.push(line(leftRight("DATE :", rangeRight, chars)));
  parts.push(line(leftRight("TIME :", formatDate(new Date()), chars)));
  if (report?.cashierName) {
    parts.push(line(leftRight("Cashier:", report.cashierName, chars)));
  }

  parts.push(line(divider(chars)));

  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line("BETTING"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(line(leftRight("Total Bets", n(report?.totalBets), chars)));
  parts.push(
    line(leftRight("Total Amount", formatCurrency(report?.totalBetsAmount), chars)),
  );

  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line("PAYOUT"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(
    line(leftRight("Total Payout", n(report?.totalPayoutCount), chars)),
  );
  parts.push(
    line(
      leftRight("Total Amount", formatCurrency(report?.totalPayoutAmount), chars),
    ),
  );

  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line("CANCELLATIONS"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(
    line(leftRight("Cancelled", n(report?.totalCancelledTickets), chars)),
  );
  parts.push(
    line(
      leftRight(
        "Cancelled Amount",
        formatCurrency(report?.totalCancelledStake),
        chars,
      ),
    ),
  );

  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line("DEPOSIT/WITHDRAWAL"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(
    line(leftRight("Deposit Amount", formatCurrency(report?.depositAmount), chars)),
  );
  parts.push(
    line(
      leftRight("Withdrawal Amount", formatCurrency(report?.withdrawAmount), chars),
    ),
  );

  parts.push(line(divider(chars)));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line(leftRight("ON HAND", formatCurrency(report?.onHand), chars)));
  parts.push(new Uint8Array(CMD.BOLD_OFF));

  parts.push(new Uint8Array(CMD.FEED_LINES(2)));
  parts.push(new Uint8Array(CMD.CUT_PARTIAL));

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

  let barcodeBytes = null;
  if (barcodePayload) {
    barcodeBytes = await getBarcodeEscPosPromise(width, barcodePayload);
  }

  const parts = [new Uint8Array(CMD.INIT)];

  if (logoBytes.length > 0) {
    parts.push(new Uint8Array(CMD.ALIGN_CENTER));
    parts.push(logoBytes);
  }

  parts.push(...buildTicketEscPosParts(ticket, { ...opts, barcodeBytes }));
  return concat(...parts);
}
