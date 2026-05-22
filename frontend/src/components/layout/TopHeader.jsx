import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import AppIcon from "../common/AppIcon";
import DesktopUserSidebar from "./DesktopUserSidebar";
import MobileMenu from "./MobileMenu";
import {
  fetchNotificationUnreadCount,
  fetchPlayerInfoPages,
  fetchPlayerWallet,
} from "../../services/api";
import NotificationsDialog from "../notifications/NotificationsDialog";
import { usePlayerSiteBranding } from "../../hooks/usePlayerSiteBranding";
import { useLanguage, useTranslation } from "../../i18n/LanguageContext.jsx";

/** Small flag assets (GB = English UI, ET = Amharic). */
const LANG_FLAG = Object.freeze({
  en: { code: "gb", label: "English" },
  am: { code: "et", label: "አማርኛ" },
});

function flagSrc(iso2) {
  return `https://flagcdn.com/w40/${iso2}.png`;
}

function pickTelegramContactFromPages(pages) {
  const entries = Array.isArray(pages?.["contact-us"]?.entries)
    ? pages["contact-us"].entries
    : [];
  if (entries.length === 0) return null;

  const looksLikeTelegram = (row) => {
    const name = String(row?.name || "").toLowerCase();
    const link = String(row?.link || "").toLowerCase();
    return (
      name.includes("telegram") ||
      link.includes("t.me/") ||
      link.includes("telegram.me/") ||
      link.includes("telegram")
    );
  };

  const preferred = entries.find(looksLikeTelegram) || entries[0];
  const logo = typeof preferred?.logo === "string" ? preferred.logo.trim() : "";
  const link = typeof preferred?.link === "string" ? preferred.link.trim() : "";
  if (!logo || !link) return null;
  return { logo, link };
}

