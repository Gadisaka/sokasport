import {
  clearAuthSession,
  isPlayerUser,
} from "../utils/authSession.js";

/**
 * Base URL for the API host only (no trailing slash, no `/api` suffix).
 * `VITE_API_URL` may be `http://host:port` or `http://host:port/api` — we normalize
 * so `${getApiOrigin()}/api/...` never becomes `/api/api/...` (which returns 404).
 */
export function getApiOrigin() {
  let s = String(import.meta.env.VITE_API_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  /* Default matches docker-compose backend port and admin Vite proxy (`admin/vite.config.js`). */
  if (!s) return "http://localhost:3001";
  if (s.endsWith("/api"))
    s = s.slice(0, -4).replace(/\/+$/, "") || "http://localhost:3001";
  return s;
}

const API_URL = getApiOrigin();

function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token");
}

/** True when auth token exists (logged-in flows that debit wallet). */
export function hasAuthToken() {
  return Boolean(getToken());
}

function updateStoredUser(user) {
  if (localStorage.getItem("user")) {
    localStorage.setItem("user", JSON.stringify(user));
  } else {
    sessionStorage.setItem("user", JSON.stringify(user));
  }
  window.dispatchEvent(new Event("authSessionUpdated"));
}

function setStoredToken(token) {
  if (localStorage.getItem("token")) {
    localStorage.setItem("token", token);
  } else {
    sessionStorage.setItem("token", token);
  }
}

function persistSessionUser(user, accessToken) {
  if (accessToken) setStoredToken(accessToken);
  updateStoredUser(user);
}

/**
 * GET /api/auth/me — current account (requires auth).
 */
export async function fetchProfile() {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || "Failed to load profile");
  }
  if (!isPlayerUser(data)) {
    clearAuthSession();
    throw new Error("NOT_LOGGED_IN");
  }
  return data;
}

/**
 * PATCH /api/auth/profile — fullname and/or phone (phone: players only). May return new accessToken.
 */
export async function updateProfile(payload) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const res = await fetch(`${API_URL}/api/auth/profile`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || "Failed to update profile");
  }
  if (data.user) {
    persistSessionUser(data.user, data.accessToken);
  }
  return data;
}

/**
 * PATCH /api/auth/change-password
 */
export async function changeAccountPassword({
  oldPassword,
  newPassword,
  confirmPassword,
}) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const res = await fetch(`${API_URL}/api/auth/change-password`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || "Failed to change password");
  }
  return data;
}

export async function fetchFixturesToday() {
  const res = await fetch(`${API_URL}/api/football/fixtures/today`);
  if (!res.ok) throw new Error(`Failed to fetch fixtures today: ${res.status}`);
  return res.json();
}

const UPCOMING_FIXTURES_DAYS = 14;

