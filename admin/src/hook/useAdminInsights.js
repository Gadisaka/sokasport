import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const KEY = ["admin", "insights"];

export function useAdminDashboardInsightsQuery({
  from = "",
  to = "",
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: [...KEY, "dashboard", { from, to }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return apiRequest(`/admin/insights/dashboard?${params.toString()}`);
    },
    enabled: Boolean(enabled && from && to),
    keepPreviousData: true,
  });
}

/** Same payload as financial support: player-wallet deposit/withdraw reports. */
export function useAdminFinanceReportsQuery({
  from = "",
  to = "",
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: [...KEY, "finance-reports", { from, to }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return apiRequest(`/admin/finance/reports?${params.toString()}`);
    },
    enabled: Boolean(enabled && from && to),
    keepPreviousData: true,
  });
}

async function fetchAllAdminAgents() {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const params = new URLSearchParams({
      page: String(page),
      limit: "100",
    });
    const res = await apiRequest(`/admin/agents-cashiers/agents?${params}`);
    all.push(...(res.items || []));
    totalPages = Number(res.totalPages) || 1;
    page += 1;
  } while (page <= totalPages);
  return all;
}

async function fetchAllAdminCashiers() {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const params = new URLSearchParams({
      page: String(page),
      limit: "100",
    });
    const res = await apiRequest(`/admin/agents-cashiers/cashiers?${params}`);
    all.push(...(res.items || []));
    totalPages = Number(res.totalPages) || 1;
    page += 1;
  } while (page <= totalPages);
  return all;
}

export function useAdminAgentsForReportsQuery({ enabled = true } = {}) {
  return useQuery({
    queryKey: [...KEY, "agents-for-reports"],
    queryFn: fetchAllAdminAgents,
    enabled: Boolean(enabled),
    staleTime: 60_000,
  });
}

export function useAdminCashiersForReportsQuery({ enabled = true } = {}) {
  return useQuery({
    queryKey: [...KEY, "cashiers-for-reports"],
    queryFn: fetchAllAdminCashiers,
    enabled: Boolean(enabled),
    staleTime: 60_000,
  });
}

/** Ticket sales: stakes and counts; optional agentId + cashierProfileId. */
export function useAdminSalesReportsQuery({
  from = "",
  to = "",
  agentId = "",
  cashierProfileId = "",
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: [
      ...KEY,
      "sales-reports",
      { from, to, agentId, cashierProfileId },
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (agentId) params.set("agentId", agentId);
      if (cashierProfileId) params.set("cashierProfileId", cashierProfileId);
      return apiRequest(`/admin/reports/sales?${params.toString()}`);
    },
    enabled: Boolean(enabled && from && to),
    keepPreviousData: true,
  });
}
