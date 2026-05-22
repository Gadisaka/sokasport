import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import TopHeader from "../components/layout/TopHeader";
import PrimaryNav from "../components/layout/PrimaryNav";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import AppIcon from "../components/common/AppIcon";
import { topHeaderData, topNavItems } from "../data/homepageData";
import { usePlatformSettings } from "../hooks/usePlatformSettings";
import {
  fetchPlayerWallet,
  fetchProfile,
  submitOnlineDeposit,
} from "../services/api";
import { depositAmountViolation } from "../utils/stakeLimits";
import SoftPanel from "../components/common/SoftPanel";
import {
  accountGhostBtn as ghostBtn,
  accountInputCls as inputCls,
  accountPrimaryBtn as primaryBtn,
} from "../components/common/accountFormClasses";
import cbeBankLogo from "../assets/banks/cbe.jpg";
import cbebirrBankLogo from "../assets/banks/cbebirr.png";
import telebirrBankLogo from "../assets/banks/telebirr.png";

/** Logos in `src/assets/banks` — keyed by payment method id */
const METHOD_BANK_LOGO = {
  cbe: cbeBankLogo,
  cbebirr: cbebirrBankLogo,
  telebirr: telebirrBankLogo,
};

const PAYMENT_METHODS = [
  { id: "telebirr", label: "Telebirr", hint: "Mobile money" },
  { id: "cbe", label: "CBE", hint: "Bank transfer" },
  { id: "cbebirr", label: "CBE Birr", hint: "CBE Birr wallet" },
];

const METHOD_AMHARIC_LABEL = {
  cbe: "CBE",
  telebirr: "Telebirr",
  cbebirr: "CBE Birr",
};

