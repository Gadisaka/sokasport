import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const BASE = "/admin/casino";

/** Full catalog incl. disabled games (casino:read). */
export function useCasinoGamesQuery() {
  return useQuery({
    queryKey: ["admin", "casino", "games"],
    queryFn: () => apiRequest(`${BASE}/games`),
  });
}

/** Toggle enabled / set sort_order for one game (casino:manage). */
export function useUpdateCasinoGameMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled, sort_order }) =>
      apiRequest(`${BASE}/games/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled, sort_order }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "casino", "games"] });
    },
  });
}

/** Master switch state — whether the player /casino page is on (casino:read). */
export function useCasinoStatusQuery() {
  return useQuery({
    queryKey: ["admin", "casino", "status"],
    queryFn: () => apiRequest(`${BASE}/status`),
  });
}

/** Turn the whole player /casino page on/off (casino:manage). */
export function useUpdateCasinoStatusMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled) =>
      apiRequest(`${BASE}/status`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "casino", "status"] });
    },
  });
}

/** Re-sync the catalog from InOut (casino:manage). */
export function useSyncCasinoCatalogMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest(`${BASE}/sync`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "casino", "games"] });
    },
  });
}

/** Casino reports (GGR, transactions, top players) for a date range. */
export function useCasinoReportsQuery({ from, to, enabled = true }) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return useQuery({
    queryKey: ["admin", "casino", "reports", from, to],
    queryFn: () => apiRequest(`${BASE}/reports?${params.toString()}`),
    enabled,
  });
}
