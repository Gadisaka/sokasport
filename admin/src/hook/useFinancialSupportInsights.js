import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const KEY = ["financial-support", "insights"];

export function useFinancialSupportDashboardQuery({
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
      return apiRequest(`/admin/finance/dashboard?${params.toString()}`);
    },
    enabled: Boolean(enabled && from && to),
    keepPreviousData: true,
  });
}

export function useFinancialSupportReportsQuery({
  from = "",
  to = "",
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: [...KEY, "reports", { from, to }],
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
