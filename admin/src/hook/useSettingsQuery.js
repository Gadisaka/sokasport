import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

// ─── Ticket cancel window ────────────────────────────────────────────────────

export function useCancelWindowQuery() {
  return useQuery({
    queryKey: ["admin", "settings", "cancel-window"],
    queryFn: () => apiRequest("/admin/settings/ticket-cancel-window"),
  });
}

export function useUpdateCancelWindowMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (minutes) =>
      apiRequest("/admin/settings/ticket-cancel-window", {
        method: "PUT",
        body: JSON.stringify({ minutes }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["admin", "settings", "cancel-window"],
      }),
  });
}

// ─── Cashout margin ──────────────────────────────────────────────────────────

export function useCashoutMarginQuery() {
  return useQuery({
    queryKey: ["admin", "settings", "cashout-margin"],
    queryFn: () => apiRequest("/admin/settings/cashout-margin"),
  });
}

export function useUpdateCashoutMarginMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (margin) =>
      apiRequest("/admin/settings/cashout-margin", {
        method: "PUT",
        body: JSON.stringify({ margin }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["admin", "settings", "cashout-margin"],
      }),
  });
}

// ─── Betting limits ──────────────────────────────────────────────────────────

export function useBettingLimitsQuery() {
  return useQuery({
    queryKey: ["admin", "settings", "betting-limits"],
    queryFn: () => apiRequest("/admin/settings/betting-limits"),
  });
}

export function useUpdateBettingLimitsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (limits) =>
      apiRequest("/admin/settings/betting-limits", {
        method: "PUT",
        body: JSON.stringify(limits),
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["admin", "settings", "betting-limits"],
      }),
  });
}

// ─── Home hero banners (player site CMS) ────────────────────────────────────

export function useHomeHeroBannersQuery() {
  return useQuery({
    queryKey: ["admin", "settings", "home-hero-banners"],
    queryFn: () => apiRequest("/admin/settings/home-hero-banners"),
  });
}

export function useUpdateHomeHeroBannersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (urls) =>
      apiRequest("/admin/settings/home-hero-banners", {
        method: "PUT",
        body: JSON.stringify({ urls }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["admin", "settings", "home-hero-banners"],
      }),
  });
}

// ─── Player info pages (FAQ, legal — player site sidebar) ───────────────────

export function usePlayerInfoPagesQuery() {
  return useQuery({
    queryKey: ["admin", "settings", "player-info-pages"],
    queryFn: () => apiRequest("/admin/settings/player-info-pages"),
  });
}

export function useUpdatePlayerInfoPagesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pages) =>
      apiRequest("/admin/settings/player-info-pages", {
        method: "PUT",
        body: JSON.stringify({ pages }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["admin", "settings", "player-info-pages"],
      }),
  });
}

// ─── Player site branding (navbar + loading logos) ─────────────────────────

export function usePlayerSiteBrandingQuery() {
  return useQuery({
    queryKey: ["admin", "settings", "player-site-branding"],
    queryFn: () => apiRequest("/admin/settings/player-site-branding"),
  });
}

export function useUpdatePlayerSiteBrandingMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      apiRequest("/admin/settings/player-site-branding", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["admin", "settings", "player-site-branding"],
      }),
  });
}

// ─── Online deposit receivers (player payment instructions + verify match) ─

export function useOnlineDepositReceiversQuery() {
  return useQuery({
    queryKey: ["admin", "settings", "online-deposit-receivers"],
    queryFn: () => apiRequest("/admin/settings/online-deposit-receivers"),
  });
}

export function useUpdateOnlineDepositReceiversMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (receivers) =>
      apiRequest("/admin/settings/online-deposit-receivers", {
        method: "PUT",
        body: JSON.stringify(receivers),
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["admin", "settings", "online-deposit-receivers"],
      }),
  });
}

// ─── Winnings tax ───────────────────────────────────────────────────────────

export function useWinningsTaxQuery() {
  return useQuery({
    queryKey: ["admin", "settings", "winnings-tax"],
    queryFn: () => apiRequest("/admin/settings/winnings-tax"),
  });
}

export function useUpdateWinningsTaxMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      apiRequest("/admin/settings/winnings-tax", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin", "settings", "winnings-tax"] }),
  });
}

// ─── Bonuses ────────────────────────────────────────────────────────────────

export function useBonusesQuery() {
  return useQuery({
    queryKey: ["admin", "bonuses"],
    queryFn: () => apiRequest("/admin/bonuses"),
    // Global defaults disable refetch-on-focus; bonuses change after `db:seed` in another terminal.
    refetchOnWindowFocus: true,
  });
}

export function useUpdateBonusMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      apiRequest(`/admin/bonuses/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "bonuses"] }),
  });
}
