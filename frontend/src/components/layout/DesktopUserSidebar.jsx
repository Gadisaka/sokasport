import { useNavigate } from "react-router-dom";
import AppIcon from "../common/AppIcon";
import { useTranslation } from "../../i18n/LanguageContext.jsx";

const menuItems = [
  { id: "bets", tKey: "menu.betHistory", icon: "circleDot" },
  { id: "deposit", tKey: "menu.deposit", icon: "wallet" },
  { id: "withdraw", tKey: "menu.withdraw", icon: "wallet" },
  { id: "transactions", tKey: "menu.transactionHistory", icon: "clipboard" },
  { id: "check", tKey: "menu.checkTicket", icon: "ticket" },
  { id: "profile", tKey: "menu.profile", icon: "user" },
];

const ROUTES = {
  bets: "/bets",
  deposit: "/deposit",
  withdraw: "/withdraw",
  transactions: "/transactions",
  check: "/check-ticket",
  profile: "/profile",
};

function DesktopUserSidebar({ open, onClose }) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  function handleSignOut() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    onClose();
    navigate("/login");
  }

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[85] cursor-default border-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label={t("common.closeMenu")}
      />
      <div
        className="animate-deposit-panel fixed right-3 top-[3.75rem] z-[90] w-[min(calc(100vw-1.5rem),17.5rem)] origin-top-right overflow-hidden rounded-[1.35rem] bg-gradient-to-br from-(--sb-bg-2)/98 via-(--sb-bg-2)/98 to-(--sb-bg-page)/98 py-2 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.65)]  backdrop-blur-md transition-shadow duration-300 max-lg:hidden"
        role="dialog"
        aria-label={t("common.accountMenu")}
      >
        <div className="pointer-events-none absolute -right-8 -top-12 h-28 w-40 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(1,144,82,0.18),transparent_70%)] blur-2xl" />
        <div className="relative px-2 pt-1 pb-2">
          <p className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-[0.22em] text-[rgba(255,255,255,0.5)]">
            {t("menu.title")}
          </p>
          <nav className="flex flex-col gap-1">
            {menuItems.map((item) => {
              const path = ROUTES[item.id];
              const enabled = Boolean(path);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!enabled}
                  onClick={() => {
                    if (!path) return;
                    onClose();
                    navigate(path);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-all duration-200 ${
                    enabled
                      ? "text-[#ffffff] hover:translate-x-0.5 hover:bg-(--sb-accent-surface-deep)/75 hover:shadow-[inset_0_0_0_1px_rgba(95,227,214,0.18)]"
                      : "cursor-not-allowed text-[rgba(255,255,255,0.5)] opacity-60"
                  }`}
                >
                  {item.icon ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--sb-accent-surface-deep)/80 text-[rgba(255,255,255,0.72)] ">
                      <AppIcon name={item.icon} size={16} />
                    </span>
                  ) : (
                    <span className="h-8 w-8 shrink-0 rounded-lg bg-(--sb-accent-surface-deep)/40 ring-1 ring-[#019052]/30" />
                  )}
                  <span className="min-w-0 flex-1 leading-tight">{t(item.tKey)}</span>
                  {enabled ? (
                    <AppIcon
                      name="chevronDown"
                      size={14}
                      className="shrink-0 -rotate-90 text-[rgba(255,255,255,0.5)]"
                    />
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="relative mx-2 mb-2 h-px bg-[#019052]/60" />
        <button
          type="button"
          onClick={handleSignOut}
          className="relative mx-2 mb-2 flex w-[calc(100%-1rem)] items-center justify-center rounded-xl bg-[#2a1520]/55 py-2.5 text-xs font-extrabold tracking-wide text-[#ffb4b4] ring-1 ring-[#5a303a]/50 transition-all duration-200 hover:bg-[#3a1f28]/65 hover:ring-[#ff6b6b]/25"
        >
          {t("menu.signOut")}
        </button>
      </div>
    </>
  );
}

export default DesktopUserSidebar;
