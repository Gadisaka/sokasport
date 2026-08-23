import AppIcon from "./AppIcon";
import { topHeaderData } from "../../data/homepageData";
import { classifyLegStatus } from "../../utils/legResultStatus";
import {
  formatOutcomeAmount,
  resolveTicketCheckOutcome,
} from "../../utils/ticketCheckOutcome";

/**
 * Public coupon rendered to look like the printed paper ticket: white thermal
 * paper, monospace, dashed dividers, scalloped edges (`.coupon-receipt` in
 * index.css), with a per-leg result marker in front of each match.
 *
 * Shared by the Check-ticket page and the "Check Coupon" preview in the desktop
 * and mobile bet slips. `ticket` is the payload from `fetchPublicCouponTicket`:
 * `{ couponNumber, outcome, outcomeAmount, stake, potentialWin, totalOdds,
 * netPayout, selections: [{ matchName, marketLabel, label, odds, kickoffAt,
 * result, status }] }`.
 */

/** Per-leg outcome marker, tuned for the white paper background. */
const LEG_ICON = {
  won: { name: "check", cls: "text-[#15803d]", title: "Won", aria: "Leg won" },
  lost: { name: "x", cls: "text-[#b91c1c]", title: "Lost", aria: "Leg lost" },
  postponed: {
    name: "minus",
    cls: "text-[#ca8a04]",
    title: "Postponed or not finished",
    aria: "Leg postponed or not finished",
  },
  notplayed: {
    name: "circle",
    cls: "text-[#9ca3af]",
    title: "Not played yet",
    aria: "Leg not played yet",
  },
};

function LegResultIcon({ status }) {
  const cfg = LEG_ICON[status] ?? LEG_ICON.notplayed;
  return (
    <span
      className={`mt-0.5 inline-flex shrink-0 ${cfg.cls}`}
      title={cfg.title}
      aria-label={cfg.aria}
      role="img"
    >
      <AppIcon name={cfg.name} size={14} strokeWidth={2.75} />
    </span>
  );
}

/** Compact "dd/mm hh:mm" kickoff, matching the printed receipt format. */
function formatReceiptKickoff(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ReceiptDivider() {
  return (
    <div aria-hidden className="my-2 border-t border-dashed border-[#9a9a9a]" />
  );
}

function ReceiptHyphenRule() {
  return (
    <div aria-hidden className="my-1.5 border-t border-dashed border-[#d2d2d2]" />
  );
}

const OUTCOME_STYLE = {
  won: { cls: "text-[#15803d]", label: "Won" },
  lost: { cls: "text-[#b91c1c]", label: "Lost" },
  bonus: { cls: "text-[#ca8a04]", label: "Bonus" },
};

function TicketOutcomeBanner({ ticket }) {
  const { outcome, amount } = resolveTicketCheckOutcome(ticket);
  const money = formatOutcomeAmount(amount);

  if (outcome === "won" || outcome === "lost" || outcome === "bonus") {
    const cfg = OUTCOME_STYLE[outcome];
    return (
      <p
        className={`m-0 text-center text-[15px] font-black ${cfg.cls}`}
        role="status"
      >
        <span className="uppercase tracking-[0.18em]">{cfg.label}</span>
        {money ? <span className="ml-2 tracking-normal">{money}</span> : null}
      </p>
    );
  }

  return (
    <p className="m-0 text-center text-[10px] font-semibold leading-relaxed text-[#555]">
      Results pending
    </p>
  );
}

function formatReceiptOdds(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

function ReceiptTotals({ ticket }) {
  const rows = [
    { label: "Stake", value: formatOutcomeAmount(ticket.stake) },
    { label: "Max Win", value: formatOutcomeAmount(ticket.potentialWin) },
    { label: "Total Odd", value: formatReceiptOdds(ticket.totalOdds) },
    {
      label: "Net Pay",
      value: formatOutcomeAmount(ticket.netPayout),
      emphasize: true,
    },
  ].filter((row) => row.value);

  if (rows.length === 0) return null;

  return (
    <div className="mt-3 rounded-[1rem] bg-gradient-to-br from-[#151528]/95 to-[#0c101c]/95 px-3.5 py-2.5 text-[12px] text-[#f5f5f5] shadow-inner shadow-black/20">
      {rows.map((row, i) => {
        const isLast = i === rows.length - 1;
        return (
          <div
            key={row.label}
            className={`flex justify-between gap-2 ${
              isLast ? "pt-2" : "border-b border-[#2a2a3e] py-1.5"
            } ${row.emphasize ? "font-extrabold" : ""}`}
          >
            <span
              className={
                row.emphasize ? "text-[#f5f5f5]" : "text-[rgba(255,255,255,0.72)]"
              }
            >
              {row.label}
            </span>
            <span
              className={
                row.emphasize ? "text-[#86efac]" : "font-bold text-[#f5f5f5]"
              }
            >
              {row.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CouponReceipt({ ticket, className = "" }) {
  if (!ticket) return null;
  const selections = ticket.selections || [];

  return (
    <div
      className={`coupon-receipt w-full max-w-[330px] bg-[#fcfcf9] px-5 py-7 font-mono text-[#0a0a0a] shadow-[0_22px_48px_-18px_rgba(0,0,0,0.7)] ${className}`}
    >
      <div className="text-center">
        <p className="m-0 text-lg font-black uppercase tracking-[0.35em] text-[#0a0a0a]">
          {topHeaderData.brand}
        </p>
        <p className="mt-2 break-all text-xl font-extrabold tracking-[0.18em] text-[#0a0a0a]">
          {ticket.couponNumber}
        </p>
      </div>

      <ReceiptDivider />

      <p className="m-0 text-center text-[10px] font-bold uppercase tracking-[0.25em] text-[#555]">
        Games on this coupon
      </p>

      <ReceiptDivider />

      <div>
        {selections.map((sel, idx, arr) => {
          const kickoff = formatReceiptKickoff(sel.kickoffAt);
          const pick = String(sel.label ?? "").trim() || "-";
          const market = String(sel.marketLabel ?? "").trim();
          return (
            <div key={`${ticket.couponNumber}-${idx}`}>
              <div className="flex items-start gap-2 py-1">
                <LegResultIcon status={classifyLegStatus(sel)} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-extrabold leading-snug text-[#0a0a0a]">
                    {idx + 1}. {sel.matchName}
                  </div>
                  {kickoff ? (
                    <div className="text-[11px] font-bold text-[#555]">
                      {kickoff}
                    </div>
                  ) : null}
                  <div className="mt-0.5 flex justify-between gap-2">
                    <span className="min-w-0 flex-1 break-words text-[12px] font-bold text-[#0a0a0a]">
                      {market ? `${market}: ` : ""}
                      {pick}
                    </span>
                    <span className="shrink-0 text-[12px] font-black text-[#0a0a0a]">
                      {Number(sel.odds).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
              {idx < arr.length - 1 ? <ReceiptHyphenRule /> : null}
            </div>
          );
        })}
      </div>

      <ReceiptDivider />

      <TicketOutcomeBanner ticket={ticket} />
      <ReceiptTotals ticket={ticket} />
    </div>
  );
}

export default CouponReceipt;