export async function fetchFixturesUpcoming(
  days = UPCOMING_FIXTURES_DAYS,
  options = {},
) {
  const { signal } = options;
  const safeDays = Math.max(
    1,
    Number.parseInt(days, 10) || UPCOMING_FIXTURES_DAYS,
  );
  const res = await fetch(
    `${API_URL}/api/football/fixtures/upcoming?days=${safeDays}`,
    { signal },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch upcoming fixtures: ${res.status}`);
  }
  return res.json();
}

/**
 * GET /api/football/fixtures?date=YYYY-MM-DD — slim prematch list for one UTC day.
 * @param {string} dateYmd
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
 *   When `timeoutMs` is set and no external `signal` aborts first, the request
 *   is aborted after that many ms (home initial load guardrail).
 */
export async function fetchFixturesByDate(dateYmd, options = {}) {
  const { signal, timeoutMs } = options;
  const safe = encodeURIComponent(String(dateYmd || "").trim());

  let timeoutId;
  let timeoutController;
  let fetchSignal = signal;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutController = new AbortController();
    if (signal) {
      if (signal.aborted) {
        timeoutController.abort(signal.reason);
      } else {
        signal.addEventListener(
          "abort",
          () => timeoutController.abort(signal.reason),
          { once: true },
        );
      }
    }
    timeoutId = setTimeout(() => {
      timeoutController.abort(
        new DOMException(`Fixtures by date timed out after ${timeoutMs}ms`, "TimeoutError"),
      );
    }, timeoutMs);
    fetchSignal = timeoutController.signal;
  }

  try {
    const res = await fetch(`${API_URL}/api/football/fixtures?date=${safe}`, {
      signal: fetchSignal,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch fixtures by date: ${res.status}`);
    }
    return res.json();
  } catch (e) {
    const timedOut =
      timeoutController?.signal?.aborted &&
      (timeoutController.signal.reason?.name === "TimeoutError" ||
        String(timeoutController.signal.reason?.message || "")
          .toLowerCase()
          .includes("timed out"));
    if (timedOut) {
      throw new Error(`Fixtures by date timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
}

export async function fetchFixturesLive(options = {}) {
  const { signal } = options;
  const res = await fetch(`${API_URL}/api/football/fixtures/live`, {
    signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch live fixtures: ${res.status}`);
  return res.json();
}

/**
 * GET /api/football/sidebar-leagues — pinned leagues + leagues with fixtures in odds horizon.
 */
export async function fetchFootballSidebarLeagues(options = {}) {
  const { signal } = options;
  const res = await fetch(`${API_URL}/api/football/sidebar-leagues`, {
    signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch sidebar leagues: ${res.status}`);
  }
  return res.json();
}

export async function fetchOddsForFixture(apiFixtureId, options = {}) {
  const { signal } = options;
  const res = await fetch(`${API_URL}/api/football/odds/${apiFixtureId}`, {
    signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch fixture odds: ${res.status}`);
  return res.json();
}

/**
 * Fetch live odds for all in-play fixtures in one call.
 * Returns real-time elapsed time, scores, and odds.
 */
export async function fetchLiveOdds(options = {}) {
  const { signal } = options;
  const res = await fetch(`${API_URL}/api/football/odds/live`, { signal });
  if (!res.ok) throw new Error(`Failed to fetch live odds: ${res.status}`);
  return res.json();
}

export async function fetchMatches() {
  const fixtures = await fetchFixturesUpcoming(UPCOMING_FIXTURES_DAYS);
  return fixtures;
}

/**
 * GET /api/cms/hero-banners — public; returns { urls: string[] }.
 */
export async function fetchHomeHeroBanners() {
  const res = await fetch(`${API_URL}/api/cms/hero-banners`);
  if (!res.ok) {
    throw new Error(`Failed to fetch hero banners: ${res.status}`);
  }
  return res.json();
}

/**
 * GET /api/cms/site-branding — public; returns { navbarWide, navbarCompact, loadingLogo } (may be "").
 */
export async function fetchPlayerSiteBranding() {
  const res = await fetch(`${API_URL}/api/cms/site-branding`);
  if (!res.ok) {
    throw new Error(`Failed to fetch site branding: ${res.status}`);
  }
  return res.json();
}

/**
 * GET /api/cms/player-info-pages — public; returns { pages, telegramHref }.
 * `telegramHref` is https Telegram URL from CMS or first Contact row, or "".
 */
export async function fetchPlayerInfoPages() {
  const res = await fetch(`${API_URL}/api/cms/player-info-pages`);
  if (!res.ok) {
    throw new Error(`Failed to fetch info pages: ${res.status}`);
  }
  return res.json();
}

/**
 * GET /api/cms/platform-config — public; returns { limits, ticketCancelWindowMinutes, onlineDepositReceivers, winningsTax }.
 */
export async function fetchPublicPlatformConfig() {
  const res = await fetch(`${API_URL}/api/cms/platform-config`);
  if (!res.ok) {
    throw new Error(`Failed to load platform config: ${res.status}`);
  }
  return res.json();
}

/**
 * GET /api/cms/ticket-by-coupon?couponNumber= — public slip check / replay.
 */
export async function fetchPublicCouponTicket(couponNumber) {
  const q = encodeURIComponent(String(couponNumber || "").trim());
  const res = await fetch(
    `${API_URL}/api/cms/ticket-by-coupon?couponNumber=${q}`,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || "Ticket not found");
  }
  return data;
}

export async function fetchMatch(id) {
  const res = await fetch(`${API_URL}/api/dummy/matches/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch match: ${res.status}`);
  const data = await res.json();
  return data.match;
}

/**
 * GET /api/player/wallet — current player wallet balance (requires auth).
 * Returns null if not logged in or wallet unavailable (e.g. non-player session).
 */
export async function fetchPlayerWallet() {
  const token = getToken();
  if (!token) return null;

  const res = await fetch(`${API_URL}/api/player/wallet`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;

  return {
    balance: Number(data.balance ?? 0),
    walletType: data.walletType ?? data.wallet_type,
  };
}

/**
 * GET /api/player/wallet/history — paginated wallet ledger (requires auth).
 * @param {{ page?: number, limit?: number }} opts
 */
export async function fetchPlayerWalletHistory({ page = 1, limit = 20 } = {}) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  const res = await fetch(
    `${API_URL}/api/player/wallet/history?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.message || data.error || "Failed to load transaction history",
    );
  }
  return data;
}

/**
 * POST /api/player/wallet/shop-withdraw — single-use 6-digit code for in-shop withdrawal.
 */
export async function createPlayerShopWithdraw(amount) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const res = await fetch(`${API_URL}/api/player/wallet/shop-withdraw`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ amount }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.message || data.error || "Failed to create withdrawal code",
    );
  }
  return data;
}

/**
 * POST /api/player/wallet/online-deposit — verify bank/mobile payment and credit wallet.
 * @param {{ method: "cbe"|"cbebirr"|"telebirr", amount: number, reference?: string, accountSuffix?: string, receiptNumber?: string, phoneNumber?: string }} payload
 */
export async function submitOnlineDeposit(payload) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const res = await fetch(`${API_URL}/api/player/wallet/online-deposit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.message || data.error || "Online deposit failed",
    );
  }
  return data;
}