function TopHeader() {
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();
  const { navbarWide: logoWide, navbarCompact: logoCompact } =
    usePlayerSiteBranding();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef(null);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [, forceUpdate] = useState(0);
  const [walletBalance, setWalletBalance] = useState(null);
  const [telegramCta, setTelegramCta] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const token =
    localStorage.getItem("token") || sessionStorage.getItem("token");
  const userStr =
    localStorage.getItem("user") || sessionStorage.getItem("user");
  const user = userStr ? JSON.parse(userStr) : null;
  const isLoggedIn = !!token;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!isLoggedIn) {
        setWalletBalance(null);
        return;
      }
      const wallet = await fetchPlayerWallet();
      if (!cancelled) setWalletBalance(wallet?.balance ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const refreshUnreadCount = useCallback(async () => {
    if (!isLoggedIn) {
      setUnreadCount(0);
      return;
    }
    try {
      const data = await fetchNotificationUnreadCount();
      setUnreadCount(Number(data?.count) || 0);
    } catch {
      setUnreadCount(0);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    const handler = () => {
      forceUpdate((n) => n + 1);
      (async () => {
        const wallet = await fetchPlayerWallet();
        setWalletBalance(wallet?.balance ?? 0);
      })();
      void refreshUnreadCount();
    };
    window.addEventListener("balanceUpdated", handler);
    return () => window.removeEventListener("balanceUpdated", handler);
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!isLoggedIn) {
      setUnreadCount(0);
      return undefined;
    }
    void refreshUnreadCount();
    const id = setInterval(() => void refreshUnreadCount(), 60_000);
    return () => clearInterval(id);
  }, [isLoggedIn, refreshUnreadCount]);

  useEffect(() => {
    const onSession = () => forceUpdate((n) => n + 1);
    window.addEventListener("authSessionUpdated", onSession);
    return () => window.removeEventListener("authSessionUpdated", onSession);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPlayerInfoPages();
        if (cancelled) return;
        setTelegramCta(pickTelegramContactFromPages(data?.pages));
      } catch {
        if (!cancelled) setTelegramCta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!langMenuOpen) return undefined;
    const onDocPointer = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        setLangMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setLangMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [langMenuOpen]);

  const selectLang = useCallback(
    (code) => {
      setLanguage(code);
      setLangMenuOpen(false);
    },
    [setLanguage],
  );

  const displayName = user?.name || user?.phone || user?.username || "";
  const displayBalance =
    walletBalance === null ? "—" : Number(walletBalance).toLocaleString();

  return (
    <>
      <header className="flex min-w-0 items-center gap-3 overflow-visible border-b border-white/10 bg-(--sb-bg-page) px-2.5 py-1.5 max-lg:gap-2 max-lg:px-2">
        <Link
          to="/"
          className="mr-auto inline-flex shrink-0 flex-col justify-center rounded bg-(--sb-bg-page) px-1.5 py-1 leading-none no-underline sm:px-2"
        >
          <div className="flex h-10 max-h-[44px] w-auto max-w-[min(132px,34vw)] items-center justify-center sm:h-11 lg:h-11 lg:max-h-[52px] lg:max-w-[min(320px,42vw)] xl:h-12 xl:max-h-[56px]">
            <picture className="flex h-full max-h-full items-center">
              <source media="(min-width: 1024px)" srcSet={logoWide} />
              <img
                src={logoCompact}
                alt="Sokasport"
                decoding="async"
                className="h-full w-auto max-h-full object-contain object-center"
              />
            </picture>
          </div>
        </Link>

        {isLoggedIn ? (
          <div className="relative flex items-center gap-2 text-sm text-[#ffffff] max-lg:gap-1.5">
            <div className="mr-1 flex flex-col items-end leading-[1.12] max-lg:mr-0">
              <span className="text-xs font-bold">{displayBalance} ETB</span>
              <small className="text-[10px] font-bold text-[rgba(255,255,255,0.72)]">
                {displayName}
              </small>
            </div>
            <Link
              to="/deposit"
              aria-label={t("header.deposit")}
              title={t("header.deposit")}
              className="inline-flex min-h-[30px] min-w-[30px] cursor-pointer items-center justify-center rounded-2xl border-0 bg-(--sb-accent-fill) px-3.5 text-xs font-bold text-white no-underline hover:bg-(--sb-accent-fill-hover) max-lg:size-8 max-lg:min-h-0 max-lg:min-w-0 max-lg:rounded-full max-lg:px-0"
            >
              <AppIcon
                name="banknote"
                size={18}
                strokeWidth={2.2}
                className="text-white lg:hidden"
              />
              <span className="hidden lg:inline">{t("header.deposit")}</span>
            </Link>
            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              aria-label={
                unreadCount > 0
                  ? `${t("header.notifications")} (${unreadCount})`
                  : t("header.notifications")
              }
              className="relative inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-(--sb-bg-page) text-[rgba(255,255,255,0.72)] hover:bg-(--sb-bg-2) hover:text-white max-lg:hidden"
            >
              <AppIcon name="bell" size={16} />
              {unreadCount > 0 ? (
                <span
                  className="absolute right-0.5 top-0.5 size-2 rounded-full bg-red-500 ring-2 ring-(--sb-bg-page)"
                  aria-hidden
                />
              ) : null}
            </button>

            {/* User icon - triggers menus */}
            <button
              type="button"
              onClick={() => {
                setDesktopMenuOpen((p) => !p);
                setMobileMenuOpen((p) => !p);
              }}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-(--sb-bg-2) text-[rgba(255,255,255,0.72)]"
            >
              <AppIcon name="user" size={16} />
            </button>

            {/* Desktop sidebar */}
            <DesktopUserSidebar
              open={desktopMenuOpen}
              onClose={() => setDesktopMenuOpen(false)}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="flex h-[30px] items-center rounded-[14px] bg-(--sb-bg-2) px-3 text-xs font-extrabold text-[#ffffff] no-underline hover:bg-(--sb-bg-card-elevated)"
            >
              {t("header.login")}
            </Link>
            <Link
              to="/register"
              className="flex h-[30px] items-center rounded-[14px] border-0 bg-(--sb-accent-fill) px-3 text-xs font-extrabold text-white no-underline hover:bg-(--sb-accent-fill-hover)"
            >
              {t("header.register")}
            </Link>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1.5 max-lg:gap-1">
          {telegramCta ? (
            <a
              href={telegramCta.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-(--sb-bg-2) max-lg:h-7 max-lg:w-7"
              aria-label={t("header.telegram")}
            >
              <img
                src={telegramCta.logo}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </a>
          ) : null}

          <div className="relative z-20 shrink-0" ref={langMenuRef}>
            <button
              type="button"
              id="lang-menu-button"
              aria-haspopup="listbox"
              aria-expanded={langMenuOpen}
              aria-controls="lang-menu-list"
              aria-label={t("header.languageMenu")}
              onClick={() => setLangMenuOpen((o) => !o)}
              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full bg-(--sb-bg-2) py-0.5 pl-1 pr-1.5 max-lg:h-7"
              title={
                language === "en" ? LANG_FLAG.en.label : LANG_FLAG.am.label
              }
            >
              <span className="inline-flex h-6 w-6 shrink-0 overflow-hidden rounded-full max-lg:h-5 max-lg:w-5">
                <img
                  src={flagSrc(LANG_FLAG[language].code)}
                  alt=""
                  width={24}
                  height={24}
                  className="h-full w-full object-cover"
                  decoding="async"
                />
              </span>
              <AppIcon
                name="chevronDown"
                size={12}
                strokeWidth={2.4}
                className={`shrink-0 text-[rgba(255,255,255,0.72)] transition-transform ${langMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {langMenuOpen ? (
              <ul
                id="lang-menu-list"
                role="listbox"
                aria-labelledby="lang-menu-button"
                className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[3.25rem] overflow-hidden rounded-xl bg-(--sb-bg-2) py-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.55)]"
              >
                <li role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={language === "en"}
                    aria-label={t("header.langEnglish")}
                    onClick={() => selectLang("en")}
                    className={`flex w-full cursor-pointer items-center justify-center px-3 py-2 transition-colors ${
                      language === "en"
                        ? "bg-(--sb-bg-2)"
                        : "hover:bg-(--sb-bg-2)/90"
                    }`}
                  >
                    <span className="inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-full">
                      <img
                        src={flagSrc(LANG_FLAG.en.code)}
                        alt=""
                        width={32}
                        height={32}
                        className="h-full w-full object-cover"
                        decoding="async"
                      />
                    </span>
                  </button>
                </li>
                <li role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={language === "am"}
                    aria-label={t("header.langAmharic")}
                    onClick={() => selectLang("am")}
                    className={`flex w-full cursor-pointer items-center justify-center px-3 py-2 transition-colors ${
                      language === "am"
                        ? "bg-(--sb-bg-2)"
                        : "hover:bg-(--sb-bg-2)/90"
                    }`}
                  >
                    <span className="inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-full">
                      <img
                        src={flagSrc(LANG_FLAG.am.code)}
                        alt=""
                        width={32}
                        height={32}
                        className="h-full w-full object-cover"
                        decoding="async"
                      />
                    </span>
                  </button>
                </li>
              </ul>
            ) : null}
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {isLoggedIn && (
        <MobileMenu
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
        />
      )}

      {isLoggedIn ? (
        <NotificationsDialog
          open={notificationsOpen}
          onClose={() => {
            setNotificationsOpen(false);
            void refreshUnreadCount();
          }}
          onReadChange={() => void refreshUnreadCount()}
        />
      ) : null}
    </>
  );
}

export default TopHeader;