function StepDots({ step, total = 4 }) {
  return (
    <div className="mb-6 flex items-center justify-center gap-2">
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div
            key={n}
            className={`h-2.5 rounded-full transition-all duration-500 ease-out ${
              active
                ? "w-9 bg-(--sb-accent-fill) shadow-[0_0_14px_rgba(1,144,82,0.45)]"
                : done
                  ? "w-2.5 bg-(--sb-accent-fill)/55"
                  : "w-2.5 bg-[#019052]/80"
            }`}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

function OnlineDepositAmharicBlock({ methodKey, receivers, minD, maxD }) {
  if (!methodKey) return null;
  const label = METHOD_AMHARIC_LABEL[methodKey] ?? methodKey;
  const chunk = receivers?.[methodKey] ?? {};
  const accountOrPhone =
    methodKey === "cbe" ? chunk.receiverAccount : chunk.receiverPhone;
  const name = chunk.receiverName;
  const accountDisplay =
    accountOrPhone && String(accountOrPhone).trim()
      ? accountOrPhone
      : "— (አስተዳዳሪው ማስቀመጥ ያለበት)";
  const nameDisplay =
    name && String(name).trim() ? name : "— (አስተዳዳሪው ማስቀመጥ ያለበት)";

  let limitLine = "Deposit limit: —";
  if (
    minD != null &&
    Number.isFinite(minD) &&
    maxD != null &&
    Number.isFinite(maxD)
  ) {
    limitLine = `Deposit limit: ${minD.toLocaleString()} - ${maxD.toLocaleString()} Birr`;
  } else if (minD != null && Number.isFinite(minD)) {
    limitLine = `ዝቅተኛ ገንዘብ: ${minD.toLocaleString()} Birr`;
  } else if (maxD != null && Number.isFinite(maxD)) {
    limitLine = `ከፍተኛ ገንዘብ: ${maxD.toLocaleString()} Birr`;
  }

  return (
    <div className="mt-5 rounded-2xl bg-(--sb-accent-surface-deep)/55 px-4 py-4 text-sm leading-relaxed text-[#c8cad8]  transition-colors duration-300">
      <p className="m-0 font-semibold tracking-tight text-[#ffffff]">
        {label} አካውንት
      </p>
      <p className="mt-2 m-0">
        ስልክ / አካውንት:{" "}
        <span className="font-semibold text-[#ffffff]">{accountDisplay}</span>
      </p>
      <p className="mt-1 m-0">
        ስም:{" "}
        <span className="font-semibold text-[#ffffff]">{nameDisplay}</span>
      </p>
      <p className="mt-3 m-0 text-xs font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.72)]">
        መመሪያ
      </p>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-[rgba(255,255,255,0.72)]">
        <li>ከላይ ባለው የ {label} አካውንት ገንዘቡን ያስገቡ</li>
        <li>
          ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጹሁፍ መልክት (SMS) ይደርሳችኋል
        </li>
        <li>
          የደረሳችሁን SMS ሙሉውን ኮፒ አድርጋችሁ በሚቀጥለው ምዕራፍ ውስጥ ፔስት አድርጋችሁ ላኩት
        </li>
      </ol>
      <p className="mt-3 m-0 text-xs text-[rgba(255,255,255,0.72)]">{limitLine}</p>
    </div>
  );
}

function Deposit() {
  const navigate = useNavigate();
  const { limits, onlineDepositReceivers } = usePlatformSettings();

  const minD =
    limits?.MIN_DEPOSIT != null && Number.isFinite(limits.MIN_DEPOSIT)
      ? limits.MIN_DEPOSIT
      : null;
  const maxD =
    limits?.MAX_DEPOSIT != null && Number.isFinite(limits.MAX_DEPOSIT)
      ? limits.MAX_DEPOSIT
      : null;

  let limitsLine = null;
  if (
    minD != null &&
    Number.isFinite(minD) &&
    maxD != null &&
    Number.isFinite(maxD)
  ) {
    limitsLine = `Shop deposits are typically handled between ${minD.toLocaleString()} and ${maxD.toLocaleString()} ETB (admin limits). Exact amounts depend on cashier policy.`;
  } else if (minD != null && Number.isFinite(minD)) {
    limitsLine = `Minimum deposit (platform): ${minD.toLocaleString()} ETB — confirm with shop staff.`;
  } else if (maxD != null && Number.isFinite(maxD)) {
    limitsLine = `Maximum deposit (platform guidance): ${maxD.toLocaleString()} ETB — confirm with shop staff.`;
  }

  const [depositTab, setDepositTab] = useState("online");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);

  const [onlineStep, setOnlineStep] = useState(1);
  const [method, setMethod] = useState(
    /** @type {"cbe"|"cbebirr"|"telebirr"|""} */ (""),
  );
  const [amountInput, setAmountInput] = useState("");
  const [smsText, setSmsText] = useState("");
  const [onlineFormError, setOnlineFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [onlineResult, setOnlineResult] = useState(
    /** @type {{ ok: true, data: object } | { ok: false, message: string } | null} */ (
      null
    ),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetchProfile();
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

  function resetOnlineWizard() {
    setOnlineStep(1);
    setMethod("");
    setAmountInput("");
    setSmsText("");
    setOnlineFormError("");
    setOnlineResult(null);
    setSubmitting(false);
  }

  function goAmountStep() {
    setOnlineFormError("");
    if (!method) {
      setOnlineFormError("Choose a payment method.");
      return;
    }
    setOnlineStep(2);
  }

  function goDetailsStep() {
    setOnlineFormError("");
    const n = Number(amountInput);
    if (!Number.isFinite(n) || n <= 0) {
      setOnlineFormError("Enter a valid amount.");
      return;
    }
    const depErr = depositAmountViolation(limits, n);
    if (depErr) {
      setOnlineFormError(depErr);
      return;
    }
    setOnlineStep(3);
  }

  async function submitOnline() {
    setOnlineFormError("");
    const n = Number(amountInput);
    if (!Number.isFinite(n) || n <= 0) {
      setOnlineFormError("Enter a valid amount.");
      return;
    }

    if (method === "telebirr" || method === "cbe" || method === "cbebirr") {
      if (!smsText.trim()) {
        setOnlineFormError(
          "Paste the full SMS from your bank or mobile money service.",
        );
        return;
      }
    }

    const payload = { method, amount: n };
    if (method === "telebirr" || method === "cbe" || method === "cbebirr") {
      payload.smsText = smsText.trim();
    }

    setSubmitting(true);
    try {
      const data = await submitOnlineDeposit(payload);
      setOnlineResult({ ok: true, data });
      setOnlineStep(4);
      fetchPlayerWallet().catch(() => {});
    } catch (err) {
      setOnlineResult({
        ok: false,
        message: err.message || "Online deposit failed.",
      });
      setOnlineStep(4);
    } finally {
      setSubmitting(false);
    }
  }

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
              Wallet top-up
            </p>
            <h1 className="m-0 text-2xl font-black tracking-tight text-[#ffffff] sm:text-3xl">
              Deposit
            </h1>
          </div>
        </header>

        <div className="relative mb-8 flex rounded-full bg-(--sb-accent-surface-deep)/85 p-1.5 shadow-inner shadow-black/30  backdrop-blur-md">
          <div
            className={`absolute inset-y-1.5 w-[calc(50%-6px)] rounded-full bg-(--sb-accent-fill) shadow-[0_8px_24px_rgba(1,144,82,0.35)] transition-all duration-500 ease-out ${
              depositTab === "online" ? "left-1.5" : "left-[calc(50%+3px)]"
            }`}
            aria-hidden
          />
          <button
            type="button"
            className={`relative z-10 flex-1 rounded-full py-3 text-center text-sm font-extrabold tracking-wide transition-colors duration-300 ${
              depositTab === "online"
                ? "text-white"
                : "text-[rgba(255,255,255,0.72)] hover:text-[#ffffff]"
            }`}
            onClick={() => {
              if (depositTab === "shop") resetOnlineWizard();
              setDepositTab("online");
            }}
          >
            Online
          </button>
          <button
            type="button"
            className={`relative z-10 flex-1 rounded-full py-3 text-center text-sm font-extrabold tracking-wide transition-colors duration-300 ${
              depositTab === "shop"
                ? "text-white"
                : "text-[rgba(255,255,255,0.72)] hover:text-[#ffffff]"
            }`}
            onClick={() => setDepositTab("shop")}
          >
            Shop
          </button>
        </div>

        {depositTab === "shop" ? (
          <SoftPanel className="animate-deposit-panel">
            <p className="m-0 text-sm leading-relaxed text-[rgba(255,255,255,0.72)]">
              Use your phone to deposit your account at the nearest shop.
            </p>
            {limitsLine ? (
              <p className="mt-4 border-t border-white/8 pt-4 text-sm leading-relaxed text-[rgba(255,255,255,0.72)]">
                {limitsLine}
              </p>
            ) : null}
          </SoftPanel>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center gap-5 py-24">
            <div className="relative h-14 w-14">
              <div className="absolute inset-0 animate-ping rounded-full bg-(--sb-accent-fill)/25" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-(--sb-bg-2) ring-2 ring-(--sb-accent-fill)/40">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#019052] border-t-(--sb-accent-fill)" />
              </div>
            </div>
            <span className="text-sm font-semibold text-[rgba(255,255,255,0.72)]">
              Loading your session…
            </span>
          </div>
        ) : pageError ? (
          <SoftPanel className="animate-deposit-panel ring-red-900/30">
            <p className="m-0 text-sm font-semibold text-[#ff6b6b]">
              {pageError}
            </p>
          </SoftPanel>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="mb-2 px-1 text-center text-sm leading-relaxed text-[rgba(255,255,255,0.72)]">
              Pay in your banking app, then paste the SMS. The amount must match
              the verified transfer.
            </p>

            {onlineStep < 4 ? (
              <StepDots step={onlineStep} total={4} />
            ) : null}

            <div
              key={`${onlineStep}-${onlineResult?.ok ?? "form"}`}
              className="animate-deposit-panel"
            >
              {onlineStep === 1 && (
                <SoftPanel>
                  <p className="mb-4 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.72)]">
                    Choose payment method
                  </p>
                  <div className="flex flex-col gap-3">
                    {PAYMENT_METHODS.map((m) => {
                      const sel = method === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setMethod(m.id);
                            setOnlineFormError("");
                          }}
                          className={`group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl px-4 py-3.5 text-left transition-all duration-300 ${
                            sel
                              ? "scale-[1.02] bg-gradient-to-r from-(--sb-accent-surface)/90 via-(--sb-bg-2) to-(--sb-bg-page) shadow-[0_12px_32px_-12px_rgba(1,144,82,0.35)] ring-2 ring-(--sb-accent-fill)/70"
                              : "bg-(--sb-accent-surface-deep)/70 ring-1 ring-white/10 hover:shadow-lg hover:shadow-black/20"
                          }`}
                        >
                          <img
                            src={METHOD_BANK_LOGO[m.id]}
                            alt=""
                            width={48}
                            height={48}
                            className="h-12 w-12 shrink-0 rounded-2xl bg-white object-contain p-1.5 shadow-md ring-1 ring-white/30 transition-transform duration-300 group-hover:scale-[1.04]"
                            draggable={false}
                          />
                          <div className="min-w-0 flex-1 pr-2">
                            <span
                              className={`block text-base font-bold transition-colors ${
                                sel ? "text-[#ffffff]" : "text-[rgba(255,255,255,0.72)] group-hover:text-[#e8eaf5]"
                              }`}
                            >
                              {m.label}
                            </span>
                            <span className="mt-0.5 block text-xs font-medium text-[rgba(255,255,255,0.5)] transition-colors group-hover:text-[rgba(255,255,255,0.72)]">
                              {m.hint}
                            </span>
                          </div>
                          {sel ? (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--sb-accent-fill)/90 text-white text-xs font-black transition-transform duration-300">
                              ✓
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {onlineFormError ? (
                    <p className="mt-4 text-center text-sm font-semibold text-[#ff6b6b]">
                      {onlineFormError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={goAmountStep}
                    className={`${primaryBtn} mt-6`}
                  >
                    Continue
                  </button>
                </SoftPanel>
              )}

              {onlineStep === 2 && (
                <SoftPanel>
                  <div className="mb-3 flex flex-col items-center gap-2">
                    {method && METHOD_BANK_LOGO[method] ? (
                      <img
                        src={METHOD_BANK_LOGO[method]}
                        alt=""
                        width={44}
                        height={44}
                        className="h-11 w-11 rounded-2xl bg-white object-contain p-1.5 shadow-md ring-1 ring-white/25"
                        draggable={false}
                      />
                    ) : null}
                    <p className="m-0 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.72)]">
                      Amount
                    </p>
                  </div>
                  <p className="mb-4 text-center text-[11px] text-[rgba(255,255,255,0.5)]">
                    {minD != null || maxD != null
                      ? `Platform range${minD != null ? ` · min ${minD}` : ""}${maxD != null ? ` · max ${maxD}` : ""} ETB`
                      : "Enter amount in ETB"}
                  </p>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[rgba(255,255,255,0.5)]">
                      Br
                    </span>
                    <input
                      type="number"
                      min={minD != null ? minD : 1}
                      max={maxD != null ? maxD : undefined}
                      step="any"
                      value={amountInput}
                      onChange={(ev) => {
                        setAmountInput(ev.target.value);
                        setOnlineFormError("");
                      }}
                      className={`${inputCls} pl-12 text-2xl tracking-tight`}
                      placeholder="0"
                    />
                  </div>
                  <OnlineDepositAmharicBlock
                    methodKey={method}
                    receivers={onlineDepositReceivers}
                    minD={minD}
                    maxD={maxD}
                  />
                  {onlineFormError ? (
                    <p className="mt-4 text-center text-sm font-semibold text-[#ff6b6b]">
                      {onlineFormError}
                    </p>
                  ) : null}
                  <div className="mt-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setOnlineStep(1);
                        setOnlineFormError("");
                      }}
                      className={ghostBtn}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={goDetailsStep}
                      className={`${primaryBtn} flex-[1.2]`}
                    >
                      Next
                    </button>
                  </div>
                </SoftPanel>
              )}

              {onlineStep === 3 && (
                <SoftPanel>
                  <div className="mb-4 flex flex-col items-center gap-2">
                    {method && METHOD_BANK_LOGO[method] ? (
                      <img
                        src={METHOD_BANK_LOGO[method]}
                        alt=""
                        width={44}
                        height={44}
                        className="h-11 w-11 rounded-2xl bg-white object-contain p-1.5 shadow-md ring-1 ring-white/25"
                        draggable={false}
                      />
                    ) : null}
                    <p className="m-0 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.72)]">
                      SMS from bank
                    </p>
                  </div>
                  {(method === "telebirr" ||
                    method === "cbe" ||
                    method === "cbebirr") && (
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold text-[rgba(255,255,255,0.72)]">
                        Full message
                      </span>
                      <textarea
                        value={smsText}
                        onChange={(ev) => setSmsText(ev.target.value)}
                        rows={8}
                        className={`${inputCls} min-h-[10rem] resize-y font-mono text-sm leading-relaxed`}
                        placeholder={
                          method === "cbebirr"
                            ? "Paste the entire CBE Birr SMS (include the invoice link if present)…"
                            : "Paste the entire text message from your bank or Telebirr…"
                        }
                        autoComplete="off"
                      />
                    </label>
                  )}
                  {onlineFormError ? (
                    <p className="mt-4 text-center text-sm font-semibold text-[#ff6b6b]">
                      {onlineFormError}
                    </p>
                  ) : null}
                  <div className="mt-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setOnlineStep(2);
                        setOnlineFormError("");
                      }}
                      disabled={submitting}
                      className={ghostBtn}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={submitOnline}
                      disabled={submitting}
                      className={`${primaryBtn} flex-[1.2]`}
                    >
                      {submitting ? "Verifying…" : "Confirm deposit"}
                    </button>
                  </div>
                </SoftPanel>
              )}

              {onlineStep === 4 && onlineResult && (
                <SoftPanel
                  className={
                    onlineResult.ok
                      ? "shadow-[0_0_0_1px_rgba(95,227,214,0.2),0_24px_48px_-20px_rgba(20,36,20,0.6)]"
                      : "shadow-[0_0_0_1px_rgba(255,107,107,0.15),0_24px_48px_-20px_rgba(42,20,20,0.5)]"
                  }
                  style={{
                    background:
                      onlineResult.ok === true
                        ? "linear-gradient(155deg, rgba(20,36,24,0.92) 0%, rgba(24,24,42,0.95) 100%)"
                        : "linear-gradient(155deg, rgba(42,20,20,0.88) 0%, rgba(24,24,36,0.95) 100%)",
                  }}
                >
                  {onlineResult.ok ? (
                    <>
                      <div className="mb-4 flex justify-center">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-(--sb-accent-fill)/20 text-3xl ring-2 ring-(--sb-accent-fill)/50">
                          ✓
                        </div>
                      </div>
                      <p className="m-0 text-center text-xs font-extrabold uppercase tracking-[0.2em] text-[#86efac]">
                        Deposit successful
                      </p>
                      <p className="mt-4 text-center text-sm text-[#ffffff]">
                        Credited{" "}
                        <span className="text-lg font-bold text-[#ffffff]">
                          {Number(
                            onlineResult.data.creditedAmount ?? 0,
                          ).toLocaleString()}{" "}
                          ETB
                        </span>
                      </p>
                      <p className="mt-2 text-center text-sm text-[rgba(255,255,255,0.72)]">
                        New balance{" "}
                        <span className="font-semibold text-[#ffffff]">
                          {Number(
                            onlineResult.data.newBalance ?? 0,
                          ).toLocaleString()}{" "}
                          ETB
                        </span>
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="mb-4 flex justify-center">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ff6b6b]/15 text-3xl text-[#ff6b6b] ring-2 ring-[#ff6b6b]/35">
                          !
                        </div>
                      </div>
                      <p className="m-0 text-center text-xs font-extrabold uppercase tracking-[0.2em] text-[#ff6b6b]">
                        Deposit failed
                      </p>
                      <p className="mt-4 text-center text-sm leading-relaxed text-[#ffffff]">
                        {onlineResult.message}
                      </p>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={resetOnlineWizard}
                    className={`mt-8 w-full rounded-2xl py-3.5 text-xs font-extrabold tracking-wide transition-all duration-300 ${
                      onlineResult.ok
                        ? "bg-[#1a3d2e]/80 text-[#86efac] ring-1 ring-[#3f7f3f]/50 hover:bg-[#234d38]/90"
                        : "bg-[#3a1515]/80 text-[#ff9b9b] ring-1 ring-[#8a4040]/40 hover:bg-[#4a2020]/90"
                    }`}
                  >
                    Start another deposit
                  </button>
                </SoftPanel>
              )}
            </div>
          </div>
        )}
      </div>

      <MobileBottomBar />
    </PageContainer>
  );
}

export default Deposit;