/** GET /api/bets/bonuses/active — public active bonus configs for slip preview */
export async function fetchActiveBonuses() {
  const res = await fetch(`${API_URL}/api/bets/bonuses/active`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Failed to load bonuses");
  }
  return data;
}

export async function placeBet(
  selections,
  stake,
  {
    acceptOddsChanges = false,
    freezeToken = null,
    idempotencyKey = null,
  } = {},
) {
  const token = getToken();

  const body = {
    selections: selections.map((s) => ({
      apiFixtureId: s.apiFixtureId,
      matchName: s.matchName,
      marketLabel: s.marketLabel,
      marketCode: s.marketCode,
      marketParams: s.marketParams,
      label: s.label,
      odds: s.acceptedOdds ?? s.value,
      acceptedOdds:
        s.acceptedOdds != null && Number.isFinite(Number(s.acceptedOdds))
          ? Number(s.acceptedOdds)
          : undefined,
      marketVersion:
        s.marketVersion != null && Number.isFinite(Number(s.marketVersion))
          ? Number(s.marketVersion)
          : undefined,
      acceptedMarketVersion:
        s.acceptedMarketVersion != null &&
        Number.isFinite(Number(s.acceptedMarketVersion))
          ? Number(s.acceptedMarketVersion)
          : undefined,
      marketState: s.marketState ? String(s.marketState) : undefined,
      fromLive: Boolean(s.fromLive),
    })),
    stake,
    acceptOddsChanges: Boolean(acceptOddsChanges),
    ...(freezeToken ? { freezeToken } : {}),
  };
  const generatedIdempotencyKey =
    idempotencyKey ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const res = await fetch(`${API_URL}/api/bets/place`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(token ? { "Idempotency-Key": generatedIdempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || data.message || "Failed to place bet");
    error.status = res.status;
    error.code = data.code || null;
    error.details = data;
    error.idempotencyKey = generatedIdempotencyKey;
    throw error;
  }

  if (data?.user) {
    updateStoredUser(data.user);
  }
  return { ...data, idempotencyKey: generatedIdempotencyKey };
}

/** Fallback when API omits marketLabel (matches server MARKET_CODES). */
function formatMarketLabelFromSel(sel) {
  const code = String(sel.marketCode ?? sel.market_code ?? "").toUpperCase();
  const p = sel.marketParams ?? sel.market_params ?? {};
  const lineFromParams = () => {
    if (!p || typeof p !== "object") return null;
    for (const key of ["line", "handicap", "value"]) {
      const n = Number(p[key]);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  switch (code) {
    case "MATCH_WINNER":
      return "Match result";
    case "DOUBLE_CHANCE":
      return "Double chance";
    case "OVER_UNDER": {
      const line = lineFromParams();
      return line != null ? `Over/Under ${line}` : "Over/Under";
    }
    case "BTTS":
      return "Both teams to score";
    case "HANDICAP": {
      const line = lineFromParams();
      return line != null ? `Handicap ${line}` : "Handicap";
    }
    default:
      if (!code) return "";
      return code
        .toLowerCase()
        .split(/_+/g)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  }
}

/** Maps GET /api/player/tickets item shape to BetHistory BetCard props */
function mapPlayerTicketToBet(ticket) {
  const statusMap = {
    OPEN: "pending",
    PRINTED: "pending",
    WON: "won",
    PAID: "won",
    LOST: "lost",
    VOID: "cancelled",
    CANCELED: "cancelled",
    CASHED_OUT: "cancelled",
  };
  const key = String(ticket.status || "").toUpperCase();
  const uiStatus = statusMap[key] || "pending";

  const gross = Number(ticket.potentialWin ?? ticket.potential_win ?? 0);
  const taxVal =
    ticket.winningsTaxAmount != null
      ? Number(ticket.winningsTaxAmount)
      : ticket.winnings_tax_amount != null
        ? Number(ticket.winnings_tax_amount)
        : 0;
  const netVal =
    ticket.netPayout != null
      ? Number(ticket.netPayout)
      : ticket.net_payout != null
        ? Number(ticket.net_payout)
        : gross;

  return {
    id: ticket.id,
    couponNumber: ticket.couponNumber,
    createdAt: ticket.createdAt,
    status: uiStatus,
    rawStatus: key,
    cashout: ticket.cashout
      ? {
          id: ticket.cashout.id,
          amount: Number(ticket.cashout.amount || 0),
          createdAt:
            ticket.cashout.createdAt ?? ticket.cashout.created_at ?? null,
        }
      : null,
    stake: ticket.stake,
    totalOdds: ticket.totalOdds,
    tax: taxVal,
    grossPotentialWin: gross,
    netWin: netVal,
    applyWinningsTax: Boolean(
      ticket.applyWinningsTax ?? ticket.apply_winnings_tax,
    ),
    winningsTaxRate:
      ticket.winningsTaxRate ?? ticket.winnings_tax_rate ?? null,
    selections: (ticket.selections ?? []).map((sel) => {
      const marketLabelRaw =
        sel.marketLabel ?? sel.market_label ?? formatMarketLabelFromSel(sel);
      const marketLabel = String(marketLabelRaw || "").trim() || "Selection";
      const home = sel.match?.homeTeam ?? "";
      const away = sel.match?.awayTeam ?? "";
      const matchName = sel.match
        ? String(away).trim()
          ? `${home} vs ${away}`
          : home || "Match"
        : "Match";
      const kickoff = sel.match?.startTime ?? sel.match?.start_time ?? null;
      return {
        matchName,
        marketLabel,
        label: sel.selection,
        odds: sel.odds,
        result: sel.result,
        matchStartTime: kickoff,
      };
    }),
  };
}

export async function fetchBetHistory() {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const res = await fetch(`${API_URL}/api/player/tickets?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      data.message || data.error || "Failed to fetch bet history",
    );
  }

  const items = Array.isArray(data.items) ? data.items : [];
  return items.map(mapPlayerTicketToBet);
}

export async function fetchPlayerCashoutQuote(ticketId) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");
  const res = await fetch(
    `${API_URL}/api/player/tickets/${ticketId}/cashout-quote`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.message || data.error || "Failed to load cashout quote",
    );
  }
  return data;
}

export async function executePlayerCashout(ticketId) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");
  const res = await fetch(`${API_URL}/api/player/tickets/${ticketId}/cashout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || "Failed to cash out ticket");
  }
  return data;
}

/**
 * PATCH /api/player/tickets/:id/cancel — wallet refund when applicable.
 */
export async function cancelPlayerTicket(ticketId) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const res = await fetch(`${API_URL}/api/player/tickets/${ticketId}/cancel`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.message || data.error || "Could not cancel this ticket",
    );
  }
  return data;
}

