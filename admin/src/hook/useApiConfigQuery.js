import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const BASE = "/admin/api-config";

export function useBookmakersQuery() {
  return useQuery({
    queryKey: ["admin", "api-config", "bookmakers"],
    queryFn: () => apiRequest(`${BASE}/bookmakers`),
  });
}

export function useBookmakerSamplesQuery(limit = 3) {
  return useQuery({
    queryKey: ["admin", "api-config", "samples", limit],
    queryFn: () => apiRequest(`${BASE}/samples?limit=${limit}`),
  });
}

export function useBookmakerPreferenceQuery() {
  return useQuery({
    queryKey: ["admin", "api-config", "preference"],
    queryFn: () => apiRequest(`${BASE}/bookmaker-preference`),
  });
}

export function useUpdateBookmakerPreferenceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiBookmakerId) =>
      apiRequest(`${BASE}/bookmaker-preference`, {
        method: "PUT",
        body: JSON.stringify({ apiBookmakerId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "api-config"] });
    },
  });
}

export function useRefreshOddsNowMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(`${BASE}/refresh-odds`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "api-config"] });
    },
  });
}

/**
 * Pulls the full bookmaker catalog from API-Sports `/odds/bookmakers` and
 * upserts it into the local table. Used by the "Sync from upstream"
 * button on the API Configuration page so admins can pick a bookmaker
 * even before any odds have been ingested.
 */
export function useSyncBookmakersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(`${BASE}/sync-bookmakers`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "api-config"] });
    },
  });
}
