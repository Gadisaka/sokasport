import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

export const CASHIER_DASHBOARD_STATS_KEY = ["cashier", "wallet", "dashboard-stats"];

/**
 * GET /api/cashier/wallet/dashboard-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export function useCashierDashboardStatsQuery({ from, to, enabled = true }) {
  return useQuery({
    queryKey: [...CASHIER_DASHBOARD_STATS_KEY, { from, to }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      return apiRequest(`/cashier/wallet/dashboard-stats?${params.toString()}`);
    },
    enabled: Boolean(enabled && from && to),
  });
}
