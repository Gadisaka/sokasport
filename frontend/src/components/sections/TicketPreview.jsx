import AppIcon from "../common/AppIcon";
import { usePlatformSettings } from "../../hooks/usePlatformSettings";
import { slipGrossTaxNet, winningsTaxLabel } from "../../utils/winningsTax";

function TicketPreview({ selections, stake, onClose, onPlaceBet, placing }) {
  const { winningsTax } = usePlatformSettings();

  const totalOdds = selections.length
    ? selections.reduce((acc, s) => acc * parseFloat(s.value), 1).toFixed(2)
    : "0.00";

  const stakeNum = parseFloat(stake) || 0;
  const possibleWin = (stakeNum * parseFloat(totalOdds)).toFixed(2);
  const { tax, netWin } = slipGrossTaxNet(possibleWin, winningsTax);

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] overflow-hidden  bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="m-0 text-base font-extrabold text-black">
            TICKET PREVIEW
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border-0 bg-transparent text-black hover:text-[#ccc]"
          >
            <AppIcon name="x" size={20} strokeWidth={2.5} />
          </button>
        </div>

        {/* Column headers */}
        <div className="flex items-center justify-between border-b border-b-[#3a3a4e] bg-black px-5 py-2 text-xs font-bold text-[#b0b0c0]">
          <span>AKO</span>
          <span>ODDS</span>
        </div>

        {/* Selections list */}
        <div className="max-h-[50vh] overflow-y-auto">
          {selections.map((sel) => (
            <div key={sel.id} className="border-b border-b-[#2e2e40] px-5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-black">
                  {sel.matchName}
                </span>
                <span className="text-sm font-bold text-black">
                  {sel.value}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-[#8a8a9a]">
                {sel.marketLabel} : {sel.label}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="border-t border-t-[#2e2e40] px-5 py-3">
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-black">Deposit</span>
            <span className="text-sm text-black">{stakeNum} ETB</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-black">Total Odds</span>
            <span className="text-sm text-black">{totalOdds}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-black">
              {winningsTaxLabel(winningsTax)}
            </span>
            <span className="text-sm text-black">
              {tax === "—" ? "—" : `${tax} ETB`}
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-black">Gross win</span>
            <span className="text-sm text-black">{possibleWin} ETB</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm font-bold text-black">Net payout</span>
            <span className="text-sm font-bold text-black">
              {netWin === "—" ? "—" : `${netWin} ETB`}
            </span>
          </div>
        </div>

        {/* Place bet button */}
        <div className="px-5 pb-5">
          <button
            type="button"
            disabled={placing}
            onClick={() => {
              onPlaceBet?.();
              onClose();
            }}
            className="w-full cursor-pointer rounded-full border-0 bg-(--sb-accent-fill) py-3.5 text-base font-extrabold text-white disabled:opacity-60"
          >
            {placing ? "PLACING..." : "PLACE BET ONLINE"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TicketPreview;
