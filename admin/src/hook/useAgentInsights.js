import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const KEY = ["agent", "insights"];

function buildParams({ from, to, branchName }) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (branchName && branchName !== "all") params.set("branchName", branchName);
  return params.toString();
}

export function useAgentDashboardQuery({ from, to, branchName }) {
  return useQuery({
    queryKey: [...KEY, "dashboard", { from, to, branchName }],
    queryFn: () => {
      const query = buildParams({ from, to, branchName });
      const suffix = query ? `?${query}` : "";
      return apiRequest(`/agent/dashboard${suffix}`);
    },
    enabled: Boolean(from && to),
    keepPreviousData: true,
  });
}

export function useAgentCashiersQuery({ from, to, branchName }) {
  return useQuery({
    queryKey: [...KEY, "cashiers", { from, to, branchName }],
    queryFn: () => {
      const query = buildParams({ from, to, branchName });
      const suffix = query ? `?${query}` : "";
      return apiRequest(`/agent/cashiers${suffix}`);
    },
    enabled: Boolean(from && to),
    keepPreviousData: true,
  });
}
