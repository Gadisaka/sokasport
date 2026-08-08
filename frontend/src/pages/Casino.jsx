import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

function GameCard({ game, onPlay }) {
  return (
    <button
      type="button"
      onClick={() => onPlay(game)}
      className="group relative aspect-square w-full cursor-pointer overflow-hidden rounded-2xl border border-(--sb-accent-border) bg-[#0a0a0a] p-0 text-left transition-all hover:ring-1 hover:ring-(--sb-accent-fill)/60"
    >
      {game.iconUrl ? (
        <img
          src={game.iconUrl}
          alt={game.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[#3a3a3a]">
          <AppIcon name="gamepad" size={40} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-1.5 pb-1.5 pt-6">
        <h3 className="truncate text-[12px] font-semibold text-[#f6f9ff]">
          {game.title}
        </h3>
      </div>
    </button>
  );
}

function InstantGameCard({ game, launching, onPlay, t }) {
  const isLaunching = launching === game.id;
  const title = t(game.nameKey);
  return (
    <button
      type="button"
      disabled={isLaunching}
      onClick={() => onPlay(game)}
      className="group relative aspect-square w-full cursor-pointer overflow-hidden rounded-2xl border border-(--sb-accent-border) bg-[#0a0a0a] p-0 text-left transition-all hover:ring-1 hover:ring-(--sb-accent-fill)/60 disabled:cursor-wait disabled:opacity-70"
    >
      <img
        src={game.iconUrl}
        alt={title}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {isLaunching ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-1.5 pb-1.5 pt-6">
        <h3 className="truncate text-[12px] font-semibold text-[#f6f9ff]">
          {title}
        </h3>
      </div>
    </button>
  );
}

function Casino() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const launchId = searchParams.get("launch");
  const handledLaunchRef = useRef(null);

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

  const clearLaunchParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("launch");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

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
        window.location.assign(targetUrl.toString());
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

  useEffect(() => {
    if (!launchId) {
      handledLaunchRef.current = null;
      return;
    }
    if (handledLaunchRef.current === launchId) return;

    const mrxGame = MRX_GAMES.find((g) => g.id === launchId);
    if (mrxGame) {
      handledLaunchRef.current = launchId;
      clearLaunchParam();
      handleMrxPlay(mrxGame);
      return;
    }

    if (launchId !== "chicken-road") {
      handledLaunchRef.current = launchId;
      clearLaunchParam();
      return;
    }

    if (casinoEnabled === null) return;
    if (casinoEnabled === true && loading) return;

    handledLaunchRef.current = launchId;
    clearLaunchParam();
    const game = games.find((g) => g.gameMode === "chicken-road");
    if (!game) {
      setError("Chicken Road is not available right now.");
      return;
    }
    handlePlay(game);
  }, [
    launchId,
    casinoEnabled,
    loading,
    games,
    clearLaunchParam,
    handleMrxPlay,
    handlePlay,
  ]);

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

        <div className="mt-3 grid grid-cols-3 gap-2 pb-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
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
