import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import PrimaryNav from "../components/layout/PrimaryNav";
import SiteFooter from "../components/layout/SiteFooter";
import TopHeader from "../components/layout/TopHeader";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import AppIcon from "../components/common/AppIcon";
import GameFrame from "../components/casino/GameFrame";
import { topHeaderData, topNavItems } from "../data/homepageData";
import { useTranslation } from "../i18n/LanguageContext.jsx";
import {
  fetchCasinoGames,
  fetchCasinoStatus,
  fetchInoutDemoLaunchUrl,
  fetchInoutLaunchUrl,
  generateMrxSsoToken,
  hasAuthToken,
} from "../services/api";

const GAME_BASE_URL =
  import.meta.env.VITE_GAME_BASE_URL || "http://localhost:4505";
const AVIATOR_URL =
  import.meta.env.VITE_AVIATOR_URL || "http://localhost:4402";
const BINGO_URL = import.meta.env.VITE_BINGO_URL || "http://localhost:4404";

const MRX_GAMES = [
  {
    id: "keno",
    nameKey: "casino.kenoName",
    descKey: "casino.kenoDesc",
    accent: "#a855f7",
    ssoTarget: GAME_BASE_URL,
    path: "/game/keno",
  },
  {
    id: "aviator",
    nameKey: "casino.aviatorName",
    descKey: "casino.aviatorDesc",
    accent: "#0ea5e9",
    ssoTarget: AVIATOR_URL,
    path: "",
  },
  {
    id: "bingo",
    nameKey: "casino.bingoName",
    descKey: "casino.bingoDesc",
    accent: "#f59e0b",
    ssoTarget: BINGO_URL,
    path: "",
  },
];

