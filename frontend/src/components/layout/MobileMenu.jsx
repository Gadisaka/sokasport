import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppIcon from "../common/AppIcon";
import { useTranslation } from "../../i18n/LanguageContext.jsx";

const subLinkCls =
  "flex w-full cursor-pointer items-center gap-3 rounded-xl border-0 bg-(--sb-accent-surface-deep)/55 px-4 py-3 text-left text-sm font-bold text-[#ffffff]  transition-all duration-200 hover:bg-(--sb-accent-surface-deep)/85 hover:ring-(--sb-accent-fill)/22";

function MobileMenu({ open, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [myBetsOpen, setMyBetsOpen] = useState(true);
  const [balanceOpen, setBalanceOpen] = useState(true);

  function handleSignOut() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    onClose();
    navigate("/login");
  }

  return (
    <>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-[85] cursor-default border-0 bg-black/55 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
          aria-label={t("common.closeMenu")}
        />
      ) : null}
      <div
        className={`fixed inset-y-0 right-0 z-[90] flex w-[min(100vw-1.25rem,20rem)] flex-col overflow-hidden rounded-l-[1.75rem] bg-gradient-to-br from-(--sb-bg-2)/98 via-(--sb-bg-2)/99 to-(--sb-bg-page)/98 shadow-[0_0_80px_-10px_rgba(0,0,0,0.85)]  backdrop-blur-md transition-transform duration-300 ease-out lg:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-label={t("common.accountMenu")}
      >
        <div className="pointer-events-none absolute -left-16 top-24 h-40 w-48 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(1,144,82,0.16),transparent_70%)] blur-2xl" />

        <div className="relative flex h-14 shrink-0 items-center justify-between px-4 shadow-[0_12px_28px_-16px_rgba(0,0,0,0.6)]">
          <div
            className="absolute inset-0 -z-10 rounded-br-[2rem] bg-(--sb-accent-fill) shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)]"
            aria-hidden
          />
          <p className="m-0 text-xs font-extrabold uppercase tracking-[0.18em] text-white">
            {t("menu.accountTitle")}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="relative z-10 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 bg-(--sb-accent-surface-deep)/18 text-white transition-transform hover:scale-105 active:scale-95"
            aria-label={t("common.close")}
          >
            <AppIcon name="x" size={22} strokeWidth={2.5} />
          </button>
        </div>

        <div className="relative flex-1 overflow-y-auto px-3 pb-8 pt-4">
          <button
            type="button"
            className="mb-2 flex w-full cursor-pointer items-center gap-3 rounded-xl border-0 bg-(--sb-accent-surface-deep)/40 px-4 py-3.5 text-left text-sm font-extrabold text-[#ffffff]  transition-all duration-200 hover:bg-(--sb-accent-surface-deep)/70 hover:ring-(--sb-accent-fill)/20"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-(--sb-bg-2) text-[rgba(255,255,255,0.72)] ">
              <AppIcon name="send" size={18} />
            </span>
            {t("menu.messages")}
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              navigate("/profile");
            }}
            className="mb-3 flex w-full cursor-pointer items-center gap-3 rounded-xl border-0 bg-(--sb-accent-surface-deep)/40 px-4 py-3.5 text-left text-sm font-extrabold text-[#ffffff]  transition-all duration-200 hover:bg-(--sb-accent-surface)/35 hover:ring-(--sb-accent-fill)/35"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-(--sb-bg-2) text-[rgba(255,255,255,0.72)] ">
              <AppIcon name="user" size={18} />
            </span>
            {t("menu.myProfile")}
          </button>

          <div className="mb-2 overflow-hidden rounded-xl ">
            <button
              type="button"
              onClick={() => setMyBetsOpen((p) => !p)}
              className="flex w-full cursor-pointer items-center justify-between border-0 bg-(--sb-accent-surface-deep)/35 px-4 py-3.5 text-left text-sm font-extrabold text-[#ffffff] transition-colors hover:bg-(--sb-accent-surface-deep)/55"
            >
              {t("menu.myBets")}
              <AppIcon
                name={myBetsOpen ? "chevronUp" : "chevronDown"}
                size={16}
                className="text-[rgba(255,255,255,0.72)]"
              />
            </button>
            <div
              className={`grid transition-all duration-300 ease-out ${
                myBetsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex flex-col gap-2 p-3 pt-0">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate("/bets");
                    }}
                    className={subLinkCls}
                  >
                    <AppIcon name="circleDot" size={16} className="text-[rgba(255,255,255,0.72)]" />
                    {t("menu.betHistory")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate("/check-ticket");
                    }}
                    className={subLinkCls}
                  >
                    <AppIcon name="ticket" size={16} className="text-[rgba(255,255,255,0.72)]" />
                    {t("menu.checkTicket")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-4 overflow-hidden rounded-xl ">
            <button
              type="button"
              onClick={() => setBalanceOpen((p) => !p)}
              className="flex w-full cursor-pointer items-center justify-between border-0 bg-(--sb-accent-surface-deep)/35 px-4 py-3.5 text-left text-sm font-extrabold text-[#ffffff] transition-colors hover:bg-(--sb-accent-surface-deep)/55"
            >
              {t("menu.balance")}
              <AppIcon
                name={balanceOpen ? "chevronUp" : "chevronDown"}
                size={16}
                className="text-[rgba(255,255,255,0.72)]"
              />
            </button>
            <div
              className={`grid transition-all duration-300 ease-out ${
                balanceOpen
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex flex-col gap-2 p-3 pt-0">
                  {[
                    { tKey: "menu.deposit", path: "/deposit" },
                    { tKey: "menu.withdraw", path: "/withdraw" },
                    { tKey: "menu.transaction", path: "/transactions" },
                  ].map((item) => (
                    <button
                      key={item.tKey}
                      type="button"
                      onClick={() => {
                        if (item.path) {
                          onClose();
                          navigate(item.path);
                        }
                      }}
                      disabled={!item.path}
                      className={`${subLinkCls} disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      {t(item.tKey)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full cursor-pointer items-center justify-center rounded-xl bg-[#2a1520]/55 py-3.5 text-sm font-extrabold tracking-wide text-[#ffb4b4] ring-1 ring-[#5a303a]/50 transition-all duration-200 hover:bg-[#3a1f28]/65"
          >
            {t("menu.signOut")}
          </button>
        </div>
      </div>
    </>
  );
}

export default MobileMenu;
