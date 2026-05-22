import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import TopHeader from "../components/layout/TopHeader";
import PrimaryNav from "../components/layout/PrimaryNav";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import AppIcon from "../components/common/AppIcon";
import SoftPanel from "../components/common/SoftPanel";
import {
  accountInputCls,
  accountPrimaryBtn,
} from "../components/common/accountFormClasses";
import { topHeaderData, topNavItems } from "../data/homepageData";
import {
  createPlayerShopWithdraw,
  fetchPlayerWallet,
  fetchProfile,
} from "../services/api";
import { usePlatformSettings } from "../hooks/usePlatformSettings";
import { withdrawAmountViolation } from "../utils/stakeLimits";

function Withdraw() {
  const navigate = useNavigate();
  const { limits } = usePlatformSettings();
  const minW =
    limits?.MIN_WITHDRAW != null && Number.isFinite(limits.MIN_WITHDRAW)
      ? limits.MIN_WITHDRAW
      : null;
  const maxW =
    limits?.MAX_WITHDRAW != null && Number.isFinite(limits.MAX_WITHDRAW)
      ? limits.MAX_WITHDRAW
      : null;

  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState(null);
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetchProfile();
        const wallet = await fetchPlayerWallet();
        if (cancelled) return;
        setBalance(wallet === null ? null : Number(wallet.balance ?? 0));
      } catch (e) {
        if (cancelled) return;
        if (e.message === "NOT_LOGGED_IN") {
          navigate("/login");
          return;
        }
        setPageError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    setResult(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setFormError("Enter a valid amount.");
      return;
    }
    if (balance != null && n > balance) {
      setFormError("Amount exceeds your balance.");
      return;
    }

    const wdErr = withdrawAmountViolation(limits, n);
    if (wdErr) {
      setFormError(wdErr);
      return;
    }

    setSubmitting(true);
    try {
      const data = await createPlayerShopWithdraw(n);
      setResult({
        code: data.code,
        expiresAt: data.expiresAt,
        amount: data.amount ?? n,
      });
      setAmount("");
      const wallet = await fetchPlayerWallet();
      if (wallet) setBalance(Number(wallet.balance ?? 0));
    } catch (err) {
      setFormError(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCode() {
    if (!result?.code) return;
    try {
      await navigator.clipboard.writeText(result.code);
    } catch {
      /* ignore */
    }
  }

  const limitHint =
    minW != null || maxW != null
      ? `Platform range${minW != null ? ` · min ${minW}` : ""}${maxW != null ? ` · max ${maxW}` : ""} ETB`
      : null;

  return (
    <PageContainer>
      <div className="sticky top-0 z-50">
        <TopHeader data={topHeaderData} />
        <PrimaryNav items={topNavItems} />
      </div>

      <div className="relative mx-auto w-full max-w-lg px-4 pb-28 pt-2 sm:px-5 sm:pt-4">
        <div
          className="pointer-events-none absolute -top-4 left-1/2 h-64 w-[min(100%,28rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(1,144,82,0.14),transparent_68%)] blur-xl"
          aria-hidden
        />

        <header className="relative mb-8 flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate("/profile")}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-(--sb-bg-2)/90 text-[#ffffff] shadow-lg shadow-black/20  transition-transform duration-300 hover:scale-105 hover:bg-(--sb-bg-2) hover:ring-(--sb-accent-fill)/30 active:scale-95"
          >
            <AppIcon name="chevronDown" size={18} className="rotate-90" />
          </button>
          <div>
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
              Shop withdrawal
            </p>
            <h1 className="m-0 text-2xl font-black tracking-tight text-[#ffffff] sm:text-3xl">
              Withdraw
            </h1>
          </div>
        </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-[rgba(255,255,255,0.72)]">
            <div className="relative h-14 w-14">
              <div className="absolute inset-0 animate-ping rounded-full bg-(--sb-accent-fill)/25" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-(--sb-bg-2) ring-2 ring-(--sb-accent-fill)/40">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#019052] border-t-(--sb-accent-fill)" />
              </div>
            </div>
            <span className="text-sm font-semibold">Loading…</span>
          </div>
        ) : pageError ? (
          <SoftPanel className="animate-deposit-panel ring-red-900/30">
            <p className="m-0 text-sm font-semibold text-[#ff6b6b]">
              {pageError}
            </p>
          </SoftPanel>
        ) : (
          <div className="flex flex-col gap-4">
            <SoftPanel className="animate-deposit-panel">
              <p className="m-0 text-center text-sm leading-relaxed text-[rgba(255,255,255,0.72)]">
                Enter how much you want to take out. We&apos;ll give you a
                one-time code to show at a shop cashier. The code works{" "}
                <span className="font-bold text-[#ffffff]">once</span>
                {result?.expiresAt
                  ? " — see expiry below after you generate a code."
                  : " and may expire if unused."}
              </p>
            </SoftPanel>

            <SoftPanel className="animate-deposit-panel">
              <p className="mb-3 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.72)]">
                Your balance
              </p>
              <p className="m-0 text-center text-3xl font-black tabular-nums text-(--sb-positive) sm:text-4xl">
                {balance === null ? "—" : `${balance.toLocaleString()} ETB`}
              </p>
            </SoftPanel>

            <form
              onSubmit={handleSubmit}
              className="animate-deposit-panel"
            >
              <SoftPanel>
                <label className="block">
                  <span className="mb-2 block text-center text-xs font-extrabold uppercase tracking-[0.15em] text-[rgba(255,255,255,0.72)]">
                    Amount (ETB)
                  </span>
                  {limitHint ? (
                    <p className="mb-3 text-center text-[11px] text-[rgba(255,255,255,0.5)]">
                      {limitHint}
                    </p>
                  ) : null}
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[rgba(255,255,255,0.5)]">
                      Br
                    </span>
                    <input
                      type="number"
                      min={minW != null ? minW : 1}
                      max={maxW != null ? maxW : undefined}
                      step="any"
                      value={amount}
                      onChange={(ev) => {
                        setAmount(ev.target.value);
                        setFormError("");
                      }}
                      required
                      className={`${accountInputCls} pl-12 text-2xl tracking-tight`}
                      placeholder="0"
                    />
                  </div>
                </label>

                {formError ? (
                  <p className="mt-4 text-center text-sm font-semibold text-[#ff6b6b]">
                    {formError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className={`${accountPrimaryBtn} mt-6`}
                >
                  {submitting ? "Generating code…" : "Get withdrawal code"}
                </button>
              </SoftPanel>
            </form>

            {result ? (
              <SoftPanel
                className="animate-deposit-panel ring-[#3f7f5f]/35"
                style={{
                  background:
                    "linear-gradient(145deg, rgba(15,74,69,0.55) 0%, rgba(24,24,42,0.96) 42%, rgba(18,18,31,0.98) 100%)",
                }}
              >
                <p className="m-0 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[#86efac]">
                  Your one-time code
                </p>
                <p className="mt-4 text-center font-mono text-3xl font-black tracking-[0.2em] text-[#ffffff] sm:text-4xl sm:tracking-[0.25em]">
                  {result.code}
                </p>
                <p className="mt-3 text-center text-sm text-[rgba(255,255,255,0.72)]">
                  Amount:{" "}
                  <span className="font-bold text-[#ffffff]">
                    {Number(result.amount).toLocaleString()} ETB
                  </span>
                </p>
                {result.expiresAt ? (
                  <p className="mt-2 text-center text-xs text-[rgba(255,255,255,0.72)]">
                    Unused codes expire after:{" "}
                    {new Date(result.expiresAt).toLocaleString()}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={copyCode}
                  className="mt-6 w-full rounded-2xl bg-(--sb-accent-surface-deep)/50 py-3.5 text-sm font-extrabold text-[#86efac] ring-1 ring-[#5f9f6f]/50 transition-all duration-300 hover:bg-(--sb-accent-surface)/40 hover:ring-[#86efac]/40"
                >
                  Copy code
                </button>
              </SoftPanel>
            ) : null}
          </div>
        )}
      </div>

      <MobileBottomBar
        selections={[]}
        onRemoveSelection={() => {}}
        onClearSelections={() => {}}
      />
      <div className="h-16 lg:hidden" />
    </PageContainer>
  );
}

export default Withdraw;