function GameCard({ game, onPlay, onDemo, t }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-br from-[#111111]/92 to-[#000000]/92 transition-all hover:ring-1 hover:ring-(--sb-accent-fill)/40">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#0a0a0a]">
        {game.iconUrl ? (
          <img
            src={game.iconUrl}
            alt={game.title}
            loading="lazy"
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[#3a3a3a]">
            <AppIcon name="gamepad" size={40} />
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-2 bottom-2">
          <div className="pointer-events-auto grid grid-cols-2 gap-1.5 rounded-xl border border-white/25 bg-white/12 p-1.5 backdrop-blur-md">
            <button
              type="button"
              onClick={() => onPlay(game)}
              className="cursor-pointer rounded-lg border-0 bg-(--sb-accent-fill) px-2 py-1.5 text-[12px] font-bold text-[#000000] transition-all hover:brightness-110"
            >
              {t("casino.play")}
            </button>
            <button
              type="button"
              onClick={() => onDemo(game)}
              className="cursor-pointer rounded-lg border border-white/20 bg-black/20 px-2 py-1.5 text-[12px] font-semibold text-[#ffffff] transition-all hover:bg-black/35"
            >
              {t("casino.demo")}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <h3 className="truncate text-[13px] font-semibold text-[#f6f9ff]">
          {game.title}
        </h3>
      </div>
    </div>
  );
}

function InstantGameCard({ game, launching, onPlay, t }) {
  const isLaunching = launching === game.id;
  return (
    <button
      type="button"
      disabled={isLaunching}
      onClick={() => onPlay(game)}
      className="group flex flex-col items-start gap-2 overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-br from-[#111111]/92 to-[#000000]/92 p-4 text-left transition-all hover:ring-1 hover:ring-(--sb-accent-fill)/40 disabled:cursor-wait disabled:opacity-70"
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${game.accent}33` }}
      >
        <AppIcon name="gamepad" size={22} className="text-white" />
      </span>
      <span className="font-bold text-white sm:text-lg">{t(game.nameKey)}</span>
      <span className="text-[11px] leading-snug text-white/60 sm:text-xs">
        {t(game.descKey)}
      </span>
      <span
        className="mt-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
        style={{ backgroundColor: `${game.accent}55` }}
      >
        {isLaunching ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            {t("casino.launching")}
          </>
        ) : (
          t("casino.playNow")
        )}
      </span>
    </button>
  );
}

function Casino() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // null = still checking; false = InOut lobby off (Instant Games still shown).
  const [casinoEnabled, setCasinoEnabled] = useState(null);

  const [frame, setFrame] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [mrxLaunching, setMrxLaunching] = useState(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchCasinoStatus({ signal: ac.signal })
      .then((s) => setCasinoEnabled(s.enabled))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setCasinoEnabled(true);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (casinoEnabled !== true) {
      setLoading(false);
      setGames([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    fetchCasinoGames({ signal: ac.signal })
      .then((list) => {
        setGames(list);
        setError(null);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(err.message || "Failed to load games");
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [casinoEnabled]);

  const handleMrxPlay = useCallback(
    async (game) => {
      setError(null);
      if (!hasAuthToken()) {
        navigate("/login");
        return;
      }
      if (mrxLaunching) return;
      setMrxLaunching(game.id);
      try {
        const ssoToken = await generateMrxSsoToken();
        const targetUrl = new URL(game.path || "/", game.ssoTarget);
        targetUrl.searchParams.set("sso_token", ssoToken);
        window.open(targetUrl.toString(), "_blank", "noopener,noreferrer");
      } catch (err) {
        if (err.message === "NOT_LOGGED_IN") {
          navigate("/login");
          return;
        }
        setError(err.message || "Could not launch game. Please try again.");
      } finally {
        setMrxLaunching(null);
      }
    },
    [mrxLaunching, navigate],
  );

  const handlePlay = useCallback(
    async (game) => {
      if (!hasAuthToken()) {
        navigate("/login");
        return;
      }
      if (launching) return;
      setLaunching(true);
      try {
        const url = await fetchInoutLaunchUrl(game.gameMode, { lang: language });
        setFrame({ url, title: game.title });
      } catch (err) {
        setError(err.message || "Failed to launch game");
      } finally {
        setLaunching(false);
      }
    },
    [launching, language, navigate],
  );

  const handleDemo = useCallback(
    async (game) => {
      if (launching) return;
      setLaunching(true);
      try {
        const url = await fetchInoutDemoLaunchUrl(game.gameMode, language);
        setFrame({ url, title: game.title });
      } catch (err) {
        setError(err.message || "Failed to launch demo");
      } finally {
        setLaunching(false);
      }
    },
    [launching, language],
  );

  return (
    <PageContainer>
      <div className="sticky top-0 z-50">
        <TopHeader data={topHeaderData} />
        <PrimaryNav items={topNavItems} />
      </div>

      <div className="mx-auto w-full max-w-6xl px-2 pt-2 sm:px-3">
        <div className="animate-deposit-panel px-1 pt-1">
          <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
            {t("casino.instantEyebrow")}
          </p>
          <h1 className="m-0 bg-gradient-to-r from-[#ffffff] via-[#ffe8a3] to-[#ffffff] bg-clip-text text-xl font-black tracking-tight text-transparent sm:text-2xl">
            {t("casino.instantTitle")}
          </h1>
          <p className="mt-1 text-xs text-white/50">{t("casino.instantHint")}</p>
        </div>

        {error ? (
          <div className="mx-1 mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3">
          {MRX_GAMES.map((game) => (
            <InstantGameCard
              key={game.id}
              game={game}
              launching={mrxLaunching}
              onPlay={handleMrxPlay}
              t={t}
            />
          ))}
        </div>

        {casinoEnabled === true ? (
          <>
            <div className="animate-deposit-panel mt-4 px-1 pt-1">
              <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
                {t("casino.inoutEyebrow")}
              </p>
              <h2 className="m-0 text-lg font-black tracking-tight text-white sm:text-xl">
                {t("casino.inoutTitle")}
              </h2>
            </div>

            {loading ? (
              <div className="flex items-center justify-center px-4 py-24 text-[rgba(255,255,255,0.72)]">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#F6AF01] border-t-transparent" />
                <span className="ml-3 text-sm font-semibold">
                  {t("casino.loading")}
                </span>
              </div>
            ) : games.length === 0 ? (
              <div className="mx-1 mb-3 mt-3 rounded-[1.25rem] bg-gradient-to-br from-[#111111]/88 to-[#000000]/92 px-4 py-14 text-center">
                <p className="m-0 text-sm font-medium text-[rgba(255,255,255,0.72)]">
                  {t("casino.empty")}
                </p>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3 pb-6 md:grid-cols-3 lg:grid-cols-4">
                {games.map((game) => (
                  <GameCard
                    key={game.gameMode}
                    game={game}
                    onPlay={handlePlay}
                    onDemo={handleDemo}
                    t={t}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

      <SiteFooter />
      <MobileBottomBar />
      <div className="h-16 lg:hidden" />

      {frame ? (
        <GameFrame
          url={frame.url}
          title={frame.title}
          onClose={() => setFrame(null)}
        />
      ) : null}
    </PageContainer>
  );
}

export default Casino;
