import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const KEY = ["agent", "operations"];

function withQuery(path, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function useAgentGamesQuery({
  page = 1,
  limit = 20,
  date = "",
  status = "",
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: [...KEY, "games", { page, limit, date, status }],
    queryFn: () =>
      apiRequest(
        withQuery("/admin/games/matches", {
          page,
          limit,
          date,
          status,
        }),
      ),
    enabled,
    keepPreviousData: true,
  });
}

export function useAgentTicketsQuery({
  page = 1,
  limit = 20,
  date = "",
  status = "",
  couponNumber = "",
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: [...KEY, "tickets", { page, limit, date, status, couponNumber }],
    queryFn: () =>
      apiRequest(
        withQuery("/tickets", {
          page,
          limit,
          date,
          status,
          couponNumber,
        }),
      ),
    enabled,
    keepPreviousData: true,
  });
}

export function useAgentReportsQuery({
  from = "",
  to = "",
  branchName = "all",
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: [...KEY, "reports", { from, to, branchName }],
    queryFn: () =>
      apiRequest(
        withQuery("/agent/reports", {
          from,
          to,
          branchName: branchName === "all" ? "" : branchName,
        }),
      ),
    enabled,
    keepPreviousData: true,
  });
}

/**
 * GET /api/tickets/:id — full ticket (agent-scoped on backend)
 */
export function useAgentTicketDetailQuery(ticketId, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...KEY, "ticket-detail", ticketId],
    queryFn: () => apiRequest(`/tickets/${ticketId}`),
    enabled: Boolean(enabled && ticketId),
  });
}

/**
 * GET /api/agent/cashier-wallet-activity
 */
export function useAgentCashierWalletActivityQuery({
  from = "",
  to = "",
  cashierProfileId = "",
  /** Player-centric: `deposit` = to player wallet, `withdraw` = from player wallet */
  flow = "",
  page = 1,
  limit = 20,
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: [
      ...KEY,
      "cashier-wallet-activity",
      { from, to, cashierProfileId, flow, page, limit },
    ],
    queryFn: () =>
      apiRequest(
        withQuery("/agent/cashier-wallet-activity", {
          from,
          to,
          cashierProfileId,
          flow,
          page,
          limit,
        }),
      ),
    enabled: Boolean(enabled && from && to),
    keepPreviousData: true,
  });
}