function notificationAuthHeaders() {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");
  return { Authorization: `Bearer ${token}` };
}

/** GET /api/notifications */
export async function fetchNotifications({ page = 1, limit = 20, unreadOnly = false } = {}) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (unreadOnly) params.set("unreadOnly", "true");

  const res = await fetch(`${API_URL}/api/notifications?${params}`, {
    headers: notificationAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Failed to load notifications");
  }
  return data;
}

/** GET /api/notifications/unread-count */
export async function fetchNotificationUnreadCount() {
  const res = await fetch(`${API_URL}/api/notifications/unread-count`, {
    headers: notificationAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Failed to load unread count");
  }
  return data;
}

/** PATCH /api/notifications/:id/read */
export async function markNotificationRead(id) {
  const res = await fetch(`${API_URL}/api/notifications/${id}/read`, {
    method: "PATCH",
    headers: notificationAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Failed to mark notification read");
  }
  return data;
}

/** PATCH /api/notifications/read-all */
export async function markAllNotificationsRead() {
  const res = await fetch(`${API_URL}/api/notifications/read-all`, {
    method: "PATCH",
    headers: notificationAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Failed to mark all read");
  }
  return data;
}

/**
 * GET /api/casino/status — public master switch for the casino lobby.
 * Returns { enabled }. Fails open (enabled: true) on network error.
 */
export async function fetchCasinoStatus(options = {}) {
  const { signal } = options;
  try {
    const res = await fetch(`${API_URL}/api/casino/status`, { signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { enabled: true };
    return { enabled: data.enabled !== false };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return { enabled: true };
  }
}

/**
 * GET /api/casino/games — public list of enabled InOut games (ordered).
 * Returns an array of { gameMode, title, description, iconUrl, multiplayer, rtp }.
 */
export async function fetchCasinoGames(options = {}) {
  const { signal } = options;
  const res = await fetch(`${API_URL}/api/casino/games`, { signal });
  const data = await res.json().catch(() => []);
  if (!res.ok) {
    throw new Error(
      (data && data.message) || `Failed to load casino games: ${res.status}`,
    );
  }
  return Array.isArray(data) ? data : [];
}

/**
 * POST /api/casino/inout/launch — real-money launch URL (requires player auth).
 * @param {string} gameMode
 * @param {{ lang?: string, userCountryCode?: string, lobbyUrl?: string }} opts
 * @returns {Promise<string>} launch URL for the iframe.
 */
export async function fetchInoutLaunchUrl(gameMode, opts = {}) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const res = await fetch(`${API_URL}/api/casino/inout/launch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ gameMode, ...opts }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || "Failed to launch game");
  }
  return data.launchUrl;
}

/**
 * GET /api/casino/inout/demo-launch — public demo launch URL for the iframe.
 * @param {string} gameMode
 * @param {string} [lang]
 * @returns {Promise<string>} launch URL for the iframe.
 */
export async function fetchInoutDemoLaunchUrl(gameMode, lang) {
  const params = new URLSearchParams({ gameMode });
  if (lang) params.set("lang", lang);

  const res = await fetch(
    `${API_URL}/api/casino/inout/demo-launch?${params.toString()}`,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || "Failed to launch demo");
  }
  return data.launchUrl;
}

