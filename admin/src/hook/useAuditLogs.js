import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

export function useAuditLogsQuery({
  page = 1,
  search = "",
  action = "",
  module = "",
  from = "",
  to = "",
} = {}) {
  return useQuery({
    queryKey: ["admin", "audit-logs", { page, search, action, module, from, to }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      if (search) params.set("search", search);
      if (action) params.set("action", action);
      if (module) params.set("module", module);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return apiRequest(`/admin/audit-logs?${params.toString()}`);
    },
    keepPreviousData: true,
  });
}
