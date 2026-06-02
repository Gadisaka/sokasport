import { forwardRef } from "react";
import {
  formatTaxLineLabel,
  slipGrossTaxNetForTicket,
} from "../../utils/winningsTax";
import receiptLogo from "../../assets/image.png";
import { formatCashierReceiptLine } from "./receiptFormat";

/**
 * Thermal POS receipt for cashier tickets.
 *
 * Designed to be embedded off-screen (.thermal-print-area) and revealed only by
 * the global print stylesheet (admin/src/index.css). Also captured directly by
 * html2pdf.js for the PDF fallback path.
 *
 * Renders as a vertically-flowing 80mm (or 58mm) monospace block. No frames,
 * no shadows — anything fancier degrades on real ESC/POS printers.
 */

const WIDTHS = {
  "80mm": { page: "80mm", body: "76mm", font: "13px" },
  "58mm": { page: "58mm", body: "54mm", font: "12px" },
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ETB`;
}

function formatOdds(value) {
  return toNumber(value).toFixed(2);
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function selectionStartMs(selection) {
  const value = selection?.match?.startTime;
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

function formatKickoffFull(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildSelectionLines(ticket) {
  const selections = Array.isArray(ticket?.selections)
    ? [...ticket.selections].sort(
        (a, b) => selectionStartMs(a) - selectionStartMs(b),
      )
    : [];
  return selections.map((selection, index) => {
    const home = selection?.match?.homeTeam || "";
    const away = selection?.match?.awayTeam || "";
    const matchName = away ? `${home} Vs ${away}` : home || "Match";
    const leagueType = String(selection?.match?.leagueType || "").trim();
    const leagueName = String(selection?.match?.leagueName || "").trim();
    return {
      id: selection.id || `sel-${index}`,
      kickoff: formatKickoffFull(selection?.match?.startTime),
      matchName,
      league: [leagueType, leagueName].filter(Boolean).join(": "),
      pick: selection?.selection || selection?.pick || "-",
      market: selection?.marketLabel || "",
      odds: formatOdds(selection?.odds),
    };
  });
}

const TicketTemplate = forwardRef(function TicketTemplate(
  { ticket, width = "80mm", barcodeDataUrl = "", platformWinningsTax = null },
  ref,
) {
  if (!ticket) return null;

  const size = WIDTHS[width] || WIDTHS["80mm"];
  const lines = buildSelectionLines(ticket);
  const printedAt = formatDate(ticket?.printedAt || ticket?.createdAt);

  const { tax, net, gross } = slipGrossTaxNetForTicket(
    ticket.potentialWin,
    ticket,
  );
  const showTax = tax != null && tax > 0;
  const taxLabel = formatTaxLineLabel(ticket, platformWinningsTax);

  return (
    <div
      ref={ref}
      data-ticket-width={width}
      className="thermal-receipt"
      style={{
        width: size.body,
        maxWidth: size.body,
        margin: "0 auto",
        padding: "4mm 2mm",
        background: "#ffffff",
        color: "#000000",
        fontFamily:
          "'Courier New', 'DejaVu Sans Mono', 'Lucida Console', monospace",
        fontSize: size.font,
        fontWeight: 700,
        lineHeight: 1.35,
        WebkitFontSmoothing: "grayscale",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "2mm" }}>
        <img
          src={receiptLogo}
          alt=""
          style={{
            width: "60%",
            maxWidth: "60%",
            height: "auto",
            display: "block",
            margin: "0 auto",
          }}
        />
      </div>

      <Divider />

      <Row label="Coupon" value={ticket.couponNumber || "-"} mono />
      <Row label="Receipt" value={ticket.receiptNumber || "-"} mono />
      <CashierRow value={formatCashierReceiptLine(ticket)} />
      <Row label="Date" value={printedAt} />

      <Divider />

      {lines.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "4mm 0",
            fontWeight: 700,
            color: "#000000",
          }}
        >
          (no selections)
        </div>
      ) : (
        lines.map((line, idx) => (
          <div key={line.id} style={{ color: "#000000" }}>
            <div style={{ marginBottom: "1.5mm" }}>
              <div style={{ fontWeight: 800 }}>
                {line.league || line.matchName}
              </div>
              {line.kickoff && (
                <div style={{ fontWeight: 700, color: "#000000" }}>
                  {line.kickoff}
                </div>
              )}
              {line.league && (
                <div style={{ fontWeight: 700, color: "#000000" }}>
                  {line.matchName}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "2mm",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    wordBreak: "break-word",
                    fontWeight: 700,
                    color: "#000000",
                  }}
                >
                  {line.market || "-"}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: "#000000",
                    whiteSpace: "nowrap",
                  }}
                >
                  {line.pick}
                </span>
                <span style={{ fontWeight: 800, color: "#000000" }}>
                  {line.odds}
                </span>
              </div>
            </div>
            {idx < lines.length - 1 ? <FullWidthHyphenRule /> : null}
          </div>
        ))
      )}

      <Divider />

      <Row label="Bets" value={String(lines.length)} bold />
      <Row label="Stake" value={formatCurrency(ticket.stake)} bold />
      <Row label="Total Odds" value={formatOdds(ticket.totalOdds)} bold />
      {showTax ? (
        <>
          <Row label="Gross Win" value={formatCurrency(gross)} bold />
          <Row label={taxLabel} value={formatCurrency(tax)} bold />
          <Row label="Net Payout" value={formatCurrency(net)} bold />
        </>
      ) : (
        <Row
          label="Possible Win"
          value={formatCurrency(ticket.potentialWin)}
          bold
        />
      )}

      {barcodeDataUrl ? (
        <div style={{ textAlign: "center", marginTop: "3mm" }}>
          <img
            src={barcodeDataUrl}
            alt=""
            style={{
              width: "70%",
              maxWidth: "70%",
              height: "auto",
              display: "block",
              margin: "0 auto",
            }}
          />
        </div>
      ) : null}
    </div>
  );
});

function Row({ label, value, mono = false, bold = false }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "2mm",
        fontWeight: bold ? 800 : 700,
      }}
    >
      <span style={{ color: "#000000", fontWeight: "inherit" }}>{label}</span>
      <span
        style={{
          color: "#000000",
          fontWeight: "inherit",
          fontFamily: mono ? "'Courier New', monospace" : undefined,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function CashierRow({ value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "2mm",
        alignItems: "flex-start",
      }}
    >
      <span style={{ color: "#000000", flexShrink: 0, fontWeight: 700 }}>
        Cashier
      </span>
      <span
        style={{
          flex: 1,
          color: "#000000",
          fontWeight: 700,
          fontFamily: "'Courier New', monospace",
          textAlign: "right",
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      style={{
        borderTop: "1px dashed #000",
        margin: "1.5mm 0",
      }}
    />
  );
}

/**
 * Full-width separator between games. Uses a real border (not overflow-clipped
 * hyphen text) so html2pdf/html2canvas, @media print, and system PDF drivers
 * render it the same as on screen.
 */
function FullWidthHyphenRule() {
  return (
    <div
      aria-hidden
      className="ticket-game-separator"
      style={{
        clear: "both",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        margin: "1.5mm 0",
        padding: 0,
        border: "none",
        borderTop: "1px dashed #000",
        minHeight: "1px",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    />
  );
}

export default TicketTemplate;
