import AppIcon from "./AppIcon";
import { topHeaderData } from "../../data/homepageData";
import { classifyLegStatus } from "../../utils/legResultStatus";

/**
 * Public coupon rendered to look like the printed paper ticket: white thermal
 * paper, monospace, dashed dividers, scalloped edges (`.coupon-receipt` in
 * index.css), with a per-leg result marker in front of each match.
 *
 * Shared by the Check-ticket page and the "Check Coupon" preview in the desktop
 * and mobile bet slips. `ticket` is the payload from `fetchPublicCouponTicket`:
 * `{ couponNumber, selections: [{ matchName, marketLabel, label, odds,
 * kickoffAt, result, status }] }`.
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

      <p className="m-0 text-center text-[10px] font-semibold leading-relaxed text-[#555]">
        Stake and payout follow your receipt when the bet is paid or printed.
      </p>
    </div>
  );
}

export default CouponReceipt;
