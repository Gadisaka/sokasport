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
import kenoThumb from "../assets/games/keno.png";
import aviatorThumb from "../assets/games/aviator.png";
import bingoThumb from "../assets/games/bingo.png";

const GAME_BASE_URL =
  import.meta.env.VITE_GAME_BASE_URL || "https://games.sokasports.com";

const MRX_GAMES = [
  {
    id: "keno",
    nameKey: "casino.kenoName",
    iconUrl: kenoThumb,
    ssoTarget: GAME_BASE_URL,
    path: "/game/keno",
  },
  {
    id: "aviator",
    nameKey: "casino.aviatorName",
    iconUrl: aviatorThumb,
    ssoTarget: GAME_BASE_URL,
    path: "/game/aviator",
  },
  {
    id: "bingo",
    nameKey: "casino.bingoName",
    iconUrl: bingoThumb,
    ssoTarget: GAME_BASE_URL,
    path: "/game/bingo",
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
  const title = t(game.nameKey);
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-br from-[#111111]/92 to-[#000000]/92 transition-all hover:ring-1 hover:ring-(--sb-accent-fill)/40">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#0a0a0a]">
        <img
          src={game.iconUrl}
          alt={title}
          loading="lazy"
          className="h-full w-full object-contain p-1"
        />

        <div className="pointer-events-none absolute inset-x-2 bottom-2">
          <div className="pointer-events-auto rounded-xl border border-white/25 bg-white/12 p-1.5 backdrop-blur-md">
            <button
              type="button"
              disabled={isLaunching}
              onClick={() => onPlay(game)}
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-(--sb-accent-fill) px-2 py-1.5 text-[12px] font-bold text-[#000000] transition-all hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
            >
              {isLaunching ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                  {t("casino.launching")}
                </>
              ) : (
                t("casino.play")
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <h3 className="truncate text-[13px] font-semibold text-[#f6f9ff]">
          {title}
        </h3>
      </div>
    </div>
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
            {t("casino.eyebrow")}
          </p>
          <h1 className="m-0 bg-gradient-to-r from-[#ffffff] via-[#ffe8a3] to-[#ffffff] bg-clip-text text-xl font-black tracking-tight text-transparent sm:text-2xl">
            {t("casino.inoutTitle")}
          </h1>
        </div>

        {error ? (
          <div className="mx-1 mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-3 pb-6 md:grid-cols-3 lg:grid-cols-4">
          {MRX_GAMES.map((game) => (
            <InstantGameCard
              key={game.id}
              game={game}
              launching={mrxLaunching}
              onPlay={handleMrxPlay}
              t={t}
            />
          ))}

          {casinoEnabled === true && !loading
            ? games.map((game) => (
                <GameCard
                  key={game.gameMode}
                  game={game}
                  onPlay={handlePlay}
                  onDemo={handleDemo}
                  t={t}
                />
              ))
            : null}
        </div>

        {casinoEnabled === true && loading ? (
          <div className="flex items-center justify-center px-4 py-12 text-[rgba(255,255,255,0.72)]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#F6AF01] border-t-transparent" />
            <span className="ml-3 text-sm font-semibold">
              {t("casino.loading")}
            </span>
          </div>
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
